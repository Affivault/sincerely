import { supabaseAdmin } from '../config/supabase.js';
import { ADMIN_EMAILS } from '../config/admin.js';
import { AppError } from '../middleware/error.middleware.js';
import { fetchAllPages } from '../utils/batch.js';
import type {
  AdminAlertKind, AdminAlertSettings, AdminBulkAction, AdminBulkResult, AdminInsights, AdminInsightsMonth,
} from '@lemlist/shared';
import { adminAccountsService, getUser } from './admin-accounts.service.js';
import { adminControlService } from './admin-control.service.js';
import { adminPlatformService } from './admin-platform.service.js';
import { adminService, estimatedMrrOf, fetchAllUsers, fetchSubscriptionRows, providerBalance } from './admin.service.js';
import { sendToOwner } from './notify.service.js';

/*
 * The business over time (sign-ups, senders, revenue, payers, churn, trial
 * conversion), the owners' email alerts, and actions on many accounts at
 * once.
 */

const MONTHS = 12;
const DAY = 86_400_000;

function monthKeys(n: number, now = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1)).toISOString().slice(0, 7));
}
const monthOf = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 7) : '');

/* ─── Alerts ─────────────────────────────────────────────────────────── */

const ALERTS_KEY = 'alerts';
const DEFAULT_ALERTS: AdminAlertSettings = {
  enabled: { icypeas_low: true, payment_failed: true, risky_sending: true, new_paying: false },
  last_sent: {},
};
/** Each kind emails at most this often, however long the condition lasts. */
const ALERT_EVERY_MS: Record<AdminAlertKind, number> = {
  icypeas_low: DAY,
  payment_failed: 6 * 60 * 60 * 1000,
  risky_sending: DAY,
  new_paying: 60 * 60 * 1000,
};

type AlertState = AdminAlertSettings & { seen: Record<string, string[]> };

async function readAlerts(): Promise<AlertState | null> {
  const { data, error } = await supabaseAdmin.from('platform_settings').select('value').eq('key', ALERTS_KEY).maybeSingle();
  if (error) return null; // 102 not run: no alerts.
  const v: any = data?.value || {};
  return { enabled: { ...DEFAULT_ALERTS.enabled, ...(v.enabled || {}) }, last_sent: { ...(v.last_sent || {}) }, seen: { ...(v.seen || {}) } };
}

async function writeAlerts(value: AlertState, by: string | null) {
  const { error } = await supabaseAdmin.from('platform_settings').upsert({ key: ALERTS_KEY, value, updated_by: by, updated_at: new Date().toISOString() });
  if (error) throw new AppError(/platform_settings|does not exist|schema cache/i.test(error.message) ? 'This needs database migration 102 to be run first.' : error.message, error.message.includes('platform_settings') ? 503 : 500);
}

/** The owners' own account ids, to send to. */
async function ownerIds(): Promise<string[]> {
  const users = await fetchAllUsers();
  const owners = new Set(ADMIN_EMAILS.map((e) => e.toLowerCase()));
  return users.filter((u: any) => owners.has(String(u.email || '').toLowerCase())).map((u: any) => u.id);
}

async function tellOwners(subject: string, text: string, href: string): Promise<boolean> {
  let any = false;
  for (const id of await ownerIds()) {
    // From each owner's own mailbox to themselves; an owner with none connected is skipped.
    if (await sendToOwner(id, { subject, text, href, footer: 'An admin alert from Sincerely. Turn alerts on or off in Admin, Settings.' })) any = true;
  }
  return any;
}

export const adminInsightsService = {
  async insights(): Promise<AdminInsights> {
    const keys = monthKeys(MONTHS);
    const first = `${keys[0]}-01`;
    const [users, subs, payments, usage, balance, usageNow] = await Promise.all([
      fetchAllUsers(),
      fetchSubscriptionRows(),
      fetchAllPages<any>((a, b) => supabaseAdmin.from('billing_payments').select('user_id, kind, amount_usd, paid_at').gte('paid_at', new Date(Date.parse(first) - 31 * DAY).toISOString()).order('paid_at').range(a, b)).catch(() => []),
      fetchAllPages<any>((a, b) => supabaseAdmin.from('usage_counters').select('user_id, period_start, emails_sent').gte('period_start', first).order('period_start').range(a, b)).catch(() => []),
      providerBalance(),
      adminService.usage().catch(() => null),
    ]);

    const now = Date.now();
    const current = keys[keys.length - 1];
    const payersBy = new Map<string, Set<string>>();
    const revenueBy = new Map<string, number>();
    const paidAfter = new Map<string, number[]>();
    for (const p of payments) {
      const m = monthOf(p.paid_at);
      revenueBy.set(m, (revenueBy.get(m) || 0) + (Number(p.amount_usd) || 0));
      if (p.kind === 'subscription' && p.user_id) {
        if (!payersBy.has(m)) payersBy.set(m, new Set());
        payersBy.get(m)!.add(p.user_id);
        const list = paidAfter.get(p.user_id) || [];
        list.push(Date.parse(p.paid_at));
        paidAfter.set(p.user_id, list);
      }
    }
    const subscribed = (id: string) => {
      const s = subs.get(id);
      return !!s && (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due') && s.plan !== 'free';
    };

    const months: AdminInsightsMonth[] = keys.map((m, i) => {
      const prev = i > 0 ? keys[i - 1] : new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
      const payers = payersBy.get(m) || new Set<string>();
      const before = payersBy.get(prev) || new Set<string>();
      const churned = m === current ? null : [...before].filter((id) => !payers.has(id) && !subscribed(id)).length;
      let ended = 0, converted = 0;
      for (const s of subs.values()) {
        if (!s.trial_ends_at || monthOf(s.trial_ends_at) !== m) continue;
        const end = Date.parse(s.trial_ends_at);
        if (end > now) continue;
        ended++;
        if ((paidAfter.get(s.user_id) || []).some((t) => t >= end - 2 * DAY)) converted++;
      }
      return {
        month: m,
        signups: users.filter((u: any) => monthOf(u.created_at) === m).length,
        active_senders: new Set(usage.filter((r: any) => monthOf(r.period_start) === m && Number(r.emails_sent) > 0).map((r: any) => r.user_id)).size,
        revenue_usd: Math.round((revenueBy.get(m) || 0) * 100) / 100,
        payers: payers.size,
        churned,
        trials_ended: ended,
        trials_converted: converted,
      };
    });

    const top_cost = (usageNow?.users || [])
      .filter((u) => u.cost_usd > 0)
      .sort((a, b) => b.cost_usd - a.cost_usd)
      .slice(0, 10)
      .map((u) => ({ user_id: u.user_id, email: u.email || '(no email)', plan: u.plan, cost_usd: u.cost_usd, revenue_usd: u.revenue_usd, profit_usd: u.profit_usd }));

    return { months, est_mrr_usd: estimatedMrrOf(subs.values()), top_cost, provider_balance: balance };
  },

  /* ─── Alerts ─────────────────────────────────────────────────────────── */

  async alertSettings(): Promise<AdminAlertSettings & { ready: boolean }> {
    const a = await readAlerts();
    return a ? { enabled: a.enabled, last_sent: a.last_sent, ready: true } : { ...DEFAULT_ALERTS, ready: false };
  },

  async saveAlertSettings(actor: string, enabled: Partial<Record<AdminAlertKind, unknown>>) {
    const current: AlertState = (await readAlerts()) || { ...DEFAULT_ALERTS, seen: {} };
    const next = { ...current, enabled: { ...current.enabled } };
    for (const k of Object.keys(DEFAULT_ALERTS.enabled) as AdminAlertKind[]) {
      if (typeof enabled?.[k] === 'boolean') next.enabled[k] = enabled[k] as boolean;
    }
    await writeAlerts(next, actor);
    await adminAccountsService.audit(actor, 'setting_alerts', { id: null, email: null }, { enabled: next.enabled });
    return this.alertSettings();
  },

  /**
   * Look for anything the owners should hear about, and email them once
   * per kind per period. Run by the scheduler; safe to run at any time.
   */
  async runAlerts(now = Date.now()): Promise<AdminAlertKind[]> {
    const state = await readAlerts();
    if (!state) return [];
    const seen: Record<string, string[]> = { ...state.seen };
    const due = (k: AdminAlertKind) => state.enabled[k] && (!state.last_sent[k] || now - Date.parse(state.last_sent[k]!) >= ALERT_EVERY_MS[k]);
    const sent: AdminAlertKind[] = [];

    if (due('icypeas_low')) {
      const b = await providerBalance();
      if (b.low && b.credits !== null) {
        if (await tellOwners(`Icypeas is down to ${Math.round(b.credits).toLocaleString()} credits`,
          `The Icypeas balance is ${Math.round(b.credits).toLocaleString()} credits. When it runs out, searches, email finding, deep checks and enrichment stop for every account. Top it up in Icypeas.`, '/admin')) sent.push('icypeas_low');
      }
    }

    if (due('payment_failed') || due('new_paying')) {
      const subs = await fetchSubscriptionRows();
      const users = await fetchAllUsers();
      const emailOf = new Map(users.map((u: any) => [u.id, u.email || '(no email)']));
      const pastDue = [...subs.values()].filter((s) => s.status === 'past_due').map((s) => s.user_id as string);
      const paying = [...subs.values()].filter((s) => s.status === 'active' && !['free', 'trial', 'lifetime'].includes(s.plan)).map((s) => s.user_id as string);
      const newPastDue = pastDue.filter((id) => !(seen.past_due || []).includes(id));
      const newPaying = paying.filter((id) => !(seen.paying || []).includes(id));
      // The first run only learns who is there; it does not announce everyone.
      const firstRun = !seen.past_due;
      if (!firstRun && due('payment_failed') && newPastDue.length) {
        const names = newPastDue.map((id) => emailOf.get(id)).join(', ');
        if (await tellOwners(`Payment failed: ${newPastDue.length === 1 ? names : `${newPastDue.length} accounts`}`,
          `A payment failed for ${names}. Stripe is retrying; until it succeeds they run as Free.`, '/admin/billing')) sent.push('payment_failed');
      }
      if (!firstRun && due('new_paying') && newPaying.length) {
        const names = newPaying.map((id) => emailOf.get(id)).join(', ');
        if (await tellOwners(`New paying customer${newPaying.length === 1 ? '' : 's'}: ${newPaying.length === 1 ? names : newPaying.length}`,
          `${names} ${newPaying.length === 1 ? 'is' : 'are'} now paying.`, '/admin/billing')) sent.push('new_paying');
      }
      seen.past_due = pastDue;
      seen.paying = paying;
    }

    if (due('risky_sending')) {
      const report = await adminPlatformService.sending().catch(() => null);
      const fresh = (report?.risky || []).filter((r) => !r.held && !(seen.risky || []).includes(r.id));
      if (fresh.length && await tellOwners(`Sending to look at: ${fresh.length === 1 ? fresh[0].email : `${fresh.length} accounts`}`,
        fresh.map((r) => `${r.email}: ${r.reasons.join(', ')} of ${r.sent.toLocaleString()} sent in ${report!.days} days.`).join('\n') + '\n\nHold their sending from Admin, Sending, before it hurts the shared reputation.', '/admin/sending')) sent.push('risky_sending');
      if (report) seen.risky = report.risky.map((r) => r.id);
    }

    const stamp = new Date(now).toISOString();
    const last_sent = { ...state.last_sent };
    for (const k of sent) last_sent[k] = stamp;
    await writeAlerts({ enabled: state.enabled, last_sent, seen }, null).catch(() => undefined);
    return sent;
  },

  /* ─── Bulk ───────────────────────────────────────────────────────────── */

  async bulk(actor: string, action: AdminBulkAction, ids: unknown, opts: { amount?: unknown; note?: unknown; reason?: unknown }): Promise<AdminBulkResult> {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
    if (!list.length) throw new AppError('Pick at least one account.', 400);
    if (list.length > 200) throw new AppError('At most 200 accounts at a time.', 400);
    const amount = Number(opts.amount);
    const note = String(opts.note ?? '').trim();
    if (action === 'give_credits' && (!Number.isFinite(amount) || amount === 0 || !note)) throw new AppError('Give an amount and say why.', 400);

    const run: Record<AdminBulkAction, (id: string) => Promise<unknown>> = {
      hold_sending: (id) => adminControlService.setSendingHold(actor, id, true),
      release_sending: (id) => adminControlService.setSendingHold(actor, id, false),
      pause_campaigns: (id) => adminControlService.pauseCampaigns(actor, id),
      give_credits: (id) => adminAccountsService.adjustCredits(actor, id, amount, note),
      suspend: (id) => adminAccountsService.suspend(actor, id, String(opts.reason ?? '').trim() || undefined),
      unsuspend: (id) => adminAccountsService.unsuspend(actor, id),
    };
    if (!run[action]) throw new AppError('Unknown action.', 400);

    let done = 0;
    const failed: AdminBulkResult['failed'] = [];
    for (const id of list) {
      try {
        await run[action](id);
        done++;
      } catch (err) {
        const email = await getUser(id).then((u) => u.email || null, () => null);
        failed.push({ id, email, error: (err as Error).message || 'Failed' });
      }
    }
    return { done, failed };
  },
};
