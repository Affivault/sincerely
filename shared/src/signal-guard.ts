/* ═══════════════════════════════════════════════════════════════════════
   Two more reasons to stop a campaign on the user's behalf.

   The bounce guard (server/bounce-guard) watches the list. These watch the
   two other things that tell you mail has stopped being welcome:

     · Spam complaints. Every "Report spam" is counted by Gmail and Yahoo,
       and past about 0.3% of mail they start filtering the sender. One
       complaint is a person; a rate is a campaign problem.

     · An open-rate collapse. Opens drifting down over a sequence is normal.
       Opens falling off a cliff - a campaign that was opened by a third of
       its recipients now opened by a twentieth - is what landing in spam
       looks like from the outside, and it is usually the first sign.

   Both are judged the way the bounce guard is, for the same reason: a
   floor on sample size, and a confidence bound instead of the raw rate, so
   a couple of early events cannot pause a healthy campaign and teach people
   to switch the protection off.

   Pure: counts in, verdict out, so the decision can be checked without a
   database and the campaign page can show the same numbers it acts on.
   ═══════════════════════════════════════════════════════════════════════ */

import { wilsonLowerBound, wilsonUpperBound } from './stats.js';

/* ── Spam complaints ─────────────────────────────────────────────────── */

/** Below this many sends, a complaint rate is a handful of people, not a signal. */
export const COMPLAINT_MIN_SENDS = 100;
/** And never on one complaint: one person can be wrong; two is a pattern starting. */
export const COMPLAINT_MIN_COMPLAINTS = 2;
/** Gmail's and Yahoo's published line for bulk senders. */
export const DEFAULT_COMPLAINT_THRESHOLD_PERCENT = 0.3;

export interface ComplaintJudgement {
  sent: number;
  complaints: number;
  /** Observed, 0-1. */
  rate: number;
  /** 95% lower bound - what the decision uses. */
  confidentRate: number;
  thresholdPercent: number;
  trip: boolean;
  note: string;
}

const pct = (r: number) => `${(r * 100).toFixed(r < 0.01 ? 2 : 1)}%`;

export function judgeComplaints(sent: number, complaints: number, thresholdPercent: number): ComplaintJudgement {
  const threshold = thresholdPercent > 0 ? thresholdPercent : DEFAULT_COMPLAINT_THRESHOLD_PERCENT;
  const rate = sent > 0 ? complaints / sent : 0;
  const confidentRate = wilsonLowerBound(complaints, sent);
  const base = { sent, complaints, rate, confidentRate, thresholdPercent: threshold };
  if (sent < COMPLAINT_MIN_SENDS || complaints < COMPLAINT_MIN_COMPLAINTS) {
    return {
      ...base,
      trip: false,
      note: complaints === 0
        ? 'No spam complaints.'
        : `${complaints} spam ${complaints === 1 ? 'complaint' : 'complaints'} in ${sent} sends - too few to judge a rate on yet.`,
    };
  }
  const trip = confidentRate > threshold / 100;
  return {
    ...base,
    trip,
    note: `${complaints} of ${sent} recipients marked it as spam (${pct(rate)}), ${trip ? 'above' : 'within'} your ${threshold}% limit.`,
  };
}

/* ── Open-rate collapse ──────────────────────────────────────────────── */

/** Sends younger than this have not had their chance to be opened yet. */
export const OPEN_SETTLE_HOURS = 24;
/** The newest settled sends judged as "now". */
export const OPEN_RECENT_SENDS = 150;
export const OPEN_MIN_RECENT = 100;
/** The sends before them, as "what this campaign normally gets". */
export const OPEN_BASELINE_SENDS = 600;
export const OPEN_MIN_BASELINE = 200;
/**
 * Below this, opens are too sparse - or mostly blocked by the recipients'
 * mail clients - for a fall in them to mean anything.
 */
export const OPEN_MIN_BASELINE_RATE = 0.1;
/** A step needs this many baseline sends to be its own yardstick. */
const STEP_MIN_BASELINE = 30;
export const DEFAULT_OPEN_DROP_PERCENT = 60;

export interface OpenSample {
  step_id: string | null;
  opened: boolean;
}

export interface OpenJudgement {
  recentSends: number;
  recentOpened: number;
  /** Observed recent rate, 0-1. */
  recentRate: number;
  /** What the recent sends would have got at the campaign's usual rate, step for step. */
  expectedRate: number;
  baselineSends: number;
  baselineRate: number;
  dropPercent: number;
  trip: boolean;
  note: string;
}

/**
 * Has the open rate collapsed?
 *
 * Compared step for step. A sequence's later emails are opened less than
 * its first - that is how sequences work - and the newest sends are mostly
 * follow-ups while the oldest were mostly first emails. Comparing the two
 * raw rates would call an ordinary sequence a collapse. So each recent send
 * is held to what that same step got before, where there is enough of it to
 * say, and to the campaign's overall rate where there is not.
 *
 * Trips only when even the top of the 95% interval for the recent rate is
 * below the expected rate cut by `dropPercent`: confidently collapsed, not
 * a slow afternoon.
 */
export function judgeOpenCollapse(recent: OpenSample[], baseline: OpenSample[], dropPercent: number): OpenJudgement {
  const drop = dropPercent > 0 && dropPercent < 100 ? dropPercent : DEFAULT_OPEN_DROP_PERCENT;
  const baselineOpened = baseline.filter((s) => s.opened).length;
  const baselineRate = baseline.length > 0 ? baselineOpened / baseline.length : 0;
  const recentOpened = recent.filter((s) => s.opened).length;
  const recentRate = recent.length > 0 ? recentOpened / recent.length : 0;

  const perStep = new Map<string, { n: number; opened: number }>();
  for (const s of baseline) {
    const k = s.step_id || '';
    const e = perStep.get(k) || { n: 0, opened: 0 };
    e.n++;
    if (s.opened) e.opened++;
    perStep.set(k, e);
  }
  let expectedSum = 0;
  for (const s of recent) {
    const e = perStep.get(s.step_id || '');
    expectedSum += e && e.n >= STEP_MIN_BASELINE ? e.opened / e.n : baselineRate;
  }
  const expectedRate = recent.length > 0 ? expectedSum / recent.length : 0;
  const base = {
    recentSends: recent.length, recentOpened, recentRate, expectedRate,
    baselineSends: baseline.length, baselineRate, dropPercent: drop,
  };

  if (recent.length < OPEN_MIN_RECENT || baseline.length < OPEN_MIN_BASELINE) {
    return { ...base, trip: false, note: 'Not enough opened-or-not sends yet to judge the open rate.' };
  }
  if (expectedRate < OPEN_MIN_BASELINE_RATE) {
    return { ...base, trip: false, note: `Opens are too low across this campaign (${pct(baselineRate)}) for a fall in them to mean anything.` };
  }
  const limit = expectedRate * (1 - drop / 100);
  const trip = wilsonUpperBound(recentOpened, recent.length) < limit;
  return {
    ...base,
    trip,
    note: trip
      ? `Opens fell from ${pct(expectedRate)} to ${pct(recentRate)} over the last ${recent.length} sends - more than the ${drop}% drop you allow.`
      : `Opens are ${pct(recentRate)} on the last ${recent.length} sends against ${pct(expectedRate)} usually.`,
  };
}
