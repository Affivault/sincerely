import { partsInTimezone, tzWallTimeToUtc } from './timezone.js';

/* ═══════════════════════════════════════════════════════════════════════
   Which moments may be offered to somebody else.

   Everything a scheduler is actually made of, and the part that is easy to
   get subtly, expensively wrong: offer a slot that is already taken and you
   double-book; offer one in the wrong hour and somebody dials in to an
   empty room a week on Tuesday.

   The rule this file follows throughout: working hours are wall-clock
   statements, everything else is an instant. "I work nine to five" means
   nine on the clock on the wall in Lisbon, which is a different instant in
   March and in July. So every window is converted to UTC per day, at that
   day's offset, rather than once per week.
   ═══════════════════════════════════════════════════════════════════════ */

/** One stretch of a weekday somebody is available. Minutes from midnight. */
export interface AvailabilityWindow {
  /** 0 = Sunday .. 6 = Saturday, matching Date.getDay(). */
  weekday: number;
  start_minute: number;
  end_minute: number;
}

export interface SchedulingPrefs {
  timezone: string;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  minimum_notice_minutes: number;
  max_bookings_per_day: number | null;
  slot_interval_minutes: number;
  booking_horizon_days: number;
}

export const DEFAULT_SCHEDULING_PREFS: SchedulingPrefs = {
  timezone: 'UTC',
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  // Four hours, so nobody books you at 09:02 for 09:15 on a morning you
  // have not looked at your calendar.
  minimum_notice_minutes: 240,
  max_bookings_per_day: null,
  slot_interval_minutes: 15,
  booking_horizon_days: 60,
};

/** Nine to five, Monday to Friday. What a new account starts with. */
export const DEFAULT_WORKING_WEEK: AvailabilityWindow[] =
  [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 540, end_minute: 1020 }));

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Something already in the diary. Only its edges matter here. */
export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface Slot {
  start: Date;
  end: Date;
}

export const SLOT_INTERVALS = [5, 10, 15, 20, 30, 60];

/** "09:00", from minutes past midnight. */
export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The reverse, tolerant of "9:00" and "9". Null when it is not a time. */
export function parseMinuteLabel(value: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(value).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59) return null;
  const total = h * 60 + min;
  return total > 1440 ? null : total;
}

/**
 * Do two stretches of time actually collide?
 *
 * Touching is not overlapping: a meeting ending at 10:00 and one starting
 * at 10:00 are back to back, and treating that as a clash costs a slot
 * every hour of every day.
 */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Merge overlapping busy intervals into the fewest that cover the same time.
 *
 * Slot generation asks "is this free?" once per candidate; without merging
 * it asks once per candidate per meeting, and a busy week turns a cheap
 * loop into a quadratic one.
 */
export function mergeBusy(busy: BusyInterval[]): BusyInterval[] {
  const sorted = busy
    .filter((b) => b.end.getTime() > b.start.getTime())
    .slice()
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const out: BusyInterval[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.start.getTime() <= last.end.getTime()) {
      if (b.end.getTime() > last.end.getTime()) last.end = b.end;
    } else {
      out.push({ start: new Date(b.start), end: new Date(b.end) });
    }
  }
  return out;
}

/**
 * The account's own calendar days that a UTC range touches.
 *
 * A range is asked for in instants, but availability is written in wall
 * clock, so the days have to be enumerated in the account's zone. Asking
 * "which dates does this cover" in UTC gets the wrong answer either side of
 * midnight for anybody not on UTC.
 */
export function localDaysBetween(from: Date, to: Date, timezone: string): { year: number; month: number; day: number; weekday: number }[] {
  const days: { year: number; month: number; day: number; weekday: number }[] = [];
  const seen = new Set<string>();

  // Walk in twelve-hour steps: small enough that no day is skipped in any
  // real zone, large enough not to loop pointlessly over a long horizon.
  for (let t = from.getTime(); t <= to.getTime() + 12 * 3_600_000; t += 12 * 3_600_000) {
    const p = partsInTimezone(new Date(t), timezone);
    const key = `${p.year}-${p.month}-${p.day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    days.push({ year: p.year, month: p.month, day: p.day, weekday: p.weekday });
  }
  return days;
}

export interface ComputeSlotsInput {
  /** Earliest instant to consider. */
  from: Date;
  /** Latest instant to consider. */
  to: Date;
  /** How long the meeting being booked runs. */
  durationMinutes: number;
  windows: AvailabilityWindow[];
  prefs: SchedulingPrefs;
  /** Everything already in the diary, in instants. */
  busy: BusyInterval[];
  /** Now, so notice can be applied. Injectable so tests are not clock-bound. */
  now?: Date;
}

/**
 * Every moment somebody could be offered.
 *
 * The order matters and each step exists for a reason:
 *
 *   1. clamp the range to the booking horizon, so a crawler cannot ask for
 *      the year 2400 and make us generate a million slots
 *   2. enumerate days in the ACCOUNT'S zone, not UTC
 *   3. convert each day's windows to instants at THAT DAY's offset, which
 *      is what makes the week after a clock change still read as 9 to 5
 *   4. step through each window at the slot interval
 *   5. drop anything too soon, anything that runs past its window, and
 *      anything colliding with a busy interval once buffers are applied
 *   6. drop whole days that have hit the cap
 */
export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const {
    from, to, durationMinutes, windows, prefs, busy,
    now = new Date(),
  } = input;

  if (!(durationMinutes > 0)) return [];
  const interval = prefs.slot_interval_minutes > 0 ? prefs.slot_interval_minutes : 15;

  // 1. Nobody may reach past the horizon, however they ask.
  const horizonEnd = new Date(now.getTime() + prefs.booking_horizon_days * 86_400_000);
  const rangeEnd = new Date(Math.min(to.getTime(), horizonEnd.getTime()));
  // Notice is a floor on the range as well as a per-slot test, so days
  // entirely inside the notice period are never even walked.
  const earliest = new Date(now.getTime() + prefs.minimum_notice_minutes * 60_000);
  const rangeStart = new Date(Math.max(from.getTime(), earliest.getTime()));
  if (rangeStart.getTime() >= rangeEnd.getTime()) return [];

  const merged = mergeBusy(busy);
  const byWeekday = new Map<number, AvailabilityWindow[]>();
  for (const w of windows) {
    const list = byWeekday.get(w.weekday);
    if (list) list.push(w); else byWeekday.set(w.weekday, [w]);
  }

  /** Busy intervals already counted against a day's cap. */
  const bookingsOnDay = (dayStart: Date, dayEnd: Date): number =>
    merged.filter((b) => overlaps(b.start, b.end, dayStart, dayEnd)).length;

  const slots: Slot[] = [];

  // 2. The account's own days.
  for (const day of localDaysBetween(rangeStart, rangeEnd, prefs.timezone)) {
    const windowsToday = byWeekday.get(day.weekday);
    if (!windowsToday || windowsToday.length === 0) continue;

    // 6. A day that is already full is skipped whole.
    if (prefs.max_bookings_per_day != null) {
      const dayStart = tzWallTimeToUtc(day.year, day.month, day.day, 0, 0, prefs.timezone);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      if (bookingsOnDay(dayStart, dayEnd) >= prefs.max_bookings_per_day) continue;
    }

    for (const w of windowsToday) {
      /*
       * 3. Converted per day, at that day's offset.
       *
       * Doing this once for the week and adding 24 hours is the bug that
       * makes every meeting an hour out for the fortnight after a clock
       * change - and it is invisible in testing unless a test crosses one.
       */
      const windowStart = tzWallTimeToUtc(
        day.year, day.month, day.day,
        Math.floor(w.start_minute / 60), w.start_minute % 60,
        prefs.timezone,
      );
      const windowEnd = new Date(
        windowStart.getTime() + (w.end_minute - w.start_minute) * 60_000,
      );

      // 4. Step through the window.
      for (
        let t = windowStart.getTime();
        t + durationMinutes * 60_000 <= windowEnd.getTime() + 1;
        t += interval * 60_000
      ) {
        const start = new Date(t);
        const end = new Date(t + durationMinutes * 60_000);

        // Must sit wholly inside the window.
        if (end.getTime() > windowEnd.getTime()) break;
        // And wholly inside the range asked for.
        if (start.getTime() < rangeStart.getTime()) continue;
        if (end.getTime() > rangeEnd.getTime()) break;

        /*
         * 5. Buffers are the organiser's, not the guest's: a slot is free
         * only if the meeting PLUS its buffers fits. Checking the bare
         * meeting is how back-to-back calls with no gap get booked by a
         * scheduler that claims to protect them.
         */
        const guardStart = new Date(start.getTime() - prefs.buffer_before_minutes * 60_000);
        const guardEnd = new Date(end.getTime() + prefs.buffer_after_minutes * 60_000);
        const clash = merged.some((b) => overlaps(guardStart, guardEnd, b.start, b.end));
        if (clash) continue;

        slots.push({ start, end });
      }
    }
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}

/** Slots grouped by the account's calendar day, for a booking page. */
export function groupSlotsByDay(slots: Slot[], timezone: string): { date: string; slots: Slot[] }[] {
  const byDate = new Map<string, Slot[]>();
  for (const s of slots) {
    const p = partsInTimezone(s.start, timezone);
    const key = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    const list = byDate.get(key);
    if (list) list.push(s); else byDate.set(key, [s]);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({ date, slots: list }));
}

/**
 * Is one exact slot still bookable?
 *
 * The booking itself must never trust the list it was offered: that list
 * was computed when the page loaded and somebody else may have taken the
 * slot since. Same rules, one candidate.
 */
export function isSlotBookable(start: Date, input: Omit<ComputeSlotsInput, 'from' | 'to'>): boolean {
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);
  const slots = computeSlots({
    ...input,
    from: new Date(start.getTime() - 1),
    to: new Date(end.getTime() + 1),
  });
  return slots.some((s) => s.start.getTime() === start.getTime());
}

/** How the working week reads in a sentence, for a settings summary. */
export function describeWeek(windows: AvailabilityWindow[]): string {
  const days = new Set(windows.map((w) => w.weekday));
  if (days.size === 0) return 'No hours set — nobody can book you.';
  const names = [...days].sort().map((d) => WEEKDAY_SHORT[d]).join(', ');
  const total = windows.reduce((n, w) => n + (w.end_minute - w.start_minute), 0);
  const hours = Math.round((total / 60) * 10) / 10;
  return `${names} · ${hours} bookable hour${hours === 1 ? '' : 's'} a week`;
}
