import { supabaseAdmin } from '../config/supabase.js';
import { env, localhostUrlProblems } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { stripeService } from './stripe.service.js';
import { icypeasBalance } from './prospect-providers.js';
import { fetchAllPages } from '../utils/batch.js';
import { PLANS, type PlanId } from '@lemlist/shared';
import type {
  AdminBillingPayment, AdminBillingReport, AdminProviderBalance, AdminStats, AdminUsageActionRow, AdminUsageReport, AdminUsageUserRow, AdminUserRow, AdminUsersResponse,
} from '@lemlist/shared';

// How many auth users we'll scan at most (pages × perPage). Fine well past
// the point where this platform needs a real search index.
const MAX_PAGES = 10;
const PER_PAGE = 1000;

/** Fetch every auth user (paged) — cached per request cycle only. */
export async function fetchAllUsers() {
  const all: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new AppError(error.message, 500);
    const users = data?.users || [];
    all.push(...users);
    if (users.length < PER_PAGE) break;
  }
  return all;
}

/**
 * Every row a query matches, a page at a time. PostgREST stops at 1,000 rows
 * whatever limit is asked for, so a plain select silently drops the rest:
 * plans past the thousandth account, payments past the thousandth invoice.
 */
export async function allRows<R = any>(page: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>): Promise<R[]> {
  try {
    return await fetchAllPages(page);
  } catch (err) {
    const msg = (err as Error).message;
    if (/billing_payments|provider_usage|admin_provider_costs|admin_credits_charged/.test(msg)) throw new AppError('This needs database migration 100 to be run first.', 503);
    throw new AppError(msg, 500);
  }
}

export async function fetchSubscriptionRows(): Promise<Map<string, any>> {
  const rows = await allRows((from, to) => supabaseAdmin.from('subscriptions').select('*').order('user_id').range(from, to));
  return new Map(rows.map((s: any) => [s.user_id, s]));
}

async function fetchSubscriptions(): Promise<Map<string, { plan: string; status: string }>> {
  const rows = await fetchSubscriptionRows();
  return new Map([...rows].map(([id, s]) => [id, { plan: s.plan, status: s.status }]));
}

/**
 * A report function's rows, every one: they are per account and action, so
 * a few hundred active accounts already pass the 1,000-row page.
 */
export function reportRows(fn: 'admin_provider_costs' | 'admin_credits_charged', fromIso: string, toIso: string) {
  return allRows((a, b) => supabaseAdmin
    .rpc(fn, { p_from: fromIso, p_to: toIso })
    .order('user_id', { nullsFirst: true })
    .order('action')
    .range(a, b));
}

/** Payments paid in [from, to), every one of them. */
export function fetchPayments(from?: string, to?: string) {
  return allRows((a, b) => {
    let q = supabaseAdmin.from('billing_payments').select('id, user_id, amount_usd');
    if (from) q = q.gte('paid_at', from);
    if (to) q = q.lt('paid_at', to);
    return q.order('id').range(a, b);
  });
}

export const cents = (n: number) => Math.round(n * 100) / 100;

/** Each active paid subscription at its plan's monthly list price. Discounts and annual billing are not known here. */
export function estimatedMrrOf(subs: Iterable<any>): number {
  let mrr = 0;
  for (const sub of subs) {
    if (sub.status !== 'active' || !sub.stripe_subscription_id) continue;
    mrr += PLANS[sub.plan as PlanId]?.priceMonthly || 0;
  }
  return cents(mrr);
}
/** Stripe's standard card fee, as an estimate: the real one is on each charge's balance transaction. */
export const stripeFee = (amountUsd: number) => (amountUsd > 0 ? amountUsd * 0.029 + 0.3 : 0);

export function monthRange(month?: string): { label: string; from: Date; to: Date } {
  const now = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  const mon = m ? Number(m[2]) - 1 : now.getUTCMonth();
  const from = new Date(Date.UTC(year, mon, 1));
  const to = new Date(Date.UTC(year, mon + 1, 1));
  return { label: from.toISOString().slice(0, 7), from, to };
}

export async function providerBalance(): Promise<AdminProviderBalance> {
  if (!env.ICYPEAS_API_KEY) return { credits: null, low: false, note: 'No ICYPEAS_API_KEY on the server.' };
  if (!env.ICYPEAS_ACCOUNT_EMAIL) return { credits: null, low: false, note: 'Set ICYPEAS_ACCOUNT_EMAIL on the server to show the Icypeas balance.' };
  try {
    const credits = await icypeasBalance(env.ICYPEAS_ACCOUNT_EMAIL);
    if (credits === null) return { credits: null, low: false, note: 'Icypeas answered without a balance we could read.' };
    return { credits, low: credits < env.ICYPEAS_LOW_BALANCE, note: null };
  } catch (err) {
    return { credits: null, low: false, note: `Icypeas balance unavailable: ${(err as Error).message}` };
  }
}

async function countRows(table: string): Promise<number> {
  const { count } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  return count || 0;
}

export const adminService = {
  /**
   * What each account cost us this month (Icypeas calls) against what it
   * paid (Stripe), plus our own Icypeas balance. Revenue is pulled from
   * Stripe on each load, so it does not depend on the webhook's event list.
   */
  /** Pull this month's and last month's payments from Stripe now, whenever they were last pulled. */
  async syncStripeNow(): Promise<boolean> {
    const now = new Date();
    return stripeService.syncPaidInvoices(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), true);
  },

  async usage(month?: string): Promise<AdminUsageReport> {
    const range = monthRange(month);
    const [revenueSynced, balance] = await Promise.all([
      stripeService.syncPaidInvoices(range.from),
      providerBalance(),
    ]);
    const [costs, charged, paymentRows, users, subs] = await Promise.all([
      reportRows('admin_provider_costs', range.from.toISOString(), range.to.toISOString()),
      reportRows('admin_credits_charged', range.from.toISOString(), range.to.toISOString()),
      fetchPayments(range.from.toISOString(), range.to.toISOString()),
      fetchAllUsers(),
      fetchSubscriptions(),
    ]);
    type Acc = { credits: number; provider: number; cost: number; revenue: number; fees: number };
    const per = new Map<string, Acc>();
    const acc = (id: string) => {
      let a = per.get(id);
      if (!a) per.set(id, (a = { credits: 0, provider: 0, cost: 0, revenue: 0, fees: 0 }));
      return a;
    };
    const actions = new Map<string, AdminUsageActionRow>();
    const act = (name: string) => {
      let a = actions.get(name);
      if (!a) actions.set(name, (a = { action: name, calls: 0, provider_credits: 0, cost_usd: 0, credits_charged: 0 }));
      return a;
    };
    let unattributed = 0;
    for (const r of costs as any[]) {
      const pc = Number(r.provider_credits) || 0, cost = Number(r.cost_usd) || 0;
      const a = act(r.action || 'other');
      a.calls += Number(r.calls) || 0; a.provider_credits += pc; a.cost_usd += cost;
      if (r.user_id) { const u = acc(r.user_id); u.provider += pc; u.cost += cost; } else unattributed += cost;
    }
    for (const r of charged as any[]) {
      const c = Number(r.credits) || 0;
      if (r.action !== 'topup') act(r.action || 'other').credits_charged += c;
      if (r.user_id) acc(r.user_id).credits += c;
    }
    for (const r of paymentRows as any[]) {
      if (!r.user_id) continue;
      const amount = Number(r.amount_usd) || 0;
      const u = acc(r.user_id); u.revenue += amount; u.fees += stripeFee(amount);
    }

    const emails = new Map(users.map((u: any) => [u.id, u.email || '(no email)']));
    const rows: AdminUsageUserRow[] = [...per.entries()].map(([id, a]) => {
      const sub = subs.get(id);
      const profit = a.revenue - a.fees - a.cost;
      return {
        user_id: id, email: emails.get(id) || '(deleted account)', plan: sub?.plan || 'free', status: sub?.status || 'free',
        credits_charged: Math.round(a.credits * 10) / 10, provider_credits: Math.round(a.provider * 100) / 100,
        cost_usd: cents(a.cost), revenue_usd: cents(a.revenue), fees_usd: cents(a.fees), profit_usd: cents(profit),
        losing: a.cost > 0 && a.cost > a.revenue - a.fees,
      };
    }).sort((x, y) => y.cost_usd - x.cost_usd || y.revenue_usd - x.revenue_usd);

    const total = (k: 'provider_credits' | 'cost_usd' | 'revenue_usd' | 'fees_usd' | 'credits_charged') => rows.reduce((s, r) => s + r[k], 0);
    const cost = total('cost_usd') + unattributed;
    return {
      month: range.label,
      usd_per_provider_credit: env.ICYPEAS_USD_PER_CREDIT,
      totals: {
        provider_credits: Math.round([...actions.values()].reduce((s, a) => s + a.provider_credits, 0) * 100) / 100,
        cost_usd: cents(cost),
        revenue_usd: cents(total('revenue_usd')),
        fees_usd: cents(total('fees_usd')),
        profit_usd: cents(total('revenue_usd') - total('fees_usd') - cost),
        credits_charged: Math.round(total('credits_charged') * 10) / 10,
      },
      unattributed_cost_usd: cents(unattributed),
      by_action: [...actions.values()].map((a) => ({ ...a, provider_credits: Math.round(a.provider_credits * 100) / 100, cost_usd: cents(a.cost_usd), credits_charged: Math.round(a.credits_charged * 10) / 10 })).sort((x, y) => y.cost_usd - x.cost_usd),
      users: rows,
      provider_balance: balance,
      revenue_synced: revenueSynced,
    };
  },

  async listUsers(search?: string): Promise<AdminUsersResponse> {
    const [users, subs] = await Promise.all([fetchAllUsers(), fetchSubscriptions()]);
    const q = (search || '').trim().toLowerCase();

    let rows: AdminUserRow[] = users.map((u) => {
      const sub = subs.get(u.id);
      return {
        id: u.id,
        email: u.email || '(no email)',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        email_confirmed: !!u.email_confirmed_at,
        plan: sub?.plan || 'free',
        status: sub?.status || 'free',
      };
    });

    if (q) rows = rows.filter((r) => r.email.toLowerCase().includes(q));
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return { users: rows.slice(0, 200), total: rows.length };
  },

  /**
   * The diagnostics public /health used to return: relay and Redis state and
   * platform-wide operational counts. Cross-tenant, so admin only.
   */
  async health(): Promise<Record<string, any>> {
    const diagnostics: Record<string, any> = { status: 'ok', timestamp: new Date().toISOString() };

    diagnostics.smtp_relay = env.SMTP_RELAY_URL
      ? { configured: true, url: env.SMTP_RELAY_URL }
      : { configured: false, note: 'SMTP_RELAY_URL not set - using direct SMTP (blocked on Render free tier)' };
    if (env.SMTP_RELAY_URL) {
      try {
        const healthUrl = env.SMTP_RELAY_URL.replace('/api/send-email', '/api/health');
        const relayResp = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        diagnostics.smtp_relay.reachable = true;
        diagnostics.smtp_relay.relay_status = await relayResp.json().catch(() => null);
      } catch (err: any) {
        diagnostics.smtp_relay.reachable = false;
        diagnostics.smtp_relay.relay_error = err.message;
      }
    }

    try {
      const { redisConnection } = await import('../config/redis.js');
      diagnostics.redis = !redisConnection ? 'not configured (REDIS_URL not set)'
        : redisConnection.status === 'ready' ? 'connected' : `status: ${redisConnection.status}`;
    } catch (err: any) {
      diagnostics.redis = `error: ${err.message}`;
    }

    diagnostics.public_url_problems = localhostUrlProblems();

    const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
      const { count: n, error } = await q;
      return error ? `error: ${error.message}` : n ?? 0;
    };
    diagnostics.campaigns = await count(supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }));
    diagnostics.active_smtp_accounts = await count(supabaseAdmin.from('smtp_accounts').select('*', { count: 'exact', head: true }).eq('is_active', true));
    diagnostics.running_campaigns = await count(supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }).eq('status', 'running'));
    diagnostics.due_contacts = await count(supabaseAdmin.from('campaign_contacts').select('*', { count: 'exact', head: true })
      .eq('status', 'active').not('next_send_at', 'is', null).lte('next_send_at', new Date().toISOString()));
    return diagnostics;
  },

  async stats(): Promise<AdminStats> {
    const [users, subs, mailboxes, domains, contacts, campaigns] = await Promise.all([
      fetchAllUsers(),
      fetchSubscriptionRows(),
      countRows('smtp_accounts'),
      countRows('sending_domains'),
      countRows('contacts'),
      countRows('campaigns'),
    ]);
    let lifetime = 0, paying = 0, trialing = 0, pastDue = 0;
    for (const sub of subs.values()) {
      if (sub.plan === 'lifetime') lifetime++;
      else if ((sub.status === 'active' || sub.status === 'trialing') && sub.plan !== 'free' && sub.plan !== 'trial') paying++;
      if (sub.status === 'trialing' && sub.plan !== 'lifetime') trialing++;
      if (sub.status === 'past_due') pastDue++;
    }
    const now = Date.now();
    const since = (iso: string | null | undefined, days: number) => !!iso && now - new Date(iso).getTime() < days * 86400000;
    return {
      total_users: users.length,
      lifetime_users: lifetime,
      paying_users: paying,
      free_users: Math.max(0, users.length - lifetime - paying),
      mailboxes,
      domains,
      contacts,
      campaigns,
      trialing_users: trialing,
      past_due_users: pastDue,
      active_7d: users.filter((u: any) => since(u.last_sign_in_at, 7)).length,
      signups_30d: users.filter((u: any) => since(u.created_at, 30)).length,
      est_mrr_usd: estimatedMrrOf(subs.values()),
    };
  },

  /** Every payment and refund in a month, with who made it, and the plan mix now. */
  async billing(month?: string): Promise<AdminBillingReport> {
    const range = monthRange(month);
    const revenueSynced = await stripeService.syncPaidInvoices(range.from);
    const [rows, users, subs] = await Promise.all([
      allRows((a, b) => supabaseAdmin.from('billing_payments').select('id, user_id, kind, amount_usd, stripe_ref, paid_at')
        .gte('paid_at', range.from.toISOString()).lt('paid_at', range.to.toISOString())
        .order('paid_at', { ascending: false }).order('id').range(a, b)).catch(() => [] as any[]),
      fetchAllUsers(),
      fetchSubscriptionRows(),
    ]);
    const emailOf = new Map(users.map((u: any) => [u.id, u.email || null]));
    const payments: AdminBillingPayment[] = (rows as any[]).map((r) => ({
      id: r.id, user_id: r.user_id, email: r.user_id ? emailOf.get(r.user_id) ?? null : null,
      kind: r.kind, amount_usd: Number(r.amount_usd) || 0, stripe_ref: r.stripe_ref, paid_at: r.paid_at,
    }));
    const gross = payments.filter((p) => p.amount_usd > 0).reduce((s, p) => s + p.amount_usd, 0);
    const refunds = -payments.filter((p) => p.amount_usd < 0).reduce((s, p) => s + p.amount_usd, 0);
    const fees = payments.reduce((s, p) => s + stripeFee(p.amount_usd), 0);

    const mix = new Map<string, { plan: string; status: string; count: number }>();
    const pastDue: AdminBillingReport['past_due'] = [];
    for (const sub of subs.values()) {
      const key = `${sub.plan}|${sub.status}`;
      const m = mix.get(key) || { plan: sub.plan, status: sub.status, count: 0 };
      m.count++; mix.set(key, m);
      if (sub.status === 'past_due') pastDue.push({ id: sub.user_id, email: emailOf.get(sub.user_id) || '(no email)', plan: sub.plan });
    }
    return {
      month: range.label,
      payments,
      totals: { gross_usd: cents(gross), refunds_usd: cents(refunds), net_usd: cents(gross - refunds), fees_usd: cents(fees), count: payments.length },
      plan_mix: [...mix.values()].sort((a, b) => b.count - a.count),
      est_mrr_usd: estimatedMrrOf(subs.values()),
      past_due: pastDue,
      revenue_synced: revenueSynced,
    };
  },

  /** Grant free-forever lifetime access (all limits removed) to a user by email. */
  async grantLifetime(email: string): Promise<AdminUserRow> {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean || !clean.includes('@')) throw new AppError('Enter a valid email address', 400);

    const users = await fetchAllUsers();
    const user = users.find((u) => (u.email || '').toLowerCase() === clean);
    if (!user) throw new AppError(`No account found for ${clean} — they need to sign up first.`, 404);

    // Lifetime is free forever: a Stripe subscription still running would keep charging them.
    const { data: current } = await supabaseAdmin.from('subscriptions').select('plan, stripe_subscription_id').eq('user_id', user.id).maybeSingle();
    if (current?.plan !== 'lifetime' && current?.stripe_subscription_id && stripeService.isConfigured()) {
      try {
        const live = await stripeService.liveSubscription(current.stripe_subscription_id);
        if (live) await stripeService.cancelSubscriptionNow(live);
      } catch (err) {
        throw new AppError(`Their Stripe subscription could not be cancelled, so nothing was changed: ${(err as Error).message}`, 502);
      }
    }

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .upsert(
        { user_id: user.id, plan: 'lifetime', status: 'active', updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    if (error) throw new AppError(error.message, 500);

    return {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at || null,
      email_confirmed: !!user.email_confirmed_at,
      plan: 'lifetime',
      status: 'active',
    };
  },

  /** Revoke lifetime access — the account drops back to the Free plan. */
  async revokeLifetime(userId: string): Promise<void> {
    const { data: sub, error: readError } = await supabaseAdmin
      .from('subscriptions')
      .select('plan, stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) throw new AppError(readError.message, 500);
    if (!sub || sub.plan !== 'lifetime') throw new AppError('This user does not have lifetime access.', 400);

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ plan: 'free', status: 'free', updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    // If they still pay through Stripe, Stripe's plan applies again.
    if (sub.stripe_customer_id && stripeService.isConfigured()) {
      await stripeService.syncCustomer(sub.stripe_customer_id).catch((err) =>
        console.warn(`[Admin] Could not re-read ${userId} from Stripe after revoking lifetime: ${(err as Error).message}`));
    }
  },
};
