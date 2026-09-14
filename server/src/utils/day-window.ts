/**
 * How many days back a report should look, from a query string.
 *
 * `?days=` reaches four endpoints and each one parsed it slightly
 * differently. Two of them used `parseInt(...)` with no fallback, and the
 * result was wrong in three ways that all failed silently:
 *
 *   ?days=abc  NaN is falsy, so the service skipped its date filter and
 *              reported all-time figures for a request that asked for a
 *              window. Nothing on the page said so.
 *   ?days=-5   a cutoff five days into the FUTURE, so every count came back
 *              zero and the dashboard read as "nothing has happened".
 *   ?days=0    falsy again, so the same as abc rather than "today".
 *
 * None of these throw, which is what makes them worth fixing: a report that
 * is confidently wrong is worse than one that refuses.
 *
 * Returns undefined only when nothing was asked for, so callers keep their
 * existing "no window means all time" behaviour for an absent parameter.
 */
export function parseDayWindow(raw: unknown, fallback?: number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return fallback;

  const n = Number(raw);
  // Anything that is not a real number is treated as not asked for, rather
  // than as "all time" — the caller's own default is the honest answer.
  if (!Number.isFinite(n)) return fallback;

  const whole = Math.floor(n);
  if (whole < 1) return fallback;

  // Ten years. Beyond this the window stops meaning anything and only costs
  // the database a wider scan.
  return Math.min(whole, 3650);
}
