/* ═══════════════════════════════════════════════════════════════════════
   Results: what the outreach produced, in a period, in one sentence.

   The revenue report answers "which campaign has earned what, ever". The
   question a customer is actually asked - by a manager, by a client, by
   themselves at the end of the month - is "what did we get for it this
   month?", and that needs a period, a comparison and a sentence:

     "From 4,120 emails in September: 23 meetings, £84k of new pipeline
      and £12k closed."

   Counted only where outreach can be credited: replies to campaign mail,
   meetings booked with a source campaign, deals with a source campaign.
   A deal that arrived from nowhere is not this platform's to claim, and a
   report that claims it stops being believed.

   Money is kept per currency and never added across currencies; the
   headline uses the largest, and says when there is more.

   Pure: numbers in, words and comparisons out.
   ═══════════════════════════════════════════════════════════════════════ */

import { partsInTimezone, tzWallTimeToUtc } from './timezone.js';
import { formatMoney } from './format-date.js';

export const RESULTS_PERIODS = ['this_month', 'last_month', 'last_90', 'this_quarter', 'this_year'] as const;
export type ResultsPeriodKey = typeof RESULTS_PERIODS[number];

export const RESULTS_PERIOD_LABELS: Record<ResultsPeriodKey, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  last_90: 'Last 90 days',
  this_quarter: 'This quarter',
  this_year: 'This year',
};

export interface ResultsPeriod {
  key: ResultsPeriodKey | 'custom';
  /** "September 2026", "1 Jul - 30 Sep 2026". */
  label: string;
  from: string;
  /** Exclusive. Never later than when the report was made. */
  to: string;
  /** Where the period itself ends (later than `to` while it is still running). */
  end: string;
  /** The period still running ("so far"). */
  partial: boolean;
}

export interface Money { currency: string; amount: number }

export interface ResultsNumbers {
  sent: number;
  /** People who answered (not auto-replies). */
  replies: number;
  /** Replies read as interested or asking to meet. */
  positive: number;
  /** Meetings booked that came from a campaign, not cancelled. */
  meetings: number;
  /** Deals opened from outreach in the period. */
  deals: number;
  /** Their value: new pipeline. */
  pipeline: Money[];
  /** Deals from outreach won in the period. */
  won_deals: number;
  won: Money[];
}

export interface CampaignResult {
  id: string;
  name: string;
  sent: number;
  replies: number;
  meetings: number;
  deals: number;
  pipeline: Money[];
  won: Money[];
}

export interface ResultsReport {
  period: ResultsPeriod;
  previous: ResultsPeriod;
  current: ResultsNumbers;
  before: ResultsNumbers;
  headline: string;
  campaigns: CampaignResult[];
  generated_at: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));

function safeZone(tz: string | null | undefined): string {
  const z = tz || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; } catch { return 'UTC'; }
}

function startOfMonth(y: number, m: number, tz: string): Date {
  // m is 1-12 and may overflow; Date.UTC normalises it.
  const d = new Date(Date.UTC(y, m - 1, 1));
  return tzWallTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, tz);
}

function dayLabel(ms: number, tz: string): string {
  const p = partsInTimezone(new Date(ms), tz);
  return `${p.day} ${MON[p.month - 1]} ${p.year}`;
}

/** The bounds of a named period, in the account's time zone, as of `now`. */
export function resultsPeriod(key: ResultsPeriodKey, now: number, timeZone?: string | null): ResultsPeriod {
  const tz = safeZone(timeZone);
  const p = partsInTimezone(new Date(now), tz);
  let from: Date; let end: Date; let label: string;
  switch (key) {
    case 'last_month': {
      from = startOfMonth(p.year, p.month - 1, tz);
      end = startOfMonth(p.year, p.month, tz);
      const d = partsInTimezone(new Date(from.getTime() + 86_400_000), tz);
      label = `${MONTHS[d.month - 1]} ${d.year}`;
      break;
    }
    case 'last_90': {
      end = new Date(now);
      from = new Date(now - 90 * 86_400_000);
      label = 'Last 90 days';
      break;
    }
    case 'this_quarter': {
      const q = Math.floor((p.month - 1) / 3);
      from = startOfMonth(p.year, q * 3 + 1, tz);
      end = startOfMonth(p.year, q * 3 + 4, tz);
      label = `Q${q + 1} ${p.year}`;
      break;
    }
    case 'this_year': {
      from = startOfMonth(p.year, 1, tz);
      end = startOfMonth(p.year + 1, 1, tz);
      label = String(p.year);
      break;
    }
    case 'this_month':
    default: {
      from = startOfMonth(p.year, p.month, tz);
      end = startOfMonth(p.year, p.month + 1, tz);
      label = `${MONTHS[p.month - 1]} ${p.year}`;
    }
  }
  const to = Math.min(end.getTime(), now);
  return { key, label, from: from.toISOString(), to: new Date(to).toISOString(), end: end.toISOString(), partial: end.getTime() > now };
}

/**
 * What to compare against. A month against the month before, a quarter
 * against the one before - and a period still running against the same
 * stretch of the one before, so the 5th is never compared with a whole
 * month.
 */
export function previousPeriod(period: ResultsPeriod, timeZone?: string | null): ResultsPeriod {
  const tz = safeZone(timeZone);
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  const length = to - from;
  if (period.key === 'last_90' || period.key === 'custom') {
    return { key: 'custom', label: 'the 90 days before', from: new Date(from - length).toISOString(), to: new Date(from).toISOString(), end: new Date(from).toISOString(), partial: false };
  }
  const p = partsInTimezone(new Date(from + 86_400_000), tz);
  const months = period.key === 'this_quarter' ? 3 : period.key === 'this_year' ? 12 : 1;
  const prevFrom = startOfMonth(p.year, p.month - months, tz).getTime();
  // Only a running period is cut to the same stretch; a finished one is set
  // against the whole of the one before (28-day February vs all of January).
  const prevTo = period.partial ? Math.min(prevFrom + length, from) : from;
  const q = partsInTimezone(new Date(prevFrom + 86_400_000), tz);
  const name = months === 12 ? String(q.year) : months === 3 ? `Q${Math.floor((q.month - 1) / 3) + 1} ${q.year}` : `${MONTHS[q.month - 1]} ${q.year}`;
  return {
    key: 'custom',
    label: period.partial ? `the same days of ${name}` : name,
    from: new Date(prevFrom).toISOString(),
    to: new Date(prevTo).toISOString(),
    end: new Date(from).toISOString(),
    partial: false,
  };
}

/* ── Money ─────────────────────────────────────────────────────────── */

export function addMoney(list: Money[], currency: string | null | undefined, amount: number): Money[] {
  if (!Number.isFinite(amount) || amount === 0) return list;
  const cur = (currency || 'USD').toUpperCase();
  const hit = list.find((m) => m.currency === cur);
  if (hit) hit.amount += amount;
  else list.push({ currency: cur, amount });
  return list;
}

/** Largest first. */
export function sortMoney(list: Money[]): Money[] {
  return [...list].sort((a, b) => b.amount - a.amount);
}

/** "£84k", "£84k + €3k", or "£0". */
export function moneyText(list: Money[], fallbackCurrency = 'USD'): string {
  const sorted = sortMoney(list).filter((m) => m.amount > 0);
  if (!sorted.length) return formatMoney(0, fallbackCurrency, { compact: true });
  return sorted.slice(0, 2).map((m) => formatMoney(m.amount, m.currency, { compact: true })).join(' + ')
    + (sorted.length > 2 ? ' + more' : '');
}

export function mainAmount(list: Money[]): number {
  return sortMoney(list)[0]?.amount ?? 0;
}

/* ── Words ─────────────────────────────────────────────────────────── */

const n = (x: number) => x.toLocaleString('en-GB');

/** The one sentence. Says only what happened; nothing is dressed up. */
export function resultsHeadline(period: ResultsPeriod, c: ResultsNumbers, currency = 'USD'): string {
  const when = period.key === 'last_90' ? 'in the last 90 days' : `in ${period.label}${period.partial ? ' so far' : ''}`;
  if (c.sent === 0 && c.replies === 0 && c.meetings === 0 && c.deals === 0 && c.won_deals === 0) {
    return `Nothing went out ${when}.`;
  }
  const parts: string[] = [];
  if (c.meetings) parts.push(`${n(c.meetings)} ${c.meetings === 1 ? 'meeting' : 'meetings'}`);
  if (mainAmount(c.pipeline) > 0) parts.push(`${moneyText(c.pipeline, currency)} of new pipeline`);
  if (mainAmount(c.won) > 0) parts.push(`${moneyText(c.won, currency)} closed`);
  if (!parts.length && c.replies) parts.push(`${n(c.replies)} ${c.replies === 1 ? 'reply' : 'replies'}${c.positive ? `, ${n(c.positive)} interested` : ''}`);
  const from = c.sent ? `From ${n(c.sent)} ${c.sent === 1 ? 'email' : 'emails'} ${when}` : `${when.charAt(0).toUpperCase()}${when.slice(1)}`;
  if (!parts.length) return `${from}: no replies yet.`;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${from}: ${list}.`;
}

export interface Change {
  /** Relative change, e.g. 0.25 for +25%. Null when there is nothing to compare with. */
  ratio: number | null;
  direction: 'up' | 'down' | 'flat' | 'new';
}

/** How a number moved. Small bases say "new" or nothing rather than "+400%". */
export function change(now: number, before: number): Change {
  if (before <= 0) return { ratio: null, direction: now > 0 ? 'new' : 'flat' };
  const ratio = (now - before) / before;
  if (Math.abs(ratio) < 0.05) return { ratio, direction: 'flat' };
  return { ratio, direction: ratio > 0 ? 'up' : 'down' };
}

export function changeText(c: Change): string | null {
  if (c.direction === 'new') return 'new';
  if (c.ratio === null) return null;
  if (c.direction === 'flat') return 'about the same';
  const pct = Math.round(Math.abs(c.ratio) * 100);
  return `${c.direction === 'up' ? '+' : '-'}${pct > 999 ? '999+' : pct}%`;
}

/** Of replies, of sends, etc. Null when the base is too small to mean anything. */
export function rateOf(part: number, whole: number, minWhole = 20): number | null {
  return whole >= minWhole ? part / whole : null;
}

export function emptyNumbers(): ResultsNumbers {
  return { sent: 0, replies: 0, positive: 0, meetings: 0, deals: 0, pipeline: [], won_deals: 0, won: [] };
}

/* ── Sharing ───────────────────────────────────────────────────────── */

export interface ResultsShare {
  id: string;
  token: string;
  title: string;
  period_label: string;
  from: string;
  to: string;
  show_campaigns: boolean;
  views: number;
  last_viewed_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

/** What a public link shows: the report, the title, and who it is from. */
export interface SharedResults {
  title: string;
  prepared_by: string | null;
  report: ResultsReport;
}

/* ── The monthly email ─────────────────────────────────────────────── */

/** "2026-09": the month a results email covers, used to send it once. */
export function monthKeyOf(period: Pick<ResultsPeriod, 'from'>, timeZone?: string | null): string {
  const p = partsInTimezone(new Date(Date.parse(period.from) + 86_400_000), safeZone(timeZone));
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** Due from 09:00 on the 1st (local) until it has gone for last month. */
export function monthlyResultsDue(lastSentMonth: string | null | undefined, now: number, timeZone?: string | null): string | null {
  const tz = safeZone(timeZone);
  const p = partsInTimezone(new Date(now), tz);
  const releaseAt = tzWallTimeToUtc(p.year, p.month, 1, 9, 0, tz).getTime();
  if (now < releaseAt) return null;
  const last = resultsPeriod('last_month', now, tz);
  const key = monthKeyOf(last, tz);
  return lastSentMonth === key ? null : key;
}

/** Subject and text of the monthly results email. */
export function buildResultsEmail(r: ResultsReport): { subject: string; text: string } {
  const c = r.current; const b = r.before;
  const cur = c.won[0]?.currency || c.pipeline[0]?.currency || 'USD';
  const bits: string[] = [];
  if (c.meetings) bits.push(`${n(c.meetings)} ${c.meetings === 1 ? 'meeting' : 'meetings'}`);
  if (mainAmount(c.pipeline) > 0) bits.push(`${moneyText(c.pipeline, cur)} pipeline`);
  if (mainAmount(c.won) > 0) bits.push(`${moneyText(c.won, cur)} won`);
  if (!bits.length) bits.push(`${n(c.replies)} ${c.replies === 1 ? 'reply' : 'replies'}`);
  const subject = `Your ${r.period.label.split(' ')[0]} results: ${bits.join(', ')}`;
  const line = (label: string, now: number, before: number, text?: string) => {
    const ch = changeText(change(now, before));
    return `${label.padEnd(14)}${text ?? n(now)}${ch && ch !== 'about the same' ? `   (${ch} on ${r.previous.label})` : ''}`;
  };
  const lines = [
    r.headline,
    '',
    line('Emails sent', c.sent, b.sent),
    line('Replies', c.replies, b.replies),
    line('Interested', c.positive, b.positive),
    line('Meetings', c.meetings, b.meetings),
    line('New deals', c.deals, b.deals, `${n(c.deals)}${mainAmount(c.pipeline) ? `, ${moneyText(c.pipeline, cur)}` : ''}`),
    line('Won', c.won_deals, b.won_deals, `${n(c.won_deals)}${mainAmount(c.won) ? `, ${moneyText(c.won, cur)}` : ''}`),
  ];
  const top = r.campaigns.filter((x) => x.meetings || x.deals || x.replies).slice(0, 3);
  if (top.length) {
    lines.push('', 'What did it');
    for (const x of top) lines.push(`- ${x.name}: ${n(x.replies)} ${x.replies === 1 ? 'reply' : 'replies'}${x.meetings ? `, ${n(x.meetings)} ${x.meetings === 1 ? 'meeting' : 'meetings'}` : ''}${mainAmount(x.pipeline) ? `, ${moneyText(x.pipeline, cur)} pipeline` : ''}`);
  }
  lines.push('', 'You can share this report with a read-only link from the Results page.');
  return { subject, text: lines.join('\n') };
}
