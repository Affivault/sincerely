/**
 * Convert a wall-clock time to its UTC instant in a given IANA timezone.
 * Mirrors server/src/utils/timezone.ts so client-entered times (e.g. a
 * campaign's scheduled start) resolve against the *campaign's* timezone
 * instead of the browser's local timezone.
 */

function getTimezoneOffsetMs(date: Date, tz: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  });
  const parts = formatter.formatToParts(date);
  const offsetName = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  if (offsetName === 'GMT' || offsetName === 'UTC') return 0;
  const m = offsetName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  const hours = parseInt(m[2], 10);
  const minutes = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + minutes) * 60_000;
}

/**
 * Convert a wall-clock date/time in `tz` to its UTC instant.
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
  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  try {
    const offset1 = getTimezoneOffsetMs(new Date(nominalUtc), tz);
    const guess = new Date(nominalUtc - offset1);
    const offset2 = getTimezoneOffsetMs(guess, tz);
    if (offset1 === offset2) return guess;
    return new Date(nominalUtc - offset2);
  } catch {
    return new Date(nominalUtc);
  }
}

/**
 * Parse a `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm") as wall-clock
 * time in `tz`, returning the corresponding UTC instant. Falls back to the
 * browser-local `new Date(value)` parse if `value` doesn't match the expected shape.
 */
export function parseDatetimeLocalInTimezone(value: string, tz: string): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date(value);
  const [, y, mo, d, h, mi] = m;
  return tzWallTimeToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), tz || 'UTC');
}
