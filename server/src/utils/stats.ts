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
