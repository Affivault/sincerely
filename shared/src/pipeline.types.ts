/* ═══════════════════════════════════════════════════════════════════════
   What a pipeline is actually for.

   The deals board could show you every deal you had and tell you almost
   nothing about them. It summed the open ones and called that "pipeline",
   which is the number every rep quotes and nobody believes: a £2m pipeline
   made of ten unqualified leads is not the same as one made of three
   proposals out, and treating them as equal is the difference between a
   forecast and a wish.

   So the maths lives here, in one place, as pure functions — no React, no
   database — because these are the numbers people make decisions on and
   they need to be checkable.

   Three ideas do most of the work:

     weighted    every stage carries a probability. A deal's weighted value
                 is what it is worth once you admit it might not close.
     commit      proposal-and-beyond, unweighted. The number you would say
                 out loud to your boss.
     rot         how long a deal has sat in its current stage. Movement is
                 the only real signal of health, and it is the one thing a
                 static board never shows.
   ═══════════════════════════════════════════════════════════════════════ */

import type { Deal, DealStage } from './crm.types.js';

/**
 * Default odds per stage.
 *
 * Deliberately coarse. These are a starting point that a deal can override
 * on its own, not a model — a 63% that nobody chose is false precision, and
 * false precision in a forecast is worse than a round number.
 */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  lead: 10,
  qualified: 30,
  proposal: 60,
  won: 100,
  lost: 0,
};

/** Stages a deal is still live in. */
export const OPEN_STAGES: DealStage[] = ['lead', 'qualified', 'proposal'];

/** Stages that are finished, one way or the other. */
export const CLOSED_STAGES: DealStage[] = ['won', 'lost'];

export function isOpen(stage: DealStage): boolean {
  return OPEN_STAGES.includes(stage);
}

/**
 * The odds for one deal: its own if it has been given one, its stage's
 * otherwise. A closed deal is not a probability — it happened or it did
 * not — so those are pinned regardless of what is stored.
 */
export function probabilityOf(deal: Pick<Deal, 'stage' | 'probability'>): number {
  if (deal.stage === 'won') return 100;
  if (deal.stage === 'lost') return 0;
  const own = deal.probability;
  if (typeof own === 'number' && own >= 0 && own <= 100) return own;
  return STAGE_PROBABILITY[deal.stage] ?? 0;
}

/** Value once the odds are taken into account. */
export function weightedValue(deal: Pick<Deal, 'stage' | 'probability' | 'value'>): number {
  return ((Number(deal.value) || 0) * probabilityOf(deal)) / 100;
}

/* ─── Rot ─────────────────────────────────────────────────────────────── */

/**
 * How long a deal may sit in a stage before it is worth asking about.
 *
 * Per stage, because the stages are not alike: a lead going quiet for three
 * weeks is ordinary, a proposal going quiet for three weeks is a lost deal
 * that nobody has admitted to yet.
 */
export const STAGE_ROT_DAYS: Record<DealStage, number> = {
  lead: 21,
  qualified: 14,
  proposal: 10,
  won: Infinity,
  lost: Infinity,
};

/** Whole days since an ISO timestamp, or null when there isn't one. */
export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.floor((now - then) / 86_400_000);
}

/**
 * How long this deal has been in its current stage.
 *
 * `stage_changed_at` when the database has it, falling back to when the
 * deal was created. Deliberately not `updated_at`: that moves when somebody
 * fixes a typo in the title, and a deal whose notes were tidied has not
 * moved forward. Counting an edit as progress is exactly the lie this is
 * meant to catch.
 */
export function daysInStage(deal: Pick<Deal, 'stage_changed_at' | 'created_at'>, now = Date.now()): number | null {
  return daysSince(deal.stage_changed_at || deal.created_at, now);
}

export interface RotVerdict {
  /** True once the deal has been still for longer than its stage allows. */
  rotting: boolean;
  days: number | null;
  /** The threshold it is being judged against. Null for a closed deal. */
  limit: number | null;
}

export function rotOf(
  deal: Pick<Deal, 'stage' | 'stage_changed_at' | 'created_at'>,
  now = Date.now(),
): RotVerdict {
  const limit = STAGE_ROT_DAYS[deal.stage];
  const days = daysInStage(deal, now);
  if (!Number.isFinite(limit) || days === null) {
    return { rotting: false, days, limit: Number.isFinite(limit) ? limit : null };
  }
  return { rotting: days > limit, days, limit };
}

/* ─── The numbers at the top of the page ──────────────────────────────── */

export interface PipelineSummary {
  /** Every open deal, added up. The number everybody quotes. */
  open: number;
  openCount: number;
  /** The same deals, once the odds are admitted. */
  weighted: number;
  /** Proposal and beyond, unweighted — what you would commit to. */
  commit: number;
  commitCount: number;
  /** Open deals expected to close inside the window. */
  closingSoon: number;
  closingSoonCount: number;
  /** Open deals whose close date has already passed. */
  overdue: number;
  overdueCount: number;
  /** Open deals that have sat still too long for their stage. */
  rotting: number;
  rottingCount: number;
  /** Closed-won inside the window. */
  wonRecent: number;
  wonRecentCount: number;
  /** Won over won-plus-lost, as a percentage. Null when nothing has closed. */
  winRate: number | null;
  /** Mean days from creation to close, over closed deals that have both. */
  avgDaysToClose: number | null;
}

/** Start of the day `days` before now, so date comparisons are stable. */
function windowFloor(days: number, now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - days * 86_400_000;
}

/**
 * Everything the header needs, in one pass.
 *
 * `soonDays` is the horizon for "closing soon" and the lookback for "won
 * recently" — one setting, because a forecast that looks forward 30 days
 * and back 90 is comparing two different things.
 */
export function summarisePipeline(
  deals: Deal[],
  { soonDays = 30, now = Date.now() }: { soonDays?: number; now?: number } = {},
): PipelineSummary {
  const horizon = windowFloor(-soonDays, now);
  const lookback = windowFloor(soonDays, now);
  const today = windowFloor(0, now);

  const s: PipelineSummary = {
    open: 0, openCount: 0,
    weighted: 0,
    commit: 0, commitCount: 0,
    closingSoon: 0, closingSoonCount: 0,
    overdue: 0, overdueCount: 0,
    rotting: 0, rottingCount: 0,
    wonRecent: 0, wonRecentCount: 0,
    winRate: null,
    avgDaysToClose: null,
  };

  let won = 0;
  let lost = 0;
  let cycleTotal = 0;
  let cycleCount = 0;

  for (const deal of deals) {
    const value = Number(deal.value) || 0;

    if (isOpen(deal.stage)) {
      s.open += value;
      s.openCount += 1;
      s.weighted += weightedValue(deal);

      if (deal.stage === 'proposal') {
        s.commit += value;
        s.commitCount += 1;
      }

      if (deal.expected_close_date) {
        const close = new Date(deal.expected_close_date).getTime();
        if (Number.isFinite(close)) {
          if (close < today) {
            s.overdue += value;
            s.overdueCount += 1;
          } else if (close <= horizon) {
            s.closingSoon += value;
            s.closingSoonCount += 1;
          }
        }
      }

      if (rotOf(deal, now).rotting) {
        s.rotting += value;
        s.rottingCount += 1;
      }
      continue;
    }

    if (deal.stage === 'won') {
      won += 1;
      const closed = deal.closed_at ? new Date(deal.closed_at).getTime() : null;
      if (closed !== null && Number.isFinite(closed) && closed >= lookback) {
        s.wonRecent += value;
        s.wonRecentCount += 1;
      }
    } else if (deal.stage === 'lost') {
      lost += 1;
    }

    // Cycle length over anything that actually closed, won or lost: a deal
    // that took four months to lose is as much a fact about the pipeline as
    // one that took four months to win.
    const opened = deal.created_at ? new Date(deal.created_at).getTime() : null;
    const closed = deal.closed_at ? new Date(deal.closed_at).getTime() : null;
    if (opened !== null && closed !== null && Number.isFinite(opened) && Number.isFinite(closed) && closed >= opened) {
      cycleTotal += (closed - opened) / 86_400_000;
      cycleCount += 1;
    }
  }

  if (won + lost > 0) s.winRate = Math.round((won / (won + lost)) * 100);
  if (cycleCount > 0) s.avgDaysToClose = Math.round(cycleTotal / cycleCount);

  return s;
}

/* ─── Funnel ──────────────────────────────────────────────────────────── */

export interface FunnelStage {
  stage: DealStage;
  count: number;
  value: number;
  weighted: number;
  /** Share of the largest stage's count, 0-1, for drawing a bar. */
  share: number;
}

/**
 * Counts and value per open stage.
 *
 * Won and lost are left out on purpose. They accumulate forever, so
 * including them makes every other stage look empty by comparison and turns
 * a picture of this quarter's work into a picture of all history.
 */
export function funnel(deals: Deal[]): FunnelStage[] {
  const rows = OPEN_STAGES.map((stage) => {
    const items = deals.filter((d) => d.stage === stage);
    return {
      stage,
      count: items.length,
      value: items.reduce((n, d) => n + (Number(d.value) || 0), 0),
      weighted: items.reduce((n, d) => n + weightedValue(d), 0),
      share: 0,
    };
  });
  const biggest = Math.max(...rows.map((r) => r.count), 1);
  for (const row of rows) row.share = row.count / biggest;
  return rows;
}

/* ─── Why a deal ended ────────────────────────────────────────────────── */

/**
 * Reasons offered when a deal closes.
 *
 * Free text is also allowed, but a list is what makes the answers
 * countable: "lost on price" eleven times is a finding, eleven differently
 * worded sentences are not.
 */
export const LOST_REASONS = [
  'Price',
  'Went with a competitor',
  'No budget',
  'Bad timing',
  'No decision',
  'Went quiet',
  'Not a fit',
] as const;

export const WON_REASONS = [
  'Product fit',
  'Price',
  'Timing',
  'Relationship',
  'Beat a competitor',
] as const;

/* ─── The path a deal took ────────────────────────────────────────────── */

/**
 * One leg of a deal's journey: a stage it was in, and for how long.
 *
 * `days` on the last leg is measured to now, because the deal is still
 * sitting there. On every earlier leg it is measured to the next move.
 */
export interface StageLeg {
  stage: DealStage;
  enteredAt: string;
  /** Null while the deal is still in this stage. */
  leftAt: string | null;
  days: number;
  /** The reason recorded on the move into this stage - won and lost only. */
  reason: string | null;
  /** True for the leg the deal is on right now. */
  current: boolean;
}

const DAY = 86_400_000;

/**
 * Turn the recorded moves into the legs of a journey.
 *
 * Events arrive as transitions ("qualified -> proposal at 14:02") and what
 * anybody wants to read is durations ("Proposal, 12 days"). The two are not
 * the same shape, and doing the conversion in the component means doing it
 * differently in each component that needs it.
 *
 * Tolerant of the order they arrive in and of a backfilled history that
 * starts mid-journey, both of which are normal: every deal that existed
 * before the history table did has exactly one opening event.
 */
export function stageTimeline(
  events: { from_stage: string | null; to_stage: string; reason: string | null; changed_at: string }[],
  now = Date.now(),
): StageLeg[] {
  const ordered = [...events]
    .filter((e) => !!e.changed_at)
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at));
  if (ordered.length === 0) return [];

  const end = now;
  return ordered.map((e, i) => {
    const next = ordered[i + 1];
    const from = new Date(e.changed_at).getTime();
    const to = next ? new Date(next.changed_at).getTime() : end;
    return {
      stage: e.to_stage as DealStage,
      enteredAt: e.changed_at,
      leftAt: next ? next.changed_at : null,
      // Clamped at zero: clock skew between the app server and the database
      // can otherwise produce a leg that lasted minus one day.
      days: Math.max(0, Math.floor((to - from) / DAY)),
      // The reason describes the outcome the deal arrived at, so it belongs
      // to the leg it opened - not to the stage it left behind, which would
      // caption "Proposal" with "lost on price".
      reason: e.reason,
      current: !next,
    };
  });
}
