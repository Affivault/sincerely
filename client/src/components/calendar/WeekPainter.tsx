import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  WEEKDAY_SHORT, WEEKDAY_NAMES, minuteLabel, durationLabel,
  addRange, dragRange, moveRange, resizeRange, snapToStep, rangeProblem,
  DAY_MINUTES, DEFAULT_STEP,
  type AvailabilityWindow, type MinuteRange,
} from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Draw your week.

   MEASURED BEFORE THIS LANDED: the hours people may book you were set with
   a pair of `<input type="time">` per window and a Plus button per day. To
   say "Tuesdays, nine to twelve and two to six" you pressed Plus, typed
   09:00, tabbed, typed 12:00, pressed Plus again, typed 14:00, tabbed,
   typed 18:00 — and then did it four more times for the rest of the week,
   with nothing on screen ever showing the shape of what you had made.

   A working week IS a shape. It has a ragged edge on Friday afternoon and
   a hole where lunch is, and those are the two things people most want to
   see and the two things a column of time fields cannot show.

   So it is drawn. Press and drag down a day to make a window; drag a
   window to move it; drag its edges to stretch it. The typed fields are
   still underneath, because the grid rounds to the quarter hour and
   somebody whose day starts at 09:05 is not wrong.

   THE PART THAT IS NOT DECORATION: `replaceWindows` refuses a day whose
   windows overlap — it has to, or the same slot is offered twice. Painting
   over an existing window therefore cannot produce two windows; it has to
   merge. That is `addRange`, and without it every second gesture on this
   grid would end in a red toast some seconds later.
   ═══════════════════════════════════════════════════════════════════════ */

const HOUR_HEIGHT = 30;
const DAY_HEIGHT = HOUR_HEIGHT * 24;
const GUTTER = 44;
/** How close to an edge counts as taking hold of it, in pixels. */
const EDGE_GRAB = 6;

/** Monday first. A working week that starts on Sunday reads as a calendar bug. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

type Draft =
  | { kind: 'create'; weekday: number; anchorMinute: number; moved: boolean } & MinuteRange
  | { kind: 'move'; weekday: number; index: number; grabOffset: number } & MinuteRange
  | { kind: 'resize'; weekday: number; index: number; edge: 'start' | 'end' } & MinuteRange
  | null;

const pct = (minute: number) => (minute / DAY_MINUTES) * 100;

export function WeekPainter({ windows, onChange }: {
  windows: AvailabilityWindow[];
  onChange: (next: AvailabilityWindow[]) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useRef(new Map<number, HTMLElement>());
  const [draft, setDraft] = useState<Draft>(null);
  const draftRef = useRef<Draft>(null);
  draftRef.current = draft;
  const swallowClick = useRef(false);
  /** Which window has the keyboard, so it can be drawn as having it. */
  const [focused, setFocused] = useState<{ weekday: number; index: number } | null>(null);

  /** The week as ranges per day, sorted — the shape everything here works in. */
  const byDay = useMemo(() => {
    const m = new Map<number, MinuteRange[]>();
    for (let d = 0; d < 7; d++) m.set(d, []);
    for (const w of windows) {
      m.get(w.weekday)?.push({ startMinute: w.start_minute, endMinute: w.end_minute });
    }
    for (const list of m.values()) list.sort((a, b) => a.startMinute - b.startMinute);
    return m;
  }, [windows]);

  const rangesFor = useCallback((weekday: number) => byDay.get(weekday) || [], [byDay]);

  /** Put one day's ranges back, leaving the other six exactly as they were. */
  const replaceDay = useCallback((weekday: number, ranges: MinuteRange[]) => {
    const rest = windows.filter((w) => w.weekday !== weekday);
    onChange([
      ...rest,
      ...ranges.map((r) => ({ weekday, start_minute: r.startMinute, end_minute: r.endMinute })),
    ]);
  }, [windows, onChange]);

  /*
   * Open on the earliest hour anybody works, not on midnight. A week that
   * opens showing 00:00 to 08:00 shows eight hours of nothing, every time.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const earliest = windows.reduce((min, w) => Math.min(min, w.start_minute), 9 * 60);
    el.scrollTop = Math.max(0, (Math.min(earliest, 9 * 60) / 60) * HOUR_HEIGHT - HOUR_HEIGHT);
    // First paint only: re-running would yank the view while somebody drags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minuteFromPointer = (clientY: number, column: HTMLElement): number => {
    const rect = column.getBoundingClientRect();
    return snapToStep(((clientY - rect.top) / rect.height) * DAY_MINUTES);
  };

  /* ── Gestures ─────────────────────────────────────────────────────── */

  const beginOnWindow = (weekday: number, index: number, range: MinuteRange) =>
    (e: React.PointerEvent) => {
      if (e.button !== 0 || e.pointerType === 'touch') return;
      e.stopPropagation();
      swallowClick.current = false;
      const column = columns.current.get(weekday);
      if (!column) return;

      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const fromTop = e.clientY - box.top;
      const fromBottom = box.bottom - e.clientY;
      /*
       * A short window has no room for two edges and a body. Grabbing the
       * edge of a 15-minute block would make it impossible to move, so
       * below twice the grab zone the whole thing is a body.
       */
      const edged = box.height > EDGE_GRAB * 3;

      if (edged && fromTop <= EDGE_GRAB) {
        setDraft({ kind: 'resize', weekday, index, edge: 'start', ...range });
      } else if (edged && fromBottom <= EDGE_GRAB) {
        setDraft({ kind: 'resize', weekday, index, edge: 'end', ...range });
      } else {
        setDraft({
          kind: 'move', weekday, index,
          grabOffset: minuteFromPointer(e.clientY, column) - range.startMinute,
          ...range,
        });
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

  const beginOnEmpty = (weekday: number) => (e: React.PointerEvent) => {
    swallowClick.current = false;
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    // Touch keeps the tap: capturing a touch inside a scroller is how a
    // grid becomes a thing you cannot scroll past.
    if (e.pointerType === 'touch') return;
    const anchor = minuteFromPointer(e.clientY, e.currentTarget as HTMLElement);
    setDraft({ kind: 'create', weekday, anchorMinute: anchor, moved: false, ...dragRange(anchor, anchor) });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const drag = (e: React.PointerEvent) => {
    const d = draftRef.current;
    if (!d) return;
    const column = columns.current.get(d.weekday);
    if (!column) return;
    const minute = minuteFromPointer(e.clientY, column);

    if (d.kind === 'create') {
      setDraft({ ...d, moved: d.moved || minute !== d.anchorMinute, ...dragRange(d.anchorMinute, minute) });
    } else if (d.kind === 'move') {
      setDraft({ ...d, ...moveRange(d, minute - d.grabOffset) });
    } else {
      setDraft({ ...d, ...resizeRange(d, d.edge, minute) });
    }
  };

  const end = () => {
    const d = draftRef.current;
    setDraft(null);
    if (!d) return;
    const next: MinuteRange = { startMinute: d.startMinute, endMinute: d.endMinute };

    if (d.kind === 'create') {
      if (!d.moved) return;    // A click. Handled as a click, below.
      swallowClick.current = true;
      replaceDay(d.weekday, addRange(rangesFor(d.weekday), next));
      return;
    }
    swallowClick.current = true;
    /*
     * The window being dragged is taken out before the new position goes
     * in. Merging it against its own old self would have every move grow
     * the window to cover where it came from as well.
     */
    const rest = rangesFor(d.weekday).filter((_, i) => i !== d.index);
    replaceDay(d.weekday, addRange(rest, next));
  };

  /*
   * A cancelled pointer leaves a draft standing, and a standing draft draws
   * a window at a position that was never committed.
   */
  const cancel = () => setDraft(null);

  /** A plain click on empty grid: an hour, starting there. */
  const clickEmpty = (weekday: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (swallowClick.current) { swallowClick.current = false; return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const start = snapToStep(((e.clientY - rect.top) / rect.height) * DAY_MINUTES);
    replaceDay(weekday, addRange(rangesFor(weekday), {
      startMinute: Math.min(start, DAY_MINUTES - 60),
      endMinute: Math.min(start + 60, DAY_MINUTES),
    }));
  };

  const removeAt = (weekday: number, index: number) =>
    replaceDay(weekday, rangesFor(weekday).filter((_, i) => i !== index));

  /**
   * Keyboard, because a grid you can only paint on is a grid half the
   * people who need this page cannot use at all.
   *
   * Arrows move the window; Shift-arrows stretch its end; Delete removes
   * it. Every one of them goes back through the same merge, so a window
   * nudged into its neighbour joins it rather than becoming an overlap the
   * server will refuse.
   */
  const onKey = (weekday: number, index: number, range: MinuteRange) =>
    (e: React.KeyboardEvent) => {
      const rest = rangesFor(weekday).filter((_, i) => i !== index);
      const commit = (next: MinuteRange) => {
        e.preventDefault();
        replaceDay(weekday, addRange(rest, next));
      };
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const delta = (e.key === 'ArrowUp' ? -1 : 1) * DEFAULT_STEP;
        commit(e.shiftKey
          ? resizeRange(range, 'end', range.endMinute + delta)
          : moveRange(range, range.startMinute + delta));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setFocused(null);
        removeAt(weekday, index);
      }
    };

  /** What a day's ranges look like RIGHT NOW, draft included. */
  const drawn = (weekday: number): { range: MinuteRange; index: number; ghost: boolean }[] => {
    const list = rangesFor(weekday).map((range, index) => ({ range, index, ghost: false }));
    const d = draft;
    if (!d || d.weekday !== weekday) return list;
    const range: MinuteRange = { startMinute: d.startMinute, endMinute: d.endMinute };
    if (d.kind === 'create') return [...list, { range, index: -1, ghost: true }];
    return list.map((item) => (item.index === d.index ? { ...item, range, ghost: true } : item));
  };

  const problem = useMemo(() => {
    for (const weekday of ORDER) {
      const p = rangeProblem(rangesFor(weekday), WEEKDAY_NAMES[weekday]);
      if (p) return p;
    }
    return null;
  }, [rangesFor]);

  const totalHours = useMemo(
    () => Math.round((windows.reduce((n, w) => n + (w.end_minute - w.start_minute), 0) / 60) * 10) / 10,
    [windows],
  );

  return (
    <div data-week-painter>
      {/* Day headings */}
      <div className="flex border-b border-[var(--border-subtle)] bg-[var(--bg-muted)]">
        <div style={{ width: GUTTER }} className="flex-shrink-0" />
        {ORDER.map((weekday) => {
          const mins = rangesFor(weekday).reduce((n, r) => n + (r.endMinute - r.startMinute), 0);
          return (
            <div key={weekday} className="flex-1 min-w-0 border-l border-[var(--border-subtle)] px-1 py-1.5 text-center">
              <p className={cn(
                'text-micro font-semibold uppercase tracking-wide',
                mins > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
              )}>
                {WEEKDAY_SHORT[weekday]}
              </p>
              <p className="mt-0.5 truncate text-micro tabular text-[var(--text-tertiary)]">
                {mins > 0 ? durationLabel(mins) : 'Off'}
              </p>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="relative overflow-y-auto" style={{ maxHeight: 340 }}>
        <div className="flex" style={{ height: DAY_HEIGHT }}>
          <div style={{ width: GUTTER }} className="relative flex-shrink-0 select-none">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-micro tabular text-[var(--text-tertiary)]"
                style={{ top: h * HOUR_HEIGHT }}
              >
                {h === 0 ? '' : minuteLabel(h * 60)}
              </div>
            ))}
          </div>

          {ORDER.map((weekday) => (
            <div
              key={weekday}
              data-availability-day={weekday}
              ref={(el) => {
                if (el) columns.current.set(weekday, el);
                else columns.current.delete(weekday);
              }}
              className={cn(
                'relative flex-1 min-w-0 cursor-crosshair border-l border-[var(--border-subtle)]',
                draft && 'select-none',
              )}
              onPointerDown={beginOnEmpty(weekday)}
              onPointerMove={drag}
              onPointerUp={end}
              onPointerCancel={cancel}
              onClick={clickEmpty(weekday)}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="pointer-events-none absolute inset-x-0 border-t border-[var(--border-subtle)] opacity-60"
                  style={{ top: h * HOUR_HEIGHT }}
                />
              ))}

              {drawn(weekday).map(({ range, index, ghost }) => {
                const isFocused = focused?.weekday === weekday && focused.index === index;
                return (
                  <div
                    /*
                     * Keyed by POSITION IN THE DAY, not by the times it
                     * covers. Keying on the minutes remounts the element on
                     * every nudge, and a remounted element does not have
                     * focus - so one press of an arrow key moved the window
                     * and threw the keyboard out of the grid.
                     */
                    key={index}
                    data-availability-window={`${weekday}-${range.startMinute}`}
                    role="group"
                    tabIndex={index >= 0 ? 0 : -1}
                    aria-label={
                      `${WEEKDAY_NAMES[weekday]} ${minuteLabel(range.startMinute)} to ${minuteLabel(range.endMinute)}. `
                      + 'Arrow keys move it, shift and arrow keys change its end, delete removes it.'
                    }
                    onFocus={() => setFocused({ weekday, index })}
                    onBlur={() => setFocused(null)}
                    onKeyDown={index >= 0 ? onKey(weekday, index, range) : undefined}
                    onPointerDown={index >= 0 ? beginOnWindow(weekday, index, range) : undefined}
                    /*
                     * Stopped here rather than allowed to bubble: the column
                     * underneath runs the same two handlers, and its copy of
                     * `end` would read the draft ref before React had cleared
                     * it and commit the very same gesture a second time.
                     */
                    onPointerMove={(e) => { e.stopPropagation(); drag(e); }}
                    onPointerUp={(e) => { e.stopPropagation(); end(); }}
                    onPointerCancel={(e) => { e.stopPropagation(); cancel(); }}
                    onClick={(e) => e.stopPropagation()}
                    title={`${minuteLabel(range.startMinute)} – ${minuteLabel(range.endMinute)} · ${durationLabel(range.endMinute - range.startMinute)}`}
                    className={cn(
                      'group absolute inset-x-[2px] z-[2] cursor-grab overflow-hidden rounded-md px-1 text-left',
                      'border border-[var(--indigo)]/40 bg-[var(--indigo-subtle)] active:cursor-grabbing',
                      'outline-none focus-visible:shadow-[var(--ring-focus)]',
                      ghost && 'border-dashed ring-2 ring-[var(--indigo)]',
                      isFocused && 'border-[var(--indigo)]',
                    )}
                    style={{
                      top: `${pct(range.startMinute)}%`,
                      height: `${pct(Math.max(DEFAULT_STEP, range.endMinute - range.startMinute))}%`,
                    }}
                  >
                    {/* The times, whenever the block is tall enough to hold
                        them. Below that the block itself is the statement. */}
                    {range.endMinute - range.startMinute >= 45 && (
                      <p className="truncate pt-0.5 text-micro tabular font-medium leading-tight text-[var(--indigo)]">
                        {minuteLabel(range.startMinute)}–{minuteLabel(range.endMinute)}
                      </p>
                    )}
                    {index >= 0 && (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); removeAt(weekday, index); }}
                        title="Remove this window"
                        className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl text-micro font-bold text-[var(--indigo)] opacity-0 transition-opacity hover:bg-[var(--indigo)] hover:text-white group-hover:opacity-100"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-4 py-2">
        <p className="text-caption text-[var(--text-tertiary)]">
          Drag down a day to open it up. Drag a block to move it, its edges to stretch it,
          or press Delete on it to close that time again.
        </p>
        <p className="text-caption tabular text-[var(--text-secondary)]" data-total-hours>
          {totalHours} bookable hour{totalHours === 1 ? '' : 's'} a week
        </p>
      </div>

      {/*
        The server has the last word on this and answers with a 400. That is
        the right place for the last word and the wrong place for the only
        one: an overlap typed into the fields below used to look entirely
        fine until Save, and the message named a weekday rather than a field.
      */}
      {problem && (
        <p role="alert" data-week-problem className="border-t border-[var(--border-subtle)] px-4 py-2 text-caption text-[var(--error)]">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Whether a week can be saved at all, in the words the button will use. */
export function weekProblem(windows: AvailabilityWindow[]): string | null {
  const byDay = new Map<number, MinuteRange[]>();
  for (const w of windows) {
    const list = byDay.get(w.weekday) || [];
    list.push({ startMinute: w.start_minute, endMinute: w.end_minute });
    byDay.set(w.weekday, list);
  }
  for (const [weekday, list] of byDay) {
    const p = rangeProblem(list, WEEKDAY_NAMES[weekday]);
    if (p) return p;
  }
  return null;
}
