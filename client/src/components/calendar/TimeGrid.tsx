import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Video, Phone, MapPin, Users } from 'lucide-react';
import {
  layoutDay, allDayEvents, durationMinutes, resolveEnd, snapMinutes,
  clockLabel, durationLabel, minutesIntoDay,
  dragRange, snapToStep, DAY_MINUTES, DEFAULT_STEP,
  type AvailabilityWindow, type CalendarEventType, type MinuteRange, type TimedEvent,
  formatHour, formatWeekdayShort } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   A day, drawn against a clock.

   The old week view was seven tall boxes with chips stacked inside them —
   a month view with more air. It could not show when anything started, how
   long it ran, or that two things clashed, which is most of what somebody
   opens a calendar to find out. A 9am standup and a two-hour workshop
   looked identical.

   Here an event is a block: its top is its start, its height is its
   length, and things happening at once sit side by side.

   AND YOU DRAW ON IT. Press on empty space and drag: the block follows,
   saying what range it covers as it goes, and on release that is the
   meeting — or the two hours you are marking as busy. Before this, saying
   "I am busy two until four" was a click (which booked a default-length
   meeting at two) followed by a drag on its bottom edge. Two gestures and
   a guess for the single commonest thing anybody does to a calendar.

   A plain click still books at the moment you clicked, because a click is
   a drag of no length and should not mean something different.
   ═══════════════════════════════════════════════════════════════════════ */

/** Tall enough that a 30-minute meeting has room for a title and a time. */
const HOUR_HEIGHT = 56;
const DAY_HEIGHT = HOUR_HEIGHT * 24;
const GUTTER = 56;

const LOCATION_ICON = {
  video: Video,
  phone: Phone,
  in_person: MapPin,
  other: Users,
} as const;

export interface GridEvent extends TimedEvent {
  title: string;
  contact_name?: string | null;
  location?: string | null;
  conferencing_url?: string | null;
}

/** A drag in progress, before it is committed.
 *
 *  Every kind carries the DAY COLUMN it is happening in, not just minutes.
 *  Without it a drag is expressed against whichever column the block was
 *  first drawn in, which is how dragging a meeting to Thursday used to
 *  leave it on Tuesday. */
type Draft =
  | { kind: 'move'; id: string; startMinute: number; grabOffset: number; day: Date; from: number; fromDay: Date }
  | { kind: 'resize'; id: string; startMinute: number; endMinute: number; day: Date; from: number }
  | { kind: 'create'; day: Date; anchorMinute: number; startMinute: number; endMinute: number; moved: boolean }
  | null;

const sameDate = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** A moment on a given day. Minute 1440 is midnight at its far end. */
function at(day: Date, minute: number): Date {
  const d = new Date(day);
  d.setHours(0, minute, 0, 0);
  return d;
}

/**
 * Where an event's block starts on THIS column, in minutes.
 *
 * An event that began yesterday evening is drawn on today's column from
 * the top, because that is where its time on today begins. Reading its
 * real start instead gives 23:00 — a number from a different day, used as
 * an offset into this one, which is the shape of several bugs at once.
 */
function drawnStartMinute(event: TimedEvent, day: Date): number {
  const start = new Date(event.starts_at);
  const dayBegin = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  return start.getTime() <= dayBegin ? 0 : minutesIntoDay(start);
}

/**
 * The bands of a day somebody is actually bookable, from availability.
 *
 * Drawn because the two halves of a scheduler were two unrelated screens:
 * the calendar knew nothing about the hours the booking page was offering
 * on your behalf, so a week that looked wide open could be closed to
 * everybody, and a Saturday you had opened up looked exactly like a
 * Saturday you had not. Now the grid says which is which, and the hours
 * you set on one screen are visible on the other.
 */
function workingBands(windows: AvailabilityWindow[], day: Date): MinuteRange[] {
  const weekday = day.getDay();
  return windows
    .filter((w) => w.weekday === weekday && w.end_minute > w.start_minute)
    .map((w) => ({ startMinute: w.start_minute, endMinute: w.end_minute }))
    .sort((a, b) => a.startMinute - b.startMinute);
}

export function TimeGrid({
  days, events, types, onOpen, onBookAt, onCreateRange, onMove, onResize,
  workingHours = [], now = new Date(),
}: {
  days: Date[];
  events: GridEvent[];
  types: CalendarEventType[];
  /** When people may book you, from the availability page. Shaded behind. */
  workingHours?: AvailabilityWindow[];
  onOpen: (event: GridEvent) => void;
  /** Empty space was clicked: book something at this exact moment. */
  onBookAt: (at: Date) => void;
  /** Empty space was dragged: book something covering exactly this stretch. */
  onCreateRange: (start: Date, end: Date) => void;
  onMove: (event: GridEvent, newStart: Date) => void;
  onResize: (event: GridEvent, newEnd: Date) => void;
  now?: Date;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const draftRef = useRef<Draft>(null);
  draftRef.current = draft;

  /*
   * A drag that ends in a range must not also be read as a click. The click
   * arrives after pointerup, so the only way to tell them apart is to say
   * so from the gesture that has just finished.
   */
  const swallowClick = useRef(false);

  /** Each day's column, so a pointer anywhere can be told which day it is over. */
  const columns = useRef(new Map<string, HTMLElement>());
  const keyOf = (day: Date) => day.toISOString();

  const typeById = useMemo(() => {
    const m = new Map<string, CalendarEventType>();
    for (const t of types) m.set(t.id, t);
    return m;
  }, [types]);

  const minutesOf = (e: TimedEvent) => typeById.get(e.event_type_id || '')?.duration_minutes ?? null;
  const colourOf = (e: GridEvent) =>
    e.colour || typeById.get(e.event_type_id || '')?.colour || '#6366f1';

  /*
   * Open on the working day rather than at midnight. A calendar that starts
   * scrolled to 00:00 shows eight hours of empty night, and every single
   * visit begins with the same scroll.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const earliest = events.reduce((min, e) => {
      if (e.all_day) return min;
      const m = minutesIntoDay(new Date(e.starts_at));
      return Math.min(min, m);
    }, 8 * 60);
    el.scrollTop = Math.max(0, (Math.min(earliest, 8 * 60) / 60) * HOUR_HEIGHT - 8);
    // Only on first paint for a given set of days: re-running on every event
    // change would yank the view back while somebody is scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]?.toDateString()]);

  /* ── The "now" line, kept roughly honest without a per-second timer ── */
  const [tick, setTick] = useState(now.getTime());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowDate = useMemo(() => new Date(tick), [tick]);
  const nowMinutes = minutesIntoDay(nowDate);

  /* ── Dragging ─────────────────────────────────────────────────────── */

  /**
   * How far down the day a pointer is.
   *
   * Allowed to reach 1440. A block's bottom edge dragged to the bottom of
   * the grid means midnight, and `snapMinutes` — which answers "where does
   * a meeting START" — clamps to 23:45, so sharing it between the two ends
   * made the last quarter-hour of the day unreachable.
   */
  const minuteFromPointer = (clientY: number, column: HTMLElement): number => {
    const rect = column.getBoundingClientRect();
    return snapToStep(((clientY - rect.top) / rect.height) * DAY_MINUTES);
  };

  /**
   * Which day column a pointer is over, whatever element captured it.
   *
   * THE FIX FOR THE BUG THAT MADE DRAGGING ACROSS DAYS DO NOTHING. Pointer
   * capture routes every subsequent move to the element pressed, so the
   * handler's `day` was forever the column the block started in — you could
   * drag a meeting to Friday, watch it follow the cursor, let go, and see
   * it snap back to Tuesday at the new time.
   */
  const dayFromPointer = useCallback((clientX: number): Date | null => {
    for (const day of days) {
      const el = columns.current.get(keyOf(day));
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) return day;
    }
    // Past the last column, or in the hour gutter: hold whichever end.
    const first = columns.current.get(keyOf(days[0]))?.getBoundingClientRect();
    if (first && clientX < first.left) return days[0];
    return days[days.length - 1] ?? null;
  }, [days]);

  const columnFor = (day: Date) => columns.current.get(keyOf(day)) || null;

  const beginMove = (event: GridEvent, day: Date) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const column = columnFor(day);
    if (!column) return;
    const top = drawnStartMinute(event, day);
    setDraft({
      kind: 'move',
      id: event.id,
      startMinute: top,
      // Where in the block they grabbed it, so it does not jump so the
      // cursor sits at the top edge.
      grabOffset: minuteFromPointer(e.clientY, column) - top,
      day,
      // Where it was, so a press that never moved commits nothing.
      from: top,
      fromDay: day,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const beginResize = (event: GridEvent, day: Date) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const end = resolveEnd(event, minutesOf(event));
    // Clipped like the start is: an event ending tomorrow is drawn to the
    // bottom of today, and that is the edge being taken hold of.
    const bottom = sameDate(end, day) ? minutesIntoDay(end) : DAY_MINUTES;
    setDraft({
      kind: 'resize',
      id: event.id,
      startMinute: drawnStartMinute(event, day),
      endMinute: bottom,
      day,
      from: bottom,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const dragEvent = (event: GridEvent) => (e: React.PointerEvent) => {
    const d = draftRef.current;
    if (!d || d.kind === 'create' || d.id !== event.id) return;
    const day = dayFromPointer(e.clientX) ?? d.day;
    const column = columnFor(day) ?? columnFor(d.day);
    if (!column) return;
    const minute = minuteFromPointer(e.clientY, column);

    if (d.kind === 'move') {
      setDraft({ ...d, startMinute: snapMinutes(minute - d.grabOffset), day });
    } else {
      // Never shorter than one step, or the block becomes unclickable. The
      // floor is the block's own drawn top, not a start from another day.
      setDraft({ ...d, endMinute: Math.max(d.startMinute + DEFAULT_STEP, minute) });
    }
  };

  const endEventDrag = (event: GridEvent) => () => {
    const d = draftRef.current;
    setDraft(null);
    if (!d || d.kind === 'create' || d.id !== event.id) return;

    /*
     * "Did this actually move" is asked of the DRAFT, not of the event.
     *
     * Comparing the committed instant against the event's own start looks
     * equivalent and is not, for anything drawn clipped: a meeting that
     * began at 23:00 yesterday is drawn on today's column from the top, so
     * a plain click on it - a drag of no distance - produced a "new" start
     * of today at midnight, and opening it would have moved it.
     */
    if (d.kind === 'move') {
      if (d.startMinute === d.from && sameDate(d.day, d.fromDay)) return;
      onMove(event, at(d.day, d.startMinute));
    } else {
      if (d.endMinute === d.from) return;
      // Built on the column the block was drawn in. Deriving it from the
      // event's own start put the new end on YESTERDAY for anything that had
      // run over midnight, silently shortening a two-hour meeting to fifteen
      // minutes.
      onResize(event, at(d.day, d.endMinute));
    }
  };

  /* ── Drawing a new block on empty space ───────────────────────────── */

  const beginCreate = (day: Date) => (e: React.PointerEvent) => {
    /*
     * Cleared here rather than only after use. A drag whose click never
     * arrives - the pointer left the window, the gesture was cancelled -
     * would otherwise leave the flag standing and swallow somebody's next
     * perfectly ordinary click on the grid.
     */
    swallowClick.current = false;
    // Only bare grid, never a press that landed on a block.
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    /*
     * Touch is left alone on purpose. The grid lives inside a vertical
     * scroller, and capturing a touch on press is how a calendar becomes a
     * thing you cannot scroll. A tap still books at the time tapped.
     */
    if (e.pointerType === 'touch') return;

    const anchor = minuteFromPointer(e.clientY, e.currentTarget as HTMLElement);
    setDraft({ kind: 'create', day, anchorMinute: anchor, ...dragRange(anchor, anchor), moved: false });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const dragCreate = (e: React.PointerEvent) => {
    const d = draftRef.current;
    if (d?.kind !== 'create') return;
    // Vertical only: a new block belongs to the day it was started on.
    // Every column shares the grid's vertical geometry, so this one answers
    // for the pointer wherever it has wandered sideways to.
    const column = columnFor(d.day);
    if (!column) return;
    const minute = minuteFromPointer(e.clientY, column);
    setDraft({
      ...d,
      // A press that wanders inside one quarter-hour cell is still a click.
      moved: d.moved || minute !== d.anchorMinute,
      ...dragRange(d.anchorMinute, minute),
    });
  };

  const endCreate = () => {
    const d = draftRef.current;
    setDraft(null);
    if (d?.kind !== 'create') return;
    if (!d.moved) return;   // A click. The click handler books at that moment.
    swallowClick.current = true;
    onCreateRange(at(d.day, d.startMinute), at(d.day, d.endMinute));
  };

  /*
   * A cancelled pointer — a system gesture, a context menu, capture lost —
   * used to leave the draft set forever, and the draft is what suppresses
   * opening an event on click. One stray gesture and no meeting on the grid
   * could be opened again until another full drag had been completed.
   */
  const cancelDrag = () => setDraft(null);

  /** "09:00 – 10:30 · 1h 30m", live, while a drag is happening. */
  const rangeLabel = (day: Date, from: number, to: number) =>
    `${clockLabel(at(day, from))} – ${clockLabel(at(day, to))} · ${durationLabel(Math.max(1, to - from))}`;

  /** The block being drawn, if this column is where it is being drawn. */
  const provisional = (day: Date): { from: number; to: number; colour: string; title: string } | null => {
    const d = draft;
    if (!d) return null;
    if (d.kind === 'create') {
      return sameDate(d.day, day)
        ? { from: d.startMinute, to: d.endMinute, colour: 'var(--indigo)', title: 'New' }
        : null;
    }
    if (d.kind !== 'move' || !sameDate(d.day, day)) return null;
    const event = events.find((e) => e.id === d.id);
    // Only when it has left the column it was drawn in — otherwise the real
    // block is already following the cursor and this would double it.
    if (!event || sameDate(new Date(event.starts_at), day)) return null;
    const mins = durationMinutes(event, minutesOf(event));
    return {
      from: d.startMinute,
      to: Math.min(DAY_MINUTES, d.startMinute + mins),
      colour: colourOf(event),
      title: event.title,
    };
  };

  return (
    <div className="panel overflow-hidden">
      {/* ── Day headings, and the all-day strip beneath them ── */}
      <div className="flex border-b border-[var(--border-subtle)] bg-[var(--bg-muted)]">
        <div style={{ width: GUTTER }} className="flex-shrink-0" />
        {days.map((day) => {
          const isToday = sameDate(day, nowDate);
          const allDay = allDayEvents(events, day);
          return (
            <div key={day.toISOString()} className="flex-1 min-w-0 border-l border-[var(--border-subtle)]">
              <div className="px-2 py-1.5 text-center">
                <p className="text-micro font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                  {formatWeekdayShort(day)}
                </p>
                <p className={cn(
                  'mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-strong font-semibold tabular',
                  isToday ? 'bg-[var(--indigo)] text-white' : 'text-[var(--text-primary)]',
                )}>
                  {day.getDate()}
                </p>
              </div>
              {allDay.length > 0 && (
                <div className="px-1 pb-1 space-y-0.5">
                  {allDay.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onOpen(e as GridEvent)}
                      className="block w-full truncate rounded px-1.5 py-0.5 text-left text-micro font-medium text-white"
                      style={{ background: colourOf(e as GridEvent) }}
                    >
                      {(e as GridEvent).title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── The grid itself ── */}
      <div ref={scrollRef} className="relative overflow-y-auto" style={{ maxHeight: '62vh' }}>
        <div className="flex" style={{ height: DAY_HEIGHT }}>
          {/* Hour gutter */}
          <div style={{ width: GUTTER }} className="relative flex-shrink-0 select-none">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-micro tabular text-[var(--text-tertiary)]"
                style={{ top: h * HOUR_HEIGHT }}
              >
                {h === 0 ? '' : formatHour(new Date(2026, 0, 1, h))}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const placed = layoutDay(events, day, minutesOf);
            const isToday = sameDate(day, nowDate);
            const ghost = provisional(day);

            return (
              <div
                key={day.toISOString()}
                data-daycol
                ref={(el) => {
                  if (el) columns.current.set(keyOf(day), el);
                  else columns.current.delete(keyOf(day));
                }}
                className={cn(
                  'relative flex-1 min-w-0 border-l border-[var(--border-subtle)]',
                  // Not `select-none` outright: it would kill selecting an
                  // event's text. Only while a drag is actually happening.
                  draft && 'select-none',
                )}
                onPointerDown={beginCreate(day)}
                onPointerMove={dragCreate}
                onPointerUp={endCreate}
                onPointerCancel={cancelDrag}
                onClick={(e) => {
                  // Only bare grid, never a click that landed on a block.
                  if (e.target !== e.currentTarget) return;
                  if (swallowClick.current) { swallowClick.current = false; return; }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const minutes = snapMinutes(((e.clientY - rect.top) / rect.height) * DAY_MINUTES);
                  onBookAt(at(day, minutes));
                }}
              >
                {/*
                  The hours you are bookable, behind everything.

                  Shading what is OUTSIDE them rather than what is inside:
                  the working day is the subject of the grid and should be
                  the plain surface, with the night and the weekend dimmed
                  around it. Tinting the working hours instead makes the
                  part you look at all day the part that is coloured in.
                */}
                {workingBands(workingHours, day).length > 0 && (
                  <div className="pointer-events-none absolute inset-0" data-working-hours>
                    {(() => {
                      const bands = workingBands(workingHours, day);
                      // The gaps between the bands, plus the ends of the day.
                      const closed: MinuteRange[] = [];
                      let at = 0;
                      for (const b of bands) {
                        if (b.startMinute > at) closed.push({ startMinute: at, endMinute: b.startMinute });
                        at = Math.max(at, b.endMinute);
                      }
                      if (at < DAY_MINUTES) closed.push({ startMinute: at, endMinute: DAY_MINUTES });
                      return closed.map((c) => (
                        <div
                          key={c.startMinute}
                          className="absolute inset-x-0 bg-[var(--bg-muted)] opacity-60"
                          style={{
                            top: `${(c.startMinute / DAY_MINUTES) * 100}%`,
                            height: `${((c.endMinute - c.startMinute) / DAY_MINUTES) * 100}%`,
                          }}
                        />
                      ));
                    })()}
                  </div>
                )}

                {/* Hour lines. Half-hours are lighter, which is what makes a
                    30-minute block readable without counting pixels. */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h}>
                    <div className="pointer-events-none absolute inset-x-0 border-t border-[var(--border-subtle)]" style={{ top: h * HOUR_HEIGHT }} />
                    <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--border-subtle)] opacity-40" style={{ top: h * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
                  </div>
                ))}

                {/* Where we are now, on today's column only. */}
                {isToday && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-[3] flex items-center"
                    style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
                    data-now-line
                  >
                    <span className="h-1.5 w-1.5 -ml-[3px] rounded-full bg-rose-500" />
                    <span className="h-px flex-1 bg-rose-500" />
                  </div>
                )}

                {placed.map(({ event, top, height, left, width, clashes }) => {
                  const d = draft && draft.kind !== 'create' && draft.id === event.id ? draft : null;
                  const mins = durationMinutes(event, minutesOf(event));
                  const start = new Date(event.starts_at);

                  // While dragging, draw from the draft so the block follows
                  // the cursor instead of waiting for the server.
                  let drawTop = top;
                  let drawHeight = height;
                  if (d?.kind === 'move') drawTop = d.startMinute / DAY_MINUTES;
                  if (d?.kind === 'resize') {
                    drawHeight = Math.max(DEFAULT_STEP, d.endMinute - d.startMinute) / DAY_MINUTES;
                  }
                  // Gone to another column: what stays here is where it was.
                  const elsewhere = d?.kind === 'move' && !sameDate(d.day, day);

                  const cancelled = event.status === 'cancelled';
                  const colour = colourOf(event);
                  const Icon = LOCATION_ICON[
                    (types.find((t) => t.id === event.event_type_id)?.location_kind ?? 'other') as keyof typeof LOCATION_ICON
                  ] ?? Users;
                  // Under half an hour there is genuinely no room for a
                  // second line; at exactly 30 there is, and 30 is the most
                  // common meeting length in the app.
                  const short = mins < 30;

                  return (
                    <div
                      key={event.id}
                      data-event={event.id}
                      onPointerDown={beginMove(event, day)}
                      onPointerMove={dragEvent(event)}
                      onPointerUp={endEventDrag(event)}
                      onPointerCancel={cancelDrag}
                      onClick={(e) => { e.stopPropagation(); if (!draftRef.current) onOpen(event); }}
                      title={`${event.title} · ${clockLabel(start)} · ${durationLabel(mins)}`}
                      className={cn(
                        'group absolute z-[2] cursor-grab overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left transition-shadow active:cursor-grabbing',
                        'hover:shadow-[0_2px_8px_rgba(0,0,0,0.12)]',
                        cancelled && 'opacity-60',
                        elsewhere && 'opacity-25',
                      )}
                      style={{
                        top: `${(elsewhere ? top : drawTop) * 100}%`,
                        height: `${drawHeight * 100}%`,
                        // A sliver of inset so neighbouring blocks do not touch.
                        left: `calc(${left * 100}% + 2px)`,
                        width: `calc(${width * 100}% - 4px)`,
                        borderLeftColor: colour,
                        background: `color-mix(in srgb, ${colour} 16%, var(--bg-surface))`,
                      }}
                    >
                      <p className={cn(
                        'truncate text-caption font-semibold leading-tight text-[var(--text-primary)]',
                        cancelled && 'line-through',
                      )}>
                        {event.title}
                      </p>
                      {!short && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-micro text-[var(--text-secondary)]">
                          {/* Mid-drag the times ARE the answer, so they replace
                              everything decorative rather than sitting beside
                              it and being cut off. */}
                          {d ? (
                            <span className="tabular font-medium text-[var(--indigo)]">
                              {d.kind === 'move'
                                ? rangeLabel(d.day, d.startMinute, Math.min(DAY_MINUTES, d.startMinute + mins))
                                : rangeLabel(d.day, d.startMinute, d.endMinute)}
                            </span>
                          ) : (
                            <>
                              <Icon className="h-2.5 w-2.5 flex-shrink-0" />
                              {clockLabel(start)} · {durationLabel(mins)}
                              {clashes > 0 && <span className="text-[var(--text-tertiary)]">· clashes</span>}
                            </>
                          )}
                        </p>
                      )}

                      {/* Resize handle. Only on blocks tall enough to have one
                          without covering the title. */}
                      {!short && (
                        <div
                          onPointerDown={beginResize(event, day)}
                          onPointerMove={dragEvent(event)}
                          onPointerUp={endEventDrag(event)}
                          onPointerCancel={cancelDrag}
                          data-resize={event.id}
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100"
                          style={{ background: colour }}
                        />
                      )}
                    </div>
                  );
                })}

                {/* The block being drawn: a new one, or one dragged in from
                    another day. Never takes a pointer event — it exists only
                    to be looked at. */}
                {ghost && (
                  <div
                    data-provisional
                    className="pointer-events-none absolute inset-x-[2px] z-[4] overflow-hidden rounded-md border border-dashed px-1.5 py-1"
                    style={{
                      top: `${(ghost.from / DAY_MINUTES) * 100}%`,
                      height: `${(Math.max(DEFAULT_STEP, ghost.to - ghost.from) / DAY_MINUTES) * 100}%`,
                      borderColor: ghost.colour,
                      background: `color-mix(in srgb, ${ghost.colour} 22%, var(--bg-surface))`,
                    }}
                  >
                    <p className="truncate text-caption font-semibold leading-tight text-[var(--text-primary)]">
                      {ghost.title}
                    </p>
                    <p className="truncate text-micro tabular font-medium text-[var(--indigo)]">
                      {rangeLabel(day, ghost.from, ghost.to)}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
