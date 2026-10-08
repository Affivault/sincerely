/* ═══════════════════════════════════════════════════════════════════════
   Emails the platform sends you about your own account.

   Four switches in Settings > Notifications, each of which used to do
   nothing at all. Now:

     email_notifications   something needs your attention: a mailbox that
                           cannot send, replies that stopped syncing, every
                           mailbox resting, a spam complaint, a reply check
                           that failed (whatever the status page raises)
     campaign_alerts       what happens to a campaign without you: the
                           bounce guard pausing it, it finishing, and
                           Relay proposing or settling a test on it.
                           Never your own launch, pause or resume.
     reply_notifications   somebody replied - one email per reply, at most
                           REPLY_EMAILS_PER_HOUR an hour so a burst does not
                           become a flood
     weekly_digest         Monday morning in your time zone: what went out,
                           who replied, meetings, and what needs a look

   They are sent from your own first connected mailbox to the address you
   sign in with, marked so that inbox sync never mistakes one for a reply.

   Pure: events and numbers in, subject and text out.
   ═══════════════════════════════════════════════════════════════════════ */

import { partsInTimezone, tzWallTimeToUtc } from './timezone.js';

export type NotifySetting = 'email_notifications' | 'campaign_alerts' | 'reply_notifications' | 'weekly_digest' | 'monthly_results';

export interface NotifyMail {
  setting: NotifySetting;
  subject: string;
  text: string;
  /** A path in the app, made absolute by the sender. */
  href: string | null;
  /** Same key, same hour: sent once. */
  dedupeKey: string;
}

export const REPLY_EMAILS_PER_HOUR = 20;

const campaignName = (d: any): string => String(d?.campaign?.name || d?.campaign_name || 'A campaign');
const campaignId = (d: any): string | null => d?.campaign?.id || d?.campaign_id || null;

/** The email an event deserves, or null when it deserves none. */
export function notificationFor(event: string, data: Record<string, any>): NotifyMail | null {
  const cid = campaignId(data);
  const href = cid ? `/campaigns/${cid}` : '/campaigns';
  switch (event) {
    case 'system.attention':
      return {
        setting: 'email_notifications',
        subject: `Needs a look: ${data.title}`,
        text: `${data.title}.\n\n${data.detail || ''}`.trim(),
        href: data.href || '/system',
        dedupeKey: `attention:${data.key}`,
      };
    case 'email.complained':
      return {
        setting: 'email_notifications',
        subject: `${data.email} marked your email as spam`,
        text: `${data.email} reported an email from ${data.campaign_name ? `"${data.campaign_name}"` : 'one of your campaigns'} as spam (reported by ${data.provider || 'their mailbox provider'}).\n\nThey have been added to your suppression list and every sequence to them has stopped. Mailbox providers slow down senders whose complaints pass about 1 in 1,000 emails, so a second complaint from the same mailbox will slow it down.`,
        href: '/email-accounts?tab=autopilot',
        dedupeKey: `complaint:${data.email}`,
      };
    case 'campaign.paused':
      // Only when nobody pressed Pause: you know about your own clicks.
      if (data.reason !== 'bounce_rate') return null;
      return {
        setting: 'campaign_alerts',
        subject: `Paused automatically: ${campaignName(data)}`,
        text: `The bounce guard paused "${campaignName(data)}": ${data.bounced ?? 'too many'} of ${data.sent ?? 'its'} recent sends bounced, which damages your sending domain if it carries on. Check the list, then resume it from the campaign.`,
        href,
        dedupeKey: `paused:${cid}`,
      };
    case 'campaign.completed':
      return { setting: 'campaign_alerts', subject: `Finished: ${campaignName(data)}`, text: `Everybody in "${campaignName(data)}" has been through the whole sequence, replied, or been stopped. It has finished.`, href, dedupeKey: `completed:${cid}` };
    case 'relay.test_proposed':
      return {
        setting: 'campaign_alerts',
        subject: `Relay wants to test a new ${data.element === 'subject' ? 'subject line' : data.element === 'opening' ? 'opening line' : 'closing question'} in "${campaignName(data)}"`,
        text: `${data.why || 'Relay wrote a new version to test against the original.'}\n\nApprove, edit or skip it on the campaign page. Nothing changes until you do.`,
        href,
        dedupeKey: `test-proposed:${cid}`,
      };
    case 'relay.test_decided':
      return {
        setting: 'campaign_alerts',
        subject: data.outcome === 'won' ? `Relay found a better version for "${campaignName(data)}"` : `Relay's test on "${campaignName(data)}" is finished`,
        text: `${data.summary || ''}${data.outcome === 'won' ? '\n\nYou can undo it from the campaign page.' : ''}`.trim(),
        href,
        dedupeKey: `test-decided:${cid}:${data.outcome}`,
      };
    case 'email.replied': {
      const who = data.from_name ? `${data.from_name} (${data.from})` : String(data.from || 'Somebody');
      return {
        setting: 'reply_notifications',
        subject: `${data.from_name || data.from} replied${data.subject ? `: ${String(data.subject).replace(/^(re|aw|sv):\s*/i, '')}` : ''}`,
        text: `${who} replied${data.campaign_name ? ` to "${data.campaign_name}"` : ''}. Their sequence has stopped.${data.excerpt ? `\n\n"${String(data.excerpt).slice(0, 400)}"` : ''}`,
        href: data.contact_id ? `/inbox?contact=${data.contact_id}` : '/inbox',
        dedupeKey: `reply:${data.message_id || data.from}:${data.subject || ''}`,
      };
    }
    default:
      return null;
  }
}

/* ── The weekly digest ─────────────────────────────────────────────── */

export interface DigestNumbers {
  /** The week covered, as calendar days in the account's time zone. */
  from_day: string;
  to_day: string;
  sent: number;
  replies: number;
  positive: number;
  meetings: number;
  bounced: number;
  complaints: number;
  /** Replies still waiting on you. */
  waiting: number;
  campaigns: Array<{ name: string; sent: number; replies: number }>;
  attention: Array<{ title: string; detail: string }>;
  /** Tests Relay settled this week (shared/experiments), as sentences. */
  learned?: string[];
}

/** Monday at 08:00 in the account's time zone. */
export const DIGEST_LOCAL_HOUR = 8;

/** The Monday 08:00 (UTC instant) of the week containing `now`, in `tz`. */
export function digestSlot(now: number, timeZone: string): Date {
  let tz = timeZone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'UTC'; }
  const p = partsInTimezone(new Date(now), tz);
  // Days back to Monday (getDay: 0 = Sunday).
  const wd = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const back = (wd + 6) % 7;
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  return tzWallTimeToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), DIGEST_LOCAL_HOUR, 0, tz);
}

/** Due once this week's slot has passed and nothing was sent since it. */
export function digestDue(lastSentAt: string | null | undefined, now: number, tz: string): boolean {
  const slot = digestSlot(now, tz).getTime();
  if (now < slot) return false;
  if (!lastSentAt) return true;
  const last = Date.parse(lastSentAt);
  return !Number.isFinite(last) || last < slot;
}

const n = (x: number) => x.toLocaleString('en-GB');
const rate = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : '-');

/** Subject and plain text of the digest. */
export function buildDigest(d: DigestNumbers): { subject: string; text: string } {
  const quiet = d.sent === 0 && d.replies === 0;
  const subject = quiet
    ? 'Your week: nothing went out'
    : `Your week: ${n(d.sent)} sent, ${n(d.replies)} ${d.replies === 1 ? 'reply' : 'replies'}${d.meetings ? `, ${n(d.meetings)} ${d.meetings === 1 ? 'meeting' : 'meetings'}` : ''}`;

  const lines: string[] = [];
  lines.push(`${d.from_day} to ${d.to_day}`);
  lines.push('');
  if (quiet) {
    lines.push('No campaign emails went out last week and nobody replied. If something should have been sending, the status page says whether it is running.');
  } else {
    lines.push(`Sent        ${n(d.sent)}`);
    lines.push(`Replies     ${n(d.replies)} (${rate(d.replies, d.sent)})${d.positive ? `, ${n(d.positive)} interested` : ''}`);
    lines.push(`Meetings    ${n(d.meetings)}`);
    lines.push(`Bounced     ${n(d.bounced)} (${rate(d.bounced, d.sent)})`);
    if (d.complaints) lines.push(`Spam reports  ${n(d.complaints)}`);
  }
  if (d.waiting > 0) {
    lines.push('');
    lines.push(`${n(d.waiting)} ${d.waiting === 1 ? 'reply is' : 'replies are'} waiting for an answer from you.`);
  }
  const top = d.campaigns.filter((c) => c.sent > 0 || c.replies > 0).slice(0, 5);
  if (top.length) {
    lines.push('');
    lines.push('By campaign');
    for (const c of top) lines.push(`- ${c.name}: ${n(c.sent)} sent, ${n(c.replies)} ${c.replies === 1 ? 'reply' : 'replies'}`);
  }
  if (d.learned?.length) {
    lines.push('');
    lines.push('What Relay learned');
    for (const l of d.learned.slice(0, 4)) lines.push(`- ${l}`);
  }
  if (d.attention.length) {
    lines.push('');
    lines.push('Needs a look');
    for (const a of d.attention.slice(0, 6)) lines.push(`- ${a.title}`);
  }
  return { subject, text: lines.join('\n') };
}
