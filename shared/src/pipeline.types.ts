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

/**
 * Total days spent in each stage, summed across every visit.
 *
 * A deal that is pushed back from Proposal to Qualified and works its way
 * forward again has been in Qualified twice, and the honest answer to "how
 * long did qualification take" is both visits added together. Reporting
 * only the latest would make a deal that has been round the loop three
 * times look like the fastest one on the board.
 */
export function daysByStage(
  events: { from_stage: string | null; to_stage: string; reason: string | null; changed_at: string }[],
  now = Date.now(),
): Partial<Record<DealStage, number>> {
  const out: Partial<Record<DealStage, number>> = {};
  for (const leg of stageTimeline(events, now)) {
    out[leg.stage] = (out[leg.stage] ?? 0) + leg.days;
  }
  return out;
}

/* ─── What happens next ───────────────────────────────────────────────── */

/**
 * Whether this deal has a next step booked.
 *
 * The one habit that separates pipelines that close from pipelines that
 * rot: every live deal should have something scheduled against it. A deal
 * with no next step is not "fine for now", it is a deal nobody has decided
 * what to do with, and it will be found again in six weeks when somebody
 * asks why the quarter is short.
 *
 * Only open deals are judged. Chasing a won deal for a next step is noise.
 */
export interface NextStep {
  /** The soonest future task or meeting, whichever comes first. */
  at: string | null;
  kind: 'activity' | 'meeting' | null;
  title: string | null;
  /** True when an open deal has nothing booked at all. */
  missing: boolean;
  /** True when the only thing outstanding is already past its date. */
  overdue: boolean;
}

export function nextStep(
  deal: Pick<Deal, 'stage'>,
  tasks: { title: string; due_date: string | null; is_done: boolean }[],
  events: { title: string; starts_at: string }[],
  now = Date.now(),
): NextStep {
  if (!isOpen(deal.stage)) {
    return { at: null, kind: null, title: null, missing: false, overdue: false };
  }

  const candidates: { at: number; iso: string; kind: 'activity' | 'meeting'; title: string }[] = [];
  for (const t of tasks) {
    if (t.is_done || !t.due_date) continue;
    const at = new Date(t.due_date).getTime();
    if (Number.isFinite(at)) candidates.push({ at, iso: t.due_date, kind: 'activity', title: t.title });
  }
  for (const e of events) {
    const at = new Date(e.starts_at).getTime();
    if (Number.isFinite(at)) candidates.push({ at, iso: e.starts_at, kind: 'meeting', title: e.title });
  }

  if (candidates.length === 0) {
    return { at: null, kind: null, title: null, missing: true, overdue: false };
  }

  candidates.sort((a, b) => a.at - b.at);
  // The soonest thing still ahead is the next step. If everything is behind
  // us, the most recent overdue item is what needs dealing with — which is
  // not the same as having nothing booked, and must not read as if it were.
  const ahead = candidates.find((c) => c.at >= now);
  const chosen = ahead ?? candidates[candidates.length - 1];
  return {
    at: chosen.iso,
    kind: chosen.kind,
    title: chosen.title,
    missing: false,
    overdue: !ahead,
  };
}

/* ─── What a B2B deal is worth ────────────────────────────────────────── */

/**
 * The commercial shape of a deal.
 *
 * A single "value" is close to meaningless in B2B. 60k of retainer on a
 * three year term and 60k of one-off project work are not the same deal:
 * one is 20k a year of revenue you can plan on, the other is a number that
 * happens once and then is gone. Adding them together in a forecast, as a
 * single value field forces you to, is how a pipeline ends up describing a
 * business nobody recognises.
 *
 * So the parts are recorded and the totals are derived. Nobody has to agree
 * on what "value" meant when they typed it.
 */
export type RecurringPeriod = 'month' | 'quarter' | 'year';

export interface DealEconomics {
  recurring_amount?: number | null;
  recurring_period?: RecurringPeriod | string | null;
  one_off_amount?: number | null;
  term_months?: number | null;
}

/** How many months one billing period covers. */
const PERIOD_MONTHS: Record<RecurringPeriod, number> = {
  month: 1,
  quarter: 3,
  year: 12,
};

/** A number if it really is one, otherwise null. Empty strings are not zero. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The default term when nobody has said.
 *
 * Twelve months, because an annual commitment is the ordinary shape of a
 * B2B agreement and because the alternative — treating an unstated term as
 * infinite, or as one month — produces a total contract value that is
 * either absurd or an obvious undercount. Stated separately from the deal
 * so the UI can say "assuming 12 months" rather than pretending to know.
 */
export const DEFAULT_TERM_MONTHS = 12;

/** True once anybody has described the shape of this deal at all. */
export function hasEconomics(deal: DealEconomics): boolean {
  return num(deal.recurring_amount) !== null
    || num(deal.one_off_amount) !== null
    || num(deal.term_months) !== null;
}

/**
 * The recurring part, normalised to a month.
 *
 * People quote what they quote — monthly retainers, quarterly licences,
 * annual contracts — and every one of those has to become the same unit
 * before two deals can be compared or added.
 */
export function monthlyRecurring(deal: DealEconomics): number {
  const amount = num(deal.recurring_amount);
  if (amount === null || amount <= 0) return 0;
  const period = (deal.recurring_period || 'month') as RecurringPeriod;
  const months = PERIOD_MONTHS[period] ?? 1;
  return amount / months;
}

/** Annual recurring revenue: the number a B2B business is actually run on. */
export function annualRecurring(deal: DealEconomics): number {
  return monthlyRecurring(deal) * 12;
}

/** The term actually agreed, or the stated assumption when there isn't one. */
export function termMonths(deal: DealEconomics): number {
  const t = num(deal.term_months);
  return t !== null && t > 0 ? t : DEFAULT_TERM_MONTHS;
}

/**
 * Everything this deal is worth across its whole term.
 *
 * Recurring over the term, plus whatever one-off sits on top. This is the
 * figure that belongs in a pipeline total, because it is the only one that
 * puts a retainer and a project side by side without flattering either.
 */
export function totalContractValue(deal: DealEconomics): number {
  const oneOff = num(deal.one_off_amount) ?? 0;
  return monthlyRecurring(deal) * termMonths(deal) + Math.max(0, oneOff);
}

/**
 * The number every existing total should use.
 *
 * Deals described the new way get their computed total; deals that only
 * ever had a single figure keep it. Without this the board, the forecast
 * and every column sum would disagree with the deal page.
 */
export function dealValue(deal: DealEconomics & { value?: number | null }): number {
  if (hasEconomics(deal)) return totalContractValue(deal);
  return num(deal.value) ?? 0;
}

export interface RevenueSplit {
  /** Recurring revenue across the term. */
  recurring: number;
  /** One-off fees. */
  oneOff: number;
  /** Annualised recurring — new ARR, if this deal closes. */
  arr: number;
  mrr: number;
  months: number;
  /** True when the term is an assumption rather than something agreed. */
  termAssumed: boolean;
}

/** The whole shape of one deal, for a page that wants to show its parts. */
export function revenueSplit(deal: DealEconomics): RevenueSplit {
  const mrr = monthlyRecurring(deal);
  const months = termMonths(deal);
  return {
    recurring: mrr * months,
    oneOff: Math.max(0, num(deal.one_off_amount) ?? 0),
    arr: mrr * 12,
    mrr,
    months,
    termAssumed: num(deal.term_months) === null,
  };
}

/**
 * New ARR sitting in the open pipeline, raw and weighted.
 *
 * Deliberately separate from the pipeline total. Total contract value tells
 * you the size of what you are working on; new ARR tells you what the
 * business looks like afterwards, and a quarter can be strong on one and
 * weak on the other. Deals with no recurring part contribute nothing here,
 * which is correct and is the point.
 */
export function pipelineArr(deals: (Deal & DealEconomics)[]): { open: number; weighted: number } {
  let open = 0;
  let weighted = 0;
  for (const deal of deals) {
    if (!isOpen(deal.stage)) continue;
    const arr = annualRecurring(deal);
    if (arr <= 0) continue;
    open += arr;
    weighted += (arr * probabilityOf(deal)) / 100;
  }
  return { open, weighted };
}

/* ─── Why deals end the way they do ───────────────────────────────────── */

/**
 * Where deals die.
 *
 * The stage a deal was in when it was marked lost is the single most
 * actionable fact a pipeline holds, and until the history table existed it
 * was unrecoverable: once the deal moved to lost, whatever it had been
 * doing before was overwritten. "We lose sixty percent of everything that
 * reaches proposal" is a problem you can go and fix. "We lost a lot of
 * deals" is not.
 */
export interface StageOutcome {
  stage: DealStage;
  won: number;
  lost: number;
  /** Won over won-plus-lost, as a percentage. Null when nothing has closed here. */
  winRate: number | null;
  /** Value lost from this stage, at the value the deal carried. */
  lostValue: number;
  wonValue: number;
}

/** The stage a deal was in immediately before it closed, if it is closed. */
export function stageBeforeClose(
  events: { from_stage: string | null; to_stage: string; changed_at: string }[],
): DealStage | null {
  const closing = [...events]
    .filter((e) => (e.to_stage === 'won' || e.to_stage === 'lost') && !!e.changed_at)
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at))
    .pop();
  if (!closing) return null;
  // A deal created directly as won or lost has no prior stage. Attributing
  // it to "lead" would invent a journey it never took.
  return (closing.from_stage as DealStage) || null;
}

/**
 * Win and loss counts per stage, for deals whose history says where they
 * were when they closed.
 *
 * Deals with no recorded prior stage are skipped rather than bucketed
 * somewhere convenient — a backfilled deal that closed before this was
 * recorded genuinely does not have an answer, and a made-up one would
 * quietly move the percentages that the whole exercise is about.
 */
export function outcomesByStage(
  deals: (Pick<Deal, 'id' | 'stage' | 'value'> & DealEconomics)[],
  historyByDeal: Record<string, { from_stage: string | null; to_stage: string; changed_at: string }[]>,
): StageOutcome[] {
  const rows: Record<string, StageOutcome> = {};
  for (const stage of OPEN_STAGES) {
    rows[stage] = { stage, won: 0, lost: 0, winRate: null, lostValue: 0, wonValue: 0 };
  }

  for (const deal of deals) {
    if (deal.stage !== 'won' && deal.stage !== 'lost') continue;
    const from = stageBeforeClose(historyByDeal[deal.id] || []);
    if (!from || !rows[from]) continue;
    const value = dealValue(deal);
    if (deal.stage === 'won') { rows[from].won += 1; rows[from].wonValue += value; }
    else { rows[from].lost += 1; rows[from].lostValue += value; }
  }

  for (const row of Object.values(rows)) {
    const closed = row.won + row.lost;
    row.winRate = closed > 0 ? Math.round((row.won / closed) * 100) : null;
  }
  return OPEN_STAGES.map((s) => rows[s]);
}

export interface ReasonCount {
  reason: string;
  count: number;
  value: number;
}

/** Outcome reasons, most common first. Unexplained closes are excluded. */
export function reasonBreakdown(
  deals: (Pick<Deal, 'stage' | 'value' | 'outcome_reason'> & DealEconomics)[],
  outcome: 'won' | 'lost',
): ReasonCount[] {
  const counts: Record<string, ReasonCount> = {};
  for (const deal of deals) {
    if (deal.stage !== outcome) continue;
    const reason = deal.outcome_reason?.trim();
    if (!reason) continue;
    if (!counts[reason]) counts[reason] = { reason, count: 0, value: 0 };
    counts[reason].count += 1;
    counts[reason].value += dealValue(deal);
  }
  return Object.values(counts).sort((a, b) => b.count - a.count || b.value - a.value);
}

export interface SourcePerformance {
  source: string;
  won: number;
  lost: number;
  open: number;
  winRate: number | null;
  wonValue: number;
  /** New ARR won from this source. */
  wonArr: number;
}

/**
 * How each source actually performs once deals close.
 *
 * Volume by source is easy and misleading: the channel that produces the
 * most deals is regularly the one that produces the least revenue. This
 * pairs the count with what came of it.
 */
export function performanceBySource(
  deals: (Pick<Deal, 'stage' | 'value' | 'source'> & DealEconomics)[],
): SourcePerformance[] {
  const rows: Record<string, SourcePerformance> = {};
  for (const deal of deals) {
    const source = deal.source?.trim() || 'Unattributed';
    if (!rows[source]) {
      rows[source] = { source, won: 0, lost: 0, open: 0, winRate: null, wonValue: 0, wonArr: 0 };
    }
    const row = rows[source];
    if (deal.stage === 'won') {
      row.won += 1;
      row.wonValue += dealValue(deal);
      row.wonArr += annualRecurring(deal);
    } else if (deal.stage === 'lost') {
      row.lost += 1;
    } else {
      row.open += 1;
    }
  }
  for (const row of Object.values(rows)) {
    const closed = row.won + row.lost;
    row.winRate = closed > 0 ? Math.round((row.won / closed) * 100) : null;
  }
  return Object.values(rows).sort((a, b) => b.wonValue - a.wonValue || b.won - a.won);
}

/**
 * Median days spent in each stage, across deals that have left it.
 *
 * Median rather than mean on purpose. One deal that sat in qualification
 * for two years drags a mean far enough to make the number useless for
 * planning, and that deal is always in the data.
 */
export function medianDaysPerStage(
  historyByDeal: Record<string, { from_stage: string | null; to_stage: string; reason: string | null; changed_at: string }[]>,
  now = Date.now(),
): Partial<Record<DealStage, number>> {
  const samples: Partial<Record<DealStage, number[]>> = {};
  for (const events of Object.values(historyByDeal)) {
    for (const leg of stageTimeline(events, now)) {
      // Only completed legs: a deal still sitting in proposal has not yet
      // told you how long proposal takes, and counting it as though it had
      // biases every figure downwards.
      if (leg.current) continue;
      (samples[leg.stage] ||= []).push(leg.days);
    }
  }

  const out: Partial<Record<DealStage, number>> = {};
  for (const [stage, days] of Object.entries(samples) as [DealStage, number[]][]) {
    if (!days.length) continue;
    const sorted = [...days].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    out[stage] = sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }
  return out;
}
