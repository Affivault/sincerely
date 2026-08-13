/* Small statistics helpers, kept separate from the service so they can be
   exercised directly — a significance test nobody can run is a significance
   test nobody should trust. */

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation.
 * Absolute error < 1.5e-7, which is far finer than any decision made on it.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t * t
    * Math.exp(-x * x) - 0.254829592 * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Two-proportion z-test: how likely is a gap this large if the two variants
 * were really the same? Returns a two-sided p-value, or null when either arm
 * is empty or nothing varies at all (both all-hit or both all-miss).
 */
export function twoProportionPValue(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  if (pooled <= 0 || pooled >= 1) return null;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  const z = (p2 - p1) / se;
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

/**
 * Lower bound of the Wilson score interval for a proportion.
 *
 * The honest way to ask "is this rate genuinely above X?" on a small sample.
 * A naive `bounced / sent > threshold` trips on two bounces out of three —
 * 67%, and meaningless — which would pause a campaign on its third send and
 * teach everyone to switch the protection off. This asks instead: given what
 * we have seen, what is the *lowest* the true rate plausibly is? Only when
 * even that pessimistic reading is above the threshold is there something
 * worth stopping a campaign for.
 *
 * Wilson rather than the textbook normal interval because the normal one is
 * badly behaved exactly where this operates — few trials, proportions near
 * zero — and can return a negative lower bound.
 *
 * @param successes  Events of interest (here: bounces).
 * @param trials     Total observations (here: sends).
 * @param z          Standard score. 1.96 = 95% two-sided, the default.
 */
export function wilsonLowerBound(successes: number, trials: number, z = 1.96): number {
  if (trials <= 0) return 0;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return Math.max(0, (centre - spread) / denominator);
}

/**
 * The other end of the same interval: the highest the true rate plausibly is.
 *
 * The lower bound answers "is this genuinely good?". This answers "is this
 * genuinely bad?" — which is the question worth asking before telling someone
 * to delete a step of their sequence. Zero replies out of forty is not proof
 * a step is worthless; it is proof the rate is below about 7%, and whether
 * that matters depends on what the rest of the campaign manages.
 *
 * With zero successes this reduces to roughly the rule of three (3/n), which
 * is the same answer arrived at honestly.
 */
export function wilsonUpperBound(successes: number, trials: number, z = 1.96): number {
  if (trials <= 0) return 1;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return Math.min(1, (centre + spread) / denominator);
}
