/* ═══════════════════════════════════════════════════════════════════════
   Days nothing goes out.

   A cold email that lands on Christmas morning is not read, it is resented,
   and by the time anybody is back at a desk it is twenty messages down. So
   an account keeps a list of closed days (Settings), a campaign can add a
   few of its own, and the sequence engine treats every one of them as a
   day with no send window at all - the same as a Sunday on a weekdays-only
   campaign - and rolls on to the next open day.

   Two shapes of entry, both plain strings so they survive JSON, a text[]
   column and a URL unchanged:

     YYYY-MM-DD   one day, once (a company offsite, a national election)
     MM-DD        that day every year (Christmas, New Year's Day)

   A day is read on the clock the send window is read on - the campaign's
   zone, or the recipient's when the campaign sends on their clock - so
   "the 25th" means the 25th where the email would be read.

   Pure: no I/O, so the sequence engine, the API and the settings page all
   agree on what a date means.
   ═══════════════════════════════════════════════════════════════════════ */

/** More than this is a list nobody is maintaining, and every window check reads it. */
export const MAX_BLACKOUT_DATES = 200;

export interface BlackoutPreset {
  /** Stored as-is: an annual MM-DD entry. */
  date: string;
  label: string;
}

/** The one-click set. Annual, because a holiday that only applies this year is not one. */
export const BLACKOUT_PRESETS: readonly BlackoutPreset[] = [
  { date: '12-24', label: 'Christmas Eve' },
  { date: '12-25', label: 'Christmas Day' },
  { date: '12-26', label: 'Boxing Day' },
  { date: '12-31', label: "New Year's Eve" },
  { date: '01-01', label: "New Year's Day" },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Days in a month, with 29 for February when no year is given - 29 Feb is a real annual entry. */
function daysIn(month: number, year?: number): number {
  if (month === 2) {
    if (year === undefined) return 29;
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * One entry in its stored form, or null when it is not a real date.
 *
 * Strict on purpose: "2026-02-30" saved without complaint would read as a
 * closed day that never comes, and the user would believe they were covered.
 */
export function normalizeBlackoutDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > daysIn(mo, y)) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = /^(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [mo, d] = [Number(m[1]), Number(m[2])];
    if (mo < 1 || mo > 12 || d < 1 || d > daysIn(mo)) return null;
    return `${pad(mo)}-${pad(d)}`;
  }
  return null;
}

/**
 * A whole list, cleaned: invalid entries dropped, duplicates removed,
 * sorted (annual first, then one-off by date) and capped.
 */
export function normalizeBlackoutDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const r of raw) {
    const n = normalizeBlackoutDate(r);
    if (n) out.add(n);
  }
  return [...out]
    .sort((a, b) => (a.length - b.length) || a.localeCompare(b))
    .slice(0, MAX_BLACKOUT_DATES);
}

/** The account's list and the campaign's own, as one. Either may be missing. */
export function mergeBlackoutDates(...lists: Array<readonly string[] | null | undefined>): string[] {
  return normalizeBlackoutDates(lists.flatMap((l) => (Array.isArray(l) ? l : [])));
}

/** Whether this local calendar day is closed. month is 1-12. */
export function isBlackoutDay(
  dates: readonly string[] | null | undefined,
  year: number,
  month: number,
  day: number,
): boolean {
  if (!dates || dates.length === 0) return false;
  const annual = `${pad(month)}-${pad(day)}`;
  const once = `${year}-${annual}`;
  return dates.includes(annual) || dates.includes(once);
}

/** "25 Dec, every year" / "3 Nov 2026" - and the preset name when it is one. */
export function describeBlackoutDate(date: string): string {
  const preset = BLACKOUT_PRESETS.find((p) => p.date === date);
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const day = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
  if (m[1]) return `${day} ${m[1]}`;
  return preset ? `${preset.label} (${day}, every year)` : `${day}, every year`;
}
