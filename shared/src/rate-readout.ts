/* ═══════════════════════════════════════════════════════════════════════
   A percentage nobody has earned yet.

   "16.7% reply rate" is two replies out of twelve. On a card it is set in
   the same weight, the same colour and the same tabular figures as 16.7%
   off twelve thousand, and it is read the same way - as a fact about the
   campaign rather than about two emails. One more reply takes it to 25%
   and somebody concludes the subject line is working.

   Analytics already refuses to do this. The step table calls a step
   `too_early` below a sample it can read, the A/B panel will not name a
   winner under thirty each, and the bounce guard judges on the lower bound
   of a Wilson interval rather than the raw rate. The dashboard and the
   campaign list were never taught the same manners: they divide and
   render, at any sample size, including zero.

   The fix is not a disclaimer. Below the threshold the rate is simply not
   the honest readout, and the counts are - "2 of 12" is the same width,
   carries strictly more information, and cannot be misread as a trend.
   Above it, the percentage is what you want and you get it.

   Decisions, not formatting: what to show and why, as plain values that
   can be asserted directly.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Sends below which a rate is not reported as a rate.
 *
 * Deliberately not the same number as MIN_STEP_SENDS (25), and the
 * difference is the point rather than an oversight. A step is judged
 * against the other steps of its own campaign - a relative comparison,
 * where a modest sample still separates a step earning replies from one
 * that is not. A bare percentage on a card has nothing to be relative to:
 * it is read as an absolute claim about the campaign, so it needs more
 * behind it before it is allowed to be one.
 */
export const MIN_RATE_SAMPLE = 30;

export type RateKind =
  /** Nothing has been sent, so there is no rate and no counts worth showing. */
  | 'none'
  /** Something has been sent, but too little to read a rate into. */
  | 'early'
  /** Enough to report as a percentage. */
  | 'measured';

export interface RateReadout {
  kind: RateKind;
  /**
   * What to put where the percentage went. "—", "2 of 12", or "16.7%".
   * Never a percentage the sample cannot support.
   */
  label: string;
  /** One line for a tooltip or a line of small text. Never empty. */
  hint: string;
  /** The raw rate, 0-1, or null when there is nothing to divide. */
  rate: number | null;
  /** True when the label is a percentage, for anything that styles it. */
  isRate: boolean;
}

/**
 * How to show a rate, given what it was computed from.
 *
 * @param part the numerator - replies, opens, bounces
 * @param whole the denominator - emails sent
 * @param noun what the numerator counts, for the hint: "replies", "opens"
 */
export function rateReadout(
  part: number | null | undefined,
  whole: number | null | undefined,
  noun = 'results',
  minSample = MIN_RATE_SAMPLE,
): RateReadout {
  const n = Math.max(0, Math.round(Number(part) || 0));
  const d = Math.max(0, Math.round(Number(whole) || 0));

  if (d <= 0) {
    return {
      kind: 'none',
      label: '—',
      hint: `Nothing sent yet, so there is no ${noun.replace(/s$/, '')} rate to show.`,
      rate: null,
      isRate: false,
    };
  }

  const rate = n / d;

  if (d < minSample) {
    /*
     * The counts, not the percentage. Same width, strictly more
     * information, and impossible to read as a trend - which is the whole
     * problem with rendering 16.7% over twelve sends.
     */
    return {
      kind: 'early',
      label: `${n} of ${d}`,
      hint: `${d} sent so far. A rate needs about ${minSample} before it means anything.`,
      rate,
      isRate: false,
    };
  }

  return {
    kind: 'measured',
    label: formatRate(rate),
    hint: `${n.toLocaleString()} of ${d.toLocaleString()} ${noun}.`,
    rate,
    isRate: true,
  };
}

/**
 * The same decision when only a rate survived the trip.
 *
 * Some endpoints hand back an average rate with no denominator attached -
 * the dashboard's headline figures are averages across campaigns. The
 * denominator there is the total sent, which is the right thing to judge
 * on: an average of rates computed from nothing is still nothing.
 */
export function averageRateReadout(
  rate: number | null | undefined,
  totalSent: number | null | undefined,
  noun = 'sends',
  minSample = MIN_RATE_SAMPLE,
): RateReadout {
  const d = Math.max(0, Math.round(Number(totalSent) || 0));
  const r = Number(rate);
  const safe = Number.isFinite(r) ? Math.max(0, r) : 0;

  if (d <= 0) {
    return {
      kind: 'none',
      label: '—',
      hint: 'Nothing sent yet, so there is nothing to average.',
      rate: null,
      isRate: false,
    };
  }

  if (d < minSample) {
    return {
      kind: 'early',
      // No counts to fall back on here, so it says what it is: a figure
      // over a sample too small to carry it.
      label: 'Too early',
      hint: `Only ${d.toLocaleString()} ${noun} so far. A rate needs about ${minSample} before it means anything.`,
      rate: safe,
      isRate: false,
    };
  }

  return {
    kind: 'measured',
    label: formatRate(safe),
    hint: `Across ${d.toLocaleString()} ${noun}.`,
    rate: safe,
    isRate: true,
  };
}

/**
 * A rate as a percentage.
 *
 * One decimal below 10%, none above - a reply rate moving from 3.2% to
 * 4.1% is the news, whereas 61.4% versus 61% is noise dressed as detail.
 * Accepts either 0-1 or 0-100, because the API returns both depending on
 * the endpoint and getting it wrong shows 1600%.
 */
export function formatRate(rate: number): string {
  const pct = rate > 1 ? rate : rate * 100;
  if (!Number.isFinite(pct)) return '—';
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/**
 * How wide a bar should be drawn for a rate, or null for no bar at all.
 *
 * A bar is a claim about magnitude, so it has exactly the same problem as
 * the number - and worse, because a bar cannot carry a caveat. Below the
 * threshold there is no bar, rather than a short one that reads as "doing
 * badly" when it means "we do not know yet".
 */
export function rateBarWidth(readout: RateReadout, fullScaleRate = 0.25): number | null {
  if (readout.kind !== 'measured' || readout.rate == null) return null;
  const scale = fullScaleRate > 0 ? fullScaleRate : 0.25;
  return Math.max(0, Math.min(100, (readout.rate / scale) * 100));
}
