import type Stripe from 'stripe';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { isOwnerEmail } from '../config/admin.js';
import { billingService } from './billing.service.js';
import { creditsService } from './credits.service.js';
import { accountControls } from './account-controls.service.js';
import { stripeService } from './stripe.service.js';
import { adminControlService } from './admin-control.service.js';
import { allRows, cents, fetchAllUsers, fetchPayments, fetchSubscriptionRows, monthRange, reportRows, stripeFee } from './admin.service.js';
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

export const missingTable = (msg: string | undefined) => /account_controls|admin_audit_log|does not exist|schema cache/i.test(msg || '');

async function fetchControls(): Promise<{ ready: boolean; rows: Map<string, any> }> {
  try {
    const rows = await allRows((a, b) => supabaseAdmin.from('account_controls').select('user_id, suspended_at, suspended_reason, note').order('user_id').range(a, b));
    return { ready: true, rows: new Map(rows.map((r: any) => [r.user_id, r])) };
  } catch {
    return { ready: false, rows: new Map() };
  }
}

export async function getUser(userId: string) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data?.user) throw new AppError('No account with that id.', 404);
  return data.user;
}

export async function getSubscriptionRow(userId: string): Promise<any | null> {
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

export async function writeControls(userId: string, patch: Record<string, any>) {
  const { error } = await supabaseAdmin
    .from('account_controls')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    if (missingTable(error.message)) throw new AppError('This needs database migration 101 to be run first.', 503);
    throw new AppError(error.message, 500);
  }
}

/** The Stripe subscription if Stripe still bills it; a Stripe outage fails the change rather than leaving the two apart. */
export async function stripeLive(subscriptionId: string | null | undefined): Promise<Stripe.Subscription | null> {
  if (!subscriptionId || !stripeService.isConfigured()) return null;
  try {
    return await stripeService.liveSubscription(subscriptionId);
  } catch (err) {
    throw new AppError(`Stripe could not be reached, so nothing was changed: ${(err as Error).message}`, 502);
  }
}

/** The account's controls row, with migration 102's columns when they exist. */
async function controlsRow(userId: string): Promise<{ data: any; error: any }> {
  const full = await supabaseAdmin.from('account_controls').select('suspended_at, suspended_reason, note, sessions_revoked_at, sending_paused_at, limit_overrides, feature_overrides').eq('user_id', userId).maybeSingle();
  if (!full.error || !/sessions_revoked_at|sending_paused_at|limit_overrides|feature_overrides/.test(full.error.message || '')) return full;
  return supabaseAdmin.from('account_controls').select('suspended_at, suspended_reason, note').eq('user_id', userId).maybeSingle();
}

async function liveCampaigns(userId: string): Promise<number> {
  const { count } = await supabaseAdmin.from('campaigns').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['running', 'scheduled']);
  return count || 0;
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
    // Revenue comes from Stripe, so ask it first, as the overview does.
    await stripeService.syncPaidInvoices(range.from);
    const [users, subs, controls, costs, charged, payments, lifetimeCosts, allPayments] = await Promise.all([
      fetchAllUsers(),
      fetchSubscriptionRows(),
      fetchControls(),
      reportRows('admin_provider_costs', from, to),
      reportRows('admin_credits_charged', from, to),
      fetchPayments(from, to),
      reportRows('admin_provider_costs', EPOCH, FOREVER),
      fetchPayments(),
    ]);

    const add = (m: Map<string, number>, id: string | null, n: number) => { if (id) m.set(id, (m.get(id) || 0) + n); };
    const cost = new Map<string, number>(), used = new Map<string, number>();
    const revenue = new Map<string, number>(), fees = new Map<string, number>();
    const lifeCost = new Map<string, number>(), lifeRevenue = new Map<string, number>(), lifeFees = new Map<string, number>();
    for (const r of costs as any[]) add(cost, r.user_id, Number(r.cost_usd) || 0);
    for (const r of charged as any[]) if (r.action !== 'topup') add(used, r.user_id, Number(r.credits) || 0);
    for (const r of payments as any[]) { const a = Number(r.amount_usd) || 0; add(revenue, r.user_id, a); add(fees, r.user_id, stripeFee(a)); }
    for (const r of lifetimeCosts as any[]) add(lifeCost, r.user_id, Number(r.cost_usd) || 0);
    for (const r of allPayments as any[]) { const a = Number(r.amount_usd) || 0; add(lifeRevenue, r.user_id, a); add(lifeFees, r.user_id, stripeFee(a)); }

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

    const mine = (table: string, cols: string, extra: (q: any) => any = (q) => q) => allRows((a, b) =>
      extra(supabaseAdmin.from(table).select(cols).eq('user_id', userId)).order('created_at', { ascending: false }).order('id').range(a, b));
    const [sub, controlsRes, credits, limits, sent, inboxes, usage, ledger, paymentsAll, lifeCosts, lifeCharged, mailboxes, domains, contacts, campaigns, audit, stripe, live_campaigns] = await Promise.all([
      getSubscriptionRow(userId),
      controlsRow(userId),
      creditsService.summary(userId),
      billingService.getLimits(userId),
      billingService.getEmailsSentThisPeriod(userId),
      billingService.countInboxes(userId),
      mine('provider_usage', 'id, action, endpoint, provider_credits, cost_usd, created_at', (q) => q.gte('created_at', since)),
      mine('prospect_credit_ledger', 'id, delta, kind, bucket, action, reason, created_at', (q) => q.gte('created_at', since)),
      allRows((a, b) => supabaseAdmin.from('billing_payments').select('id, kind, amount_usd, currency, stripe_ref, paid_at').eq('user_id', userId).order('paid_at', { ascending: false }).order('id').range(a, b)),
      // All time, summed by the database: a busy account has more rows than are worth fetching.
      reportRows('admin_provider_costs', EPOCH, FOREVER),
      reportRows('admin_credits_charged', EPOCH, FOREVER),
      countFor('smtp_accounts', userId),
      countFor('sending_domains', userId),
      countFor('contacts', userId),
      countFor('campaigns', userId),
      this.auditLog(30, userId),
      adminControlService.stripeSummary(userId),
      liveCampaigns(userId),
    ]);
    const controlsReady = !controlsRes.error;
    const controls = controlsRes.data || null;

    const byMonth = new Map<string, AdminMonthRow>(months.map((m) => [m, { month: m, credits_used: 0, provider_credits: 0, cost_usd: 0, revenue_usd: 0, fees_usd: 0, profit_usd: 0 }]));
    const monthOf = (iso: string) => byMonth.get(String(iso).slice(0, 7));
    for (const r of usage as any[]) {
      const m = monthOf(r.created_at); if (!m) continue;
      m.provider_credits += Number(r.provider_credits) || 0; m.cost_usd += Number(r.cost_usd) || 0;
    }
    for (const r of ledger as any[]) {
      if (r.kind !== 'spend' && r.kind !== 'refund') continue;
      const m = monthOf(r.created_at); if (m) m.credits_used -= Number(r.delta) || 0;
    }
    const payments = (paymentsAll as any[]).map((p) => ({ ...p, amount_usd: Number(p.amount_usd) || 0 }));
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

    const lifeCost = (lifeCosts as any[]).filter((r) => r.user_id === userId).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
    const lifeRevenue = payments.reduce((s, p) => s + p.amount_usd, 0);
    const lifeFees = payments.reduce((s, p) => s + stripeFee(p.amount_usd), 0);
    const lifeUsed = (lifeCharged as any[]).filter((r) => r.user_id === userId && r.action !== 'topup').reduce((s, r) => s + (Number(r.credits) || 0), 0);
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
        sessions_revoked_at: controls?.sessions_revoked_at ?? null,
        sending_paused_at: controls?.sending_paused_at ?? null,
        overrides: { limits: controls?.limit_overrides || {}, features: controls?.feature_overrides || {} },
      },
      plan_limits: { maxInboxes: PLANS[billingService.planFromSubscription(sub)]?.maxInboxes ?? 0, emailsPerMonth: PLANS[billingService.planFromSubscription(sub)]?.emailsPerMonth ?? 0, features: { ...(PLANS[billingService.planFromSubscription(sub)]?.features || {}) } },
      stripe,
      live_campaigns,
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
      ledger: (ledger as any[]).slice(0, 100).map((r) => ({ ...r, delta: Number(r.delta) || 0 })),
      calls: (usage as any[]).slice(0, 100).map((r) => ({ ...r, provider_credits: Number(r.provider_credits) || 0, cost_usd: Number(r.cost_usd) || 0 })),
      payments,
      resources: { mailboxes, domains, contacts, campaigns },
      audit: audit.entries,
      controls_ready: controlsReady,
    };
  },

  /* ─── Controls ─────────────────────────────────────────────────────── */

  /**
   * Put an account on a plan. A paying account is changed in Stripe itself,
   * so Stripe bills the new plan and its next event keeps it: Starter and
   * Growth swap the price (from the next renewal), Free and Lifetime cancel
   * the subscription now. Scale and Trial are not sold through Stripe.
   */
  async setPlan(actor: string, userId: string, plan: string, status?: string): Promise<{ stripe: 'changed' | 'canceled' | null }> {
    if (!PLANS[plan as PlanId]) throw new AppError('Unknown plan.', 400);
    const nextStatus = status || (plan === 'free' ? 'free' : 'active');
    if (!ALLOWED_STATUSES.has(nextStatus)) throw new AppError('Unknown status.', 400);
    const user = await getUser(userId);
    const before = await getSubscriptionRow(userId);
    const from = { plan: before?.plan || 'free', status: before?.status || 'free' };

    let stripe: 'changed' | 'canceled' | null = null;
    const live = before?.plan === 'lifetime' ? null : await stripeLive(before?.stripe_subscription_id);
    if (live) {
      if (plan !== 'starter' && plan !== 'growth' && plan !== 'free' && plan !== 'lifetime') {
        throw new AppError(`${PLANS[plan as PlanId].name} is not sold through Stripe. Move them to Free first, which cancels their Stripe subscription, then set ${PLANS[plan as PlanId].name}.`, 400);
      }
      try {
        if (plan === 'starter' || plan === 'growth') {
          await stripeService.changeSubscriptionPlan(live, plan);
          stripe = 'changed';
        } else {
          await stripeService.cancelSubscriptionNow(live);
          stripe = 'canceled';
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(`Stripe refused the change, so nothing was changed: ${(err as Error).message}`, 502);
      }
    }
    // Stripe has written a changed plan already; everything else is ours to write.
    if (stripe !== 'changed') await writeSubscription(userId, { plan, status: nextStatus });

    await this.audit(actor, 'plan', { id: userId, email: user.email || null }, {
      from, to: { plan, status: stripe === 'changed' ? from.status : nextStatus }, ...(stripe ? { stripe } : {}),
    });
    return { stripe };
  },

  /** Pull this account fresh from Stripe: subscription, payments and refunds. */
  async syncFromStripe(actor: string, userId: string): Promise<{ synced: boolean }> {
    const user = await getUser(userId);
    const sub = await getSubscriptionRow(userId);
    if (!sub?.stripe_customer_id) return { synced: false };
    if (!stripeService.isConfigured()) throw new AppError('Stripe is not configured on the server.', 503);
    try {
      await stripeService.syncCustomer(sub.stripe_customer_id);
    } catch (err) {
      throw new AppError(`Stripe could not be reached: ${(err as Error).message}`, 502);
    }
    await this.audit(actor, 'stripe_sync', { id: userId, email: user.email || null });
    return { synced: true };
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
