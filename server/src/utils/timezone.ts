/**
 * Timezone helpers built on Intl.DateTimeFormat for robust DST handling.
 *
 * The naive pattern `new Date(new Date().toLocaleString('en-US', { timeZone: tz }))`
 * is widely used but has two real problems:
 *   1. The string format produced by toLocaleString is implementation-defined
 *      and is parsed in the **system** timezone, not UTC.
 *   2. Computing the UTC instant of midnight in `tz` from the *current* offset
 *      gives the wrong answer on a DST transition day, because midnight and
 *      now can be on opposite sides of the transition (offset differs by 1h).
 *
 * These helpers use Intl.DateTimeFormat which exposes the correct offset for
 * any instant in any timezone.
 */

interface TzParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
}

function getParts(date: Date, tz: string): TzParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  let hour = parseInt(lookup.hour, 10);
  if (hour === 24) hour = 0; // Some engines return "24" for midnight with hour12:false
  return {
    year: parseInt(lookup.year, 10),
    month: parseInt(lookup.month, 10),
    day: parseInt(lookup.day, 10),
    hour,
    minute: parseInt(lookup.minute, 10),
    weekday: weekdayMap[lookup.weekday] ?? 0,
  };
}

/**
 * Get the UTC offset, in milliseconds, of `tz` at the given instant.
 * Positive means `tz` is ahead of UTC (e.g. Tokyo = +9h).
 */
function getTimezoneOffsetMs(date: Date, tz: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  });
  const parts = formatter.formatToParts(date);
  const offsetName = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  // longOffset returns "GMT", "GMT+05:30", "GMT-04:00", etc.
  if (offsetName === 'GMT' || offsetName === 'UTC') return 0;
  const m = offsetName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  const hours = parseInt(m[2], 10);
  const minutes = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + minutes) * 60_000;
}

/**
 * Get the calendar parts of "now" in the given timezone.
 * Use these to compare against business-hour windows or weekdays.
 */
export function nowInTimezone(tz: string): TzParts {
  return partsInTimezone(new Date(), tz);
}

/**
 * Get the calendar parts of the given instant interpreted in `tz`.
 */
export function partsInTimezone(date: Date, tz: string): TzParts {
  try {
    return getParts(date, tz);
  } catch {
    return getParts(date, 'UTC');
  }
}

/**
 * Return the UTC Date corresponding to midnight (00:00:00.000) on "today" in
 * the given timezone. Correctly handles DST: uses the offset that applies
 * at midnight in `tz`, not the offset at the current moment.
 */
export function startOfDayInTimezone(tz: string): Date {
  try {
    const parts = getParts(new Date(), tz);
    return tzWallTimeToUtc(parts.year, parts.month, parts.day, 0, 0, tz);
  } catch {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}

/**
 * Convert a wall-clock time in `tz` to its UTC instant.
 * Iterates twice to handle ambiguity at DST transitions.
 */
export function tzWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  // First pass: assume UTC, then subtract the offset at that nominal moment.
  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offset1 = getTimezoneOffsetMs(new Date(nominalUtc), tz);
  const guess = new Date(nominalUtc - offset1);
  // Second pass: re-check the offset at the guessed instant (handles
  // crossings of DST boundaries).
  const offset2 = getTimezoneOffsetMs(guess, tz);
  if (offset1 === offset2) return guess;
  return new Date(nominalUtc - offset2);
}
