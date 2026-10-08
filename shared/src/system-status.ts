/* ═══════════════════════════════════════════════════════════════════════
   Is everything running?

   Most of what this product does happens while nobody is looking: the
   sequence sends, the inbox syncs, the autopilot rests a mailbox, warm-up
   trickles, a returned-mail notice stops a sequence. Every one of those is
   a timer inside the server, and none of them said when it last ran - so a
   job that stalled was noticed the way these things always are, days later,
   as "why did nothing go out on Tuesday?".

   Each job now leaves a heartbeat. This file is the list of jobs, how
   often each is meant to beat, and the one rule for reading a heartbeat:
   late is three missed beats, stalled is six. One missed beat is a slow
   tick, not a problem - a status page that cries wolf is one nobody reads.
   ═══════════════════════════════════════════════════════════════════════ */

import type { ReplyCheckResult } from './reply-check.js';

export type JobId =
  | 'sending' | 'inbox' | 'autopilot' | 'warmup_send' | 'warmup_engage' | 'verification'
  | 'booking_reminders' | 'placement' | 'standing_searches' | 'ab_promote'
  | 'sse_maintenance' | 'domain_reverify' | 'watchdog' | 'digest' | 'reply_check' | 'improve';

export interface JobDef {
  id: JobId;
  label: string;
  /** What stops happening when it stops, in the user's terms. */
  what: string;
  everyMs: number;
  /** Shown to everyone; the rest only matter when something is wrong. */
  core: boolean;
}

const S = 1000, M = 60 * S, H = 60 * M;

export const JOBS: JobDef[] = [
  { id: 'sending', label: 'Sending', what: 'Campaign emails go out on schedule', everyMs: 30 * S, core: true },
  { id: 'inbox', label: 'Inbox sync', what: 'Replies arrive in the inbox and stop sequences', everyMs: 5 * M, core: true },
  { id: 'autopilot', label: 'Deliverability autopilot', what: 'Struggling mailboxes are rested; bounce notices are read', everyMs: 10 * M, core: true },
  { id: 'warmup_send', label: 'Warm-up sending', what: 'Warm-up mail builds new mailboxes a reputation', everyMs: 12 * M, core: true },
  { id: 'warmup_engage', label: 'Warm-up engagement', what: 'Warm-up mail is opened, replied to and rescued from spam', everyMs: 10 * M, core: false },
  { id: 'verification', label: 'Email verification', what: 'Queued addresses are verified', everyMs: 20 * S, core: false },
  { id: 'booking_reminders', label: 'Booking reminders', what: 'Invitees are reminded the day before a meeting', everyMs: 15 * M, core: false },
  { id: 'placement', label: 'Inbox placement', what: 'Placement tests find their probe emails', everyMs: 2 * M, core: false },
  { id: 'standing_searches', label: 'Standing searches', what: 'Saved searches prospect and enrol on their cadence', everyMs: H, core: false },
  { id: 'ab_promote', label: 'A/B winners', what: 'Settled split tests promote their winner', everyMs: 30 * M, core: false },
  { id: 'sse_maintenance', label: 'Daily counters', what: 'Mailbox send counters reset each day', everyMs: H, core: false },
  { id: 'domain_reverify', label: 'Domain re-checks', what: 'Sending domains are re-checked for DNS changes', everyMs: 6 * H, core: false },
  { id: 'watchdog', label: 'Watchdog', what: 'Problems are noticed and you are told', everyMs: 5 * M, core: false },
  { id: 'digest', label: 'Weekly digest', what: 'Monday\'s summary email goes out', everyMs: 30 * M, core: false },
  { id: 'improve', label: 'Campaign improvement', what: 'Relay writes, runs and settles tests on campaigns that asked for it', everyMs: H, core: false },
  { id: 'reply_check', label: 'Daily reply check', what: 'Proves once a day that a reply stops a sequence', everyMs: H, core: false },
];

export const JOB_BY_ID: Record<JobId, JobDef> = Object.fromEntries(JOBS.map((j) => [j.id, j])) as Record<JobId, JobDef>;

export type JobHealth = 'ok' | 'late' | 'stalled' | 'never' | 'failing';

export interface JobBeat {
  job: JobId;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  duration_ms: number | null;
}

/** Missed beats before a job reads as late, and as stalled. */
export const LATE_BEATS = 3;
export const STALLED_BEATS = 6;
/** Consecutive errors are "failing" when the last good run is this many beats old. */
export const FAILING_BEATS = 3;

/**
 * How a job is doing. Measured from its last *finished* run - a job that
 * started an hour ago and never finished is the stuck one, and a start
 * time alone would call it healthy.
 */
export function jobHealth(beat: JobBeat | null | undefined, everyMs: number, now = Date.now()): JobHealth {
  if (!beat || !beat.last_finished_at) {
    // A job that started but never finished, long enough ago, is stuck.
    if (beat?.last_started_at && now - Date.parse(beat.last_started_at) > STALLED_BEATS * everyMs) return 'stalled';
    return 'never';
  }
  const sinceFinish = now - Date.parse(beat.last_finished_at);
  if (sinceFinish > STALLED_BEATS * everyMs) return 'stalled';
  if (sinceFinish > LATE_BEATS * everyMs) return 'late';
  const lastOk = beat.last_ok_at ? Date.parse(beat.last_ok_at) : 0;
  if (beat.last_error_at && Date.parse(beat.last_error_at) > lastOk && now - lastOk > FAILING_BEATS * everyMs) return 'failing';
  return 'ok';
}

/* ── What the status page shows ────────────────────────────────────── */

export type StatusLevel = 'ok' | 'attention' | 'down';

export interface StatusJob {
  id: JobId;
  label: string;
  what: string;
  core: boolean;
  health: JobHealth;
  last_ok_at: string | null;
  last_error: string | null;
  every_ms: number;
}

export interface StatusIssue {
  /** Stable, so an alert about it is sent once. */
  key: string;
  level: 'attention' | 'down';
  title: string;
  detail: string;
  href: string | null;
  since: string | null;
}

export interface SystemStatus {
  /** False until migration 078 is run; jobs are then read from this server's memory only. */
  persisted: boolean;
  level: StatusLevel;
  headline: string;
  jobs: StatusJob[];
  issues: StatusIssue[];
  checked_at: string;
  /** Whether a reply really stops a sequence, as last proven (shared/reply-check). */
  reply_check: ReplyCheckStatus;
}

export interface ReplyCheckStatus {
  last: ReplyCheckResult | null;
  last_ok_at: string | null;
  /** The account's automatic daily check is on. */
  daily: boolean;
  running: boolean;
  /** False until migration 079: results are not kept and the daily check does not run. */
  persisted: boolean;
}

export function overallLevel(jobs: StatusJob[], issues: StatusIssue[]): StatusLevel {
  if (jobs.some((j) => j.core && j.health === 'stalled') || issues.some((i) => i.level === 'down')) return 'down';
  if (jobs.some((j) => j.health === 'late' || j.health === 'stalled' || j.health === 'failing') || issues.length > 0) return 'attention';
  return 'ok';
}

export interface SelfTestResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}
