/* ═══════════════════════════════════════════════════════════════════════
   The weekly digest - the "Weekly digest" switch, which used to do nothing.

   Monday at 08:00 in the account's own time zone, for the seven days just
   gone: what went out, who replied (and how many were interested), the
   meetings booked, what bounced, any spam reports, how many replies are
   still waiting on you, the campaigns that did the work, and whatever the
   status page says needs a look. Rules and wording are in shared/notify.

   Sent once a week: user_settings.last_digest_sent_at (migration 079) is
   stamped before the send, so two servers, or a retry, cannot send it
   twice. Without that column the digest waits for the migration rather
   than risk going out every half hour.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { buildDigest, digestDue, digestSlot, monthlyResultsDue, buildResultsEmail, type DigestNumbers } from '@lemlist/shared';
import { resultsService } from './results.service.js';
import { sendToOwner } from './notify.service.js';
import { systemStatusService } from './system-status.service.js';
import { replyQueueService } from './reply-queue.service.js';

const DAY = 86_400_000;

function dayIn(at: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(at));
}

async function countActivities(userId: string, type: string, from: string, to: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('campaign_activities')
    .select('id, campaigns!inner(user_id)', { count: 'exact', head: true })
    .eq('campaigns.user_id', userId)
    .eq('activity_type', type)
    .gte('occurred_at', from)
    .lt('occurred_at', to);
  return count || 0;
}

/** Sends and replies per campaign, for the week. */
async function byCampaign(userId: string, from: string, to: string): Promise<DigestNumbers['campaigns']> {
  const tally = new Map<string, { sent: number; replies: number }>();
  for (const type of ['sent', 'replied'] as const) {
    for (let page = 0; page < 20; page++) {
      const { data, error } = await supabaseAdmin
        .from('campaign_activities')
        .select('campaign_id, campaigns!inner(user_id)')
        .eq('campaigns.user_id', userId)
        .eq('activity_type', type)
        .gte('occurred_at', from)
        .lt('occurred_at', to)
        .range(page * 1000, page * 1000 + 999);
      if (error || !data?.length) break;
      for (const r of data as any[]) {
        const t = tally.get(r.campaign_id) || { sent: 0, replies: 0 };
        if (type === 'sent') t.sent++; else t.replies++;
        tally.set(r.campaign_id, t);
      }
      if (data.length < 1000) break;
    }
  }
  if (!tally.size) return [];
  const { data: names } = await supabaseAdmin.from('campaigns').select('id, name').eq('user_id', userId).in('id', [...tally.keys()]);
  const nameOf = new Map((names || []).map((c: any) => [c.id, c.name]));
  return [...tally.entries()]
    .map(([id, t]) => ({ name: String(nameOf.get(id) || 'A deleted campaign'), ...t }))
    .sort((a, b) => b.replies - a.replies || b.sent - a.sent);
}

export const digestService = {
  /** The numbers for the week before `slot` (a Monday 08:00). */
  async numbers(userId: string, slot: Date, tz: string): Promise<DigestNumbers> {
    const to = slot.toISOString();
    const fromMs = slot.getTime() - 7 * DAY;
    const from = new Date(fromMs).toISOString();

    const [sent, replies, bounced, complaints, campaigns, positive, meetings, queue, status] = await Promise.all([
      countActivities(userId, 'sent', from, to),
      countActivities(userId, 'replied', from, to),
      countActivities(userId, 'bounced', from, to),
      countActivities(userId, 'complained', from, to),
      byCampaign(userId, from, to),
      supabaseAdmin.from('inbox_messages').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('direction', 'inbound').in('sara_intent', ['interested', 'meeting'])
        .gte('received_at', from).lt('received_at', to)
        .then((r) => r.count || 0, () => 0),
      supabaseAdmin.from('crm_events').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).is('cancelled_at', null)
        .gte('booked_at', from).lt('booked_at', to)
        .then((r) => r.count || 0, () => 0),
      replyQueueService.counts(userId).catch(() => null),
      systemStatusService.status(userId).catch(() => null),
    ]);

    return {
      from_day: dayIn(fromMs, tz),
      to_day: dayIn(slot.getTime() - 1, tz),
      sent, replies, positive, meetings, bounced, complaints,
      waiting: (queue as any)?.open ?? 0,
      campaigns,
      attention: (status?.issues || []).map((i) => ({ title: i.title, detail: i.detail })),
    };
  },

  /** Build and send one account's digest now. Used by the schedule and by "Send me one now". */
  async send(userId: string, opts: { slot?: Date } = {}): Promise<{ sent: boolean; subject: string }> {
    const { data: settings } = await supabaseAdmin.from('user_settings').select('timezone').eq('user_id', userId).maybeSingle();
    const tz = (settings as any)?.timezone || 'UTC';
    const slot = opts.slot || digestSlot(Date.now(), tz);
    const d = await this.numbers(userId, slot, tz);
    const { subject, text } = buildDigest(d);
    const sent = await sendToOwner(userId, {
      subject, text, href: '/',
      footer: 'Your weekly digest. Turn it off in Settings, Notifications.',
    });
    return { sent, subject };
  },
};

let columnMissing = false;

/** Every account whose digest is due: claim the week, then send. Cross-tenant; scheduler only. */
export async function runDigests(now = Date.now()): Promise<{ sent: number }> {
  const { data: rows, error } = await supabaseAdmin
    .from('user_settings')
    .select('user_id, timezone, last_digest_sent_at')
    .eq('weekly_digest', true);
  if (error) {
    // Wait for migration 079 rather than send without a record of it.
    if (/last_digest_sent_at/.test(error.message)) { columnMissing = true; return { sent: 0 }; }
    throw new Error(`digest accounts: ${error.message}`);
  }
  columnMissing = false;

  let sent = 0;
  for (const r of rows || []) {
    const tz = (r as any).timezone || 'UTC';
    if (!digestDue((r as any).last_digest_sent_at, now, tz)) continue;
    // Claim it first: only the server whose update matched sends.
    const claim = supabaseAdmin.from('user_settings')
      .update({ last_digest_sent_at: new Date(now).toISOString() })
      .eq('user_id', (r as any).user_id);
    const { data: won } = await ((r as any).last_digest_sent_at
      ? claim.eq('last_digest_sent_at', (r as any).last_digest_sent_at)
      : claim.is('last_digest_sent_at', null)
    ).select('user_id');
    if (!won?.length) continue;
    const out = await digestService.send((r as any).user_id, { slot: digestSlot(now, tz) }).catch(() => ({ sent: false }));
    if (out.sent) sent++;
  }
  return { sent };
}

export function digestReady(): boolean {
  return !columnMissing;
}

/* ── Monthly results (shared/results) ──────────────────────────────── */

let monthlyColumnMissing = false;

/** On the 1st, last month's results to every account that wants them. Cross-tenant; scheduler only. */
export async function runMonthlyResults(now = Date.now()): Promise<{ sent: number }> {
  if (monthlyColumnMissing) return { sent: 0 };
  const { data: rows, error } = await supabaseAdmin
    .from('user_settings')
    .select('user_id, timezone, monthly_results, last_results_month');
  if (error) {
    if (/monthly_results|last_results_month/.test(error.message)) { monthlyColumnMissing = true; return { sent: 0 }; }
    throw new Error(`monthly results accounts: ${error.message}`);
  }
  let sent = 0;
  for (const r of rows || []) {
    const row = r as any;
    if (row.monthly_results === false) continue;
    const key = monthlyResultsDue(row.last_results_month, now, row.timezone);
    if (!key) continue;
    // Claim the month before sending, so it goes once.
    const claim = supabaseAdmin.from('user_settings').update({ last_results_month: key }).eq('user_id', row.user_id);
    const { data: won } = await (row.last_results_month ? claim.eq('last_results_month', row.last_results_month) : claim.is('last_results_month', null)).select('user_id');
    if (!won?.length) continue;
    try {
      const report = await resultsService.report(row.user_id, 'last_month', { now });
      // Nothing went out and nothing came back: no email about nothing.
      const c = report.current;
      if (!c.sent && !c.replies && !c.meetings && !c.deals && !c.won_deals) continue;
      const { subject, text } = buildResultsEmail(report);
      if (await sendToOwner(row.user_id, {
        subject, text, href: '/analytics/results?period=last_month',
        footer: 'Your monthly results. Turn them off in Settings, Notifications.',
      })) sent++;
    } catch (err: any) {
      console.error(`[Results] monthly for ${row.user_id}: ${err?.message || err}`);
    }
  }
  return { sent };
}
