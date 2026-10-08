/* ═══════════════════════════════════════════════════════════════════════
   Campaigns that improve themselves.

   One switch per campaign: "Let Relay improve this campaign". After that,
   one test at a time:

     1. Relay picks the email with the most people still to receive it.
     2. It writes ONE challenger that changes ONE thing - the subject, the
        opening, or the ask - from what people actually replied.
     3. The person approves it (or edits, or skips) - unless they chose
        "run tests without asking" for that campaign.
     4. The rest of the sends split 50/50, with the A/B machinery the
        builder already uses.
     5. It is judged on REPLIES, never opens: Apple Mail opens everything
        on its own, so an open-rate winner is a coin toss in a costume.
     6. The challenger replaces the original only when it is at least 90%
        likely to get more replies. If the original is that likely to be
        better, or nothing separates them by the time enough people have
        had it, the original stays - and the person is told which.

   Everything a person sees is a sentence. The maths is here, pure, so the
   checks can hold it to plain numbers.
   ═══════════════════════════════════════════════════════════════════════ */

import { checkEmailContent } from './content-check.js';
import { writingProblems } from './writing.js';

export const IMPROVE = {
  /** Sends per version before anything is decided. */
  MIN_ARM: 150,
  /** After this many sends per version, a test with no clear winner ends. */
  MAX_ARM: 600,
  /** ...or after this long. */
  MAX_DAYS: 28,
  /** How sure Relay must be that the new version gets more replies. */
  WIN_PROBABILITY: 0.9,
  /** People still to receive an email before it is worth testing. */
  MIN_REMAINING: 400,
} as const;

export const IMPROVE_ELEMENTS = ['subject', 'opening', 'ask'] as const;
export type ImproveElement = typeof IMPROVE_ELEMENTS[number];

export const IMPROVE_ELEMENT_LABELS: Record<ImproveElement, string> = {
  subject: 'subject line',
  opening: 'opening line',
  ask: 'closing question',
};

export type ExperimentStatus =
  | 'proposed'   // written, waiting for the person
  | 'running'    // splitting sends
  | 'won'        // the new version is now the email
  | 'kept'       // the original stayed
  | 'skipped'    // the person passed on it
  | 'stopped'    // ended by hand before a result
  | 'undone';    // a win the person reversed

export interface ArmNumbers { sent: number; replies: number }

export interface Experiment {
  id: string;
  campaign_id: string;
  step_id: string;
  /** 1-based, as people count emails. */
  email_number: number;
  element: ImproveElement;
  status: ExperimentStatus;
  /** Why Relay thinks this might do better, in a sentence. */
  why: string;
  original: { subject: string | null; body_html: string | null };
  challenger: { subject: string | null; body_html: string | null };
  /** Live while running; final once decided. */
  a: ArmNumbers;
  b: ArmNumbers;
  probability_b_better: number | null;
  /** The plain-words result, once decided. */
  summary: string | null;
  created_at: string;
  started_at: string | null;
  decided_at: string | null;
}

/* ── Deciding ──────────────────────────────────────────────────────── */

/** Standard normal CDF (Abramowitz-Stegun 7.1.26), good to ~1e-7. */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * How likely B's true reply rate is above A's, from each version's
 * Beta(1 + replies, 1 + non-replies) posterior, by normal approximation -
 * deterministic, so the same numbers always give the same answer.
 */
export function probabilityBBetter(a: ArmNumbers, b: ArmNumbers): number {
  const beta = (x: ArmNumbers) => {
    const al = 1 + x.replies; const be = 1 + Math.max(0, x.sent - x.replies);
    const mean = al / (al + be);
    const variance = (al * be) / ((al + be) ** 2 * (al + be + 1));
    return { mean, variance };
  };
  const A = beta(a); const B = beta(b);
  const sd = Math.sqrt(A.variance + B.variance);
  return sd > 0 ? phi((B.mean - A.mean) / sd) : 0.5;
}

export type Verdict =
  | { decided: false; reason: string; probability: number }
  | { decided: true; outcome: 'won' | 'kept'; probability: number; reason: string };

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

/** Where a running test stands, and whether it is over. */
export function judge(a: ArmNumbers, b: ArmNumbers, startedAt: string | null, now = Date.now()): Verdict {
  const p = probabilityBBetter(a, b);
  const enough = Math.min(a.sent, b.sent) >= IMPROVE.MIN_ARM;
  const days = startedAt ? (now - Date.parse(startedAt)) / 86_400_000 : 0;
  if (enough && p >= IMPROVE.WIN_PROBABILITY) {
    return { decided: true, outcome: 'won', probability: p, reason: 'the new version is clearly getting more replies' };
  }
  if (enough && p <= 1 - IMPROVE.WIN_PROBABILITY) {
    return { decided: true, outcome: 'kept', probability: p, reason: 'the original is clearly getting more replies' };
  }
  if (Math.min(a.sent, b.sent) >= IMPROVE.MAX_ARM || (days >= IMPROVE.MAX_DAYS && enough)) {
    return { decided: true, outcome: 'kept', probability: p, reason: 'no clear difference after enough sends' };
  }
  if (!enough && days >= IMPROVE.MAX_DAYS * 2) {
    return { decided: true, outcome: 'kept', probability: p, reason: 'too few people received it to tell' };
  }
  if (!enough) {
    const left = IMPROVE.MIN_ARM - Math.min(a.sent, b.sent);
    return { decided: false, probability: p, reason: `${left} more ${left === 1 ? 'send' : 'sends'} per version before it can tell` };
  }
  return { decided: false, probability: p, reason: `${Math.round(p * 100)}% likely the new version is better so far - not sure enough yet` };
}

/** The sentence a decided test leaves behind. */
export function experimentSummary(e: Pick<Experiment, 'element' | 'email_number'>, a: ArmNumbers, b: ArmNumbers, outcome: 'won' | 'kept', reason: string): string {
  const ra = a.sent ? a.replies / a.sent : 0;
  const rb = b.sent ? b.replies / b.sent : 0;
  const what = `${IMPROVE_ELEMENT_LABELS[e.element]} on email ${e.email_number}`;
  const nums = `(${pct(rb)} replied to the new version, ${pct(ra)} to the original, ${Math.min(a.sent, b.sent).toLocaleString('en-GB')} sends each)`;
  if (outcome === 'won') {
    const lift = ra > 0 ? Math.round(((rb - ra) / ra) * 100) : null;
    return `A new ${what} got ${lift !== null && lift > 0 ? `${lift}% more replies` : 'more replies'} ${nums}. It is now the email everyone gets.`;
  }
  if (reason === 'the original is clearly getting more replies') return `The original ${what} did better ${nums}, so it stays.`;
  if (reason === 'too few people received it to tell') return `The test of a new ${what} ended: too few people received it to tell. The original stays.`;
  return `A new ${what} made no clear difference ${nums}, so the original stays.`;
}

/* ── Choosing what to test ─────────────────────────────────────────── */

/**
 * The next thing to try on an email: subject first (first emails only -
 * follow-ups ride the first email's thread), then the opening, then the
 * ask, skipping whatever was tried on this email most recently.
 */
export function nextElement(emailNumber: number, tried: ImproveElement[]): ImproveElement {
  const options: ImproveElement[] = emailNumber === 1 ? ['subject', 'opening', 'ask'] : ['opening', 'ask'];
  const unseen = options.find((o) => !tried.includes(o));
  if (unseen) return unseen;
  // All tried: the one tried longest ago.
  const order = [...tried].reverse();
  return [...options].sort((x, y) => order.indexOf(y) - order.indexOf(x))[0];
}

/* ── Guarding what Relay writes ────────────────────────────────────── */

function tags(s: string | null | undefined): string[] {
  return [...new Set((s || '').match(/\{\{\s*[a-z_]+/gi)?.map((t) => t.replace(/\{\{\s*/, '').toLowerCase()) || [])].sort();
}
function links(s: string | null | undefined): string[] {
  return [...new Set((s || '').match(/https?:\/\/[^\s"'<>)]+/gi) || [])].sort();
}
function text(html: string | null | undefined): string {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Whether a challenger may be tested at all. Relay changes one thing; it
 * must not drop a merge tag, add or remove a link, balloon or gut the
 * email, introduce anything the launch review would flag, or add a long
 * dash or a stock phrase the original did not have.
 * Returns the problems; empty means it may run.
 */
export function challengerProblems(
  original: { subject: string | null; body_html: string | null },
  challenger: { subject: string | null; body_html: string | null },
  element: ImproveElement,
): string[] {
  const problems: string[] = [];
  if (element === 'subject') {
    if (!(challenger.subject || '').trim()) problems.push('The new subject is empty.');
    if ((challenger.subject || '').trim() === (original.subject || '').trim()) problems.push('The new subject is the same as the original.');
    if ((challenger.subject || '').length > 80) problems.push('The new subject is too long.');
  } else {
    const before = text(original.body_html); const after = text(challenger.body_html);
    if (!after) problems.push('The new email is empty.');
    if (after === before) problems.push('The new email is the same as the original.');
    const ratio = before ? after.length / before.length : 1;
    if (ratio < 0.6 || ratio > 1.5) problems.push('The new email changes too much of the original.');
  }
  const t0 = tags(`${original.subject} ${original.body_html}`); const t1 = tags(`${challenger.subject ?? original.subject} ${challenger.body_html ?? original.body_html}`);
  if (t0.join() !== t1.join()) problems.push('The merge tags changed.');
  if (links(original.body_html).join() !== links(challenger.body_html ?? original.body_html).join()) problems.push('The links changed.');
  const before = checkEmailContent([{ step_order: 0, subject: original.subject, body_html: original.body_html }]).length;
  const after = checkEmailContent([{ step_order: 0, subject: challenger.subject ?? original.subject, body_html: challenger.body_html ?? original.body_html }]).length;
  if (after > before) problems.push('The new version reads more like spam to filters.');
  // Relay's own words are held to Relay's standard: no long dashes, no
  // stock phrases, nothing the original did not already have.
  const own = (x: { subject: string | null; body_html: string | null }) =>
    new Set([...writingProblems(x.subject || '', { subject: true }), ...writingProblems(x.body_html || '')]);
  const was = own(original);
  const now = own({ subject: challenger.subject ?? original.subject, body_html: challenger.body_html ?? original.body_html });
  if ([...now].some((p) => !was.has(p))) problems.push('The new version does not meet the writing standard.');
  return problems;
}

/** "Testing a new subject line on email 1 - 212 of 300 sends so far." */
export function runningLine(e: Pick<Experiment, 'element' | 'email_number' | 'a' | 'b'>): string {
  const done = Math.min(e.a.sent, e.b.sent);
  return `Testing a new ${IMPROVE_ELEMENT_LABELS[e.element]} on email ${e.email_number} - ${Math.min(done, IMPROVE.MIN_ARM)} of ${IMPROVE.MIN_ARM} sends per version so far${done >= IMPROVE.MIN_ARM ? ', waiting for a clear answer' : ''}.`;
}

export interface ImproveStatus {
  enabled: boolean;
  /** Run tests without asking first. */
  auto: boolean;
  /** Claude is configured: Relay can write. */
  ai: boolean;
  /** Why nothing is happening, when nothing is. */
  waiting: string | null;
  current: Experiment | null;
  history: Experiment[];
  /** False until migration 082. */
  ready: boolean;
}
