import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { crmApi } from '../../api/crm.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { cn } from '../../lib/utils';
import {
  ActivityModal, MeetingModal, TASK_TYPE_ICON, TASK_TYPE_TONE,
  startOfDay, sameDay,
} from '../../components/crm/CrmPrimitives';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Phone, Users, MapPin,
  Handshake, User, Clock, CheckSquare, Keyboard,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CrmEvent, CrmTask } from '@lemlist/shared';
import { CALENDAR_SHORTCUTS, durationLabel, durationMinutes, resolveEnd, formatDate, formatDayMonth, formatDayOfMonth, formatFullDate, formatLongWeekdayDate, formatMonthYear, formatTime, formatWeekdayDate, viewFromCommand, type CalendarCommand } from '@lemlist/shared';
import { calendarApi, availabilityApi } from '../../api/calendar.api';
import { TimeGrid, type GridEvent } from '../../components/calendar/TimeGrid';
import { EventTypeBar } from '../../components/calendar/EventTypeBar';
import { keepPrevious } from '../../lib/listQuery';
import { useOptimisticRow } from '../../lib/optimistic';
import { useCalendarKeys } from '../../hooks/useCalendarKeys';
import { useUndoLastChange } from '../../hooks/useUndoable';
import { Refreshing } from '../../components/ui/Refreshing';

/* ═══════════════════════════════════════════════════════════════════════
   Calendar.

   Meetings AND dated activities share the grid — a calendar that only knows
   about meetings lies to you about how full the day is. Everything is
   drag-to-reschedule, and clicking empty space books at that time.
   ═══════════════════════════════════════════════════════════════════════ */

type View = 'day' | 'week' | 'month' | 'agenda';

/** One thing on the calendar, from either source. */
type Item =
  | { kind: 'event'; at: Date; event: CrmEvent }
  | { kind: 'task'; at: Date; task: CrmTask };

function itemTime(i: Item): number { return i.at.getTime(); }

/** The filter's name for "no kind at all", which is a kind of its own here. */
const NO_KIND = 'none';

/**
 * The next whole hour — or tomorrow morning, once today has run out.
 *
 * `bookAt(today, new Date().getHours() + 1)` reads as "in an hour" and is,
 * for twenty-three hours of the day. At 23:20 it asked for hour 24, which
 * Date normalises to the next day at MIDNIGHT, so the one time anybody is
 * likely to press this late in the evening offered a meeting at midnight.
 */
function nextHour(): Date {
  const at = new Date();
  const today = at.getDate();
  at.setMinutes(0, 0, 0);
  at.setHours(at.getHours() + 1);
  if (at.getDate() !== today) at.setHours(9, 0, 0, 0);
  return at;
}

function monthMatrix(anchor: Date): Date[] {
  // Monday-first grid covering the whole month plus the spill either side.
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function weekDays(anchor: Date): Date[] {
  const offset = (anchor.getDay() + 6) % 7;
  const start = startOfDay(new Date(anchor));
  start.setDate(start.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function timeOf(d: Date, allDay?: boolean): string {
  return allDay ? 'All day' : formatTime(d);
}

/** A chip on a month cell / week column. */
function ItemChip({ item, onOpen, onDragStart, onDragEnd, compact }: {
  item: Item; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void; compact?: boolean;
}) {
  if (item.kind === 'event') {
    const e = item.event;
    const Icon = e.type === 'call' ? Phone : Users;
    /*
     * A meeting called off looks called off HERE TOO. The time grid struck
     * it through and dimmed it; the month and the agenda drew it exactly
     * like a meeting that was still happening, so the same week read two
     * different ways depending on which view you were in.
     */
    const off = e.status === 'cancelled';
    return (
      <button
        draggable
        onDragStart={onDragStart}
        /*
         * A drag released anywhere but a day cell used to leave `dragging`
         * set for good - no drop, no dragleave, nothing to clear it - so
         * the page went on believing a drag was in progress and the next
         * cell you crossed lit up as a drop target for it.
         */
        onDragEnd={onDragEnd}
        onClick={(ev) => { ev.stopPropagation(); onOpen(); }}
        title={`${e.title}${off ? ' · called off' : ''}${e.location ? ` · ${e.location}` : ''}`}
        className={cn(
          'w-full flex items-center gap-1 px-1.5 py-1 rounded-md bg-[var(--indigo-subtle)] border border-[var(--indigo)]/25 text-left cursor-grab active:cursor-grabbing hover:border-[var(--indigo)]/60 transition-colors',
          off && 'opacity-60',
        )}
      >
        <Icon className="h-2.5 w-2.5 flex-shrink-0 text-[var(--indigo)]" />
        <span className={cn(
          'flex-1 min-w-0 truncate text-micro font-medium text-[var(--indigo)]',
          off && 'line-through',
        )}>{e.title}</span>
        {!compact && !e.all_day && (
          <span className="text-micro tabular text-[var(--indigo)]/70 flex-shrink-0">{timeOf(item.at)}</span>
        )}
      </button>
    );
  }
  const t = item.task;
  const Icon = TASK_TYPE_ICON[t.type] || CheckSquare;
  return (
    <button
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(ev) => { ev.stopPropagation(); onOpen(); }}
      title={t.title}
      className={cn(
        'w-full flex items-center gap-1 px-1.5 py-1 rounded-md border text-left cursor-grab active:cursor-grabbing transition-colors',
        'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]',
        t.is_done && 'opacity-50',
      )}
    >
      <Icon className={cn('h-2.5 w-2.5 flex-shrink-0', TASK_TYPE_TONE[t.type]?.split(' ')[0])} />
      <span className={cn('flex-1 min-w-0 truncate text-micro font-medium text-[var(--text-secondary)]', t.is_done && 'line-through')}>
        {t.title}
      </span>
    </button>
  );
}

export function CalendarPage() {
  const qc = useQueryClient();
  /*
   * Week, not month. A month grid answers "what is the shape of my month";
   * a week answers "what am I doing", which is why anybody opens this.
   */
  const [view, setView] = useState<View>('week');
  /** Kinds of meeting hidden from the grid. Local, not stored. */
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [eventModal, setEventModal] = useState<{ event: Partial<CrmEvent> | null } | null>(null);
  const [taskModal, setTaskModal] = useState<Partial<CrmTask> | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [dragging, setDragging] = useState<Item | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);

  // Fetch a generous window so moving between months rarely refetches.
  const range = useMemo(() => {
    const from = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 0, 23, 59, 59);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [anchor]);

  const { data: events = [], isPlaceholderData: stale } = useQuery({
    queryKey: ['crm', 'events', range.from, range.to],
    queryFn: () => crmApi.listEvents(range),
    ...keepPrevious,
  });
  const { data: tasks = [] } = useQuery({ queryKey: ['crm', 'tasks'], queryFn: () => crmApi.listTasks() });
  /*
   * Retired kinds included, on purpose.
   *
   * This list is what the grid LOOKS A MEETING'S KIND UP IN, and retiring a
   * kind promises in its own confirmation that the meetings already booked
   * keep it. They did not: a retired kind was absent from this list, so
   * every demo in the past fell back to the default indigo and to thirty
   * minutes the moment the Demo kind was retired.
   */
  const { data: types = [] } = useQuery({
    queryKey: ['calendar', 'types', 'all'],
    queryFn: () => calendarApi.listTypes({ includeArchived: true }),
  });
  /** The ones still in use — what the bar offers and what may be filtered. */
  const liveTypes = useMemo(() => types.filter((t) => !t.archived_at), [types]);

  /*
   * The hours people may book you, drawn behind the grid.
   *
   * The two halves of the scheduler were two unrelated screens: this page
   * knew nothing about the availability the booking page was offering on
   * your behalf, so a week that looked wide open could be closed to
   * everybody, and a Saturday you had opened up looked exactly like a
   * Saturday you had not.
   *
   * Failure is silent on purpose. Shading is context, not content, and a
   * calendar that will not draw because a secondary request 500'd is a
   * calendar that has failed at its actual job.
   */
  const { data: availability } = useQuery({
    queryKey: ['calendar', 'availability'],
    queryFn: availabilityApi.get,
    retry: false,
    meta: { silentError: true },
  });

  /*
   * THE FILTER APPLIES TO EVERY VIEW.
   *
   * It used to be applied when building the time grid's events and nowhere
   * else, so hiding a kind hid it in the week and the day and left it fully
   * visible in the month and the agenda - and the bar carrying the filter
   * was not rendered in either of those, so there was nothing on screen to
   * say why. Switching view silently un-hid things.
   */
  const isVisible = (e: CrmEvent) => !hidden.has(e.event_type_id || NO_KIND);

  /** What the time grid draws, after the colour filters. */
  const gridEvents = useMemo<GridEvent[]>(
    () => events.filter(isVisible).map((e) => e as unknown as GridEvent),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, hidden],
  );

  /** Whether anything on screen has no kind at all, so the bar can offer it. */
  const hasUnsorted = useMemo(() => events.some((e) => !e.event_type_id), [events]);

  /** Everything on the calendar, keyed by local day. */
  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const push = (i: Item) => {
      const k = key(i.at);
      const arr = map.get(k);
      if (arr) arr.push(i); else map.set(k, [i]);
    };
    for (const e of events) {
      if (!isVisible(e)) continue;
      const at = new Date(e.starts_at);
      if (!Number.isNaN(at.getTime())) push({ kind: 'event', at, event: e });
    }
    for (const t of tasks) {
      if (!t.due_date) continue;
      const at = new Date(t.due_date);
      if (!Number.isNaN(at.getTime())) push({ kind: 'task', at, task: t });
    }
    for (const arr of map.values()) arr.sort((a, b) => itemTime(a) - itemTime(b));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, tasks, hidden]);

  const itemsFor = (d: Date) => byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) || [];

  /* ── Drag to reschedule ─────────────────────────────────────────────
     Dropping on a day keeps the original time of day and only moves the
     date — nobody means "move this 10am call to midnight". */
  /*
   * MEASURED BEFORE THIS LANDED: every drag on this page rubber-banded.
   *
   * TimeGrid clears its draft the instant the pointer comes up, and the
   * mutation only invalidated on success - so the block you had just
   * dragged to Thursday snapped back to Tuesday, sat there for the length
   * of the round trip, and then jumped to Thursday. The one place a
   * calendar most needs to feel direct was the one place it looked like
   * the save had failed and then changed its mind.
   *
   * The shared helper rather than a hand-rolled setQueryData: the same
   * event is in the month cache, the agenda's, and the dashboard's today
   * panel, and patching one exact key would have made it instant in one
   * place and late in three.
   */
  const optimisticEvent = useOptimisticRow<{ id: string; starts_at?: string; ends_at?: string | null }>({
    scope: ['crm'],
    id: (v) => v.id,
    patch: (v) => {
      const next: Record<string, unknown> = {};
      if (v.starts_at !== undefined) next.starts_at = v.starts_at;
      if (v.ends_at !== undefined) next.ends_at = v.ends_at;
      return next;
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not move that'),
  });

  /** Drag on the time grid. The block stays where it was dropped. */
  const moveEvent = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; starts_at?: string; ends_at?: string | null }) =>
      crmApi.updateEvent(id, patch as any),
    // Spread last: an onError written after this would replace the rollback.
    ...optimisticEvent,
  });

  /*
   * The same optimism for the month view's drag.
   *
   * It was left rubber-banding when the week view stopped: the chip you had
   * just dropped on Thursday sat on Tuesday for the length of the round
   * trip and then jumped. One calendar behaving two ways depending on which
   * view you were in is worse than either behaviour on its own.
   */
  const rescheduleTask = useMutation({
    mutationFn: ({ id, due_date }: { id: string; due_date: string }) =>
      crmApi.updateTask(id, { due_date }),
    ...useOptimisticRow<{ id: string; due_date: string }>({
      scope: ['crm'],
      id: (v) => v.id,
      patch: (v) => ({ due_date: v.due_date }),
      onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not reschedule'),
    }),
  });

  /*
   * A way back from every change, because direct manipulation without one
   * is a thing people learn to be careful around.
   *
   * A drag is the easiest gesture in the app to do by accident - a meeting
   * nudged to the wrong day on the way to clicking it - and until now the
   * only way back was to notice, work out where it had come from, and drag
   * it there. Google has offered this since 2010 and it is most of why
   * dragging on a calendar feels safe rather than nervy.
   */
  const offerUndo = useUndoLastChange();

  /** Put an event back exactly as it was, whatever moved. */
  const undoEvent = (e: CrmEvent, label: string) => offerUndo(
    label,
    () => moveEvent.mutateAsync({
      id: e.id,
      starts_at: e.starts_at,
      // null, not undefined: a meeting that had no end must get none back.
      // Undefined would be dropped from the payload and the end it picked
      // up on the way would silently stand.
      ends_at: e.ends_at ?? null,
    }),
  );

  const reschedule = ({ item, day }: { item: Item; day: Date }) => {
    const original = item.at;
    const next = new Date(day);
    next.setHours(original.getHours(), original.getMinutes(), 0, 0);
    if (next.getTime() === original.getTime()) return;

    if (item.kind === 'event') {
      // Preserve the duration when there's an end time.
      const ends = item.event.ends_at ? new Date(item.event.ends_at) : null;
      const durationMs = ends && !Number.isNaN(ends.getTime()) ? ends.getTime() - original.getTime() : null;
      moveEvent.mutate({
        id: item.event.id,
        starts_at: next.toISOString(),
        ends_at: durationMs != null ? new Date(next.getTime() + durationMs).toISOString() : undefined,
      });
      undoEvent(item.event, `Moved to ${formatWeekdayDate(next)}`);
      return;
    }
    const was = item.task.due_date!;
    rescheduleTask.mutate({ id: item.task.id, due_date: next.toISOString() });
    offerUndo(`Moved to ${formatWeekdayDate(next)}`,
      () => rescheduleTask.mutateAsync({ id: item.task.id, due_date: was }));
  };

  const openItem = (i: Item) => {
    if (i.kind === 'event') setEventModal({ event: i.event });
    else { setTaskModal(i.task); setTaskModalOpen(true); }
  };

  const bookAt = (day: Date, hour = 9) => {
    const at = new Date(day);
    at.setHours(hour, 0, 0, 0);
    setEventModal({ event: { starts_at: at.toISOString() } as Partial<CrmEvent> });
  };

  const shift = (dir: -1 | 1) => {
    setAnchor((a) => {
      const d = new Date(a);
      if (view === 'month') d.setMonth(d.getMonth() + dir);
      else if (view === 'week') d.setDate(d.getDate() + 7 * dir);
      else if (view === 'day') d.setDate(d.getDate() + dir);
      else d.setDate(d.getDate() + 14 * dir);
      return d;
    });
  };

  /*
   * The keys, which a calendar needs more than any other screen here.
   *
   * What people do on a calendar is not "an action" but navigation -
   * forward a week, back a week, back to today, show me the month - dozens
   * of times in a sitting, and each one was a deliberate trip to a
   * 32-pixel chevron or across the header to a segmented control.
   *
   * The bindings are Google Calendar's and come from shared, so the
   * shortcuts sheet and this cannot disagree about what any of them is.
   */
  useCalendarKeys((command: CalendarCommand) => {
    const next = viewFromCommand(command);
    if (next) { setView(next); return; }
    if (command === 'today') { setAnchor(startOfDay(new Date())); return; }
    if (command === 'prev') { shift(-1); return; }
    if (command === 'next') { shift(1); return; }
    // Whatever the view, `c` means the same thing it does everywhere else
    // on this page: the next free hour, not midnight and not 9am tomorrow.
    if (command === 'create') {
      setEventModal({ event: { starts_at: nextHour().toISOString() } as Partial<CrmEvent> });
    }
  });

  const today = startOfDay(new Date());
  const days = view === 'week' ? weekDays(anchor) : view === 'day' ? [startOfDay(anchor)] : monthMatrix(anchor);

  const periodLabel = view === 'day'
    ? formatFullDate(anchor)
    : view === 'week'
    ? (() => {
        const w = weekDays(anchor);
        const a = w[0], b = w[6];
        const same = a.getMonth() === b.getMonth();
        return same
          ? `${formatDayOfMonth(a)}–${b.getDate()} ${formatMonthYear(b)}`
          : `${formatDayMonth(a)} – ${formatDate(b)}`;
      })()
    : formatMonthYear(anchor);

  /* ── Agenda: a flat chronological list from today forward ── */
  const agenda = useMemo(() => {
    const all: Item[] = [];
    for (const arr of byDay.values()) all.push(...arr);
    const from = startOfDay(anchor).getTime();
    return all
      .filter((i) => i.at.getTime() >= from)
      .sort((a, b) => itemTime(a) - itemTime(b))
      .slice(0, 100);
  }, [byDay, anchor]);

  const upcomingCount = useMemo(
    () => events.filter((e) => e.status !== 'cancelled' && new Date(e.starts_at) >= today).length,
    [events, today],
  );

  return (
    <div>
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(99,102,241,0.18)]">
            <CalendarDays className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Calendar"
        description={
          upcomingCount > 0
            ? `${upcomingCount} meeting${upcomingCount === 1 ? '' : 's'} ahead · activities with a due date show here too`
            : 'Meetings and dated activities, together — drag anything to reschedule it'
        }
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => { setTaskModal(null); setTaskModalOpen(true); }} className="btn-secondary">
              <CheckSquare className="h-3.5 w-3.5" /> Activity
            </button>
            <button
              onClick={() => setEventModal({ event: { starts_at: nextHour().toISOString() } as Partial<CrmEvent> })}
              className="btn-primary"
            >
              <Plus className="h-3.5 w-3.5" /> Book meeting
            </button>
          </div>
        }
      />

      <div className="space-y-3">
        {/* Period navigation + view switch */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <button onClick={() => shift(-1)} className="icon-btn h-8 w-8" title="Previous"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => shift(1)} className="icon-btn h-8 w-8" title="Next"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <h2 className="text-heading font-semibold text-[var(--text-primary)] tracking-[-0.01em] min-w-[190px]">{periodLabel}</h2>
          <button
            onClick={() => setAnchor(startOfDay(new Date()))}
            className="h-8 px-3 rounded-lg border border-[var(--border-subtle)] text-body font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Today
          </button>

          <div className="ml-auto flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
            {(['day', 'week', 'month', 'agenda'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  'h-7 px-3 rounded-md text-body font-medium capitalize transition-colors',
                  view === v ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Every view, not just the two that used to have it. It is a legend
            as much as a filter, and a filter you cannot see the state of is
            how a month looks emptier than it is. */}
        {liveTypes.length > 0 && (
          <EventTypeBar
            types={liveTypes}
            hidden={hidden}
            showUnsorted={hasUnsorted}
            onToggle={(id) => setHidden((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
          />
        )}

        <Refreshing active={stale}>
          {view === 'agenda' ? (
            <div className="panel overflow-hidden">
              {agenda.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <CalendarDays className="h-6 w-6 mx-auto text-[var(--text-muted)] mb-2" />
                  <p className="text-strong font-medium text-[var(--text-primary)]">Nothing scheduled from here on</p>
                  <p className="text-body text-[var(--text-tertiary)] mt-1">Book a meeting or schedule an activity and it'll appear.</p>
                </div>
              ) : (
                agenda.map((item, i) => {
                  const prev = agenda[i - 1];
                  const newDay = !prev || !sameDay(prev.at, item.at);
                  const isToday = sameDay(item.at, today);
                  const contactId = item.kind === 'event' ? item.event.contact_id : item.task.contact_id;
                  const contactName = item.kind === 'event'
                    ? (item.event.contact_name || item.event.contact_email)
                    : item.task.contact_name;
                  const deal = item.kind === 'event' ? item.event.deal : item.task.deal;
                  return (
                    <div key={`${item.kind}-${item.kind === 'event' ? item.event.id : item.task.id}`}>
                      {newDay && (
                        <div className={cn(
                          'flex items-baseline gap-2 px-4 py-2 border-b border-[var(--border-subtle)]',
                          isToday ? 'bg-[var(--indigo-subtle)]/40' : 'bg-[var(--bg-elevated)]/50',
                        )}>
                          <span className={cn('text-body font-semibold', isToday ? 'text-[var(--indigo)]' : 'text-[var(--text-primary)]')}>
                            {isToday ? 'Today' : formatLongWeekdayDate(item.at)}
                          </span>
                        </div>
                      )}
                      <button
                        onClick={() => openItem(item)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors"
                      >
                        <span className="w-16 flex-shrink-0 text-caption tabular font-medium text-[var(--text-tertiary)]">
                          {item.kind === 'event' ? timeOf(item.at, item.event.all_day) : timeOf(item.at)}
                        </span>
                        <span className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0',
                          item.kind === 'event'
                            ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                            : TASK_TYPE_TONE[item.task.type] || TASK_TYPE_TONE.todo,
                        )}>
                          {item.kind === 'event'
                            ? (item.event.type === 'call' ? <Phone className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />)
                            : (() => { const I = TASK_TYPE_ICON[item.task.type] || CheckSquare; return <I className="h-3.5 w-3.5" />; })()}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className={cn(
                            'block text-strong font-medium text-[var(--text-primary)] truncate',
                            item.kind === 'task' && item.task.is_done && 'line-through opacity-60',
                            // Same as the grid and the month: a meeting called
                            // off reads as called off in every view.
                            item.kind === 'event' && item.event.status === 'cancelled' && 'line-through opacity-60',
                          )}>
                            {item.kind === 'event' ? item.event.title : item.task.title}
                          </span>
                          <span className="flex items-center gap-2 mt-0.5 text-caption text-[var(--text-tertiary)]">
                            {item.kind === 'event' && item.event.location && (
                              <span className="inline-flex items-center gap-1 truncate"><MapPin className="h-3 w-3" />{item.event.location}</span>
                            )}
                            {contactName && (
                              <span className="inline-flex items-center gap-1 truncate"><User className="h-3 w-3" />{contactName}</span>
                            )}
                            {deal && (
                              <span className="inline-flex items-center gap-1 truncate"><Handshake className="h-3 w-3" />{deal.title}</span>
                            )}
                          </span>
                        </span>
                        {contactId && (
                          <Link
                            to={`/contacts/${contactId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hidden sm:inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[var(--border-subtle)] text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
                          >
                            Profile
                          </Link>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          ) : view === 'week' || view === 'day' ? (
            /*
               A real grid, against a clock. What used to be here was the month
               renderer with taller cells: chips stacked in a column, so a 9am
               standup and a two-hour workshop looked the same and a clash was
               invisible. Everything that makes this a calendar rather than a
               list lives in TimeGrid.
            */
            <TimeGrid
              days={days}
              events={gridEvents}
              types={types}
              now={new Date()}
              onOpen={(e) => setEventModal({ event: e as unknown as CrmEvent })}
              onBookAt={(at) => setEventModal({ event: { starts_at: at.toISOString() } as Partial<CrmEvent> })}
              /*
                 Drawn out rather than clicked, so the length is already
                 decided and arrives with it. Clicking gave a default-length
                 meeting at the time clicked and left resizing it as a
                 separate act — which is why "block out two until four" took
                 two gestures on a surface built for one.
              */
              onCreateRange={(start, end) => setEventModal({
                event: {
                  starts_at: start.toISOString(),
                  ends_at: end.toISOString(),
                } as Partial<CrmEvent>,
              })}
              workingHours={availability?.windows || []}
              onMove={(e, start) => {
                // Length is preserved: dragging a block moves it, it does not
                // reshape it. Resizing is the handle on its bottom edge.
                const mins = durationMinutes(e, types.find((t) => t.id === e.event_type_id)?.duration_minutes);
                moveEvent.mutate({
                  id: e.id,
                  starts_at: start.toISOString(),
                  ends_at: new Date(start.getTime() + mins * 60000).toISOString(),
                });
                undoEvent(e as unknown as CrmEvent, `Moved to ${formatWeekdayDate(start)} ${formatTime(start)}`);
              }}
              onResize={(e, end) => {
                moveEvent.mutate({ id: e.id, ends_at: end.toISOString() });
                undoEvent(e as unknown as CrmEvent,
                  `Now ${durationLabel(Math.max(1, Math.round((end.getTime() - new Date(e.starts_at).getTime()) / 60000)))} long`);
              }}
            />
          ) : (
            <div className="panel overflow-hidden">
              {/* Day-of-week header */}
              <div className="grid grid-cols-7 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
                {DOW.map((d) => (
                  <div key={d} className="px-2 py-2 text-caption font-semibold text-[var(--text-tertiary)] text-center">{d}</div>
                ))}
              </div>

              <div className={cn('grid grid-cols-7', view === 'month' ? 'grid-rows-6' : 'grid-rows-1')}>
                {days.map((day) => {
                  const items = itemsFor(day);
                  const inMonth = day.getMonth() === anchor.getMonth();
                  const isToday = sameDay(day, today);
                  const dayKey = day.toISOString();
                  const isDropTarget = dropDay === dayKey && !!dragging;
                  return (
                    <div
                      key={dayKey}
                      onDragOver={(e) => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropDay(dayKey); } }}
                      onDragLeave={() => setDropDay((k) => (k === dayKey ? null : k))}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragging) reschedule({ item: dragging, day });
                        setDragging(null);
                        setDropDay(null);
                      }}
                      onClick={() => bookAt(day)}
                      className={cn(
                        'group relative border-b border-r border-[var(--border-subtle)] p-1.5 cursor-pointer transition-colors',
                        'min-h-[104px]',
                        !inMonth && 'bg-[var(--bg-elevated)]/40',
                        isDropTarget ? 'bg-[var(--indigo-subtle)] ring-1 ring-inset ring-[var(--indigo)]/50' : 'hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn(
                          'inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-caption font-semibold tabular',
                          isToday ? 'bg-[var(--indigo)] text-white' : inMonth ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]',
                        )}>
                          {day.getDate()}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); bookAt(day); }}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity icon-btn h-5 w-5"
                          title="Book a meeting on this day"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="space-y-1">
                        {items.slice(0, 3).map((item) => (
                          <ItemChip
                            key={`${item.kind}-${item.kind === 'event' ? item.event.id : item.task.id}`}
                            item={item}
                            compact
                            onOpen={() => openItem(item)}
                            onDragStart={() => setDragging(item)}
                            onDragEnd={() => { setDragging(null); setDropDay(null); }}
                          />
                        ))}
                        {items.length > 3 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setAnchor(startOfDay(day)); setView('week'); }}
                            className="w-full text-left px-1.5 text-micro font-medium text-[var(--text-tertiary)] hover:text-[var(--indigo)] transition-colors"
                          >
                            +{items.length - 3} more
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Refreshing>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-[var(--text-tertiary)]">
          <p className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            {view === 'week' || view === 'day'
              ? 'Drag down the empty grid to block out a stretch of time, or click once to book at that moment. Drag a meeting to move it — to another day if you like — or its bottom edge to change how long it runs.'
              : 'Drag any meeting or activity onto another day to reschedule it — the time of day is kept.'}
          </p>
          {/* The keys, said once where somebody is already looking at the
              thing they drive. A shortcuts sheet behind `?` is only found by
              people who already suspect there is one. */}
          <p className="flex items-center gap-1.5">
            <Keyboard className="h-3 w-3" />
            {CALENDAR_SHORTCUTS.map((s) => s.keys.join('')).join(' · ')}
            {' — press ? for what they do'}
          </p>
        </div>
      </div>

      {eventModal && <MeetingModal event={eventModal.event} onClose={() => setEventModal(null)} />}
      {taskModalOpen && <ActivityModal task={taskModal} onClose={() => setTaskModalOpen(false)} />}
    </div>
  );
}
