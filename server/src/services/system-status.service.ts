/* ═══════════════════════════════════════════════════════════════════════
   Is everything running - for one account.

   Three layers, each answering "would I find out?":

     jobs       every background job's heartbeat, read against how often it
                is meant to beat (shared/system-status).
     issues     the account's own things that have quietly stopped: a
                mailbox that cannot sign in or whose replies stopped
                syncing, a campaign stuck on a stall, emails piling up past
                their send time, every mailbox resting.
     alerts     the watchdog (every five minutes) tells Slack/webhooks
                about a new issue once, and again when it clears - the
                difference between a status page you have to remember to
                open and one that comes to you.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import {
  JOBS, jobHealth, overallLevel,
  type StatusIssue, type StatusJob, type SystemStatus, type SelfTestResult,
} from '@lemlist/shared';
import { readBeats } from '../utils/heartbeat.js';
import { smtpService } from './smtp.service.js';
import { fireEvent } from './webhook.service.js';
import { aiAvailable } from './ai.service.js';
import { aiUsageService } from './ai-usage.service.js';

const MIN = 60_000;
/** Replies older than this, on a mailbox that should be syncing, is a stall. */
const SYNC_STALE_MS = 30 * MIN;
/** Emails this far past their send time, in a running campaign, are a backlog. */
const OVERDUE_MS = 30 * MIN;

async function jobs(now = Date.now()): Promise<{ list: StatusJob[]; persisted: boolean }> {
  const { beats, persisted } = await readBeats();
  const list = JOBS.map((j): StatusJob => {
    const b = beats.get(j.id);
    return {
      id: j.id, label: j.label, what: j.what, core: j.core, every_ms: j.everyMs,
      health: jobHealth(b, j.everyMs, now),
      last_ok_at: b?.last_ok_at ?? null,
      last_error: b?.last_error ?? null,
    };
  });
  return { list, persisted };
}

/** The account's own issues. Job issues are added by the caller. */
async function accountIssues(userId: string, now = Date.now()): Promise<StatusIssue[]> {
  const issues: StatusIssue[] = [];

  const { data: boxes } = await supabaseAdmin
    .from('smtp_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_seed', false);
  const active = (boxes || []).filter((b: any) => b.is_active);

  for (const b of active as any[]) {
    if (!b.is_verified) {
      issues.push({
        key: `mailbox-signin:${b.id}`,
        level: 'down',
        title: `${b.email_address} cannot send`,
        detail: b.last_send_error || 'Its sign-in was refused, so it has been taken out of rotation. Reconnect it to put it back.',
        href: `/email-accounts?mailbox=${b.id}`,
        since: b.last_send_error_at || null,
      });
      continue;
    }
    if (b.imap_host) {
      const last = b.last_inbox_sync_at ? Date.parse(b.last_inbox_sync_at) : 0;
      if (b.last_inbox_sync_error) {
        issues.push({
          key: `mailbox-sync-error:${b.id}`,
          level: 'attention',
          title: `Replies to ${b.email_address} are not coming in`,
          detail: `The last inbox sync failed: ${String(b.last_inbox_sync_error).slice(0, 200)}. Replies are not being read and sequences will not stop for them.`,
          href: `/email-accounts?mailbox=${b.id}`,
          since: b.last_inbox_sync_at || null,
        });
      } else if (last && now - last > SYNC_STALE_MS) {
        issues.push({
          key: `mailbox-sync-stale:${b.id}`,
          level: 'attention',
          title: `${b.email_address} has not synced for ${Math.round((now - last) / 60_000)} minutes`,
          detail: 'Replies may be sitting unread in the mailbox, and sequences will not stop for them until it syncs.',
          href: `/email-accounts?mailbox=${b.id}`,
          since: b.last_inbox_sync_at,
        });
      }
    }
  }

  const sendable = active.filter((b: any) => b.is_verified);
  if (sendable.length > 0 && sendable.every((b: any) => b.autopilot_state === 'resting')) {
    issues.push({
      key: 'autopilot-all-resting',
      level: 'down',
      title: 'Every mailbox is resting',
      detail: 'The autopilot rested them after bounces or blocks, so nothing is sending until one comes back. Its log says why.',
      href: '/email-accounts?tab=autopilot',
      since: null,
    });
  }

  const { data: stalled } = await supabaseAdmin
    .from('campaigns')
    .select('id, name, stall_reason, stall_since')
    .eq('user_id', userId)
    .eq('status', 'running')
    .not('stall_reason', 'is', null);
  for (const c of stalled || []) {
    issues.push({
      key: `campaign-stalled:${(c as any).id}`,
      level: 'attention',
      title: `"${(c as any).name}" is not sending`,
      detail: String((c as any).stall_reason),
      href: `/campaigns/${(c as any).id}`,
      since: (c as any).stall_since || null,
    });
  }

  const { count: overdue } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id, campaigns!inner(user_id, status)', { count: 'exact', head: true })
    .eq('campaigns.user_id', userId)
    .eq('campaigns.status', 'running')
    .eq('status', 'active')
    .lt('next_send_at', new Date(now - OVERDUE_MS).toISOString());
  if ((overdue || 0) > 0) {
    issues.push({
      key: 'sending-backlog',
      level: 'attention',
      title: `${(overdue || 0).toLocaleString()} email${overdue === 1 ? ' is' : 's are'} more than 30 minutes late`,
      detail: 'They are due but have not gone out. Usually every mailbox has reached today\'s limit - they go out as capacity frees up - but if it persists, sending may be stuck.',
      href: '/campaigns',
      since: null,
    });
  }

  // Relay's AI allowance ran out: replies are still read, by the rules.
  if (aiAvailable()) {
    const ai = await aiUsageService.usage(userId, true).catch(() => null);
    if (ai?.state === 'reached') {
      issues.push({
        key: `ai-allowance:${ai.month}`,
        level: 'attention',
        title: 'Relay has used this month\'s AI allowance',
        detail: `Replies are being read by the keyword rules and sequences come from templates until ${ai.resets_at.slice(0, 10)}. Nothing has stopped sending. Choose a larger allowance in Settings if you want Claude back sooner.`,
        href: '/settings?tab=ai',
        since: null,
      });
    }
  }

  return issues;
}

function jobIssues(list: StatusJob[]): StatusIssue[] {
  return list
    .filter((j) => j.core && (j.health === 'stalled' || j.health === 'failing'))
    .map((j) => ({
      key: `job:${j.id}`,
      level: j.health === 'stalled' ? 'down' as const : 'attention' as const,
      title: j.health === 'stalled' ? `${j.label} has stopped` : `${j.label} keeps failing`,
      detail: j.health === 'stalled'
        ? `It has not run for a while, so this is not happening: ${j.what.toLowerCase()}. The server may need a restart.`
        : `It runs, but errors every time${j.last_error ? `: ${j.last_error.slice(0, 160)}` : ''}.`,
      href: '/system',
      since: j.last_ok_at,
    }));
}

function headlineFor(level: SystemStatus['level'], issues: StatusIssue[]): string {
  if (level === 'ok') return 'Everything is running.';
  const first = issues[0];
  if (issues.length === 1 && first) return first.title + '.';
  return `${issues.length} things need a look${first ? ` - starting with: ${first.title.toLowerCase()}` : ''}.`;
}

export const systemStatusService = {
  async status(userId: string): Promise<SystemStatus> {
    const now = Date.now();
    const [{ list, persisted }, mine] = await Promise.all([jobs(now), accountIssues(userId, now)]);
    const issues = [...jobIssues(list), ...mine]
      .sort((a, b) => (a.level === b.level ? 0 : a.level === 'down' ? -1 : 1));
    const level = overallLevel(list, issues);
    return { persisted, level, headline: headlineFor(level, issues), jobs: list, issues, checked_at: new Date(now).toISOString() };
  },

  /**
   * Checks run on demand: the database answers, every sending mailbox can
   * sign in and send (a probe to itself, no quota), and the core jobs have
   * beaten recently.
   */
  async selfTest(userId: string): Promise<SelfTestResult[]> {
    const results: SelfTestResult[] = [];

    const t0 = Date.now();
    const { error: dbErr } = await supabaseAdmin.from('smtp_accounts').select('id', { head: true, count: 'exact' }).eq('user_id', userId);
    results.push({ id: 'database', label: 'Database', ok: !dbErr, detail: dbErr ? dbErr.message : `Answered in ${Date.now() - t0} ms.` });

    const { data: boxes } = await supabaseAdmin
      .from('smtp_accounts')
      .select('id, email_address')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('is_seed', false);
    if (!boxes || boxes.length === 0) {
      results.push({ id: 'mailboxes', label: 'Mailboxes', ok: false, detail: 'No mailbox connected, so nothing can send.' });
    }
    // One at a time: several probes at once from one account looks like a burst.
    for (const b of boxes || []) {
      try {
        const r: any = await smtpService.test(userId, (b as any).id);
        const ok = !!(r?.success ?? r?.ok);
        results.push({
          id: `mailbox:${(b as any).id}`,
          label: (b as any).email_address,
          ok,
          detail: ok ? 'Signed in, sent a test to itself, and read its inbox.' : (r?.message || 'The connection test failed.'),
        });
      } catch (err: any) {
        results.push({ id: `mailbox:${(b as any).id}`, label: (b as any).email_address, ok: false, detail: err?.message || 'The connection test failed.' });
      }
    }

    const { list } = await jobs();
    for (const j of list.filter((x) => x.core)) {
      results.push({
        id: `job:${j.id}`,
        label: j.label,
        ok: j.health === 'ok',
        detail: j.health === 'ok' ? `Running - last finished ${j.last_ok_at ? new Date(j.last_ok_at).toISOString().slice(11, 16) + ' UTC' : 'recently'}.`
          : j.health === 'never' ? 'Has not run on this server yet. Give it a few minutes after a restart.'
            : j.health === 'failing' ? `Runs but errors: ${j.last_error || 'unknown error'}`
              : `Last ran too long ago (${j.health}).`,
      });
    }
    return results;
  },
};

/* ── The watchdog ──────────────────────────────────────────────────── */

let alertsMissing = false;

/**
 * Every account with something that can go wrong: tell each about new
 * issues once, and about cleared ones once. Cross-tenant; scheduler only.
 */
export async function runWatchdog(): Promise<{ users: number; raised: number; cleared: number }> {
  if (alertsMissing) return { users: 0, raised: 0, cleared: 0 };
  const now = Date.now();
  const { list } = await jobs(now);
  const globalIssues = jobIssues(list);

  const users = new Set<string>();
  const { data: rows, error } = await supabaseAdmin
    .from('smtp_accounts').select('user_id').eq('is_active', true).eq('is_seed', false);
  if (error) throw new Error(`watchdog accounts: ${error.message}`);
  for (const r of rows || []) users.add((r as any).user_id);

  let raised = 0, cleared = 0;
  for (const userId of users) {
    try {
      const issues = [...globalIssues, ...(await accountIssues(userId, now))];
      const { data: open, error: readErr } = await supabaseAdmin
        .from('system_alerts').select('key').eq('user_id', userId).is('resolved_at', null);
      if (readErr) {
        if (/system_alerts/.test(readErr.message)) { alertsMissing = true; break; }
        throw new Error(readErr.message);
      }
      const known = new Set((open || []).map((r: any) => r.key));
      const current = new Set(issues.map((i) => i.key));

      for (const i of issues) {
        if (known.has(i.key)) continue;
        const { error: insErr } = await supabaseAdmin.from('system_alerts').upsert({
          user_id: userId, key: i.key, level: i.level, title: i.title, detail: i.detail,
          first_seen_at: new Date(now).toISOString(), resolved_at: null,
        }, { onConflict: 'user_id,key' });
        if (insErr) continue;
        raised++;
        fireEvent(userId, 'system.attention', { key: i.key, level: i.level, title: i.title, detail: i.detail, href: i.href }).catch(() => {});
      }
      for (const key of known) {
        if (current.has(key)) continue;
        const { data: done } = await supabaseAdmin.from('system_alerts')
          .update({ resolved_at: new Date(now).toISOString() })
          .eq('user_id', userId).eq('key', key).is('resolved_at', null)
          .select('title');
        if (done && done.length) {
          cleared++;
          fireEvent(userId, 'system.resolved', { key, title: (done[0] as any).title }).catch(() => {});
        }
      }
    } catch (err: any) {
      console.error(`[Watchdog] ${userId}: ${err?.message || err}`);
    }
  }
  return { users: users.size, raised, cleared };
}
