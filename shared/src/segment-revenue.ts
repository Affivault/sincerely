import { wilsonLowerBound } from './stats.js';

/* ═══════════════════════════════════════════════════════════════════════
   Which kinds of company actually close.

   The revenue report answers "which campaign earned money". It cannot
   answer the question that decides the next list: what do the people who
   BUY have in common? Industry, size, seniority, where they came from.
   That is the closed loop - outreach tells you who to go after next -
   and it is the one thing a two-product stack structurally cannot do,
   because the replies live in one company's database and the revenue in
   another's.

   It is also, by some distance, the easiest analysis in this product to
   get catastrophically wrong, and the way it goes wrong is not a bug:

   SLICE FORTY DEALS EIGHT WAYS AND SOMETHING WILL ALWAYS LOOK THREE
   TIMES BETTER. That is not a finding, it is arithmetic. With eight
   industries and a handful of wins, the top row is whichever segment got
   lucky, and a tool that presents it as "fintech closes at 6x your
   average" has just told somebody to rebuild their entire list around
   noise. They will, too - it is exactly the kind of insight people want
   to be true.

   So the rules here are strict, and most of them are refusals:

     A SEGMENT WITH TOO FEW CLOSED DEALS GETS NO WIN RATE. Not a
     cautious one, none. Won-of-closed over three deals is a coin flip
     with a percent sign.

     LIFT NEEDS BOTH SIDES TO CLEAR THE BAR. A confident segment
     compared against a baseline of nine deals is not a comparison.

     LIFT IS COMPUTED ON THE LOWER BOUND, NOT THE RATE. A segment at
     4-of-5 has a point estimate of 80% and could easily be 40%. Ranking
     on the optimistic reading puts small lucky segments on top, which is
     precisely the failure this module exists to prevent.

     THE MULTIPLE-COMPARISONS PROBLEM IS STATED, NOT HIDDEN. The caller
     is told how many segments were compared, because "best of twelve"
     and "best of two" are different claims.
   ═══════════════════════════════════════════════════════════════════════ */

/** Closed deals (won + lost) a segment needs before a win rate is reported. */
export const MIN_CLOSED_FOR_RATE = 8;

/** Contacts a segment needs before a reply rate is reported. */
export const MIN_REACHED_FOR_RATE = 30;

/** How far from the baseline counts as worth pointing at. */
export const LIFT_THRESHOLD = 1.3;

export type SegmentDimension = 'industry' | 'size' | 'location' | 'seniority' | 'source';

export const DIMENSION_LABELS: Record<SegmentDimension, string> = {
  industry: 'Industry',
  size: 'Company size',
  location: 'Location',
  seniority: 'Seniority',
  source: 'Where they came from',
};

/** One contact who was reached, and what happened. */
export interface SegmentMember {
  /** The bucket this contact falls in. Null when the attribute is unknown. */
  value: string | null;
  replied: boolean;
  /** Deals attributed to this contact's outreach. */
  won: number;
  lost: number;
  open: number;
  wonValue: number;
}

export interface SegmentRow {
  value: string;
  /** Contacts reached in this segment. */
  reached: number;
  replied: number;
  /** Reply rate, 0-1. Null below the sample floor. */
  replyRate: number | null;
  won: number;
  lost: number;
  open: number;
  closed: number;
  wonValue: number;
  /** Won of closed, 0-1. Null below the closed-deal floor. */
  winRate: number | null;
  /**
   * The lowest that win rate plausibly is, given the sample. This is what
   * the ranking uses - not the point estimate.
   */
  confidentWinRate: number | null;
  /**
   * How this segment compares to everything else, as a multiple. Null
   * unless both this segment and the baseline have enough behind them.
   */
  lift: number | null;
  /** Revenue per contact reached. The number that decides a list. */
  valuePerContact: number;
  /** Why there is no rate, when there is not. Never empty when null. */
  note: string;
}

export interface SegmentReport {
  dimension: SegmentDimension;
  rows: SegmentRow[];
  /** The account's own average, for comparison. */
  baseline: {
    reached: number;
    replied: number;
    won: number;
    lost: number;
    closed: number;
    wonValue: number;
    winRate: number | null;
    confidentWinRate: number | null;
  };
  /**
   * How many segments were compared to produce this.
   *
   * Reported because "best of twelve" and "best of two" are different
   * claims, and the reader is the only one who can weigh that.
   */
  compared: number;
  /** Contacts whose value for this attribute is unknown. */
  unknown: number;
  /** One sentence on whether any of this is worth acting on. */
  verdict: string;
}

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Group the people who were reached, and see who bought.
 *
 * Takes one row per contact rather than per deal, because the
 * denominator is the thing that makes this honest: "fintech won us
 * £80k" means nothing without "out of how many fintech contacts we
 * mailed".
 */
export function segmentRevenue(
  members: readonly SegmentMember[],
  dimension: SegmentDimension,
): SegmentReport {
  const buckets = new Map<string, SegmentMember[]>();
  let unknown = 0;

  for (const m of members) {
    const value = (m.value || '').trim();
    /*
     * Unknown is counted, never bucketed. Putting everything with a blank
     * industry into an "Other" row produces a big confident segment made
     * entirely of missing data, which then wins.
     */
    if (!value) { unknown++; continue; }
    buckets.set(value, [...(buckets.get(value) ?? []), m]);
  }

  const totals = members.reduce((acc, m) => ({
    reached: acc.reached + 1,
    replied: acc.replied + (m.replied ? 1 : 0),
    won: acc.won + m.won,
    lost: acc.lost + m.lost,
    wonValue: acc.wonValue + m.wonValue,
  }), { reached: 0, replied: 0, won: 0, lost: 0, wonValue: 0 });

  const baseClosed = totals.won + totals.lost;
  const baseWinRate = baseClosed >= MIN_CLOSED_FOR_RATE ? totals.won / baseClosed : null;
  const baseConfident = baseClosed >= MIN_CLOSED_FOR_RATE
    ? wilsonLowerBound(totals.won, baseClosed)
    : null;

  const rows: SegmentRow[] = [...buckets.entries()].map(([value, group]) => {
    const reached = group.length;
    const replied = group.filter((m) => m.replied).length;
    const won = group.reduce((n, m) => n + m.won, 0);
    const lost = group.reduce((n, m) => n + m.lost, 0);
    const open = group.reduce((n, m) => n + m.open, 0);
    const wonValue = group.reduce((n, m) => n + m.wonValue, 0);
    const closed = won + lost;

    const replyRate = reached >= MIN_REACHED_FOR_RATE ? round(replied / reached) : null;
    const winRate = closed >= MIN_CLOSED_FOR_RATE ? round(won / closed) : null;
    const confidentWinRate = closed >= MIN_CLOSED_FOR_RATE
      ? round(wilsonLowerBound(won, closed))
      : null;

    /*
     * Lift on the LOWER bound, and only when the baseline is solid too.
     *
     * A segment at four wins from five closed has a point estimate of 80%
     * and could comfortably be 40%. Ranking on the optimistic reading is
     * how a small lucky segment ends up at the top of a list somebody
     * then rebuilds their targeting around.
     */
    const lift = confidentWinRate != null && baseConfident != null && baseConfident > 0
      ? round(confidentWinRate / baseConfident, 2)
      : null;

    const note = closed < MIN_CLOSED_FOR_RATE
      ? `${closed} closed deal${closed === 1 ? '' : 's'} — needs ${MIN_CLOSED_FOR_RATE} before a win rate means anything.`
      : baseConfident == null
        ? `Not enough closed deals overall to compare against.`
        : '';

    return {
      value, reached, replied, replyRate,
      won, lost, open, closed, wonValue,
      winRate, confidentWinRate, lift,
      // Always computed: it needs no inference, it is just money divided
      // by people, and it is the number that actually decides a list.
      valuePerContact: reached > 0 ? round(wonValue / reached, 2) : 0,
      note,
    };
  });

  /*
   * Ranked by confident lift where there is one, then by revenue per
   * contact. A segment with no rate is not pushed to the bottom - it may
   * be earning well and simply not have closed enough to prove why.
   */
  rows.sort((a, b) => {
    if (a.lift != null && b.lift != null) return b.lift - a.lift;
    if (a.lift != null) return -1;
    if (b.lift != null) return 1;
    return b.valuePerContact - a.valuePerContact;
  });

  const withRate = rows.filter((r) => r.lift != null);
  const standout = withRate.find((r) => (r.lift ?? 0) >= LIFT_THRESHOLD);

  let verdict: string;
  if (rows.length === 0) {
    verdict = unknown > 0
      ? `Nothing to compare — none of the ${unknown} contacts reached has this recorded.`
      : 'Nothing to compare yet.';
  } else if (baseConfident == null) {
    verdict = `${baseClosed} closed deal${baseClosed === 1 ? '' : 's'} in total. This needs about ${MIN_CLOSED_FOR_RATE} before any segment can be compared to your average.`;
  } else if (withRate.length === 0) {
    verdict = `No single ${DIMENSION_LABELS[dimension].toLowerCase()} has closed ${MIN_CLOSED_FOR_RATE} deals yet, so the differences here are still noise.`;
  } else if (standout) {
    /*
     * Named, with the count it was picked from. "Best of twelve" and
     * "best of two" are different claims and only the reader can weigh
     * that - so the number is in the sentence rather than in a footnote.
     */
    verdict = `${standout.value} closes at ${standout.lift}x your average, out of ${withRate.length} ${DIMENSION_LABELS[dimension].toLowerCase()} group${withRate.length === 1 ? '' : 's'} with enough deals to compare.`;
  } else {
    verdict = `Nothing here is far enough from your average to act on — ${withRate.length} group${withRate.length === 1 ? '' : 's'} compared.`;
  }

  return {
    dimension,
    rows,
    baseline: {
      reached: totals.reached,
      replied: totals.replied,
      won: totals.won,
      lost: totals.lost,
      closed: baseClosed,
      wonValue: totals.wonValue,
      winRate: baseWinRate != null ? round(baseWinRate) : null,
      confidentWinRate: baseConfident != null ? round(baseConfident) : null,
    },
    compared: withRate.length,
    unknown,
    verdict,
  };
}

/* ── Turning a job title into something you can group by ──────────────── */

const SENIORITY_RULES: Array<[RegExp, string]> = [
  [/\b(ceo|founder|co-?founder|owner|proprietor|managing director|president)\b/i, 'Founder / CEO'],
  [/\b(c[a-z]o|chief)\b/i, 'C-level'],
  [/\b(vp|vice president|svp|evp)\b/i, 'VP'],
  [/\b(head of|director)\b/i, 'Director / Head'],
  [/\b(manager|lead|principal)\b/i, 'Manager'],
];

/**
 * Roughly how senior a job title is.
 *
 * Deliberately coarse and deliberately fallible. The alternative was to
 * group by the raw title, which produces four hundred segments of one
 * person each and no comparison at all.
 *
 * Returns null rather than guessing when nothing matches, so unrecognised
 * titles are counted as unknown instead of being swept into an "Other"
 * bucket that then looks like a real segment.
 */
export function seniorityOf(title: string | null | undefined): string | null {
  const t = (title || '').trim();
  if (!t) return null;
  for (const [re, label] of SENIORITY_RULES) if (re.test(t)) return label;
  return null;
}

/**
 * Company headcount, bucketed.
 *
 * Accepts the shapes a size field actually arrives in - "50-200", "1000+",
 * "11 to 50", a bare number - because it is typed by hand and imported
 * from half a dozen providers.
 */
export function sizeBandOf(size: string | null | undefined): string | null {
  const raw = (size || '').trim();
  if (!raw) return null;

  const numbers = raw.match(/\d[\d,]*/g)?.map((n) => Number(n.replace(/,/g, ''))) ?? [];
  if (numbers.length === 0) return null;

  // The lower end of a range is what places it: "50-200" is a mid-market
  // company, not an enterprise one.
  let n = Math.min(...numbers);
  if (!Number.isFinite(n)) return null;

  /*
   * A trailing plus is an open-ended floor, not a value.
   *
   * "1000+" means a thousand or more, and banding it on the number alone
   * put it in 201-1000 - the band it is explicitly above. The largest
   * companies in the list would have been filed as mid-market, which is
   * the one bucket a size segment exists to tell apart.
   */
  if (/\+\s*$/.test(raw)) n += 1;

  if (n < 11) return '1-10';
  if (n < 51) return '11-50';
  if (n < 201) return '51-200';
  if (n < 1001) return '201-1000';
  return '1000+';
}
