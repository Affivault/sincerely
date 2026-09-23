/* ═══════════════════════════════════════════════════════════════════════
   What will actually happen if this campaign launches now.

   The launch check answers "is it safe?". It could not answer the question
   people actually have in front of the Launch button: how long will this
   take, and what will it produce? A 2,000-contact, four-step sequence on
   two mailboxes warming up at 15 a day does not finish in a week, and the
   first anyone used to learn of it was step three landing a month late.

   So this simulates it, day by day: who is due, how much the mailboxes can
   carry that day (warm-up ramps included), which days the schedule sends
   on, and what the account's own history says comes back. Pure, so it can
   be asserted; the server gathers the inputs.
   ═══════════════════════════════════════════════════════════════════════ */

export interface ForecastStep {
  /** Emails cost capacity; LinkedIn and manual steps are tasks and do not. */
  is_email: boolean;
  /** Wait before this step, in days (hours and minutes folded in). */
  delay_days: number;
}

export interface ForecastMailbox {
  label: string;
  /**
   * Sends this mailbox can carry on day `n` from today (0 = today),
   * already net of warm-up. 0 means no cap.
   */
  capacity: (dayOffset: number) => number;
}

export interface ForecastInput {
  steps: ForecastStep[];
  /** Everyone still in flight: which step they are waiting for, and in how many days it is due. */
  positions: { step: number; due_in_days: number; count: number }[];
  /** Lower-case weekday names the campaign sends on. */
  send_days: string[];
  /** Campaign's own cap per day; 0 = none. */
  daily_limit: number;
  /** Per-mailbox ceiling from the gap between emails and the send window; 0 = none. */
  per_mailbox_window_cap: number;
  mailboxes: ForecastMailbox[];
  /** Today's date, local to the campaign. */
  start: Date;
  /** Historical rates for the projection, or null when there is too little history. */
  history: { sent: number; replies: number; positive: number } | null;
}

export interface ForecastDay {
  date: string;       // YYYY-MM-DD
  sends: number;
  capacity: number;   // what could have gone, that day
  sending_day: boolean;
}

export type ForecastBottleneck = 'mailboxes' | 'daily_limit' | 'none';

export interface CampaignForecast {
  days: ForecastDay[];
  total_sends: number;
  /** Day index (0 = today) the last email goes out; null if not within the horizon. */
  finish_day: number | null;
  finish_date: string | null;
  /** Day everyone has had their first email. */
  first_touch_day: number | null;
  bottleneck: ForecastBottleneck;
  /** Typical sends per sending day at the start. */
  daily_capacity: number;
  projection: {
    replies: number;
    positive: number;
    reply_rate: number;
    positive_rate: number;
    /** How much history the rates rest on. */
    basis_sent: number;
    /** True when the account's own history is too thin and industry-typical rates were used. */
    assumed: boolean;
  };
  warnings: string[];
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** Far enough to show a slow campaign is slow; not so far the loop costs anything. */
export const FORECAST_HORIZON_DAYS = 120;
/** Below this many historical sends the account's own rates are noise. */
const MIN_HISTORY = 200;
/** What cold email typically returns, used only without enough history. */
const TYPICAL = { reply: 0.04, positive: 0.012 };

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function forecastCampaign(input: ForecastInput): CampaignForecast {
  const H = FORECAST_HORIZON_DAYS;
  const sendDays = new Set((input.send_days.length ? input.send_days : WEEKDAYS.slice(1, 6)).map((d) => d.toLowerCase()));
  const warnings: string[] = [];

  // due[day][step] = how many contacts become due for `step` on `day`.
  const due: Map<number, number[]> = new Map();
  const add = (day: number, step: number, n: number) => {
    if (n <= 0 || step >= input.steps.length) return;
    const d = Math.max(0, day);
    const row = due.get(d) ?? new Array(input.steps.length).fill(0);
    row[step] += n;
    due.set(d, row);
  };
  let firstTouchOutstanding = 0;
  for (const p of input.positions) {
    add(Math.ceil(p.due_in_days), p.step, p.count);
    // "First touch" is the first email step, whichever index that is.
    const firstEmail = input.steps.findIndex((s) => s.is_email);
    if (p.step <= firstEmail) firstTouchOutstanding += p.count;
  }

  const days: ForecastDay[] = [];
  const backlog = new Array(input.steps.length).fill(0);
  let total = 0;
  let finish: number | null = null;
  let firstTouch: number | null = firstTouchOutstanding === 0 ? 0 : null;
  let firstTouchSent = 0;
  let limitedByMailboxes = 0;
  let limitedByDaily = 0;
  let startCap = 0;
  const firstEmail = input.steps.findIndex((s) => s.is_email);

  for (let d = 0; d < H; d++) {
    const date = new Date(input.start);
    date.setDate(date.getDate() + d);
    const arriving = due.get(d);
    if (arriving) arriving.forEach((n, i) => { backlog[i] += n; });

    // Non-email steps are tasks: they pass straight through, whatever the day.
    let moved = true;
    while (moved) {
      moved = false;
      input.steps.forEach((s, i) => {
        if (!s.is_email && backlog[i] > 0) {
          const n = backlog[i];
          backlog[i] = 0;
          const next = input.steps[i + 1];
          if (next) {
            if (next.delay_days <= 0) { backlog[i + 1] += n; moved = true; }
            else add(d + Math.max(1, Math.ceil(next.delay_days)), i + 1, n);
          }
        }
      });
    }

    const sending = sendDays.has(WEEKDAYS[date.getDay()]);
    let boxCap = 0;
    let uncapped = false;
    for (const m of input.mailboxes) {
      const c = m.capacity(d);
      if (c === 0 && !input.per_mailbox_window_cap) { uncapped = true; continue; }
      const eff = c === 0 ? input.per_mailbox_window_cap : input.per_mailbox_window_cap ? Math.min(c, input.per_mailbox_window_cap) : c;
      boxCap += eff;
    }
    // No mailbox at all sends nothing; a mailbox with no cap sends without limit.
    const mailboxCap = input.mailboxes.length === 0 ? 0 : uncapped ? Infinity : boxCap;
    const cap = !sending ? 0 : Math.min(mailboxCap, input.daily_limit > 0 ? input.daily_limit : Infinity);
    if (sending && startCap === 0 && Number.isFinite(cap)) startCap = cap;

    let left = cap;
    let sent = 0;
    const waiting = backlog.reduce((a, b) => a + b, 0);
    // Follow-ups before first touches: a started conversation is worth more
    // than a new one, and it is how the send engine orders due contacts too.
    const order = input.steps.map((_, i) => i).filter((i) => input.steps[i].is_email).sort((a, b) => b - a);
    for (const i of order) {
      if (left <= 0) break;
      const n = Math.min(backlog[i], left);
      if (n <= 0) continue;
      backlog[i] -= n;
      left -= n;
      sent += n;
      if (i <= firstEmail) firstTouchSent += n;
      const next = input.steps[i + 1];
      if (next) add(d + Math.max(1, Math.ceil(next.delay_days)), i + 1, n);
    }
    if (sending && waiting > sent) {
      if (Number.isFinite(mailboxCap) && (input.daily_limit <= 0 || mailboxCap <= input.daily_limit)) limitedByMailboxes++;
      else if (input.daily_limit > 0) limitedByDaily++;
    }
    total += sent;
    if (sent > 0) finish = d;
    if (firstTouch === null && firstTouchOutstanding > 0 && firstTouchSent >= firstTouchOutstanding) firstTouch = d;
    days.push({ date: ymd(date), sends: sent, capacity: Number.isFinite(cap) ? cap : sent, sending_day: sending });
  }

  const unsent = backlog.reduce((a, b) => a + b, 0) + [...due.entries()].filter(([day]) => day >= H).reduce((a, [, r]) => a + r.reduce((x, y) => x + y, 0), 0);
  if (unsent > 0) {
    finish = null;
    warnings.push(`At this pace ${unsent.toLocaleString()} email${unsent === 1 ? '' : 's'} would still be waiting after ${H} days. Add mailboxes or raise the daily limit.`);
  }

  const bottleneck: ForecastBottleneck = limitedByMailboxes >= limitedByDaily && limitedByMailboxes > 0
    ? 'mailboxes' : limitedByDaily > 0 ? 'daily_limit' : 'none';
  if (bottleneck === 'mailboxes' && limitedByMailboxes > 5) {
    warnings.push(`Mailbox capacity is the bottleneck on ${limitedByMailboxes} sending days - follow-ups will land later than the sequence says.`);
  }
  if (bottleneck === 'daily_limit' && limitedByDaily > 5) {
    warnings.push(`The campaign's daily limit holds it back on ${limitedByDaily} sending days; the mailboxes could send more.`);
  }
  if (input.mailboxes.length === 0) warnings.push('No verified mailbox can send this campaign.');
  if (sendDays.size === 0) warnings.push('The campaign has no sending days.');

  const h = input.history;
  const enough = !!h && h.sent >= MIN_HISTORY;
  const replyRate = enough ? h!.replies / h!.sent : TYPICAL.reply;
  const positiveRate = enough ? h!.positive / h!.sent : TYPICAL.positive;
  // Replies come per person, not per email: people count once however many steps they get.
  const people = input.positions.reduce((a, p) => a + p.count, 0);
  const emailSteps = Math.max(1, input.steps.filter((s) => s.is_email).length);
  const perPerson = (rate: number) => Math.min(0.95, rate * emailSteps);

  return {
    days,
    total_sends: total,
    finish_day: finish,
    finish_date: finish !== null ? days[finish].date : null,
    first_touch_day: firstTouch,
    bottleneck,
    daily_capacity: startCap,
    projection: {
      replies: Math.round(people * perPerson(replyRate)),
      positive: Math.round(people * perPerson(positiveRate)),
      reply_rate: replyRate,
      positive_rate: positiveRate,
      basis_sent: h?.sent ?? 0,
      assumed: !enough,
    },
    warnings,
  };
}
