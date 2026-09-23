/* ═══════════════════════════════════════════════════════════════════════
   Is this deal alive?

   "Days in stage" is the whole of what most CRMs know, and it is a weak
   signal: a deal can sit in Proposal for three weeks with the buyer
   answering every email inside the hour, and another can move stage
   yesterday and never hear back again. This app owns the mailbox as well
   as the pipeline, so it can read what actually predicts a close - who
   wrote last, how fast they answer, how many people on their side are
   engaged, and whether there is a meeting in the diary.

   Pure: the server gathers the signals, this turns them into a score, a
   short list of reasons in plain words, and the one thing to do next.
   ═══════════════════════════════════════════════════════════════════════ */

import type { DealStage } from './crm.types.js';
import { rotOf } from './pipeline.types.js';

export type DealHealthGrade = 'healthy' | 'watch' | 'at_risk';

/** What to do about it. The client turns each into a button. */
export type DealNextAction =
  | 'reply'            // they wrote last and are waiting
  | 'follow_up'        // we wrote last and they have gone quiet
  | 'book_meeting'     // talking, but nothing in the diary
  | 'add_stakeholder'  // one person engaged, or no decision maker
  | 'update_close_date'
  | 'do_tasks'
  | 'none';

export interface DealHealthReason {
  /** Negative lowers the score, positive raises it. */
  impact: number;
  text: string;
  action?: DealNextAction;
}

export interface DealHealth {
  score: number;
  grade: DealHealthGrade;
  /** Most important first. Positive reasons last. */
  reasons: DealHealthReason[];
  next_action: DealNextAction;
  /** One sentence for a tooltip or a card. */
  summary: string;
}

/** Everything the score reads. Gathered by the server per deal. */
export interface DealSignals {
  stage: DealStage;
  created_at: string;
  stage_changed_at: string | null;
  expected_close_date: string | null;
  /** Last email from anybody on the deal to us. */
  last_inbound_at: string | null;
  /** Last email from us to anybody on the deal. */
  last_outbound_at: string | null;
  /**
   * How long they took to answer each of our emails, oldest first, in
   * hours. Only answered emails count.
   */
  response_hours: number[];
  /** People on the deal who have written to us at least once. */
  engaged_people: number;
  /** People on the deal at all, primary contact included. */
  people: number;
  has_decision_maker: boolean;
  /** Participants have roles recorded at all; otherwise the DM check says nothing. */
  roles_recorded: boolean;
  next_meeting_at: string | null;
  overdue_tasks: number;
}

const DAY = 86_400_000;

function days(fromIso: string | null, now: number): number | null {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  return Number.isFinite(t) ? Math.floor((now - t) / DAY) : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function hoursLabel(h: number): string {
  if (h < 1) return 'under an hour';
  if (h < 36) return plural(Math.round(h), 'hour');
  return plural(Math.round(h / 24), 'day');
}

export function gradeOf(score: number): DealHealthGrade {
  if (score >= 70) return 'healthy';
  if (score >= 40) return 'watch';
  return 'at_risk';
}

export function scoreDeal(s: DealSignals, now = Date.now()): DealHealth {
  const reasons: DealHealthReason[] = [];
  const add = (impact: number, text: string, action?: DealNextAction) => reasons.push({ impact, text, action });

  const age = days(s.created_at, now) ?? 0;
  const sinceIn = days(s.last_inbound_at, now);
  const sinceOut = days(s.last_outbound_at, now);
  const inboundT = s.last_inbound_at ? new Date(s.last_inbound_at).getTime() : 0;
  const outboundT = s.last_outbound_at ? new Date(s.last_outbound_at).getTime() : 0;

  // Who holds the ball. The single most useful thing a pipeline can say.
  if (inboundT > outboundT && sinceIn !== null && sinceIn >= 1) {
    add(sinceIn >= 3 ? -30 : -15, `They wrote ${sinceIn === 1 ? 'yesterday' : `${sinceIn} days ago`} and are waiting on you`, 'reply');
  } else if (outboundT >= inboundT && sinceOut !== null && s.last_inbound_at && sinceIn !== null && sinceIn >= 7) {
    add(sinceIn >= 21 ? -30 : -15, `No reply in ${sinceIn} days since your last email`, 'follow_up');
  } else if (!s.last_inbound_at && age >= 7) {
    add(-15, 'Nobody on their side has replied yet', 'follow_up');
  }

  // Answers getting slower is how interest fades before anyone says no.
  const r = s.response_hours.filter((h) => Number.isFinite(h) && h >= 0);
  if (r.length >= 3) {
    const latest = r[r.length - 1];
    const earlier = r.slice(0, -1).sort((a, b) => a - b);
    const median = earlier[Math.floor(earlier.length / 2)];
    if (latest > Math.max(48, median * 2.5)) {
      add(-10, `Replies slowing: ${hoursLabel(median)} before, ${hoursLabel(latest)} last time`, 'book_meeting');
    } else if (latest <= 24 && median <= 24) {
      add(5, `They answer fast (usually within ${hoursLabel(median)})`);
    }
  }

  const rot = rotOf({ stage: s.stage, stage_changed_at: s.stage_changed_at, created_at: s.created_at }, now);
  if (rot.rotting && rot.days !== null) {
    add(-15, `${rot.days} days in ${s.stage} (usually moves within ${rot.limit})`);
  }

  if (s.expected_close_date) {
    const late = days(s.expected_close_date, now);
    if (late !== null && late > 0) add(-15, `Close date passed ${plural(late, 'day')} ago`, 'update_close_date');
  }

  const later = s.stage === 'qualified' || s.stage === 'proposal';
  if (later && s.engaged_people <= 1 && age >= 7) {
    add(-10, s.people <= 1 ? 'Single-threaded: only one contact on the deal' : 'Only one person on their side is engaged', 'add_stakeholder');
  }
  if (s.stage === 'proposal' && s.roles_recorded && !s.has_decision_maker) {
    add(-10, 'No decision maker on the deal', 'add_stakeholder');
  }

  if (s.overdue_tasks > 0) add(-10, `${plural(s.overdue_tasks, 'overdue task')}`, 'do_tasks');

  if (s.next_meeting_at) {
    const until = Math.ceil((new Date(s.next_meeting_at).getTime() - now) / DAY);
    if (until >= 0 && until <= 21) add(10, until === 0 ? 'Meeting today' : `Meeting in ${plural(until, 'day')}`);
  } else if (later && sinceIn !== null && sinceIn <= 14 && !reasons.some((x) => x.action === 'reply')) {
    add(-5, 'Talking, but no meeting booked', 'book_meeting');
  }

  if (sinceIn !== null && sinceIn <= 3 && !(inboundT > outboundT && sinceIn >= 1)) {
    add(5, sinceIn === 0 ? 'They replied today' : `They replied ${plural(sinceIn, 'day')} ago`);
  }

  const score = Math.max(0, Math.min(100, 100 + reasons.reduce((n, x) => n + x.impact, 0)));
  reasons.sort((a, b) => a.impact - b.impact);
  const worst = reasons.find((x) => x.impact < 0 && x.action);
  const grade = gradeOf(score);
  const summary = reasons.length === 0
    ? 'Nothing to worry about'
    : reasons.filter((x) => x.impact < 0).slice(0, 2).map((x) => x.text).join(' · ') || reasons[0].text;

  return { score, grade, reasons, next_action: worst?.action ?? 'none', summary };
}

export const DEAL_ACTION_LABEL: Record<DealNextAction, string> = {
  reply: 'Reply now',
  follow_up: 'Send a follow-up',
  book_meeting: 'Book a meeting',
  add_stakeholder: 'Add a stakeholder',
  update_close_date: 'Update close date',
  do_tasks: 'Open tasks',
  none: '',
};
