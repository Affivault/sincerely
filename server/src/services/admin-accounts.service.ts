import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { isOwnerEmail } from '../config/admin.js';
import { billingService } from './billing.service.js';
import { creditsService } from './credits.service.js';
import { accountControls } from './account-controls.service.js';
import { cents, fetchAllUsers, monthRange, stripeFee } from './admin.service.js';
import { PLANS, type PlanId } from '@lemlist/shared';
import type {
  AdminAccountDetail, AdminAccountRow, AdminAccountsResponse, AdminAuditEntry, AdminAuditResponse, AdminMonthRow,
} from '@lemlist/shared';

/*
 * The admin backend's accounts: every account with what it uses, costs and
 * pays, one account in full, and the controls the owner has over it (plan,
 * credit allowance, credit adjustments, suspension, a private note). Every
 * change is written to admin_audit_log.
 *
 * Suspension, notes and the log live in tables from migration 101. Until it
 * is run the rest still works and controls_ready says why those do not.
 */

const tenth = (n: number) => Math.round(n * 10) / 10;
const EPOCH = '2000-01-01T00:00:00.000Z';
const FOREVER = '2100-01-01T00:00:00.000Z';
/** Supabase has no "banned forever": a hundred years is the usual stand-in. */
const BAN_FOREVER = '876000h';
const ALLOWED_STATUSES = new Set(['active', 'trialing', 'free', 'past_due', 'canceled']);

const missingTable = (msg: string | undefined) => /account_controls|admin_audit_log|does not exist|schema cache/i.test(msg || '');

async function fetchSubscriptionRows(): Promise<Map<string, any>> {
  const { data, error } = await supabaseAdmin.from('subscriptions').select('*');
  if (error) throw new AppError(error.message, 500);
  return new Map((data || []).map((s: any) => [s.user_id, s]));
}

async function fetchControls(): Promise<{ ready: boolean; rows: Map<string, any> }> {
  const { data, error } = await supabaseAdmin.from('account_controls').select('user_id, suspended_at, suspended_reason, note');
  if (error) return { ready: false, rows: new Map() };
  return { ready: true, rows: new Map((data || []).map((r: any) => [r.user_id, r])) };
}

async function getUser(userId: string) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data?.user) throw new AppError('No account with that id.', 404);
  return data.user;
}

async function getSubscriptionRow(userId: string): Promise<any | null> {
  const { data, error } = await supabaseAdmin.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new AppError(error.message, 500);
  return data ?? null;
}

/** Update the account's subscription row, creating one on Free if it has none (the table defaults to a trial). */
async function writeSubscription(userId: string, patch: Record<string, any>) {
  const existing = await getSubscriptionRow(userId);
  const now = new Date().toISOString();
  const { error } = existing
    ? await supabaseAdmin.from('subscriptions').update({ ...patch, updated_at: now }).eq('user_id', userId)
    : await supabaseAdmin.from('subscriptions').insert({ user_id: userId, plan: 'free', status: 'free', ...patch, updated_at: now });
  if (error) throw new AppError(error.message, 500);
  return existing;
}

async function writeControls(userId: string, patch: Record<string, any>) {
  const { error } = await supabaseAdmin
    .from('account_controls')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    if (missingTable(error.message)) throw new AppError('This needs database migration 101 to be run first.', 503);
    throw new AppError(error.message, 500);
  }
}

async function countFor(table: string, userId: string): Promise<number> {
  const { count } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId);
  return count || 0;
}

/** Month keys (YYYY-MM), newest first. */
function lastMonths(n: number): string[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}

export const adminAccountsService = {
  /** Write one line to the audit log. Never fails the action it records. */
  async audit(actorEmail: string, action: string, target: { id: string | null; email: string | null }, details: Record<string, any> = {}) {
    const { error } = await supabaseAdmin.from('admin_audit_log').insert({
      actor_email: actorEmail, action, target_user_id: target.id, target_email: target.email, details,
    });
    if (error) console.warn(`[Admin] Audit log write failed (${action} on ${target.email}): ${error.message}`);
  },

  async auditLog(limit = 100, userId?: string): Promise<AdminAuditResponse> {
    let q = supabaseAdmin.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(Math.min(500, Math.max(1, limit)));
    if (userId) q = q.eq('target_user_id', userId);
    const { data, error } = await q;
    if (error) return { entries: [], controls_ready: !missingTable(error.message) };
    return { entries: (data || []) as AdminAuditEntry[], controls_ready: true };
  },

  async list(month?: string): Promise<AdminAccountsResponse> {
    const range = monthRange(month);
    const from = range.from.toISOString(), to = range.to.toISOString();
    const [users, subs, controls, costs, charged, payments, lifetimeCosts, allPayments] = await Promise.all([
      fetchAllUsers(),
      fetchSubscriptionRows(),
      fetchControls(),
      supabaseAdmin.rpc('admin_provider_costs', { p_from: from, p_to: to }),
      supabaseAdmin.rpc('admin_credits_charged', { p_from: from, p_to: to }),
      supabaseAdmin.from('billing_payments').select('user_id, amount_usd').gte('paid_at', from).lt('paid_at', to).limit(100000),
      supabaseAdmin.rpc('admin_provider_costs', { p_from: EPOCH, p_to: FOREVER }),
      supabaseAdmin.from('billing_payments').select('user_id, amount_usd').limit(100000),
    ]);
    for (const r of [costs, charged, payments, lifetimeCosts, allPayments]) {
      if (r.error) {
        if (/admin_provider_costs|admin_credits_charged|billing_payments|provider_usage/.test(r.error.message)) {
          throw new AppError('Accounts need database migration 100 to be run first.', 503);
        }
        throw new AppError(r.error.message, 500);
      }
    }

    const add = (m: Map<string, number>, id: string | null, n: number) => { if (id) m.set(id, (m.get(id) || 0) + n); };
    const cost = new Map<string, number>(), used = new Map<string, number>();
    const revenue = new Map<string, number>(), fees = new Map<string, number>();
    const lifeCost = new Map<string, number>(), lifeRevenue = new Map<string, number>(), lifeFees = new Map<string, number>();
    for (const r of (costs.data || []) as any[]) add(cost, r.user_id, Number(r.cost_usd) || 0);
    for (const r of (charged.data || []) as any[]) if (r.action !== 'topup') add(used, r.user_id, Number(r.credits) || 0);
    for (const r of (payments.data || []) as any[]) { const a = Number(r.amount_usd) || 0; add(revenue, r.user_id, a); add(fees, r.user_id, stripeFee(a)); }
    for (const r of (lifetimeCosts.data || []) as any[]) add(lifeCost, r.user_id, Number(r.cost_usd) || 0);
    for (const r of (allPayments.data || []) as any[]) { const a = Number(r.amount_usd) || 0; add(lifeRevenue, r.user_id, a); add(lifeFees, r.user_id, stripeFee(a)); }

    const accounts: AdminAccountRow[] = users.map((u: any) => {
      const sub = subs.get(u.id) || null;
      const ctl = controls.rows.get(u.id);
      const suspended = !!ctl?.suspended_at;
      const c = cost.get(u.id) || 0, rev = revenue.get(u.id) || 0, fee = fees.get(u.id) || 0;
      const lc = lifeCost.get(u.id) || 0, lr = lifeRevenue.get(u.id) || 0, lf = lifeFees.get(u.id) || 0;
      const custom = sub?.credit_allowance !== null && sub?.credit_allowance !== undefined;
      return {
        id: u.id,
        email: u.email || '(no email)',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        email_confirmed: !!u.email_confirmed_at,
        plan: sub?.plan || 'free',
        status: sub?.status || 'free',
        effective_plan: billingService.planFromSubscription(sub),
        suspended,
        has_stripe: !!sub?.stripe_customer_id,
        credits_used: tenth(used.get(u.id) || 0),
        credit_allowance: suspended ? 0 : billingService.creditAllowanceFor(sub),
        custom_allowance: custom,
        cost_usd: cents(c),
        revenue_usd: cents(rev),
        profit_usd: cents(rev - fee - c),
        lifetime_revenue_usd: cents(lr),
        lifetime_profit_usd: cents(lr - lf - lc),
        losing: c > 0 && c > rev - fee,
      };
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return { month: range.label, accounts, controls_ready: controls.ready };
  },

  async detail(userId: string): Promise<AdminAccountDetail> {
    const user = await getUser(userId);
    const months = lastMonths(6);
    const since = `${months[months.length - 1]}-01T00:00:00.000Z`;

    const [sub, controlsRes, credits, limits, sent, inboxes, usageRes, ledgerRes, paymentsRes, lifeUsageRes, lifeLedgerRes, mailboxes, domains, contacts, campaigns, audit] = await Promise.all([
      getSubscriptionRow(userId),
      supabaseAdmin.from('account_controls').select('suspended_at, suspended_reason, note').eq('user_id', userId).maybeSingle(),
      creditsService.summary(userId),
      billingService.getLimits(userId),
      billingService.getEmailsSentThisPeriod(userId),
      billingService.countInboxes(userId),
      supabaseAdmin.from('provider_usage').select('id, action, endpoint, provider_credits, cost_usd, created_at').eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(20000),
      supabaseAdmin.from('prospect_credit_ledger').select('id, delta, kind, bucket, action, reason, created_at').eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(20000),
      supabaseAdmin.from('billing_payments').select('id, kind, amount_usd, currency, stripe_ref, paid_at').eq('user_id', userId).order('paid_at', { ascending: false }).limit(500),
      supabaseAdmin.from('provider_usage').select('cost_usd').eq('user_id', userId).limit(100000),
      supabaseAdmin.from('prospect_credit_ledger').select('delta, kind').eq('user_id', userId).in('kind', ['spend', 'refund']).limit(100000),
      countFor('smtp_accounts', userId),
      countFor('sending_domains', userId),
      countFor('contacts', userId),
      countFor('campaigns', userId),
      this.auditLog(30, userId),
    ]);
    for (const r of [usageRes, ledgerRes, paymentsRes, lifeUsageRes, lifeLedgerRes]) {
      if (r.error) throw new AppError(r.error.message, 500);
    }
    const controlsReady = !controlsRes.error;
    const controls = controlsRes.data || null;

    const byMonth = new Map<string, AdminMonthRow>(months.map((m) => [m, { month: m, credits_used: 0, provider_credits: 0, cost_usd: 0, revenue_usd: 0, fees_usd: 0, profit_usd: 0 }]));
    const monthOf = (iso: string) => byMonth.get(String(iso).slice(0, 7));
    for (const r of (usageRes.data || []) as any[]) {
      const m = monthOf(r.created_at); if (!m) continue;
      m.provider_credits += Number(r.provider_credits) || 0; m.cost_usd += Number(r.cost_usd) || 0;
    }
    for (const r of (ledgerRes.data || []) as any[]) {
      if (r.kind !== 'spend' && r.kind !== 'refund') continue;
      const m = monthOf(r.created_at); if (m) m.credits_used -= Number(r.delta) || 0;
    }
    const payments = ((paymentsRes.data || []) as any[]).map((p) => ({ ...p, amount_usd: Number(p.amount_usd) || 0 }));
    for (const p of payments) {
      const m = monthOf(p.paid_at); if (!m) continue;
      m.revenue_usd += p.amount_usd; m.fees_usd += stripeFee(p.amount_usd);
    }
    const monthRows = [...byMonth.values()].map((m) => ({
      ...m,
      credits_used: tenth(m.credits_used),
      provider_credits: Math.round(m.provider_credits * 100) / 100,
      cost_usd: cents(m.cost_usd),
      revenue_usd: cents(m.revenue_usd),
      fees_usd: cents(m.fees_usd),
      profit_usd: cents(m.revenue_usd - m.fees_usd - m.cost_usd),
    }));

    const lifeCost = ((lifeUsageRes.data || []) as any[]).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
    const lifeRevenue = payments.reduce((s, p) => s + p.amount_usd, 0);
    const lifeFees = payments.reduce((s, p) => s + stripeFee(p.amount_usd), 0);
    const lifeUsed = -((lifeLedgerRes.data || []) as any[]).reduce((s, r) => s + (Number(r.delta) || 0), 0);
    const thisMonth = monthRows[0];

    const suspended = !!controls?.suspended_at;
    const account: AdminAccountRow = {
      id: user.id,
      email: user.email || '(no email)',
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at || null,
      email_confirmed: !!user.email_confirmed_at,
      plan: sub?.plan || 'free',
      status: sub?.status || 'free',
      effective_plan: billingService.planFromSubscription(sub),
      suspended,
      has_stripe: !!sub?.stripe_customer_id,
      credits_used: thisMonth.credits_used,
      credit_allowance: credits.allowance,
      custom_allowance: sub?.credit_allowance !== null && sub?.credit_allowance !== undefined,
      cost_usd: thisMonth.cost_usd,
      revenue_usd: thisMonth.revenue_usd,
      profit_usd: thisMonth.profit_usd,
      lifetime_revenue_usd: cents(lifeRevenue),
      lifetime_profit_usd: cents(lifeRevenue - lifeFees - lifeCost),
      losing: thisMonth.cost_usd > 0 && thisMonth.cost_usd > thisMonth.revenue_usd - thisMonth.fees_usd,
    };

    return {
      account,
      subscription: sub ? {
        plan: sub.plan, status: sub.status,
        trial_ends_at: sub.trial_ends_at ?? null, current_period_end: sub.current_period_end ?? null,
        stripe_customer_id: sub.stripe_customer_id ?? null, stripe_subscription_id: sub.stripe_subscription_id ?? null,
        credit_allowance: sub.credit_allowance === null || sub.credit_allowance === undefined ? null : Number(sub.credit_allowance),
      } : null,
      controls: {
        suspended_at: controls?.suspended_at ?? null,
        suspended_reason: controls?.suspended_reason ?? null,
        note: controls?.note ?? null,
      },
      credits: {
        allowance: credits.allowance, used: credits.used, plan_remaining: credits.plan_remaining,
        bonus: credits.purchased, remaining: credits.remaining, resets_at: credits.resets_at,
      },
      emails: { sent, limit: limits.emailsPerMonth, inboxes, inbox_limit: limits.maxInboxes },
      totals: {
        lifetime_revenue_usd: cents(lifeRevenue),
        lifetime_cost_usd: cents(lifeCost),
        lifetime_fees_usd: cents(lifeFees),
        lifetime_profit_usd: cents(lifeRevenue - lifeFees - lifeCost),
        lifetime_credits_used: tenth(lifeUsed),
      },
      months: monthRows,
      ledger: ((ledgerRes.data || []) as any[]).slice(0, 100).map((r) => ({ ...r, delta: Number(r.delta) || 0 })),
      calls: ((usageRes.data || []) as any[]).slice(0, 100).map((r) => ({ ...r, provider_credits: Number(r.provider_credits) || 0, cost_usd: Number(r.cost_usd) || 0 })),
      payments,
      resources: { mailboxes, domains, contacts, campaigns },
      audit: audit.entries,
      controls_ready: controlsReady,
    };
  },

  /* ─── Controls ─────────────────────────────────────────────────────── */

  async setPlan(actor: string, userId: string, plan: string, status?: string) {
    if (!PLANS[plan as PlanId]) throw new AppError('Unknown plan.', 400);
    const nextStatus = status || (plan === 'free' ? 'free' : 'active');
    if (!ALLOWED_STATUSES.has(nextStatus)) throw new AppError('Unknown status.', 400);
    const user = await getUser(userId);
    const before = await writeSubscription(userId, { plan, status: nextStatus });
    await this.audit(actor, 'plan', { id: userId, email: user.email || null }, {
      from: { plan: before?.plan || 'free', status: before?.status || 'free' },
      to: { plan, status: nextStatus },
    });
    // Stripe owns a paying subscription: its next webhook writes its own plan back.
    return { stripe_managed: !!before?.stripe_subscription_id && plan !== 'lifetime' };
  },

  async setAllowance(actor: string, userId: string, value: number | null) {
    let next: number | null = null;
    if (value !== null && value !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new AppError('The allowance must be between 0 and 1,000,000 credits.', 400);
      next = tenth(n);
    }
    const user = await getUser(userId);
    const before = await writeSubscription(userId, { credit_allowance: next });
    await this.audit(actor, 'allowance', { id: userId, email: user.email || null }, {
      from: before?.credit_allowance ?? null, to: next,
    });
  },

  /**
   * Give or take credits. Given credits are bonus credits: they never expire
   * and are spent after the plan's. Taken credits come off this month's plan
   * allowance. Neither counts as usage in the profit reports.
   */
  async adjustCredits(actor: string, userId: string, amount: number, note: string) {
    const n = tenth(Number(amount));
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 100_000) throw new AppError('Enter a number of credits between -100,000 and 100,000, not 0.', 400);
    const why = String(note || '').trim().slice(0, 300);
    if (!why) throw new AppError('Add a note saying why, for the record.', 400);
    const user = await getUser(userId);
    const { error } = await supabaseAdmin.from('prospect_credit_ledger').insert({
      user_id: userId, delta: n, kind: 'adjustment', bucket: n > 0 ? 'purchased' : 'plan', action: 'adjustment', reason: why,
    });
    if (error) throw new AppError(error.message, 500);
    await this.audit(actor, 'credits', { id: userId, email: user.email || null }, { amount: n, note: why });
  },

  async suspend(actor: string, userId: string, reason?: string) {
    const user = await getUser(userId);
    if (isOwnerEmail(user.email)) throw new AppError('The owner account cannot be suspended.', 400);
    const why = String(reason || '').trim().slice(0, 300) || null;
    await writeControls(userId, { suspended_at: new Date().toISOString(), suspended_reason: why });
    accountControls.forget(userId);
    // Also stop them signing in again or refreshing the session they have.
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER } as any);
    if (error) console.warn(`[Admin] Could not ban ${user.email} at sign-in: ${error.message}`);
    await this.audit(actor, 'suspend', { id: userId, email: user.email || null }, { reason: why });
  },

  async unsuspend(actor: string, userId: string) {
    const user = await getUser(userId);
    await writeControls(userId, { suspended_at: null, suspended_reason: null });
    accountControls.forget(userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: 'none' } as any);
    if (error) console.warn(`[Admin] Could not lift the sign-in ban on ${user.email}: ${error.message}`);
    await this.audit(actor, 'unsuspend', { id: userId, email: user.email || null });
  },

  async setNote(actor: string, userId: string, note: string) {
    const user = await getUser(userId);
    const text = String(note || '').slice(0, 5000);
    await writeControls(userId, { note: text || null });
    await this.audit(actor, 'note', { id: userId, email: user.email || null }, { length: text.length });
  },
};
