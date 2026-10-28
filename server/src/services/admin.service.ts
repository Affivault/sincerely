import { supabaseAdmin } from '../config/supabase.js';
import { env, localhostUrlProblems } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { stripeService } from './stripe.service.js';
import { icypeasBalance } from './prospect-providers.js';
import type {
  AdminProviderBalance, AdminStats, AdminUsageActionRow, AdminUsageReport, AdminUsageUserRow, AdminUserRow, AdminUsersResponse,
} from '@lemlist/shared';

// How many auth users we'll scan at most (pages × perPage). Fine well past
// the point where this platform needs a real search index.
const MAX_PAGES = 10;
const PER_PAGE = 1000;

/** Fetch every auth user (paged) — cached per request cycle only. */
async function fetchAllUsers() {
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

async function fetchSubscriptions(): Promise<Map<string, { plan: string; status: string }>> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, plan, status');
  if (error) throw new AppError(error.message, 500);
  return new Map((data || []).map((s: any) => [s.user_id, { plan: s.plan, status: s.status }]));
}

const cents = (n: number) => Math.round(n * 100) / 100;
/** Stripe's standard card fee, as an estimate: the real one is on each charge's balance transaction. */
const stripeFee = (amountUsd: number) => (amountUsd > 0 ? amountUsd * 0.029 + 0.3 : 0);

function monthRange(month?: string): { label: string; from: Date; to: Date } {
  const now = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  const mon = m ? Number(m[2]) - 1 : now.getUTCMonth();
  const from = new Date(Date.UTC(year, mon, 1));
  const to = new Date(Date.UTC(year, mon + 1, 1));
  return { label: from.toISOString().slice(0, 7), from, to };
}

async function providerBalance(): Promise<AdminProviderBalance> {
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
  async usage(month?: string): Promise<AdminUsageReport> {
    const range = monthRange(month);
    const [revenueSynced, balance] = await Promise.all([
      stripeService.syncPaidInvoices(range.from),
      providerBalance(),
    ]);
    const [costs, charged, payments, users, subs] = await Promise.all([
      supabaseAdmin.rpc('admin_provider_costs', { p_from: range.from.toISOString(), p_to: range.to.toISOString() }),
      supabaseAdmin.rpc('admin_credits_charged', { p_from: range.from.toISOString(), p_to: range.to.toISOString() }),
      supabaseAdmin.from('billing_payments').select('user_id, amount_usd').gte('paid_at', range.from.toISOString()).lt('paid_at', range.to.toISOString()).limit(10000),
      fetchAllUsers(),
      fetchSubscriptions(),
    ]);
    for (const r of [costs, charged, payments]) {
      if (r.error) {
        if (/admin_provider_costs|admin_credits_charged|billing_payments|provider_usage/.test(r.error.message)) {
          throw new AppError('Usage and profit needs database migration 100 to be run first.', 503);
        }
        throw new AppError(r.error.message, 500);
      }
    }

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
    for (const r of (costs.data || []) as any[]) {
      const pc = Number(r.provider_credits) || 0, cost = Number(r.cost_usd) || 0;
      const a = act(r.action || 'other');
      a.calls += Number(r.calls) || 0; a.provider_credits += pc; a.cost_usd += cost;
      if (r.user_id) { const u = acc(r.user_id); u.provider += pc; u.cost += cost; } else unattributed += cost;
    }
    for (const r of (charged.data || []) as any[]) {
      const c = Number(r.credits) || 0;
      if (r.action !== 'topup') act(r.action || 'other').credits_charged += c;
      if (r.user_id) acc(r.user_id).credits += c;
    }
    for (const r of (payments.data || []) as any[]) {
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
      fetchSubscriptions(),
      countRows('smtp_accounts'),
      countRows('sending_domains'),
      countRows('contacts'),
      countRows('campaigns'),
    ]);
    let lifetime = 0, paying = 0;
    for (const sub of subs.values()) {
      if (sub.plan === 'lifetime') lifetime++;
      else if ((sub.status === 'active' || sub.status === 'trialing') && sub.plan !== 'free' && sub.plan !== 'trial') paying++;
    }
    return {
      total_users: users.length,
      lifetime_users: lifetime,
      paying_users: paying,
      free_users: Math.max(0, users.length - lifetime - paying),
      mailboxes,
      domains,
      contacts,
      campaigns,
    };
  },

  /** Grant free-forever lifetime access (all limits removed) to a user by email. */
  async grantLifetime(email: string): Promise<AdminUserRow> {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean || !clean.includes('@')) throw new AppError('Enter a valid email address', 400);

    const users = await fetchAllUsers();
    const user = users.find((u) => (u.email || '').toLowerCase() === clean);
    if (!user) throw new AppError(`No account found for ${clean} — they need to sign up first.`, 404);

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
      .select('plan')
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) throw new AppError(readError.message, 500);
    if (!sub || sub.plan !== 'lifetime') throw new AppError('This user does not have lifetime access.', 400);

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ plan: 'free', status: 'free', updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },
};
