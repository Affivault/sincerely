/* ═══════════════════════════════════════════════════════════════════════
   When is somebody back?

   An out-of-office reply was recognised and recorded, and the sequence
   carried on regardless - so "I'm away until the 14th" was answered on
   the 10th by a follow-up that landed in an inbox nobody was reading, to
   be bulk-deleted on their return with everything else from the fortnight.

   This reads the return date out of the auto-reply so the next email can
   wait. The rule is the same whether it says "back on" or "away until":
   resume the day AFTER the date given. "Back on Monday" means Monday is
   spent digging out, and "until Friday" may or may not include Friday;
   the day after is right either way.

   A date only counts when it sits just after words that talk about being
   away or coming back - a signature's "Mon-Fri 9-5", an event date or a
   booking reference must not hold anybody's email for a month. And it has
   to be plausible: after the reply arrived, and no more than
   AWAY_MAX_DAYS later. Of several, the latest wins ("away from the 2nd to
   the 9th" is back after the 9th). With no usable date, the hold is a
   short default.

   Pure: text and an instant in, a date out.
   ═══════════════════════════════════════════════════════════════════════ */

/** Hold when an out-of-office gives no date. */
export const AWAY_DEFAULT_HOLD_DAYS = 3;
/** Ignore dates further out than this (a typo'd year, a far-off event). */
export const AWAY_MAX_DAYS = 200;
/** The hour (UTC) a held follow-up is released; the sending window still applies. */
export const AWAY_RESUME_HOUR_UTC = 8;

export interface AbsenceReading {
  /** The date they gave, as a calendar day ("2026-10-14"), or null when none was found. */
  returns_on: string | null;
  /** When the next email may go: the day after that date, or the default hold. */
  resume_at: string;
  /** The words the date was read from, for the note on the contact. */
  phrase: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY_RE = '(mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thu(?:rs?)?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';

/**
 * Words that put a following date in context. Looked for in the stretch of
 * text just before the date, within the same sentence.
 */
const TRIGGER = /\b(back|return(?:ing|s)?|until|till|til|through|thru|away|out of (?:the )?office|ooo|off|leave|holidays?|vacation|annual leave|available|reachable|in the office|responding|respond|reply|replying|from|between|starting|resume|resuming)\b/i;

const DAY = 86_400_000;

function utcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function iso(dayMs: number): string {
  return new Date(dayMs).toISOString().slice(0, 10);
}

function monthNum(word: string): number | null {
  const k = word.toLowerCase().slice(0, word.toLowerCase().startsWith('sept') ? 4 : 3);
  return MONTHS[k] ?? MONTHS[k.slice(0, 3)] ?? null;
}

function weekdayNum(word: string): number | null {
  const w = word.toLowerCase();
  for (const k of ['thurs', 'thur', 'tues']) if (w.startsWith(k)) return WEEKDAYS[k];
  return WEEKDAYS[w.slice(0, 3)] ?? null;
}

/** A real calendar day, or null (31 February, month 13). */
function makeDay(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  return back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? t : null;
}

/** With no year given: this year, or next if that date has already passed. */
function withoutYear(m: number, d: number, today: number): number | null {
  const y = new Date(today).getUTCFullYear();
  const thisYear = makeDay(y, m, d);
  if (thisYear === null) return null;
  return thisYear >= today ? thisYear : makeDay(y + 1, m, d);
}

function fullYear(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return raw.length <= 2 ? 2000 + n : n;
}

interface Found { at: number; end: number; day: number }

function candidates(text: string, today: number): Found[] {
  const out: Found[] = [];
  const push = (m: RegExpMatchArray, day: number | null) => {
    if (day !== null && m.index !== undefined) out.push({ at: m.index, end: m.index + m[0].length, day });
  };

  // 14 October 2026 / Monday 14th of Oct
  for (const m of text.matchAll(new RegExp(`\\b(?:${WEEKDAY_RE},?\\s+(?:the\\s+)?)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\.?,?(?:\\s+(\\d{4}))?\\b`, 'gi'))) {
    const d = Number(m[2]); const mo = monthNum(m[3]); const y = fullYear(m[4]);
    push(m, mo === null ? null : y ? makeDay(y, mo, d) : withoutYear(mo, d, today));
  }
  // October 14, 2026 / Monday, Oct 14th
  for (const m of text.matchAll(new RegExp(`\\b(?:${WEEKDAY_RE},?\\s+)?${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'gi'))) {
    const mo = monthNum(m[2]); const d = Number(m[3]); const y = fullYear(m[4]);
    push(m, mo === null ? null : y ? makeDay(y, mo, d) : withoutYear(mo, d, today));
  }
  // 2026-10-14
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(m, makeDay(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  // 14/10, 14/10/2026, 14.10.2026 - a dot only with a year, so 9.30 is a time.
  for (const m of text.matchAll(/\b(\d{1,2})(\/|\.)(\d{1,2})(?:\2(\d{2}|\d{4}))?\b(?!\s*(?:am|pm|h\b|uhr))/gi)) {
    if (m[2] === '.' && !m[4]) continue;
    const a = Number(m[1]); const b = Number(m[3]); const y = fullYear(m[4]);
    // 10/12 is 10 December or 12 October. The nearer one that has not
    // passed: holding a follow-up two months for a ten-day absence costs
    // more than one email landing a day or two early.
    const readings = ([[a, b], [b, a]] as const)
      .map(([d, mo]) => (y ? makeDay(y, mo, d) : withoutYear(mo, d, today)))
      .filter((t): t is number => t !== null && t >= today)
      .sort((p, q) => p - q);
    push(m, readings[0] ?? null);
  }
  // "in January", "until March" - the first of that month.
  for (const m of text.matchAll(new RegExp(`\\b(?:in|until|till|from|early|beginning of|start of)\\s+${MONTH_RE}\\b(?!\\.?\\s*\\d)`, 'gi'))) {
    const mo = monthNum(m[1]);
    push(m, mo === null ? null : withoutYear(mo, 1, today));
  }
  // A weekday alone: its next occurrence. Never part of a range ("Mon-Fri").
  for (const m of text.matchAll(new RegExp(`\\b(next\\s+)?${WEEKDAY_RE}\\b`, 'gi'))) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 4), m.index);
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 14);
    if (/[-–]\s*$|\bto\s*$/i.test(before) || /^\s*(?:[-–]|to\b|through\b|thru\b|and\b)/i.test(after)) continue;
    // Already read as part of a full date.
    if (/^,?\s+(?:the\s+)?\d{1,2}\b|^,?\s+[a-z]{3,9}\.?\s+\d{1,2}\b/i.test(after)) continue;
    const wd = weekdayNum(m[2]);
    if (wd === null) continue;
    const todayWd = new Date(today).getUTCDay();
    let ahead = (wd - todayWd + 7) % 7 || 7;
    if (m[1]) ahead += ahead < 7 ? 7 : 0;
    push(m, today + ahead * DAY);
  }
  // tomorrow / next week / after the weekend
  for (const m of text.matchAll(/\b(tomorrow|next week|after the weekend)\b/gi)) {
    const w = m[1].toLowerCase();
    const todayWd = new Date(today).getUTCDay();
    const toMonday = ((1 - todayWd + 7) % 7) || 7;
    push(m, w === 'tomorrow' ? today + DAY : today + toMonday * DAY);
  }
  return out;
}

/** The sentence-ish stretch before a date, where its context words live. */
function lead(text: string, at: number): string {
  const before = text.slice(Math.max(0, at - 90), at);
  const cut = Math.max(before.lastIndexOf('.'), before.lastIndexOf('\n'), before.lastIndexOf('!'), before.lastIndexOf('?'));
  return cut >= 0 ? before.slice(cut + 1) : before;
}

/**
 * Read an out-of-office for when its sender is back.
 * `text` is the subject and the opening of the body; `receivedAt` is when it arrived.
 */
export function readAbsence(text: string, receivedAt: number | string | Date = Date.now()): AbsenceReading {
  const arrived = typeof receivedAt === 'number' ? receivedAt : new Date(receivedAt).getTime();
  const now = Number.isFinite(arrived) ? arrived : Date.now();
  const today = utcDay(now);
  const body = (text || '').replace(/\s+/g, ' ').slice(0, 1500);

  let best: Found | null = null;
  for (const c of candidates(body, today)) {
    if (c.day < today || c.day > today + AWAY_MAX_DAYS * DAY) continue;
    if (!TRIGGER.test(lead(body, c.at))) continue;
    if (!best || c.day > best.day) best = c;
  }

  if (!best) {
    return {
      returns_on: null,
      resume_at: new Date(today + AWAY_DEFAULT_HOLD_DAYS * DAY + AWAY_RESUME_HOUR_UTC * 3_600_000).toISOString(),
      phrase: null,
    };
  }
  const phrase = `${lead(body, best.at)}${body.slice(best.at, best.end)}`.trim();
  return {
    returns_on: iso(best.day),
    resume_at: new Date(best.day + DAY + AWAY_RESUME_HOUR_UTC * 3_600_000).toISOString(),
    phrase: phrase.slice(0, 120),
  };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The note on the contact while follow-ups are held; null once released.
 * `awayUntil` is when the next email may go (resume_at); `returnsOn` is the
 * date they gave, when they gave one.
 */
export function awayLabel(awayUntil: string | null | undefined, returnsOn: string | null | undefined, now = Date.now()): string | null {
  if (!awayUntil) return null;
  const t = Date.parse(awayUntil);
  if (!Number.isFinite(t) || t <= now) return null;
  const fmt = (ms: number) => { const d = new Date(ms); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  if (returnsOn && Number.isFinite(Date.parse(returnsOn))) return `Out of office until ${fmt(Date.parse(returnsOn))} - next email waits until ${fmt(t)}`;
  return `Out of office (no return date given) - next email waits until ${fmt(t)}`;
}
