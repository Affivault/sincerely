/* ═══════════════════════════════════════════════════════════════════════
   What a calendar needs to be a calendar.

   The old one drew a week as seven tall boxes with chips stacked inside
   them, which is a month view with more air. It could not show when
   anything started, how long it ran, or that two things clashed - and those
   three facts are most of what a calendar is for. A 9am standup and a
   two-hour workshop looked identical.

   So the geometry lives here: resolving how long something runs, turning a
   time into a position, and working out what to do when things overlap.
   Pure functions, because this is the part worth testing and the part that
   is invisible until it is wrong.
   ═══════════════════════════════════════════════════════════════════════ */

export type EventLocationKind = 'video' | 'phone' | 'in_person' | 'other';

export const EVENT_LOCATION_KINDS: { id: EventLocationKind; label: string; hint: string }[] = [
  { id: 'video',     label: 'Video call', hint: 'A link, added to the invite.' },
  { id: 'phone',     label: 'Phone',      hint: 'You call them, or they call you.' },
  { id: 'in_person', label: 'In person',  hint: 'An address on the invite.' },
  { id: 'other',     label: 'Something else', hint: 'Anything that is none of the above.' },
];

export type CalendarEventStatus = 'confirmed' | 'tentative' | 'cancelled';

/** A kind of meeting: its name, its colour, and how long it usually runs. */
export interface CalendarEventType {
  id: string;
  user_id: string;
  name: string;
  colour: string;
  duration_minutes: number;
  location_kind: EventLocationKind;
  is_default: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEventTypeInput {
  name: string;
  colour?: string;
  duration_minutes?: number;
  location_kind?: EventLocationKind;
  is_default?: boolean;
}

/**
 * The palette offered when somebody makes a new kind of meeting.
 *
 * Picked to stay distinguishable side by side and to hold up on both a
 * light and a dark grid - a calendar is read at a glance and by colour, so
 * two greens that differ only in saturation are worse than useless.
 */
export const EVENT_COLOURS: { hex: string; name: string }[] = [
  { hex: '#6366f1', name: 'Indigo' },
  { hex: '#0ea5e9', name: 'Sky' },
  { hex: '#10b981', name: 'Emerald' },
  { hex: '#f59e0b', name: 'Amber' },
  { hex: '#ef4444', name: 'Red' },
  { hex: '#ec4899', name: 'Pink' },
  { hex: '#8b5cf6', name: 'Violet' },
  { hex: '#64748b', name: 'Slate' },
];

export const DEFAULT_EVENT_COLOUR = '#6366f1';

/** When no type and no explicit end say otherwise. */
export const DEFAULT_EVENT_MINUTES = 30;

/** Only these are real colours as far as the database is concerned. */
export function isHexColour(value: unknown): boolean {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/* ── Geometry ─────────────────────────────────────────────────────── */

/** The shape the grid needs from an event, whatever else it carries. */
export interface TimedEvent {
  id: string;
  starts_at: string;
  ends_at?: string | null;
  all_day?: boolean;
  colour?: string | null;
  status?: CalendarEventStatus | string | null;
  event_type_id?: string | null;
}

/**
 * When something actually finishes.
 *
 * `ends_at` is nullable and plenty of existing rows have nothing in it, so
 * an end has to be derived rather than assumed present. The type's usual
 * length first, because that is what somebody agreed to; half an hour only
 * when there is nothing better. Never earlier than the start.
 */
export function resolveEnd(
  event: TimedEvent,
  typeMinutes?: number | null,
): Date {
  const start = new Date(event.starts_at);
  if (event.ends_at) {
    const end = new Date(event.ends_at);
    if (!Number.isNaN(end.getTime()) && end.getTime() > start.getTime()) return end;
  }
  const minutes = typeMinutes && typeMinutes > 0 ? typeMinutes : DEFAULT_EVENT_MINUTES;
  return new Date(start.getTime() + minutes * 60_000);
}

/** How long it runs, in minutes, floored at a clickable minimum. */
export function durationMinutes(event: TimedEvent, typeMinutes?: number | null): number {
  const start = new Date(event.starts_at).getTime();
  const end = resolveEnd(event, typeMinutes).getTime();
  return Math.max(1, Math.round((end - start) / 60_000));
}

/** Minutes since midnight local time. The grid's y axis. */
export function minutesIntoDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * One event's place on a day column, as fractions.
 *
 * Returned as 0..1 rather than pixels so the same numbers drive a 600px
 * column and a 1200px one, and nothing has to know the row height.
 */
export interface Placement<T> {
  event: T;
  /** Distance from the top of the day, 0..1. */
  top: number;
  /** Height as a fraction of the day, 0..1. */
  height: number;
  /** Horizontal offset within the column, 0..1. */
  left: number;
  /** Width as a fraction of the column, 0..1. */
  width: number;
  /** How many events this one clashes with. Drives the "3 more" affordance. */
  clashes: number;
}

const DAY_MINUTES = 24 * 60;

/**
 * Lay out a day's events so overlapping ones sit side by side.
 *
 * The algorithm every calendar uses and none of them explain. Sort by start.
 * Walk the list building a cluster of things that overlap each other, even
 * transitively - A overlaps B, B overlaps C, so all three share the width
 * even if A and C do not touch. Within a cluster, drop each event into the
 * leftmost column whose last event has already finished. The cluster's width
 * is the number of columns it needed.
 *
 * The transitive part is what naive versions get wrong: computing width
 * per-pair leaves two events claiming the same half of the column and drawn
 * on top of each other, which looks exactly like a rendering bug.
 *
 * `dayStart` is passed in rather than derived so an event running past
 * midnight is clipped to the day being drawn instead of overflowing it.
 */
export function layoutDay<T extends TimedEvent>(
  events: T[],
  dayStart: Date,
  typeMinutesFor?: (event: T) => number | null | undefined,
): Placement<T>[] {
  const dayBegin = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate()).getTime();
  const dayEnd = dayBegin + DAY_MINUTES * 60_000;

  const spans = events
    .filter((e) => !e.all_day)
    .map((e) => {
      const start = new Date(e.starts_at).getTime();
      const end = resolveEnd(e, typeMinutesFor?.(e)).getTime();
      return { event: e, start, end };
    })
    .filter((s) => Number.isFinite(s.start) && s.end > dayBegin && s.start < dayEnd)
    .map((s) => ({
      ...s,
      // Clipped, so a meeting that began yesterday evening draws from the
      // top of today rather than at a negative offset.
      start: Math.max(s.start, dayBegin),
      end: Math.min(s.end, dayEnd),
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out: Placement<T>[] = [];

  let cluster: typeof spans = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;

    // Greedy column packing within the cluster.
    const columns: number[] = [];       // end time of the last event in each column
    const assigned = new Map<number, number>();  // index in cluster -> column

    cluster.forEach((span, i) => {
      let col = columns.findIndex((endsAt) => endsAt <= span.start);
      if (col === -1) { columns.push(span.end); col = columns.length - 1; }
      else columns[col] = span.end;
      assigned.set(i, col);
    });

    const width = columns.length;
    cluster.forEach((span, i) => {
      const col = assigned.get(i)!;
      const startMin = (span.start - dayBegin) / 60_000;
      const endMin = (span.end - dayBegin) / 60_000;
      out.push({
        event: span.event,
        top: startMin / DAY_MINUTES,
        height: Math.max(endMin - startMin, 15) / DAY_MINUTES,
        left: col / width,
        width: 1 / width,
        clashes: width - 1,
      });
    });

    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const span of spans) {
    // A gap means the previous cluster is closed: nothing after this point
    // can overlap anything in it.
    if (span.start >= clusterEnd && cluster.length > 0) flush();
    cluster.push(span);
    clusterEnd = Math.max(clusterEnd, span.end);
  }
  flush();

  return out;
}

/** The all-day events for a given day, which sit above the grid. */
export function allDayEvents<T extends TimedEvent>(events: T[], day: Date): T[] {
  const begin = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = begin + DAY_MINUTES * 60_000;
  return events.filter((e) => {
    if (!e.all_day) return false;
    const at = new Date(e.starts_at).getTime();
    return at >= begin && at < end;
  });
}

/**
 * Snap a click to the nearest bookable minute.
 *
 * Clicking the grid used to book at 9am whatever row you hit, which meant
 * the calendar was only ever an inbox for meetings made elsewhere.
 */
export function snapMinutes(minutes: number, step = 15): number {
  const snapped = Math.round(minutes / step) * step;
  return Math.max(0, Math.min(DAY_MINUTES - step, snapped));
}

/** A time as "9:00 am" / "14:30", following the viewer's locale. */
export function clockLabel(date: Date, locale?: string): string {
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** "45m", "1h", "1h 30m" — how long a thing runs, said briefly. */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
