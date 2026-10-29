import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { fetchAllPages } from '../utils/batch.js';
import {
  CREDIT_PRICES, PLANS,
  type AccountOverrides, type AdminSendingReport, type AdminSettingsResponse, type Announcement, type CreditAction,
  type PlanId, type PlanOverride, type PlatformSettings,
} from '@lemlist/shared';
import { accountControls } from './account-controls.service.js';
import { adminAccountsService, getUser, writeControls } from './admin-accounts.service.js';
import { fetchAllUsers } from './admin.service.js';
import { platformSettings } from './platform-settings.service.js';

/*
 * The platform as a whole: its settings (plans, prices, sign-ups, the
 * announcement, the stop-all-sending switch), per-account limits, and
 * sending health across every account. Every change is in the activity log.
 */

const SENDING_DAYS = 7;
const BOUNCE_FLAG = 0.05;
const COMPLAINT_FLAG = 0.003;
const MIN_SENT = 20;

const NEEDS_102 = 'This needs database migration 102 to be run first.';
const PLATFORM = { id: null, email: null };

/** A whole number of -1 (unlimited) or more, within reason, or undefined to leave it to the plan. */
function limit(v: unknown, label: string, max: number): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < -1 || n > max) throw new AppError(`${label} must be a whole number from 0 to ${max.toLocaleString()}, or -1 for unlimited.`, 400);
  return n;
}

function cleanPlans(input: any): PlatformSettings['plans'] {
  const out: PlatformSettings['plans'] = {};
  for (const id of Object.keys(PLANS) as PlanId[]) {
    const p = input?.[id];
    if (!p) continue;
    const o: PlanOverride = {};
    const inboxes = limit(p.maxInboxes, `${PLANS[id].name} inboxes`, 10_000);
    const emails = limit(p.emailsPerMonth, `${PLANS[id].name} emails a month`, 10_000_000);
    const credits = limit(p.prospectCredits, `${PLANS[id].name} credits a month`, 1_000_000);
    if (credits === -1) throw new AppError('Credits cost real money, so no plan can have unlimited credits.', 400);
    if (inboxes !== undefined) o.maxInboxes = inboxes;
    if (emails !== undefined) o.emailsPerMonth = emails;
    if (credits !== undefined) o.prospectCredits = credits;
    if (Object.keys(o).length) out[id] = o;
  }
  return out;
}

function cleanPrices(input: any): PlatformSettings['credit_prices'] {
  const out: PlatformSettings['credit_prices'] = {};
  for (const a of Object.keys(CREDIT_PRICES) as CreditAction[]) {
    const v = input?.[a];
    if (v === null || v === undefined || v === '') continue;
    const n = Math.round(Number(v) * 10) / 10;
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError('A price is from 0 to 100 credits, to a tenth.', 400);
    out[a] = n;
  }
  return out;
}

function cleanSignups(input: any): PlatformSettings['signups'] {
  const mode = input?.mode;
  if (!['open', 'invite', 'closed'].includes(mode)) throw new AppError('Sign-ups are open, invite-only or closed.', 400);
  const allow = [...new Set((Array.isArray(input?.allow) ? input.allow : String(input?.allow || '').split(/[\s,;]+/))
    .map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean))] as string[];
  const bad = allow.find((a) => !/^@?[^\s@]+(\.[^\s@]+)+$/.test(a) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  if (bad) throw new AppError(`"${bad}" is not an email address or an @domain.`, 400);
  if (allow.length > 2000) throw new AppError('At most 2,000 addresses or domains.', 400);
  return { mode, allow };
}

function cleanAnnouncement(input: any): Announcement | null {
  if (!input || !String(input.text || '').trim()) return null;
  const text = String(input.text).trim();
  if (text.length > 280) throw new AppError('Keep the announcement to 280 characters.', 400);
  const url = String(input.link_url || '').trim();
  if (url && !/^https:\/\/[^\s]+$/.test(url) && !/^\/[^\s]*$/.test(url)) throw new AppError('The link is an https:// address or a path in the app.', 400);
  const tone = input.tone === 'warn' ? 'warn' : 'info';
  const label = url ? String(input.link_label || '').trim().slice(0, 40) || 'Learn more' : null;
  const id = createHash('sha1').update(`${text}|${tone}|${url}|${label}`).digest('hex').slice(0, 12);
  return { id, text, tone, link_url: url || null, link_label: label };
}

async function save(actor: string, key: keyof PlatformSettings, value: unknown, details: Record<string, any>) {
  try {
    await platformSettings.save(key, value, actor);
  } catch (err) {
    const msg = (err as any)?.message || '';
    if (/platform_settings|does not exist|schema cache/i.test(msg)) throw new AppError(NEEDS_102, 503);
    throw new AppError(msg || 'The setting could not be saved.', 500);
  }
  await adminAccountsService.audit(actor, `setting_${key}`, PLATFORM, details);
}

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : 0);

export const adminPlatformService = {
  /* ─── Settings ─────────────────────────────────────────────────────── */

  async settings(): Promise<AdminSettingsResponse> {
    const settings = await platformSettings.get();
    const d = platformSettings.defaults();
    return {
      settings,
      defaults: {
        plans: Object.fromEntries((Object.keys(PLANS) as PlanId[]).map((id) => [id, { ...d.plans[id], name: PLANS[id].name }])) as AdminSettingsResponse['defaults']['plans'],
        credit_prices: d.credit_prices,
      },
      ready: platformSettings.isReady(),
      updated: platformSettings.updatedStamps(),
    };
  },

  async savePlans(actor: string, input: unknown) {
    const plans = cleanPlans(input);
    await save(actor, 'plans', Object.keys(plans).length ? plans : null, { plans });
    return this.settings();
  },

  async savePrices(actor: string, input: unknown) {
    const prices = cleanPrices(input);
    await save(actor, 'credit_prices', Object.keys(prices).length ? prices : null, { prices });
    return this.settings();
  },

  async saveSignups(actor: string, input: unknown) {
    const signups = cleanSignups(input);
    await save(actor, 'signups', signups.mode === 'open' && !signups.allow.length ? null : signups, { mode: signups.mode, allowed: signups.allow.length });
    return this.settings();
  },

  async saveAnnouncement(actor: string, input: unknown) {
    const a = cleanAnnouncement(input);
    await save(actor, 'announcement', a, { text: a?.text ?? null });
    return this.settings();
  },

  /** Stop, or start again, every send on the platform. */
  async setKillSwitch(actor: string, on: boolean, reason?: string) {
    const why = String(reason || '').trim().slice(0, 300);
    if (on && !why) throw new AppError('Say why, for the record.', 400);
    await save(actor, 'kill_switch', on ? { reason: why, at: new Date().toISOString(), by: actor } : null, on ? { on, reason: why } : { on });
    return this.settings();
  },

  /* ─── One account's limits ─────────────────────────────────────────── */

  async setOverrides(actor: string, userId: string, input: any) {
    const user = await getUser(userId);
    const limits: AccountOverrides['limits'] = {};
    const inboxes = limit(input?.limits?.maxInboxes, 'Inboxes', 10_000);
    const emails = limit(input?.limits?.emailsPerMonth, 'Emails a month', 10_000_000);
    if (inboxes !== undefined) limits.maxInboxes = inboxes;
    if (emails !== undefined) limits.emailsPerMonth = emails;
    const features: AccountOverrides['features'] = {};
    for (const f of Object.keys(PLANS.growth.features) as (keyof AccountOverrides['features'])[]) {
      const v = input?.features?.[f];
      if (typeof v === 'boolean') features[f] = v;
    }
    try {
      await writeControls(userId, { limit_overrides: limits, feature_overrides: features });
    } catch (err) {
      if (err instanceof AppError && /limit_overrides|feature_overrides/.test(err.message)) throw new AppError(NEEDS_102, 503);
      throw err;
    }
    accountControls.forget(userId);
    await adminAccountsService.audit(actor, 'overrides', { id: userId, email: user.email || null }, { limits, features });
    return { limits, features };
  },

  /* ─── Sending, across every account ────────────────────────────────── */

  async sending(): Promise<AdminSendingReport> {
    const since = new Date(Date.now() - SENDING_DAYS * 86_400_000).toISOString();
    const [users, mailboxes, domains, activity, controls, settings] = await Promise.all([
      fetchAllUsers(),
      fetchAllPages<any>((a, b) => supabaseAdmin.from('smtp_accounts').select('id, user_id, email_address, is_active, is_verified, autopilot_state').order('id').range(a, b))
        .catch(() => fetchAllPages<any>((a, b) => supabaseAdmin.from('smtp_accounts').select('id, user_id, email_address, is_active, is_verified').order('id').range(a, b))),
      fetchAllPages<any>((a, b) => supabaseAdmin.from('sending_domains').select('id, user_id, domain, spf_ok, dkim_ok, dmarc_ok, last_checked_at').order('id').range(a, b)).catch(() => []),
      fetchAllPages<any>((a, b) => supabaseAdmin.from('campaign_activities')
        .select('activity_type, account:metadata->>smtp_account_id')
        .in('activity_type', ['sent', 'bounced', 'complained'])
        .gte('occurred_at', since)
        .order('id')
        .range(a, b)),
      fetchAllPages<any>((a, b) => supabaseAdmin.from('account_controls').select('user_id, sending_paused_at').order('user_id').range(a, b)).catch(() => []),
      platformSettings.get(),
    ]);
    const emailOf = new Map(users.map((u: any) => [u.id, u.email || null]));
    const held = new Set(controls.filter((c: any) => c.sending_paused_at).map((c: any) => c.user_id));

    const byBox = new Map<string, { sent: number; bounced: number; complained: number }>();
    for (const r of activity) {
      if (!r.account) continue;
      const c = byBox.get(r.account) || { sent: 0, bounced: 0, complained: 0 };
      if (r.activity_type === 'sent') c.sent++;
      else if (r.activity_type === 'bounced') c.bounced++;
      else if (r.activity_type === 'complained') c.complained++;
      byBox.set(r.account, c);
    }

    const rows = mailboxes.map((m: any) => {
      const c = byBox.get(m.id) || { sent: 0, bounced: 0, complained: 0 };
      const bounce_rate = rate(c.bounced, c.sent);
      const complaint_rate = rate(c.complained, c.sent);
      return {
        id: m.id, user_id: m.user_id, email: m.email_address, owner_email: emailOf.get(m.user_id) ?? null,
        is_active: m.is_active !== false, is_verified: !!m.is_verified, autopilot_state: m.autopilot_state ?? null,
        ...c, bounce_rate, complaint_rate,
        flagged: c.sent >= MIN_SENT && (bounce_rate >= BOUNCE_FLAG || complaint_rate >= COMPLAINT_FLAG),
      };
    }).sort((a: any, b: any) => Number(b.flagged) - Number(a.flagged) || b.bounce_rate - a.bounce_rate || b.sent - a.sent);

    const byUser = new Map<string, { sent: number; bounced: number; complained: number }>();
    for (const r of rows) {
      const c = byUser.get(r.user_id) || { sent: 0, bounced: 0, complained: 0 };
      c.sent += r.sent; c.bounced += r.bounced; c.complained += r.complained;
      byUser.set(r.user_id, c);
    }
    const risky = [...byUser.entries()].map(([id, c]) => {
      const bounce_rate = rate(c.bounced, c.sent);
      const complaint_rate = rate(c.complained, c.sent);
      const reasons: string[] = [];
      if (c.sent >= MIN_SENT && bounce_rate >= BOUNCE_FLAG) reasons.push(`${(bounce_rate * 100).toFixed(1)}% bounced`);
      if (c.sent >= MIN_SENT && complaint_rate >= COMPLAINT_FLAG) reasons.push(`${(complaint_rate * 100).toFixed(2)}% marked as spam`);
      return { id, email: emailOf.get(id) || '(no email)', sent: c.sent, bounce_rate, complaint_rate, reasons, held: held.has(id) };
    }).filter((r) => r.reasons.length).sort((a, b) => b.complaint_rate - a.complaint_rate || b.bounce_rate - a.bounce_rate);

    const total = rows.reduce((t: any, r: any) => ({ sent: t.sent + r.sent, bounced: t.bounced + r.bounced, complained: t.complained + r.complained }), { sent: 0, bounced: 0, complained: 0 });
    return {
      days: SENDING_DAYS,
      totals: { ...total, bounce_rate: rate(total.bounced, total.sent), complaint_rate: rate(total.complained, total.sent), mailboxes: rows.length, paused_mailboxes: rows.filter((r: any) => !r.is_active).length },
      mailboxes: rows,
      domains: domains.map((d: any) => ({ ...d, owner_email: emailOf.get(d.user_id) ?? null }))
        .sort((a: any, b: any) => Number(!!(a.spf_ok && a.dkim_ok)) - Number(!!(b.spf_ok && b.dkim_ok))),
      risky,
      kill_switch: settings.kill_switch,
      thresholds: { bounce: BOUNCE_FLAG, complaint: COMPLAINT_FLAG, min_sent: MIN_SENT },
    };
  },

  /** Take one mailbox out of sending, or put it back. Its owner can turn it back on themselves. */
  async setMailboxActive(actor: string, mailboxId: string, active: boolean) {
    const { data: box, error } = await supabaseAdmin.from('smtp_accounts').select('id, user_id, email_address').eq('id', mailboxId).maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!box) throw new AppError('Mailbox not found.', 404);
    const { error: upErr } = await supabaseAdmin.from('smtp_accounts').update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', mailboxId);
    if (upErr) throw new AppError(upErr.message, 500);
    const user = await getUser(box.user_id).catch(() => null);
    await adminAccountsService.audit(actor, active ? 'mailbox_resumed' : 'mailbox_paused', { id: box.user_id, email: user?.email || null }, { mailbox: box.email_address });
  },
};
