import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Video, Phone, MapPin, Users } from 'lucide-react';
import {
  layoutDay, allDayEvents, durationMinutes, resolveEnd, snapMinutes,
  clockLabel, durationLabel, minutesIntoDay,
  type CalendarEventType, type TimedEvent,
} from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   A day, drawn against a clock.

   The old week view was seven tall boxes with chips stacked inside them —
   a month view with more air. It could not show when anything started, how
   long it ran, or that two things clashed, which is most of what somebody
   opens a calendar to find out. A 9am standup and a two-hour workshop
   looked identical.

   Here an event is a block: its top is its start, its height is its
   length, and things happening at once sit side by side. Empty space is
   clickable and books at the time you clicked, which is the difference
   between a calendar and a read-only list of meetings made elsewhere.
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

/** A drag in progress, before it is committed. */
type Draft =
  | { kind: 'move'; id: string; startMinutes: number; grabOffset: number; day: Date }
  | { kind: 'resize'; id: string; endMinutes: number }
  | null;

export function TimeGrid({
  days, events, types, onOpen, onBookAt, onMove, onResize, now = new Date(),
}: {
  days: Date[];
  events: GridEvent[];
  types: CalendarEventType[];
  onOpen: (event: GridEvent) => void;
  /** Empty space was clicked: book something at this exact moment. */
  onBookAt: (at: Date) => void;
  onMove: (event: GridEvent, newStart: Date) => void;
  onResize: (event: GridEvent, newEnd: Date) => void;
  now?: Date;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const draftRef = useRef<Draft>(null);
  draftRef.current = draft;

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

  const minutesFromPointer = (e: React.PointerEvent | PointerEvent, column: HTMLElement): number => {
    const rect = column.getBoundingClientRect();
    const y = (e as PointerEvent).clientY - rect.top;
    return snapMinutes((y / rect.height) * 24 * 60);
  };

  const beginMove = (event: GridEvent, day: Date) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const column = (e.currentTarget as HTMLElement).closest('[data-daycol]') as HTMLElement;
    if (!column) return;
    const start = new Date(event.starts_at);
    const grabbedAt = minutesFromPointer(e, column);
    setDraft({
      kind: 'move',
      id: event.id,
      startMinutes: minutesIntoDay(start),
      // Where in the block they grabbed it, so it does not jump so the
      // cursor sits at the top edge.
      grabOffset: grabbedAt - minutesIntoDay(start),
      day,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const beginResize = (event: GridEvent) => (e: React.PointerEvent) => {
    e.stopPropagation();
    setDraft({
      kind: 'resize',
      id: event.id,
      endMinutes: minutesIntoDay(resolveEnd(event, minutesOf(event))),
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (event: GridEvent, day: Date) => (e: React.PointerEvent) => {
    const d = draftRef.current;
    if (!d || d.id !== event.id) return;
    const column = (e.currentTarget as HTMLElement).closest('[data-daycol]') as HTMLElement;
    if (!column) return;
    const at = minutesFromPointer(e, column);

    if (d.kind === 'move') {
      setDraft({ ...d, startMinutes: snapMinutes(at - d.grabOffset), day });
    } else {
      // Never shorter than one snap step, or the block becomes unclickable.
      const startMin = minutesIntoDay(new Date(event.starts_at));
      setDraft({ ...d, endMinutes: Math.max(startMin + 15, at) });
    }
  };

  const endDrag = (event: GridEvent) => () => {
    const d = draftRef.current;
    setDraft(null);
    if (!d || d.id !== event.id) return;

    if (d.kind === 'move') {
      const next = new Date(d.day);
      next.setHours(0, d.startMinutes, 0, 0);
      if (next.getTime() !== new Date(event.starts_at).getTime()) onMove(event, next);
    } else {
      const start = new Date(event.starts_at);
      const next = new Date(start);
      next.setHours(0, d.endMinutes, 0, 0);
      if (next.getTime() !== resolveEnd(event, minutesOf(event)).getTime()) onResize(event, next);
    }
  };

  return (
    <div className="panel overflow-hidden">
      {/* ── Day headings, and the all-day strip beneath them ── */}
      <div className="flex border-b border-[var(--border-subtle)] bg-[var(--bg-muted)]">
        <div style={{ width: GUTTER }} className="flex-shrink-0" />
        {days.map((day) => {
          const isToday = day.toDateString() === nowDate.toDateString();
          const allDay = allDayEvents(events, day);
          return (
            <div key={day.toISOString()} className="flex-1 min-w-0 border-l border-[var(--border-subtle)]">
              <div className="px-2 py-1.5 text-center">
                <p className="text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </p>
                <p className={cn(
                  'mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold tabular',
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
                      className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[10.5px] font-medium text-white"
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
                className="absolute right-2 -translate-y-1/2 text-[10.5px] tabular text-[var(--text-tertiary)]"
                style={{ top: h * HOUR_HEIGHT }}
              >
                {h === 0 ? '' : new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const placed = layoutDay(events, day, minutesOf);
            const isToday = day.toDateString() === nowDate.toDateString();

            return (
              <div
                key={day.toISOString()}
                data-daycol
                className="relative flex-1 min-w-0 border-l border-[var(--border-subtle)]"
                onClick={(e) => {
                  // Only bare grid, never a click that landed on a block.
                  if (e.target !== e.currentTarget) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const minutes = snapMinutes(((e.clientY - rect.top) / rect.height) * 24 * 60);
                  const at = new Date(day);
                  at.setHours(0, minutes, 0, 0);
                  onBookAt(at);
                }}
              >
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
                  const d = draft?.id === event.id ? draft : null;
                  const mins = durationMinutes(event, minutesOf(event));
                  const start = new Date(event.starts_at);

                  // While dragging, draw from the draft so the block follows
                  // the cursor instead of waiting for the server.
                  let drawTop = top;
                  let drawHeight = height;
                  if (d?.kind === 'move') drawTop = d.startMinutes / (24 * 60);
                  if (d?.kind === 'resize') {
                    drawHeight = Math.max(15, d.endMinutes - minutesIntoDay(start)) / (24 * 60);
                  }

                  const cancelled = event.status === 'cancelled';
                  const colour = colourOf(event);
                  const Icon = LOCATION_ICON[
                    (types.find((t) => t.id === event.event_type_id)?.location_kind ?? 'other') as keyof typeof LOCATION_ICON
                  ] ?? Users;
                  const short = mins <= 30;

                  return (
                    <div
                      key={event.id}
                      data-event={event.id}
                      onPointerDown={beginMove(event, day)}
                      onPointerMove={onPointerMove(event, day)}
                      onPointerUp={endDrag(event)}
                      onClick={(e) => { e.stopPropagation(); if (!draftRef.current) onOpen(event); }}
                      title={`${event.title} · ${clockLabel(start)} · ${durationLabel(mins)}`}
                      className={cn(
                        'group absolute z-[2] cursor-grab overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left transition-shadow active:cursor-grabbing',
                        'hover:shadow-[0_2px_8px_rgba(0,0,0,0.12)]',
                        cancelled && 'opacity-60',
                      )}
                      style={{
                        top: `${drawTop * 100}%`,
                        height: `${drawHeight * 100}%`,
                        // A sliver of inset so neighbouring blocks do not touch.
                        left: `calc(${left * 100}% + 2px)`,
                        width: `calc(${width * 100}% - 4px)`,
                        borderLeftColor: colour,
                        background: `color-mix(in srgb, ${colour} 16%, var(--bg-surface))`,
                      }}
                    >
                      <p className={cn(
                        'truncate text-[11.5px] font-semibold leading-tight text-[var(--text-primary)]',
                        cancelled && 'line-through',
                      )}>
                        {event.title}
                      </p>
                      {!short && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-[var(--text-secondary)]">
                          <Icon className="h-2.5 w-2.5 flex-shrink-0" />
                          {clockLabel(start)} · {durationLabel(mins)}
                          {clashes > 0 && <span className="text-[var(--text-tertiary)]">· clashes</span>}
                        </p>
                      )}

                      {/* Resize handle. Only on blocks tall enough to have one
                          without covering the title. */}
                      {!short && (
                        <div
                          onPointerDown={beginResize(event)}
                          onPointerMove={onPointerMove(event, day)}
                          onPointerUp={endDrag(event)}
                          data-resize={event.id}
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100"
                          style={{ background: colour }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
