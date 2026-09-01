import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { warmupAllowance, emailDomain } from '@lemlist/shared';
import type { CampaignHealth, CampaignIssue, CampaignReach, SmtpAccount } from '@lemlist/shared';
import * as bounceGuard from './bounce-guard.service.js';

/**
 * Whether a running campaign is actually running.
 *
 * A campaign's badge says "running" from the moment it is launched until
 * somebody changes it. It says that whether mail is going out or not, and
 * every way of it not going out is silent: a mailbox that loses its
 * password, a bounce guard that trips, a sending window nobody is awake
 * for, a queue of contacts all sitting on an error. The sends drop to zero
 * and the first signal is a week without replies.
 *
 * None of the facts below are new. The bounce guard already knows, the
 * sender pool already knows, the schedule already knows. What has never
 * existed is one place that asks all of them on behalf of the person who
 * would want to know.
 *
 * Nothing here throws on a partial answer: a health panel that errors is
 * strictly worse than a health panel that says less.
 */

/** Sendable means it can actually carry a real campaign send right now. */
function sendable(a: SmtpAccount): boolean {
  return a.is_active && a.is_verified;
}

/**
 * Sends left in this mailbox today. Null when it is uncapped.
 *
 * Always measured against `sends_today` — the same counter selectBestSender()
 * gates real campaign sends on (see sse.service.ts). `warmup_sent_today` is a
 * separate counter for peer-to-peer warm-up mail, not campaign sends, so
 * reading it here for a warming-up mailbox could report capacity that
 * `sends_today` has already exhausted.
 */
function remainingToday(a: SmtpAccount): number | null {
  const allowance = warmupAllowance(a);
  if (allowance === 0) return null; // 0 means unlimited, everywhere in this codebase
  return Math.max(0, allowance - (a.sends_today || 0));
}

/** The steady daily allowance. Null when uncapped. */
function dailyAllowance(a: SmtpAccount): number | null {
  const allowance = warmupAllowance(a);
  return allowance === 0 ? null : allowance;
}

/**
 * Which mailboxes this campaign sends from.
 *
 * The pool when it has one, otherwise every usable mailbox on the account —
 * the same rule selectBestSender() follows, because a health check that
 * modelled a different pool than the sender would be worse than none.
 */
async function sendersFor(userId: string, campaignId: string): Promise<SmtpAccount[]> {
  const { data: pool } = await supabaseAdmin
    .from('campaign_smtp_accounts')
    .select('smtp_account_id')
    .eq('campaign_id', campaignId);

  let query = supabaseAdmin.from('smtp_accounts').select('*').eq('user_id', userId);
  const ids = (pool || []).map((p: any) => p.smtp_account_id).filter(Boolean);
  if (ids.length > 0) query = query.in('id', ids);

  const { data } = await query;
  return (data || []) as SmtpAccount[];
}

/** Whether the campaign's send window contains this moment. */
function insideWindow(campaign: any, now = new Date()): boolean | null {
  const start = campaign.send_window_start;
  const end = campaign.send_window_end;
  const days: string[] = Array.isArray(campaign.send_days) ? campaign.send_days : [];
  if (!start || !end || days.length === 0) return null;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: campaign.timezone || 'UTC',
      weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
  } catch {
    // An unknown timezone is not a reason to claim the campaign is asleep.
    return null;
  }

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const weekday = get('weekday').toLowerCase();
  if (!days.map((d) => String(d).toLowerCase()).includes(weekday)) return false;

  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const toMinutes = (hhmm: string) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const from = toMinutes(start);
  const to = toMinutes(end);
  // A window that wraps midnight is two ranges, not one.
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

export const campaignHealthService = {
  async get(userId: string, campaignId: string): Promise<CampaignHealth> {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!campaign) throw new AppError('Campaign not found', 404);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [senders, pendingRes, erroredRes, activeRes, sentRes, domainsRes, verdict] = await Promise.all([
      sendersFor(userId, campaignId),
      supabaseAdmin.from('campaign_contacts').select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaignId).eq('status', 'pending'),
      supabaseAdmin.from('campaign_contacts').select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaignId).eq('status', 'error'),
      supabaseAdmin.from('campaign_contacts').select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaignId).in('status', ['pending', 'active']),
      supabaseAdmin.from('campaign_activities').select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaignId).eq('activity_type', 'sent').gte('created_at', since),
      supabaseAdmin.from('sending_domains').select('domain, spf_ok, dkim_ok').eq('user_id', userId),
      bounceGuard.assessCampaign(userId, campaignId).catch(() => null),
    ]);

    const pending = pendingRes.count || 0;
    const errored = erroredRes.count || 0;
    const stillGoing = activeRes.count || 0;
    const sent24h = sentRes.count || 0;
    const usable = senders.filter(sendable);

    const issues: CampaignIssue[] = [];

    /* ---- who it sends from ---- */
    if (senders.length === 0) {
      issues.push({
        id: 'no_sender',
        level: 'stalled',
        headline: 'No mailbox is assigned to this campaign.',
        detail: 'The sender pool is empty and there are no mailboxes on the account to fall back to. Nothing can go out.',
        fix: { label: 'Connect a mailbox', href: '/email-accounts' },
      });
    } else if (usable.length === 0) {
      const why = senders.some((a) => !a.is_verified)
        ? 'none of them have passed a connection test'
        : 'all of them are switched off';
      issues.push({
        id: 'sender_failing',
        level: 'stalled',
        headline: `This campaign has ${senders.length} mailbox${senders.length === 1 ? '' : 'es'}, but ${why}.`,
        detail: 'A password change or a revoked app password will do this. Run "Test" on the mailbox to see the real error.',
        fix: { label: 'Check mailboxes', href: '/email-accounts?tab=mailboxes' },
      });
    }

    /* ---- capacity ---- */
    const uncapped = usable.some((a) => remainingToday(a) === null);
    const capacityToday = uncapped
      ? null
      : usable.reduce((n, a) => n + (remainingToday(a) || 0), 0);
    const dailyCapacity = uncapped
      ? null
      : usable.reduce((n, a) => n + (dailyAllowance(a) || 0), 0);

    if (usable.length > 0 && capacityToday === 0) {
      issues.push({
        id: 'capacity_exhausted',
        level: 'attention',
        headline: 'Today’s sending allowance is used up.',
        detail: dailyCapacity
          ? `These mailboxes send ${dailyCapacity.toLocaleString()} a day between them, and today’s are gone. Sending resumes tomorrow.`
          : 'Sending resumes when the daily allowance resets.',
        fix: { label: 'Review limits', href: '/email-accounts?tab=mailboxes' },
      });
    }
    /* ---- reputation ---- */
    if (verdict?.trip) {
      issues.push({
        id: 'bounce_guard',
        level: 'stalled',
        headline: 'The bounce guard has stopped this campaign.',
        detail: verdict.note
          || `${verdict.bounced.toLocaleString()} of ${verdict.sent.toLocaleString()} sends bounced, past the ${verdict.thresholdPercent}% threshold. Continuing would damage the sending domain, so sending is held until the list is cleaned.`,
        fix: { label: 'Clean the list', href: '/verification' },
      });
    }

    // Only the domains actually being sent from matter here.
    if (usable.length > 0) {
      const verified = new Set(
        (domainsRes.data || [])
          .filter((d: any) => d.spf_ok && d.dkim_ok)
          .map((d: any) => String(d.domain).toLowerCase()),
      );
      const unauthenticated = new Set(
        usable
          .map((a) => emailDomain(a.email_address))
          .filter((d): d is string => !!d)
          .filter((d) => !verified.has(d) && ![...verified].some((v) => d.endsWith(`.${v}`))),
      );
      if (unauthenticated.size > 0) {
        issues.push({
          id: 'domain_unauthenticated',
          level: 'attention',
          headline: `Sending from ${[...unauthenticated].join(', ')} without SPF and DKIM.`,
          detail: 'Mail still goes out, but a lot of it will land in spam. This is the single biggest thing you can fix.',
          fix: { label: 'Fix DNS', href: '/email-accounts?tab=domains' },
        });
      }
    }

    /* ---- the queue itself ---- */
    if (stillGoing === 0 && errored > 0) {
      issues.push({
        id: 'all_errored',
        level: 'stalled',
        headline: `All ${errored.toLocaleString()} remaining contact${errored === 1 ? ' is' : 's are'} stuck on an error.`,
        detail: 'Nothing is left to send. Fix the underlying cause and retry them.',
        fix: { label: 'Retry errored contacts', href: `/campaigns/${campaignId}` },
      });
    } else if (stillGoing === 0 && errored === 0 && campaign.status === 'running') {
      issues.push({
        id: 'nothing_left',
        level: 'attention',
        headline: 'Everyone in this campaign has finished the sequence.',
        detail: 'It is still marked running but has nobody left to send to. Add more contacts, or mark it complete.',
        fix: { label: 'Add contacts', href: `/campaigns/${campaignId}` },
      });
    }

    /* ---- the clock ---- */
    const windowOpen = insideWindow(campaign);
    if (windowOpen === null && campaign.status === 'running') {
      issues.push({
        id: 'no_schedule',
        level: 'attention',
        headline: 'This campaign has no sending window.',
        detail: 'Without one it can send at any hour, including the middle of the night in the recipient’s timezone.',
        fix: { label: 'Set a schedule', href: '/schedules' },
      });
    } else if (windowOpen === false && stillGoing > 0 && campaign.status === 'running') {
      issues.push({
        id: 'outside_schedule',
        level: 'attention',
        headline: 'Outside the sending window right now.',
        detail: `This campaign sends ${campaign.send_window_start}–${campaign.send_window_end} ${campaign.timezone || 'UTC'}. It will pick up again then.`,
        fix: null,
      });
    }

    /* ---- the verdict ---- */
    const stalled = issues.filter((i) => i.level === 'stalled');
    const level = stalled.length > 0 ? 'stalled' : issues.length > 0 ? 'attention' : 'ok';

    const daysToClear = dailyCapacity && dailyCapacity > 0 && stillGoing > 0
      ? Math.ceil(stillGoing / dailyCapacity)
      : null;

    let summary: string;
    if (level === 'stalled') {
      summary = stalled.length === 1
        ? stalled[0].headline
        : `${stalled.length} things are stopping this campaign from sending.`;
    } else if (level === 'attention') {
      summary = issues.length === 1
        ? issues[0].headline
        : `Sending, with ${issues.length} things worth a look.`;
    } else if (stillGoing === 0) {
      summary = 'Nothing left to send.';
    } else if (daysToClear !== null) {
      summary = `Sending. ${stillGoing.toLocaleString()} left, about ${daysToClear} day${daysToClear === 1 ? '' : 's'} at this rate.`;
    } else {
      summary = `Sending. ${stillGoing.toLocaleString()} contact${stillGoing === 1 ? '' : 's'} left.`;
    }

    return {
      level,
      summary,
      issues,
      sent_24h: sent24h,
      pending,
      errored,
      capacity_today: capacityToday,
      days_to_clear: daysToClear,
      generated_at: new Date().toISOString(),
    };
  },

  /**
   * What a campaign can reach, cheaply, for anywhere that needs the number
   * before an add rather than after it.
   *
   * This is the extension's question: someone is about to put two hundred
   * people into a campaign whose mailboxes send forty a day, and right now
   * nothing tells them. It is deliberately not the full health check —
   * that runs seven queries, and the extension asks this on every panel
   * open.
   */
  async reach(userId: string, campaignId: string): Promise<CampaignReach> {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, status')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!campaign) throw new AppError('Campaign not found', 404);

    const [senders, activeRes] = await Promise.all([
      sendersFor(userId, campaignId),
      supabaseAdmin.from('campaign_contacts').select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaignId).in('status', ['pending', 'active']),
    ]);

    const usable = senders.filter(sendable);
    const uncapped = usable.some((a) => dailyAllowance(a) === null);
    const pending = activeRes.count || 0;

    const dailyCapacity = uncapped ? null : usable.reduce((n, a) => n + (dailyAllowance(a) || 0), 0);
    const capacityToday = uncapped ? null : usable.reduce((n, a) => n + (remainingToday(a) || 0), 0);

    return {
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      pending,
      capacity_today: capacityToday,
      daily_capacity: dailyCapacity,
      days_to_clear: dailyCapacity && dailyCapacity > 0 && pending > 0
        ? Math.ceil(pending / dailyCapacity)
        : null,
      sending: usable.length > 0 && ['running', 'scheduled'].includes(campaign.status),
    };
  },
};
