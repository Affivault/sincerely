/* ═══════════════════════════════════════════════════════════════════════
   Flow: the day's work as one list of decisions.

   Replies waiting on an answer, deals going quiet, the next meeting,
   the tasks due - each used to live on its own page, and the order to
   do them in lived in the rep's head. Flow puts them in one queue, most
   urgent first, each with the next move already prepared. The aim is a
   queue that can be cleared in a sitting, top to bottom, by keyboard.

   Ranking is a judgement, so it lives here where it can be asserted.
   ═══════════════════════════════════════════════════════════════════════ */

import type { DealHealth } from './deal-health.js';
import type { ReplyUrgency } from './reply-queue.js';

export type FlowKind = 'meeting' | 'reply' | 'deal' | 'task';

export interface FlowReply {
  message_id: string;
  from_email: string;
  contact_id: string | null;
  contact_name: string | null;
  company: string | null;
  subject: string | null;
  snippet: string;
  intent: string | null;
  urgency: ReplyUrgency;
  waited_ms: number;
  /** Relay's prepared answer, when it wrote one. */
  draft: string | null;
  deal_value: number | null;
}

export interface FlowDeal {
  deal_id: string;
  title: string;
  company: string | null;
  value: number;
  currency: string;
  stage: string;
  contact_email: string | null;
  contact_name: string | null;
  health: DealHealth;
}

export interface FlowMeeting {
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  contact_id: string | null;
  contact_email: string | null;
  contact_name: string | null;
  deal_id: string | null;
  conferencing_url: string | null;
  location: string | null;
  /** True once it has ended and no outcome is recorded yet. */
  needs_outcome: boolean;
}

export interface FlowTask {
  task_id: string;
  title: string;
  due_date: string | null;
  priority: string;
  deal_id: string | null;
  contact_name: string | null;
  overdue: boolean;
}

export interface FlowItem {
  /** Stable across refreshes: `${kind}:${id}`. */
  key: string;
  kind: FlowKind;
  /** 0-100, higher first. */
  rank: number;
  /** One line on why it is where it is. */
  why: string;
  reply?: FlowReply;
  deal?: FlowDeal;
  meeting?: FlowMeeting;
  task?: FlowTask;
}

export interface FlowSummary {
  items: FlowItem[];
  counts: Record<FlowKind, number>;
  generated_at: string;
}

const MIN = 60_000;

/** A meeting's place: imminent beats everything, then the rest of today. */
export function meetingRank(startsAt: string, now: number, needsOutcome: boolean): number {
  if (needsOutcome) return 72;
  const until = new Date(startsAt).getTime() - now;
  if (until <= 30 * MIN) return 100;
  if (until <= 3 * 60 * MIN) return 82;
  return 45;
}

/** A reply's place: lateness first, then what they said, then what is at stake. */
export function replyRank(urgency: ReplyUrgency, intent: string | null, dealValue: number | null): number {
  const base = urgency === 'overdue' ? 88 : urgency === 'due-soon' ? 78 : 62;
  const hot = intent === 'meeting' || intent === 'interested' ? 6 : 0;
  const money = dealValue && dealValue > 0 ? Math.min(5, Math.round(dealValue / 10_000)) : 0;
  return Math.min(99, base + hot + money);
}

export function dealRank(health: DealHealth): number {
  const base = health.grade === 'at_risk' ? 70 : 52;
  // The worse the score, the higher it sits within its band.
  return base + Math.round((100 - health.score) / 20);
}

export function taskRank(overdue: boolean, priority: string): number {
  return (overdue ? 60 : 48) + (priority === 'high' ? 6 : 0);
}

export function sortFlow(items: FlowItem[]): FlowItem[] {
  return [...items].sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key));
}

/* ─── The brief before a meeting ─────────────────────────────────────── */

export interface MeetingBrief {
  event: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    conferencing_url: string | null;
    location: string | null;
    notes: string | null;
    outcome: string | null;
  };
  person: {
    contact_id: string | null;
    name: string | null;
    email: string | null;
    job_title: string | null;
    company: string | null;
    company_id: string | null;
    linkedin_url: string | null;
  } | null;
  deal: {
    id: string;
    title: string;
    stage: string;
    value: number;
    currency: string;
    expected_close_date: string | null;
    health: DealHealth | null;
  } | null;
  /** Newest first. */
  emails: { direction: 'inbound' | 'outbound'; subject: string | null; snippet: string; at: string; intent: string | null }[];
  /** What they pushed back on - what the call has to answer. */
  objections: { snippet: string; at: string }[];
  previous_meetings: { title: string; at: string; outcome: string | null }[];
  open_tasks: { title: string; due_date: string | null }[];
}
