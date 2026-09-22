/* ═══════════════════════════════════════════════════════════════════════
   One way to write a date down.

   MEASURED BEFORE THIS LANDED: 57 date and time formatting calls, in 21
   distinct spellings, and the same logical format written two different
   ways:

       toLocaleDateString('en-US',   { month: 'short', day: 'numeric' })   x13
       toLocaleDateString(undefined, { day: 'numeric', month: 'short' })   x3

   Those are the same intent. They are not the same output. The first is
   locked to American order and says "Jan 5" to everybody on earth; the
   second follows the reader and says "5 Jan" in London. Both are in this
   app, on adjacent screens, describing the same kind of value. Four more
   calls passed no options at all and rendered the raw browser default -
   "05/01/2026, 14:30:00", seconds and all.

   Nobody decided any of this. It accumulated, exactly like the thirty-one
   font sizes did.

   THE RULE: EXPLICIT OPTIONS, NEVER AN EXPLICIT LOCALE.

   Those are two halves of one idea. Explicit options fix the SHAPE - what
   fields appear, and that seconds never do. Leaving the locale undefined
   lets the reader's own conventions decide the ORDER, so an American sees
   "Jan 5, 2026" and a Londoner sees "5 Jan 2026" from this one function.
   Hardcoding 'en-US' does not make a format consistent; it makes it
   consistently wrong for everybody outside one country.

   Named by role rather than by shape, so a call site says what the date
   IS rather than how to spell it - and so the spelling can change in one
   place later.
   ═══════════════════════════════════════════════════════════════════════ */

/** Anything a date can arrive as, including the ways it can arrive broken. */
export type DateLike = Date | string | number | null | undefined;

/**
 * A usable Date, or null.
 *
 * Every helper here goes through this, because a date that is absent and
 * a date that is malformed both reach the UI constantly - a nullable
 * timestamp column, an API that returned '' - and `new Date(null)` is the
 * 1st of January 1970 rather than an error. Printing 1970 is worse than
 * printing nothing: it looks like data.
 */
function toDate(value: DateLike): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * What every helper shows when there is nothing to show.
 *
 * An em dash, not a blank. A missing date rendered as nothing reads as a
 * rendering fault - the label is there, the value is not - whereas a dash
 * says plainly that there isn't one. It is also what the two wrappers this
 * replaced already did, so the screens importing them are unchanged.
 */
const NOTHING = '\u2014';

function fmt(value: DateLike, options: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  if (!d) return NOTHING;
  // Locale deliberately undefined: see the note above. This is the only
  // place in the app that calls toLocaleDateString, and the only reason
  // that is enforceable is that it is the only place that needs to.
  return d.toLocaleDateString(undefined, options);
}

/* ── Dates ────────────────────────────────────────────────────────────── */

/** `5 Jan` — within the current year, where the year is noise. */
export function formatDayMonth(value: DateLike): string {
  return fmt(value, { day: 'numeric', month: 'short' });
}

/** `5 Jan 2026` — the default for anything that might not be this year. */
export function formatDate(value: DateLike): string {
  return fmt(value, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** `5 January 2026` — for somewhere a date is the subject, not a label. */
export function formatLongDate(value: DateLike): string {
  return fmt(value, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** `Mon 5 Jan` — a calendar column header. */
export function formatWeekdayDate(value: DateLike): string {
  return fmt(value, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** `Monday 5 January` — a day being announced rather than listed. */
export function formatLongWeekdayDate(value: DateLike): string {
  return fmt(value, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** `Monday 5 January 2026`. */
export function formatFullDate(value: DateLike): string {
  return fmt(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** `Monday`. */
export function formatWeekday(value: DateLike): string {
  return fmt(value, { weekday: 'long' });
}

/** `Mon`. */
export function formatWeekdayShort(value: DateLike): string {
  return fmt(value, { weekday: 'short' });
}

/** `January 2026` — a month being used as a heading. */
export function formatMonthYear(value: DateLike): string {
  return fmt(value, { month: 'long', year: 'numeric' });
}

/** `5` — the number in a calendar cell. */
export function formatDayOfMonth(value: DateLike): string {
  return fmt(value, { day: 'numeric' });
}

/* ── Times ────────────────────────────────────────────────────────────── */

/**
 * `14:30`, or `2:30 pm` for a reader whose clock works that way.
 *
 * Minutes always two digits, seconds never. A send time with seconds on
 * it implies a precision the scheduler does not have.
 */
export function formatTime(value: DateLike): string {
  const d = toDate(value);
  if (!d) return NOTHING;
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** `14:00` — the top of an hour, where minutes would be noise. */
export function formatHour(value: DateLike): string {
  const d = toDate(value);
  if (!d) return NOTHING;
  return d.toLocaleTimeString(undefined, { hour: 'numeric' });
}

/** `5 Jan 2026, 14:30` — the one that replaced the raw browser default. */
export function formatDateTime(value: DateLike): string {
  const d = toDate(value);
  if (!d) return NOTHING;
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** `5 Jan, 14:30` — a timestamp inside the current year. */
export function formatDayMonthTime(value: DateLike): string {
  const d = toDate(value);
  if (!d) return NOTHING;
  return `${formatDayMonth(d)}, ${formatTime(d)}`;
}

/** `Monday 5 January 2026, 14:30` — a mail header, where the day matters. */
export function formatFullDateTime(value: DateLike): string {
  const d = toDate(value);
  if (!d) return NOTHING;
  return `${formatFullDate(d)}, ${formatTime(d)}`;
}

/* ── Money ────────────────────────────────────────────────────────────── */

/**
 * `$12,000` / `£12,000`, in the reader's number conventions.
 *
 * The currency comes from the record - a deal in euros is in euros - but
 * the grouping and placement follow the reader, which is the same split
 * the dates make. Fourteen call sites hardcoded 'en-US' here too.
 *
 * Whole units by default: nobody reading a pipeline wants the pence.
 */
export function formatMoney(
  value: number | null | undefined,
  currency = 'USD',
  opts: { cents?: boolean; compact?: boolean } = {},
): string {
  const n = Number(value) || 0;
  try {
    return n.toLocaleString(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: opts.cents ? 2 : 0,
      // `$1.2M` for a figure on a card, where the exact pounds are noise
      // and the width is not available anyway.
      ...(opts.compact ? { notation: 'compact' as const } : {}),
    });
  } catch {
    // An unknown or malformed currency code throws rather than degrading,
    // and a pipeline total is too useful to lose over a bad three letters.
    return `${n.toLocaleString(undefined, { maximumFractionDigits: opts.cents ? 2 : 0 })}`;
  }
}
