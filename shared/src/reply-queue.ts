/* ═══════════════════════════════════════════════════════════════════════
   Forty replies land, three matter, and the three get lost.

   That is where cold outreach actually leaks money, and this app had no
   answer to it. A reply could be classified (sara_intent), and it could
   be triaged into a disposition (interested / later / not interested) -
   but nothing said WHOSE JOB IT WAS or HOW LONG SOMEBODY HAD BEEN
   WAITING. For one person that is survivable. For four it is the whole
   job, and "I thought you had it" is how a booked meeting turns into a
   competitor's booked meeting.

   Three things missing, and they are different things:

     TRIAGE is "what is this?"      - existed
     OWNERSHIP is "whose is it?"    - did not
     THE CLOCK is "since when?"     - did not

   The clock is the part that is easy to get wrong in a way that makes it
   useless, and most of this module is about not doing that:

   AN AUTOREPLY IS NOT A PERSON WAITING. An out-of-office does not need a
   response and must never start a clock. Get this wrong and the queue
   fills with robots, the overdue count is meaningless within a week, and
   people stop looking - which is worse than having no queue, because now
   the real ones are hidden behind a number nobody trusts.

   AN UNSUBSCRIBE IS NOT A CONVERSATION. It needs an action, not a reply.
   Showing it as "overdue for a response" teaches people that overdue
   means nothing.

   A PARKED REPLY IS NOT A LATE ONE. Somebody who said "ask me in March"
   is handled. Without somewhere to put it, the only way to clear it from
   the queue is to pretend it is done.

   URGENCY IS NOT AGE. Rank by age alone and the top of the queue is
   permanently occupied by the oldest thing nobody was ever going to
   convert. Intent first, then what is on the table, then how long.
   ═══════════════════════════════════════════════════════════════════════ */

/** The intents that mean a human is waiting on a human. */
const NEEDS_REPLY = new Set(['interested', 'meeting', 'objection', 'not_now', 'other']);

/**
 * How long each kind of reply may sit before it is late.
 *
 * Differentiated on purpose. Somebody asking to book is ready now and
 * every hour costs something real; somebody raising an objection is
 * thinking, and an answer tomorrow is a perfectly good answer. One flat
 * number would make the queue either hysterical or useless.
 *
 * These are defaults for ordering, not a promise to anybody. The value is
 * in which reply is at the top, not in the absolute hours.
 */
export const REPLY_SLA_MS: Record<string, number> = {
  meeting: 2 * 60 * 60 * 1000,
  interested: 4 * 60 * 60 * 1000,
  objection: 24 * 60 * 60 * 1000,
  other: 24 * 60 * 60 * 1000,
  not_now: 72 * 60 * 60 * 1000,
};

export const DEFAULT_SLA_MS = 24 * 60 * 60 * 1000;

/** "Due soon" starts at a quarter of the budget remaining. */
const DUE_SOON_FRACTION = 0.25;

export interface ReplyFacts {
  received_at: string | number;
  /** What Relay made of it. Null when it has not been classified. */
  sara_intent?: string | null;
  /** Set when the message came from a machine rather than a person. */
  auto_reply_kind?: string | null;
  triage_decision?: string | null;
  /** The teammate who owns it, or null. */
  assigned_to?: string | null;
  /** When a human actually replied. The clock stops here. */
  first_response_at?: string | number | null;
  /** Deliberately parked until this time. */
  snoozed_until?: string | number | null;
  /** Open pipeline value on the contact behind this reply, if any. */
  deal_value?: number | null;
}

const ms = (v: string | number | null | undefined): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Is a person waiting on a person?
 *
 * The gate for the whole queue, and the single most important function
 * here. Everything it lets through starts a clock, and a clock started by
 * an out-of-office is a clock nobody will believe by Friday.
 */
export function needsHuman(m: ReplyFacts): boolean {
  // A machine sent it. Nobody is waiting.
  if (m.auto_reply_kind) return false;

  // Somebody has already answered.
  if (ms(m.first_response_at) != null) return false;

  /*
   * An unsubscribe or a bounce needs an action, not a reply. Leaving them
   * in would mean the queue's headline number is mostly things that can
   * never be "responded to", and a number like that gets ignored.
   */
  const intent = (m.sara_intent || '').trim();
  if (intent && !NEEDS_REPLY.has(intent)) return false;

  /*
   * A decided "not interested" is finished. "Later" is not - it is a
   * reply somebody intends to come back to, which is exactly the thing
   * that gets forgotten, so it stays in the queue until it is parked with
   * a date.
   */
  if (m.triage_decision === 'not_interested') return false;

  return true;
}

export type ReplyUrgency = 'overdue' | 'due-soon' | 'waiting' | 'parked' | 'done';

export interface ReplyState {
  urgency: ReplyUrgency;
  /** How long a person has been waiting, ms. Zero when nobody is. */
  waitedMs: number;
  /** Time left before it is late, ms. Negative once overdue. Null when not waiting. */
  remainingMs: number | null;
  /** The budget this one was judged against. */
  slaMs: number;
  /** True when nobody has picked it up. */
  unassigned: boolean;
}

/**
 * Where this reply stands right now.
 *
 * `parked` is deliberately its own state rather than a kind of waiting.
 * Somebody who asked to be contacted in March is handled, and counting
 * them as late every day until March is how an overdue count becomes
 * furniture.
 */
export function replyState(m: ReplyFacts, now: number = Date.now()): ReplyState {
  const slaMs = REPLY_SLA_MS[(m.sara_intent || '').trim()] ?? DEFAULT_SLA_MS;
  const unassigned = !m.assigned_to;

  if (!needsHuman(m)) {
    return { urgency: 'done', waitedMs: 0, remainingMs: null, slaMs, unassigned };
  }

  const snoozed = ms(m.snoozed_until);
  if (snoozed != null && snoozed > now) {
    return { urgency: 'parked', waitedMs: 0, remainingMs: snoozed - now, slaMs, unassigned };
  }

  const received = ms(m.received_at);
  if (received == null) {
    // An unparseable timestamp must not become a negative age or a
    // permanent "overdue" at the top of everybody's queue.
    return { urgency: 'waiting', waitedMs: 0, remainingMs: slaMs, slaMs, unassigned };
  }

  /*
   * A snooze that has expired does not restore the time it covered - the
   * clock runs from when the reply arrived, because that is when the
   * person started waiting. Parking is a promise to come back, not a
   * reset.
   */
  const waitedMs = Math.max(0, now - received);
  const remainingMs = slaMs - waitedMs;

  if (remainingMs <= 0) return { urgency: 'overdue', waitedMs, remainingMs, slaMs, unassigned };
  if (remainingMs <= slaMs * DUE_SOON_FRACTION) {
    return { urgency: 'due-soon', waitedMs, remainingMs, slaMs, unassigned };
  }
  return { urgency: 'waiting', waitedMs, remainingMs, slaMs, unassigned };
}

/**
 * What to do first.
 *
 * Higher sorts earlier. Built so that age is the LAST word rather than
 * the first: rank on age alone and the top of the queue is permanently
 * held by the oldest thing nobody was ever going to convert, which is the
 * fastest way to teach somebody to ignore the top of the queue.
 *
 *   1. Intent, because a request to book is worth more than an objection
 *      however long the objection has waited.
 *   2. What is actually on the table, because a reply attached to an open
 *      deal is a different conversation from one that is not.
 *   3. Lateness, as a tiebreak within a band rather than across bands.
 */
const INTENT_WEIGHT: Record<string, number> = {
  meeting: 100,
  interested: 80,
  objection: 50,
  other: 30,
  not_now: 10,
};

export function replyPriority(m: ReplyFacts, now: number = Date.now()): number {
  const state = replyState(m, now);
  if (state.urgency === 'done') return -1;
  // Parked work is handled; it must never outrank something live, however
  // valuable, or parking would be pointless.
  if (state.urgency === 'parked') return 0;

  const intent = INTENT_WEIGHT[(m.sara_intent || '').trim()] ?? 30;

  /*
   * Value, compressed. Linear money would let one large deal dominate the
   * whole queue for weeks; log keeps a bigger deal ahead of a smaller one
   * without letting it swamp intent.
   */
  const value = m.deal_value && m.deal_value > 0
    ? Math.min(30, Math.log10(m.deal_value) * 8)
    : 0;

  /*
   * Lateness, capped. An overdue reply should rise; one overdue by three
   * weeks should not outrank a fresh request to book a call, because the
   * three-week-old one has already failed and the fresh one has not.
   */
  const late = state.remainingMs != null && state.remainingMs < 0
    ? Math.min(25, (-state.remainingMs / state.slaMs) * 15)
    : 0;

  // Nobody has it. A small nudge, because unowned work is the work that
  // actually gets dropped.
  const orphan = state.unassigned ? 5 : 0;

  return intent + value + late + orphan;
}

export interface QueueCounts {
  /** Replies with a person waiting, however long. */
  open: number;
  overdue: number;
  dueSoon: number;
  /** Open and owned by nobody. */
  unassigned: number;
  /** Parked with a date. Not late, not forgotten. */
  parked: number;
  /** Open and assigned to the person asking. */
  mine: number;
}

export function queueCounts(
  rows: readonly ReplyFacts[],
  opts: { now?: number; userId?: string | null } = {},
): QueueCounts {
  const now = opts.now ?? Date.now();
  const counts: QueueCounts = { open: 0, overdue: 0, dueSoon: 0, unassigned: 0, parked: 0, mine: 0 };

  for (const row of rows) {
    const state = replyState(row, now);
    if (state.urgency === 'done') continue;
    if (state.urgency === 'parked') { counts.parked++; continue; }

    counts.open++;
    if (state.urgency === 'overdue') counts.overdue++;
    if (state.urgency === 'due-soon') counts.dueSoon++;
    if (state.unassigned) counts.unassigned++;
    if (opts.userId && row.assigned_to === opts.userId) counts.mine++;
  }

  return counts;
}

/** "4m", "3h", "2d" - a clock that fits in a chip. */
export function waitLabel(ms_: number): string {
  const mins = Math.floor(Math.max(0, ms_) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * One sentence about a reply's standing.
 *
 * Says what is true rather than shouting. "Overdue" on its own is a
 * colour; "waiting 6h, over the 2h this kind gets" is something somebody
 * can disagree with, which is the point.
 */
export function replyStateLabel(state: ReplyState): string {
  switch (state.urgency) {
    case 'done':
      return 'Handled.';
    case 'parked':
      return `Parked for another ${waitLabel(state.remainingMs ?? 0)}.`;
    case 'overdue':
      return `Waiting ${waitLabel(state.waitedMs)} — past the ${waitLabel(state.slaMs)} this kind of reply gets.`;
    case 'due-soon':
      return `Waiting ${waitLabel(state.waitedMs)} — ${waitLabel(state.remainingMs ?? 0)} left.`;
    default:
      return `Waiting ${waitLabel(state.waitedMs)}.`;
  }
}
