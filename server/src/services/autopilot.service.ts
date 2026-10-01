/* ═══════════════════════════════════════════════════════════════════════
   Deliverability autopilot: the part that acts.

   The rules are in shared/autopilot. This reads the evidence they judge
   on - every send and bounce of the last week, by the mailbox that sent it
   and the provider that received it - applies what they decide, and writes
   down what it did in words a person can read.

   Runs on a schedule (jobs/schedulers/autopilot.scheduler.ts), across
   every account, so it is never reachable from an authenticated route
   except through the per-user status, switch and resume endpoints below.

   Written to be safe to get wrong: every transition is conditioned on the
   state it was judged from, so a person pressing "resume" at the moment
   the autopilot decides to rest never loses to it silently; and a
   database without migration 077 makes the whole thing a no-op rather
   than an error.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  AUTOPILOT, nextMailboxState, restMailbox, evidenceFrom, autopilotShare,
  receivingProvider, judgeProvider, holdHours, emailDomain, looksLikeBounceNotice,
  type AutopilotStatus, type AutopilotEvent, type AutopilotWeek, type MailboxEvidence,
  type MailboxTransition, type AutopilotEventKind,
} from '@lemlist/shared';
import { fireEvent } from './webhook.service.js';
import { intakeBounceNotice, markBounceChecked } from './bounce-intake.service.js';

const DAY = 86_400_000;
const PAGE = 1000;
/** Evidence rows read per account per run. Beyond this the week is plain. */
const MAX_ROWS = 50_000;

/* ── Is the migration in? ──────────────────────────────────────────── */

let readyCache: { value: boolean; at: number } | null = null;

export async function autopilotReady(): Promise<boolean> {
  if (readyCache && Date.now() - readyCache.at < 5 * 60_000) return readyCache.value;
  const { error } = await supabaseAdmin.from('autopilot_events').select('id').limit(1);
  const value = !error;
  readyCache = { value, at: Date.now() };
  return value;
}

/* ── Evidence ──────────────────────────────────────────────────────── */

interface EvidenceRow {
  type: 'sent' | 'bounced' | 'complained';
  at: number;
  account: string | null;
  kind: string | null;
  to: string | null;
}

async function readEvidence(userId: string, since: Date): Promise<EvidenceRow[]> {
  const rows: EvidenceRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('campaign_activities')
      .select('activity_type, occurred_at, metadata, campaigns!inner(user_id)')
      .eq('campaigns.user_id', userId)
      .in('activity_type', ['sent', 'bounced', 'complained'])
      .gte('occurred_at', since.toISOString())
      .order('occurred_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`autopilot evidence: ${error.message}`);
    for (const r of data || []) {
      const m = (r as any).metadata || {};
      rows.push({
        type: (r as any).activity_type,
        at: Date.parse((r as any).occurred_at),
        account: m.smtp_account_id || null,
        kind: m.bounce_kind || null,
        to: m.to || null,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

function evidenceFor(rows: EvidenceRow[], accountId: string, from: Date): MailboxEvidence {
  const e: MailboxEvidence = { sent: 0, bounced: 0, blocked: 0, complained: 0 };
  const since = from.getTime();
  for (const r of rows) {
    if (r.account !== accountId || r.at < since) continue;
    if (r.type === 'sent') e.sent++;
    else if (r.type === 'complained') e.complained = (e.complained || 0) + 1;
    else if (r.kind === 'blocked') e.blocked++;
    else e.bounced++;
  }
  return e;
}

/* ── Writing it down ───────────────────────────────────────────────── */

async function logEvent(userId: string, ev: {
  kind: AutopilotEventKind; title: string; detail?: string | null;
  smtp_account_id?: string | null; provider?: string | null; metrics?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('autopilot_events').insert({
    user_id: userId,
    kind: ev.kind,
    title: ev.title,
    detail: ev.detail ?? null,
    smtp_account_id: ev.smtp_account_id ?? null,
    provider: ev.provider ?? null,
    metrics: ev.metrics ?? {},
  });
  if (error) console.error(`[Autopilot] Could not log event for ${userId}: ${error.message}`);
  // Slack, Zapier and raw webhooks hear about it the moment it happens.
  if (ev.kind !== 'weekly') {
    fireEvent(userId, 'autopilot.action', {
      kind: ev.kind, title: ev.title, detail: ev.detail ?? null,
      smtp_account_id: ev.smtp_account_id ?? null, provider: ev.provider ?? null,
    }).catch(() => {});
  }
}

/**
 * Apply one transition, only if the mailbox is still where it was judged
 * from - so a manual resume and an automatic rest racing cannot both land.
 */
async function apply(userId: string, account: any, t: MailboxTransition): Promise<boolean> {
  if (!t.patch) return false;
  const { data, error } = await supabaseAdmin
    .from('smtp_accounts')
    .update(t.patch)
    .eq('id', account.id)
    .eq('user_id', userId)
    .eq('autopilot_state', account.autopilot_state || 'active')
    .select('id');
  if (error) {
    console.error(`[Autopilot] Could not update mailbox ${account.id}: ${error.message}`);
    return false;
  }
  if (!data || data.length === 0) return false;
  if (t.event) {
    await logEvent(userId, {
      kind: t.event.kind,
      title: t.event.title,
      detail: t.event.detail,
      smtp_account_id: account.id,
      metrics: t.event.hours ? { hours: t.event.hours } : {},
    });
  }
  return true;
}

/* ── One account, once ─────────────────────────────────────────────── */

export async function evaluateUser(userId: string, now = new Date()): Promise<{ changed: number }> {
  const { data: settings } = await supabaseAdmin
    .from('user_settings')
    .select('autopilot_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (settings && settings.autopilot_enabled === false) return { changed: 0 };

  const { data: accounts, error } = await supabaseAdmin
    .from('smtp_accounts')
    .select('id, label, email_address, is_active, is_verified, is_seed, bounce_rate_7d, autopilot_state, autopilot_reason, autopilot_since, autopilot_rest_until, autopilot_recovery_day, autopilot_evidence_from, autopilot_last_rest_at')
    .eq('user_id', userId)
    .eq('is_seed', false);
  if (error) throw new Error(`autopilot mailboxes: ${error.message}`);
  if (!accounts || accounts.length === 0) return { changed: 0 };

  const rows = await readEvidence(userId, new Date(now.getTime() - AUTOPILOT.WINDOW_DAYS * DAY));
  let changed = 0;

  // 0. bounce_rate_7d was a lifetime rate under a seven-day name, which is
  //    how a mailbox that bounced badly in March still looked sick in
  //    September. The week's evidence is already here, so keep it true.
  const weekStart = new Date(now.getTime() - AUTOPILOT.WINDOW_DAYS * DAY);
  for (const a of accounts as any[]) {
    const w = evidenceFor(rows, a.id, weekStart);
    const rate = w.sent > 0 ? Math.round(((w.bounced + w.blocked) / w.sent) * 1000) / 10 : 0;
    if (Number(a.bounce_rate_7d) !== rate) {
      await supabaseAdmin.from('smtp_accounts').update({ bounce_rate_7d: rate }).eq('id', a.id).eq('user_id', userId);
    }
  }

  // 1. Each mailbox on its own evidence.
  for (const a of accounts as any[]) {
    // An inactive mailbox sends nothing and needs no rest - unless it is
    // already resting, whose clock should still run out.
    if (!a.is_active && (a.autopilot_state || 'active') !== 'resting') continue;
    const t = nextMailboxState(a, evidenceFor(rows, a.id, evidenceFrom(a, now)), now, a.email_address);
    if (await apply(userId, a, t)) {
      changed++;
      Object.assign(a, t.patch);
    }
  }

  // 2. A sending domain being refused as a whole. When two mailboxes on
  //    one domain are resting because receivers refused the sender, the
  //    problem is the domain's reputation, and the rest of its mailboxes
  //    are about to meet the same wall.
  const byDomain = new Map<string, any[]>();
  for (const a of accounts as any[]) {
    const d = emailDomain(a.email_address);
    if (!d) continue;
    byDomain.set(d, [...(byDomain.get(d) || []), a]);
  }
  for (const [domain, group] of byDomain) {
    const refused = group.filter((a) => a.autopilot_state === 'resting' && /refused it as a sender/.test(a.autopilot_reason || ''));
    if (refused.length < 2) continue;
    for (const a of group) {
      if (!a.is_active || a.autopilot_state === 'resting') continue;
      const t = restMailbox(
        a,
        `other mailboxes on ${domain} are being refused as senders, which points at the domain's reputation rather than one mailbox`,
        now,
        a.email_address,
      );
      if (await apply(userId, a, t)) {
        changed++;
        Object.assign(a, t.patch);
      }
    }
  }

  // 3. Receiving providers that have started refusing.
  changed += await evaluateProviders(userId, rows, now);

  return { changed };
}

async function evaluateProviders(userId: string, rows: EvidenceRow[], now: Date): Promise<number> {
  let changed = 0;
  const since = now.getTime() - DAY;
  const tally = new Map<string, { sent: number; blocked: number }>();
  for (const r of rows) {
    if (r.at < since || !r.to) continue;
    const p = receivingProvider(r.to);
    if (!p) continue;
    const t = tally.get(p) || { sent: 0, blocked: 0 };
    if (r.type === 'sent') t.sent++;
    else if (r.kind === 'blocked') t.blocked++;
    tally.set(p, t);
  }

  const { data: holds } = await supabaseAdmin
    .from('autopilot_holds')
    .select('provider, held_until, created_at')
    .eq('user_id', userId);
  const held = new Map((holds || []).map((h: any) => [h.provider, h]));

  // Release the ones whose time is up.
  for (const h of holds || []) {
    if (Date.parse((h as any).held_until) > now.getTime()) continue;
    const { data: gone } = await supabaseAdmin
      .from('autopilot_holds')
      .delete()
      .eq('user_id', userId)
      .eq('provider', (h as any).provider)
      .lte('held_until', now.toISOString())
      .select('provider');
    if (gone && gone.length) {
      changed++;
      held.delete((h as any).provider);
      await logEvent(userId, {
        kind: 'release',
        provider: (h as any).provider,
        title: `Sending to ${(h as any).provider} again`,
        detail: 'The pause is over. Mail there goes out at the normal pace, and pauses again if it is refused.',
      });
    }
  }

  for (const [provider, t] of tally) {
    if (held.has(provider) || !judgeProvider(t.sent, t.blocked)) continue;
    // The previous hold's start, when there was one this week, is gone with
    // its row - the event log remembers it.
    const { data: prev } = await supabaseAdmin
      .from('autopilot_events')
      .select('created_at')
      .eq('user_id', userId)
      .eq('kind', 'hold')
      .eq('provider', provider)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const hours = holdHours(prev?.created_at, now);
    const until = new Date(now.getTime() + hours * 3_600_000).toISOString();
    const reason = `${t.blocked} of ${t.sent} sends to ${provider} were refused in the last day`;
    const { error } = await supabaseAdmin
      .from('autopilot_holds')
      .upsert({ user_id: userId, provider, held_until: until, reason, created_at: now.toISOString() }, { onConflict: 'user_id,provider' });
    if (error) {
      console.error(`[Autopilot] Could not hold ${provider} for ${userId}: ${error.message}`);
      continue;
    }
    invalidateHolds(userId);
    changed++;
    await logEvent(userId, {
      kind: 'hold',
      provider,
      title: `Paused sending to ${provider} for ${hours} hours`,
      detail: `${reason}. Sending more into a wall teaches ${provider} to block you for longer - those emails wait and go out when the pause ends.`,
      metrics: { hours, sent: t.sent, blocked: t.blocked },
    });
  }
  return changed;
}

/* ── The send path's question ──────────────────────────────────────── */

const holdCache = new Map<string, { value: Map<string, number>; expires: number }>();

export function invalidateHolds(userId: string): void {
  holdCache.delete(userId);
}

/**
 * When mail to this address may go again, or null now. Memoised for a
 * minute, and fails open: an autopilot problem must never stop sending.
 */
export async function providerHeldUntil(userId: string, email: string): Promise<Date | null> {
  const provider = receivingProvider(email);
  if (!provider) return null;
  let cached = holdCache.get(userId);
  if (!cached || cached.expires < Date.now()) {
    const value = new Map<string, number>();
    try {
      const { data, error } = await supabaseAdmin
        .from('autopilot_holds')
        .select('provider, held_until')
        .eq('user_id', userId)
        .gt('held_until', new Date().toISOString());
      if (!error) for (const h of data || []) value.set((h as any).provider, Date.parse((h as any).held_until));
    } catch { /* fail open */ }
    cached = { value, expires: Date.now() + 60_000 };
    holdCache.set(userId, cached);
  }
  const until = cached.value.get(provider);
  return until && until > Date.now() ? new Date(until) : null;
}

/* ── Bounce notices ────────────────────────────────────────────────── */

/**
 * Read recent inbound mail nobody has checked for bounces yet: the notices
 * stored before bounce intake existed, and anything the sync missed.
 */
export async function sweepBounceNotices(batch = 300): Promise<{ checked: number; recorded: number }> {
  const since = new Date(Date.now() - 14 * DAY).toISOString();
  const { data, error } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, user_id, smtp_account_id, from_email, subject, body_text, received_at, smtp_accounts(email_address)')
    .eq('direction', 'inbound')
    .is('bounce_checked_at', null)
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(batch);
  if (error) {
    if (!/bounce_checked_at/.test(error.message)) console.error(`[Autopilot] Bounce sweep: ${error.message}`);
    return { checked: 0, recorded: 0 };
  }

  let recorded = 0;
  const perUser = new Map<string, number>();
  for (const m of data || []) {
    if (!looksLikeBounceNotice({ fromEmail: m.from_email, subject: m.subject, bodyText: m.body_text })) continue;
    const res = await intakeBounceNotice(m as any, (m as any).smtp_accounts?.email_address || null);
    if (res.recorded > 0) {
      recorded += res.recorded;
      perUser.set(m.user_id, (perUser.get(m.user_id) || 0) + res.recorded);
    }
  }
  await markBounceChecked((data || []).map((m) => m.id));

  for (const [userId, n] of perUser) {
    await logEvent(userId, {
      kind: 'bounces_found',
      title: `Found ${n} bounce${n === 1 ? '' : 's'} in delivery notices`,
      detail: `Returned-mail notices that used to sit unread in Other mail. Those addresses have left their sequences${n === 1 ? '' : ''}, and each bounce now counts against the mailbox that sent it.`,
      metrics: { bounces: n },
    });
  }
  return { checked: data?.length || 0, recorded };
}

/* ── The week ──────────────────────────────────────────────────────── */

async function weekFor(userId: string, now: Date): Promise<AutopilotWeek> {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const { data } = await supabaseAdmin
    .from('autopilot_events')
    .select('kind, metrics')
    .eq('user_id', userId)
    .gte('created_at', since);
  const week: AutopilotWeek = { rests: 0, slowdowns: 0, recoveries: 0, holds: 0, bounces_found: 0, rested_hours: 0 };
  for (const e of data || []) {
    const m = (e as any).metrics || {};
    switch ((e as any).kind) {
      case 'rest': week.rests++; week.rested_hours += Number(m.hours) || 0; break;
      case 'slow': week.slowdowns++; break;
      case 'recovered': case 'full_speed': week.recoveries++; break;
      case 'hold': week.holds++; break;
      case 'bounces_found': week.bounces_found += Number(m.bounces) || 0; break;
    }
  }
  return week;
}

/**
 * Once a week, what the autopilot did, in one entry - and to Slack or a
 * webhook for anyone who has one connected. A quiet week says so: "nothing
 * needed doing" is worth knowing too.
 */
export async function maybeSendWeekly(userId: string, now = new Date()): Promise<boolean> {
  const { data: s } = await supabaseAdmin
    .from('user_settings')
    .select('autopilot_enabled, autopilot_digest_sent_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!s || s.autopilot_enabled === false) return false;
  const last = s.autopilot_digest_sent_at ? Date.parse(s.autopilot_digest_sent_at) : 0;
  if (now.getTime() - last < 7 * DAY) return false;

  // Claimed first, conditioned on the value read, so two servers do not both send.
  let claim = supabaseAdmin.from('user_settings').update({ autopilot_digest_sent_at: now.toISOString() }).eq('user_id', userId);
  claim = s.autopilot_digest_sent_at ? claim.eq('autopilot_digest_sent_at', s.autopilot_digest_sent_at) : claim.is('autopilot_digest_sent_at', null);
  const { data: claimed } = await claim.select('user_id');
  if (!claimed || claimed.length === 0) return false;

  // A first run has no week behind it to report on.
  if (!last) return false;

  const week = await weekFor(userId, now);
  const acted = week.rests + week.slowdowns + week.holds + week.bounces_found;
  const parts: string[] = [];
  if (week.rests) parts.push(`rested ${week.rests} mailbox${week.rests === 1 ? '' : 'es'}`);
  if (week.slowdowns) parts.push(`slowed ${week.slowdowns}`);
  if (week.recoveries) parts.push(`brought ${week.recoveries} back to full speed`);
  if (week.holds) parts.push(`paused ${week.holds} provider${week.holds === 1 ? '' : 's'} that pushed back`);
  if (week.bounces_found) parts.push(`caught ${week.bounces_found} bounce${week.bounces_found === 1 ? '' : 's'} from returned-mail notices`);
  const title = acted
    ? `This week the autopilot ${parts.join(', ')}`
    : 'A quiet week: every mailbox stayed healthy';
  const detail = acted
    ? 'Your campaigns kept sending through the healthy mailboxes throughout.'
    : 'Nothing bounced or was refused enough to act on.';
  await logEvent(userId, { kind: 'weekly', title, detail, metrics: week as unknown as Record<string, unknown> });
  fireEvent(userId, 'autopilot.weekly', { title, detail, ...week }).catch(() => {});
  return true;
}

/* ── Every account ─────────────────────────────────────────────────── */

let lastRunAt: string | null = null;

export async function runAutopilot(now = new Date()): Promise<{ users: number; changed: number }> {
  if (!(await autopilotReady())) return { users: 0, changed: 0 };
  const users = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('smtp_accounts')
      .select('user_id')
      .eq('is_seed', false)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`autopilot accounts: ${error.message}`);
    for (const r of data || []) users.add((r as any).user_id);
    if (!data || data.length < PAGE) break;
  }

  let changed = 0;
  for (const userId of users) {
    try {
      changed += (await evaluateUser(userId, now)).changed;
      await maybeSendWeekly(userId, now);
    } catch (err: any) {
      // One account's bad data must not stop everyone else's protection.
      console.error(`[Autopilot] Evaluation failed for ${userId}: ${err?.message || err}`);
    }
  }
  lastRunAt = now.toISOString();
  return { users: users.size, changed };
}

/* ── Per-user endpoints ────────────────────────────────────────────── */

export const autopilotService = {
  async status(userId: string): Promise<AutopilotStatus> {
    const empty: AutopilotStatus = {
      ready: false, enabled: true, mailboxes: [], holds: [], events: [],
      week: { rests: 0, slowdowns: 0, recoveries: 0, holds: 0, bounces_found: 0, rested_hours: 0 },
      last_run_at: lastRunAt,
    };
    if (!(await autopilotReady())) return empty;
    const now = new Date();

    const [settings, accounts, holds, events, week] = await Promise.all([
      supabaseAdmin.from('user_settings').select('autopilot_enabled').eq('user_id', userId).maybeSingle(),
      supabaseAdmin.from('smtp_accounts')
        .select('id, label, email_address, is_active, autopilot_state, autopilot_reason, autopilot_since, autopilot_rest_until, autopilot_recovery_day, autopilot_evidence_from, autopilot_last_rest_at')
        .eq('user_id', userId).eq('is_seed', false).order('created_at', { ascending: true }),
      supabaseAdmin.from('autopilot_holds').select('provider, held_until, reason').eq('user_id', userId)
        .gt('held_until', now.toISOString()).order('held_until', { ascending: true }),
      supabaseAdmin.from('autopilot_events').select('id, kind, title, detail, smtp_account_id, provider, created_at')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(40),
      weekFor(userId, now),
    ]);
    if (accounts.error) throw new AppError(accounts.error.message, 500);

    const rows = await readEvidence(userId, new Date(now.getTime() - AUTOPILOT.WINDOW_DAYS * DAY));
    return {
      ready: true,
      enabled: settings.data?.autopilot_enabled !== false,
      mailboxes: (accounts.data || []).filter((a: any) => a.is_active || a.autopilot_state === 'resting').map((a: any) => ({
        id: a.id,
        label: a.label,
        email_address: a.email_address,
        state: a.autopilot_state || 'active',
        reason: a.autopilot_reason,
        since: a.autopilot_since,
        rest_until: a.autopilot_rest_until,
        share: autopilotShare(a, now),
        evidence: evidenceFor(rows, a.id, evidenceFrom(a, now)),
      })),
      holds: (holds.data || []) as any,
      events: (events.data || []) as AutopilotEvent[],
      week,
      last_run_at: lastRunAt,
    };
  },

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    if (!(await autopilotReady())) throw new AppError('Run migration 077 to turn on the autopilot.', 503);
    const { error } = await supabaseAdmin
      .from('user_settings')
      .upsert({ user_id: userId, autopilot_enabled: enabled }, { onConflict: 'user_id' });
    if (error) throw new AppError(error.message, 500);
    if (!enabled) {
      // Off means off: nothing stays rested or held on the autopilot's say-so.
      await supabaseAdmin.from('smtp_accounts')
        .update({ autopilot_state: 'active', autopilot_reason: null, autopilot_rest_until: null, autopilot_recovery_day: 0 })
        .eq('user_id', userId).neq('autopilot_state', 'active');
      await supabaseAdmin.from('autopilot_holds').delete().eq('user_id', userId);
      invalidateHolds(userId);
    }
    await logEvent(userId, {
      kind: 'manual_resume',
      title: enabled ? 'Autopilot switched on' : 'Autopilot switched off',
      detail: enabled
        ? 'It will rest, slow and pause on its own from its next check, a few minutes from now.'
        : 'Every mailbox is back at full volume and every provider pause is lifted. Nothing will be rested automatically.',
    });
  },

  /** A person overrides a rest or slowdown. Judged afresh from now. */
  async resumeMailbox(userId: string, accountId: string): Promise<void> {
    if (!(await autopilotReady())) throw new AppError('Run migration 077 first.', 503);
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('smtp_accounts')
      .update({
        autopilot_state: 'active', autopilot_reason: null, autopilot_rest_until: null,
        autopilot_recovery_day: 0, autopilot_since: now, autopilot_evidence_from: now,
      })
      .eq('id', accountId)
      .eq('user_id', userId)
      .select('email_address')
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Mailbox not found', 404);
    await logEvent(userId, {
      kind: 'manual_resume',
      smtp_account_id: accountId,
      title: `${data.email_address} resumed by hand`,
      detail: 'Back at full volume now. The autopilot judges it only on what it sends from here.',
    });
  },

  async releaseHold(userId: string, provider: string): Promise<void> {
    const { data, error } = await supabaseAdmin.from('autopilot_holds')
      .delete().eq('user_id', userId).eq('provider', provider).select('provider');
    if (error) throw new AppError(error.message, 500);
    if (!data || data.length === 0) throw new AppError('No pause on that provider', 404);
    invalidateHolds(userId);
    await logEvent(userId, {
      kind: 'release', provider,
      title: `Pause on ${provider} lifted by hand`,
      detail: 'Mail there goes out at the normal pace from the next send.',
    });
  },
};
