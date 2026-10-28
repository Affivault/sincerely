import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { billingService } from './billing.service.js';
import { CREDIT_PRICE_LIST } from '@lemlist/shared';
import type { CreditActionTotal, CreditLedgerEntry, CreditUsageReport, ProspectCreditsSummary } from '@lemlist/shared';

/*
 * Credits: one balance for every paid action (search pages, found emails,
 * deep checks, enrichments). Hard-capped: a spend that does not fit is
 * refused and nothing runs. There is no overage and nothing to buy; the
 * plan's credits reset on the 1st (UTC).
 */

// UTC, not local time: matches billing.service.ts's currentPeriodStart(), so
// the credit reset and the billing period agree whatever the server's TZ.
function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
function nextMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/** Ledger sums are numeric strings from Postgres and floats in JS: keep one decimal. */
const tenth = (n: number) => Math.round(n * 10) / 10;
const sum = (rows: any[] | null) => tenth((rows || []).reduce((s, r) => s + (Number(r.delta) || 0), 0));

export const OUT_OF_CREDITS = 'You’re out of credits for this month. They reset on the 1st, or upgrade your plan for more.';

export class OutOfCreditsError extends AppError {
  constructor(message = OUT_OF_CREDITS) {
    super(message, 403);
  }
}

/** Insert a ledger row; without the action column while migration 100 is not run. */
async function insertLedger(row: Record<string, any>) {
  let { error } = await supabaseAdmin.from('prospect_credit_ledger').insert(row);
  if (error && /action/.test(error.message || '')) {
    const { action: _skip, ...rest } = row;
    ({ error } = await supabaseAdmin.from('prospect_credit_ledger').insert(rest));
  }
  if (error) console.error(`[Credits] Ledger write failed for ${row.user_id}: ${error.message}`);
}

export interface SpendInput {
  amount: number;
  action: string;
  reason?: string;
  provider?: string | null;
  ref?: string | null;
}

export const creditsService = {
  async summary(userId: string): Promise<ProspectCreditsSummary> {
    const allowance = await billingService.getCreditAllowance(userId);

    const { data: planRows, error: planError } = await supabaseAdmin
      .from('prospect_credit_ledger')
      .select('delta')
      .eq('user_id', userId)
      .eq('bucket', 'plan')
      .gte('created_at', monthStartIso());
    if (planError) throw new AppError(planError.message, 500);
    const used = Math.max(0, -sum(planRows));
    const planRemaining = allowance < 0 ? -1 : Math.max(0, tenth(allowance - used));

    // Credits bought before packs were withdrawn still spend, after the plan's.
    const { data: purchasedRows, error: purchasedError } = await supabaseAdmin
      .from('prospect_credit_ledger')
      .select('delta')
      .eq('user_id', userId)
      .eq('bucket', 'purchased');
    if (purchasedError) throw new AppError(purchasedError.message, 500);
    const purchased = Math.max(0, sum(purchasedRows));

    return {
      allowance,
      used,
      plan_remaining: planRemaining,
      purchased,
      remaining: allowance < 0 ? -1 : tenth(planRemaining + purchased),
      resets_at: nextMonthIso(),
    };
  },

  /**
   * Spend atomically, or throw OutOfCreditsError and spend nothing.
   * Returns the bucket it came from, for the refund.
   */
  async spend(userId: string, input: SpendInput): Promise<string> {
    const allowance = await billingService.getCreditAllowance(userId);
    const args: Record<string, any> = {
      p_user_id: userId,
      p_amount: input.amount,
      p_allowance: allowance,
      p_reason: input.reason ?? input.action,
      p_provider: input.provider ?? null,
      p_provider_person_id: input.ref ?? null,
      p_action: input.action,
    };
    let { data, error } = await supabaseAdmin.rpc('try_spend_prospect_credits', args);
    if (error && /p_action|function|schema cache/i.test(error.message || '')) {
      // Migration 100 not run yet: the old function takes whole credits only.
      const { p_action: _skip, ...old } = args;
      ({ data, error } = await supabaseAdmin.rpc('try_spend_prospect_credits', { ...old, p_amount: Math.ceil(input.amount) }));
    }
    if (error) throw new AppError(error.message, 500);
    const bucket: string | null = (Array.isArray(data) ? data[0] : data)?.spent_bucket ?? null;
    if (!bucket) throw new OutOfCreditsError();
    return bucket;
  },

  /** Give back a spend that bought nothing. */
  async refund(userId: string, input: SpendInput & { bucket: string }): Promise<void> {
    await insertLedger({
      user_id: userId, delta: input.amount, kind: 'refund', reason: input.reason ?? input.action,
      provider: input.provider ?? null, provider_person_id: input.ref ?? null, bucket: input.bucket, action: input.action,
    });
  },

  /** The usage page: balance, prices, this month by action, recent charges. */
  async report(userId: string): Promise<CreditUsageReport> {
    const [credits, trialCapped] = await Promise.all([this.summary(userId), billingService.isTrialCapped(userId)]);

    let { data: rows, error } = await supabaseAdmin
      .from('prospect_credit_ledger')
      .select('id, delta, kind, action, reason, created_at')
      .eq('user_id', userId)
      .gte('created_at', monthStartIso())
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error && /action/.test(error.message || '')) {
      ({ data: rows, error } = await supabaseAdmin
        .from('prospect_credit_ledger')
        .select('id, delta, kind, reason, created_at')
        .eq('user_id', userId)
        .gte('created_at', monthStartIso())
        .order('created_at', { ascending: false })
        .limit(2000) as any);
    }
    if (error) throw new AppError(error.message, 500);

    const totals = new Map<string, CreditActionTotal>();
    for (const r of (rows || []) as any[]) {
      if (r.kind !== 'spend' && r.kind !== 'refund') continue;
      const action = r.action || (r.kind === 'spend' ? r.reason : null) || 'other';
      const t = totals.get(action) || { action, credits: 0, count: 0 };
      t.credits = tenth(t.credits - Number(r.delta || 0));
      t.count += r.kind === 'spend' ? 1 : -1;
      totals.set(action, t);
    }
    const history: CreditLedgerEntry[] = ((rows || []) as any[]).slice(0, 100).map((r) => ({
      id: r.id, delta: tenth(Number(r.delta) || 0), kind: r.kind, action: r.action ?? null, reason: r.reason ?? null, created_at: r.created_at,
    }));

    return {
      credits,
      prices: CREDIT_PRICE_LIST,
      trial_capped: trialCapped,
      by_action: [...totals.values()].filter((t) => t.credits > 0 || t.count > 0).map((t) => ({ ...t, count: Math.max(0, t.count) })).sort((a, b) => b.credits - a.credits),
      history,
    };
  },
};
