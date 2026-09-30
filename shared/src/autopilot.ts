/* ═══════════════════════════════════════════════════════════════════════
   Deliverability autopilot: the rules.

   The platform has long known when a mailbox was in trouble - health
   scores, bounce rates, warm-up progress - and has left every decision to
   a person who is, at the moment it matters, not looking. So the rules
   live here and act on their own:

     slowed      a mailbox showing early signs (a bounce rate creeping up,
                 a first policy block) sends at half its allowance, and its
                 share moves to the healthy mailboxes.
     resting     a mailbox being refused - a confidently high bounce rate,
                 or several blocks - stops sending for two days (four if it
                 needed a rest recently). Its campaigns carry on through
                 the rest of the rotation.
     recovering  after a rest it comes back at a quarter, then half, then
                 three quarters, then full - judged only on what it sends
                 from here, so the bounces that sent it to rest cannot send
                 it straight back.

   And one rule about the people receiving: a provider (gmail.com,
   outlook.com, a company's domain) that starts refusing your mail is
   paused for a few hours rather than sent more of the same.

   Every threshold is judged on a Wilson lower bound or an absolute floor,
   never a raw rate from a handful of sends - two bounces in three sends is
   bad luck, not evidence, and an autopilot that acts on bad luck gets
   switched off.

   Pure: no clock of its own, no database. The service feeds it evidence
   and a `now`, and the checks assert it against a fake clock.
   ═══════════════════════════════════════════════════════════════════════ */

import { wilsonLowerBound } from './stats.js';
import { warmupAllowance, type WarmupPlanFields } from './smtp.types.js';
import { isFreeMailDomain } from './free-mail.js';

export type AutopilotState = 'active' | 'slowed' | 'resting' | 'recovering';

export const AUTOPILOT = {
  /** Sends before a bounce rate is read as anything. */
  MIN_SENDS: 30,
  /** Rest when we are confident the true bounce rate is at least this. */
  REST_BOUNCE: 0.05,
  /** Slow when we are confident it is at least this. */
  SLOW_BOUNCE: 0.025,
  /** Policy blocks (5.7.x, "spam", "blocked") that rest a mailbox... */
  REST_BLOCKS: 3,
  /** ...when they are at least this share of its sends. */
  REST_BLOCK_SHARE: 0.02,
  /** One block is a warning. */
  SLOW_BLOCKS: 1,
  REST_HOURS: 48,
  /** A second rest within REPEAT_WINDOW_DAYS is longer. */
  REST_HOURS_REPEAT: 96,
  REPEAT_WINDOW_DAYS: 14,
  /** Share of the allowance on each day of recovery; then full. */
  RECOVERY_STEPS: [0.25, 0.5, 0.75] as readonly number[],
  SLOW_FACTOR: 0.5,
  /**
   * An uncapped mailbox has no allowance to take a share of. While slowed
   * or recovering it is held to a share of this many a day instead.
   */
  UNCAPPED_BASE: 200,
  /** Evidence window for active and slowed mailboxes. */
  WINDOW_DAYS: 7,
  /** Provider pause: blocks in the last day that trigger one... */
  HOLD_BLOCKS: 3,
  /** ...when they are at least this share of sends there. */
  HOLD_SHARE: 0.05,
  HOLD_HOURS: 12,
  HOLD_HOURS_REPEAT: 24,
} as const;

export interface MailboxEvidence {
  /** Sends from this mailbox in the window. */
  sent: number;
  /** Refusals because the address is dead. */
  bounced: number;
  /** Refusals of the sender itself. */
  blocked: number;
}

export type MailboxVerdict =
  | { verdict: 'ok' }
  | { verdict: 'slow' | 'rest'; reason: string };

const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

/** What the evidence says about a mailbox, ignoring where it stands now. */
export function judgeMailbox(e: MailboxEvidence): MailboxVerdict {
  const failures = e.bounced + e.blocked;
  const blockShare = e.sent > 0 ? e.blocked / e.sent : 0;

  if (e.blocked >= AUTOPILOT.REST_BLOCKS && (e.sent === 0 || blockShare >= AUTOPILOT.REST_BLOCK_SHARE)) {
    return { verdict: 'rest', reason: `${e.blocked} receiving servers refused it as a sender in the last ${AUTOPILOT.WINDOW_DAYS} days` };
  }
  if (e.sent >= AUTOPILOT.MIN_SENDS) {
    const lower = wilsonLowerBound(failures, e.sent);
    if (lower >= AUTOPILOT.REST_BOUNCE) {
      return { verdict: 'rest', reason: `${failures} of ${e.sent} sends bounced (${pct(failures / e.sent)})` };
    }
    if (lower >= AUTOPILOT.SLOW_BOUNCE) {
      return { verdict: 'slow', reason: `bounce rate climbing: ${failures} of ${e.sent} (${pct(failures / e.sent)})` };
    }
  }
  if (e.blocked >= AUTOPILOT.SLOW_BLOCKS) {
    return { verdict: 'slow', reason: `${e.blocked === 1 ? 'a receiving server' : `${e.blocked} receiving servers`} refused it as a sender` };
  }
  return { verdict: 'ok' };
}

export interface MailboxAutopilot {
  autopilot_state?: AutopilotState | null;
  autopilot_since?: string | null;
  autopilot_rest_until?: string | null;
  autopilot_recovery_day?: number | null;
  autopilot_evidence_from?: string | null;
  autopilot_last_rest_at?: string | null;
  autopilot_reason?: string | null;
}

export type AutopilotEventKind =
  | 'rest' | 'slow' | 'recovering' | 'recovery_step' | 'recovered' | 'full_speed'
  | 'hold' | 'release' | 'manual_resume' | 'bounces_found' | 'weekly';

export interface MailboxTransition {
  /** The columns to write. Empty when nothing changes. */
  patch: Required<Pick<MailboxAutopilot,
    'autopilot_state' | 'autopilot_since' | 'autopilot_rest_until' | 'autopilot_recovery_day'
    | 'autopilot_evidence_from' | 'autopilot_last_rest_at' | 'autopilot_reason'>> | null;
  event: { kind: AutopilotEventKind; title: string; detail: string; hours?: number } | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function fmtHours(h: number): string {
  return h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hours`;
}

/**
 * Where a mailbox goes next.
 *
 * `evidence` must already be the evidence since `evidenceFrom(mailbox)` -
 * the service reads it that way so a rested mailbox is judged afresh.
 */
export function nextMailboxState(
  m: MailboxAutopilot,
  evidence: MailboxEvidence,
  now: Date,
  label = 'This mailbox',
): MailboxTransition {
  const state: AutopilotState = (m.autopilot_state as AutopilotState) || 'active';
  const t = now.getTime();
  const iso = now.toISOString();
  const base = {
    autopilot_state: state,
    autopilot_since: m.autopilot_since ?? null,
    autopilot_rest_until: m.autopilot_rest_until ?? null,
    autopilot_recovery_day: m.autopilot_recovery_day ?? 0,
    autopilot_evidence_from: m.autopilot_evidence_from ?? null,
    autopilot_last_rest_at: m.autopilot_last_rest_at ?? null,
    autopilot_reason: m.autopilot_reason ?? null,
  };
  const none: MailboxTransition = { patch: null, event: null };

  const rest = (reason: string) => restMailbox(m, reason, now, label);

  if (state === 'resting') {
    const until = m.autopilot_rest_until ? Date.parse(m.autopilot_rest_until) : 0;
    if (t < until) return none;
    return {
      patch: {
        ...base,
        autopilot_state: 'recovering',
        autopilot_since: iso,
        autopilot_rest_until: null,
        autopilot_recovery_day: 0,
        // Judged from here on: the bounces that caused the rest are history.
        autopilot_evidence_from: iso,
        autopilot_reason: 'coming back gradually after a rest',
      },
      event: {
        kind: 'recovering',
        title: `${label} is back, at a quarter of its usual volume`,
        detail: `The rest is over. It ramps back up over ${AUTOPILOT.RECOVERY_STEPS.length} days, and goes straight back to rest if the bouncing starts again.`,
      },
    };
  }

  const verdict = judgeMailbox(evidence);

  if (state === 'recovering') {
    if (verdict.verdict === 'rest') return rest(verdict.reason);
    const since = m.autopilot_since ? Date.parse(m.autopilot_since) : t;
    const day = Math.floor((t - since) / DAY);
    if (day >= AUTOPILOT.RECOVERY_STEPS.length) {
      return {
        patch: { ...base, autopilot_state: 'active', autopilot_since: iso, autopilot_recovery_day: 0, autopilot_reason: null },
        event: { kind: 'recovered', title: `${label} is back to full volume`, detail: `It came through recovery cleanly: ${evidence.sent} sends, ${evidence.bounced + evidence.blocked} bounced.` },
      };
    }
    if (day !== (m.autopilot_recovery_day ?? 0)) {
      const share = AUTOPILOT.RECOVERY_STEPS[day];
      return {
        patch: { ...base, autopilot_recovery_day: day },
        event: { kind: 'recovery_step', title: `${label} is up to ${Math.round(share * 100)}% of its volume`, detail: 'Recovery continuing, nothing bouncing.' },
      };
    }
    return none;
  }

  if (verdict.verdict === 'rest') return rest(verdict.reason);

  if (state === 'active' && verdict.verdict === 'slow') {
    return {
      patch: { ...base, autopilot_state: 'slowed', autopilot_since: iso, autopilot_reason: verdict.reason },
      event: {
        kind: 'slow',
        title: `Slowed ${label} to half volume`,
        detail: `${capitalise(verdict.reason)}. Half its sends move to your healthier mailboxes until it settles.`,
      },
    };
  }
  if (state === 'slowed' && verdict.verdict === 'ok') {
    return {
      patch: { ...base, autopilot_state: 'active', autopilot_since: iso, autopilot_reason: null },
      event: { kind: 'full_speed', title: `${label} is back to full volume`, detail: 'The warning signs have cleared.' },
    };
  }
  if (state === 'slowed' && verdict.verdict === 'slow' && verdict.reason !== m.autopilot_reason) {
    // Still slowed; keep the reason current without logging an event.
    return { patch: { ...base, autopilot_reason: verdict.reason }, event: null };
  }
  return none;
}

/**
 * Put a mailbox to rest. Two days, or four when it rested within the last
 * two weeks - a mailbox that needs a second rest needed a longer first one.
 */
export function restMailbox(m: MailboxAutopilot, reason: string, now: Date, label = 'This mailbox'): MailboxTransition {
  const t = now.getTime();
  const iso = now.toISOString();
  const recent = !!m.autopilot_last_rest_at
    && t - Date.parse(m.autopilot_last_rest_at) < AUTOPILOT.REPEAT_WINDOW_DAYS * DAY;
  const hours = recent ? AUTOPILOT.REST_HOURS_REPEAT : AUTOPILOT.REST_HOURS;
  return {
    patch: {
      autopilot_state: 'resting',
      autopilot_since: iso,
      autopilot_rest_until: new Date(t + hours * HOUR).toISOString(),
      autopilot_recovery_day: 0,
      autopilot_evidence_from: m.autopilot_evidence_from ?? null,
      autopilot_last_rest_at: iso,
      autopilot_reason: reason,
    },
    event: {
      kind: 'rest',
      title: `Rested ${label} for ${fmtHours(hours)}`,
      detail: `${capitalise(reason)}. Its campaigns keep sending through your other mailboxes${recent ? '. A second rest in two weeks, so a longer one' : ''}.`,
      hours,
    },
  };
}

/** Where the evidence for this mailbox's next judgement starts. */
export function evidenceFrom(m: MailboxAutopilot, now: Date): Date {
  const window = new Date(now.getTime() - AUTOPILOT.WINDOW_DAYS * DAY);
  const from = m.autopilot_evidence_from ? new Date(m.autopilot_evidence_from) : null;
  return from && from > window ? from : window;
}

/**
 * What a mailbox may send today, autopilot included.
 *
 * Same convention as warmupAllowance - 0 means uncapped - plus `sendable`,
 * false while it rests. Every sender selection path reads this, so a
 * resting mailbox cannot be reached by a fallback either.
 */
export function autopilotAllowance(
  a: WarmupPlanFields & MailboxAutopilot,
  now: Date = new Date(),
): { sendable: boolean; limit: number } {
  const base = warmupAllowance(a);
  const state = (a.autopilot_state as AutopilotState) || 'active';
  if (state === 'resting') {
    const until = a.autopilot_rest_until ? Date.parse(a.autopilot_rest_until) : Infinity;
    // A rest that has run out but not been stepped yet is still a rest:
    // recovery starts at a quarter, never at full, whatever the timing.
    if (now.getTime() < until) return { sendable: false, limit: 0 };
    return { sendable: true, limit: share(base, AUTOPILOT.RECOVERY_STEPS[0]) };
  }
  if (state === 'recovering') {
    const day = Math.min(a.autopilot_recovery_day ?? 0, AUTOPILOT.RECOVERY_STEPS.length - 1);
    return { sendable: true, limit: share(base, AUTOPILOT.RECOVERY_STEPS[day]) };
  }
  if (state === 'slowed') return { sendable: true, limit: share(base, AUTOPILOT.SLOW_FACTOR) };
  return { sendable: true, limit: base };
}

function share(base: number, factor: number): number {
  const of = base === 0 ? AUTOPILOT.UNCAPPED_BASE : base;
  return Math.max(1, Math.floor(of * factor));
}

/**
 * Who is on the receiving end, for provider pauses. Consumer addresses are
 * grouped by the company that runs them - a block from gmail.com and one
 * from googlemail.com are the same refusal.
 */
export function receivingProvider(email: string): string {
  const domain = (email.split('@')[1] || '').toLowerCase().trim();
  if (!domain) return '';
  if (/^(gmail|googlemail)\.com$/.test(domain)) return 'gmail.com';
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return 'outlook.com';
  if (/^(yahoo|ymail|rocketmail|aol)\.[a-z.]+$/.test(domain)) return 'yahoo.com';
  if (/^(icloud|me|mac)\.com$/.test(domain)) return 'icloud.com';
  return domain;
}

export function isConsumerProvider(provider: string): boolean {
  return ['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com'].includes(provider) || isFreeMailDomain(provider);
}

/** Should mail to this provider pause? */
export function judgeProvider(sent: number, blocked: number): boolean {
  return blocked >= AUTOPILOT.HOLD_BLOCKS && (sent === 0 || blocked / sent >= AUTOPILOT.HOLD_SHARE);
}

export function holdHours(previousHoldAt: string | null | undefined, now: Date): number {
  const recent = previousHoldAt && now.getTime() - Date.parse(previousHoldAt) < 7 * DAY;
  return recent ? AUTOPILOT.HOLD_HOURS_REPEAT : AUTOPILOT.HOLD_HOURS;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/* ── What the client shows ─────────────────────────────────────────── */

export interface AutopilotMailbox {
  id: string;
  label: string;
  email_address: string;
  state: AutopilotState;
  reason: string | null;
  since: string | null;
  rest_until: string | null;
  /** Share of its usual allowance it may send right now, 0-1. */
  share: number;
  evidence: MailboxEvidence;
}

export interface AutopilotHold {
  provider: string;
  held_until: string;
  reason: string | null;
}

export interface AutopilotEvent {
  id: string;
  kind: AutopilotEventKind;
  title: string;
  detail: string | null;
  smtp_account_id: string | null;
  provider: string | null;
  created_at: string;
}

export interface AutopilotWeek {
  rests: number;
  slowdowns: number;
  recoveries: number;
  holds: number;
  /** Bounces read from notices that would have gone unnoticed before. */
  bounces_found: number;
  /** Hours of rest given, across every mailbox. */
  rested_hours: number;
}

export interface AutopilotStatus {
  /** False until migration 077 has been run. */
  ready: boolean;
  enabled: boolean;
  mailboxes: AutopilotMailbox[];
  holds: AutopilotHold[];
  events: AutopilotEvent[];
  week: AutopilotWeek;
  last_run_at: string | null;
}

export const AUTOPILOT_STATE_LABELS: Record<AutopilotState, string> = {
  active: 'Full speed',
  slowed: 'Slowed',
  resting: 'Resting',
  recovering: 'Recovering',
};

/** The share of its allowance a mailbox has right now, for display. */
export function autopilotShare(m: MailboxAutopilot, now: Date = new Date()): number {
  const state = (m.autopilot_state as AutopilotState) || 'active';
  if (state === 'resting') {
    const until = m.autopilot_rest_until ? Date.parse(m.autopilot_rest_until) : Infinity;
    return now.getTime() < until ? 0 : AUTOPILOT.RECOVERY_STEPS[0];
  }
  if (state === 'recovering') {
    return AUTOPILOT.RECOVERY_STEPS[Math.min(m.autopilot_recovery_day ?? 0, AUTOPILOT.RECOVERY_STEPS.length - 1)];
  }
  if (state === 'slowed') return AUTOPILOT.SLOW_FACTOR;
  return 1;
}
