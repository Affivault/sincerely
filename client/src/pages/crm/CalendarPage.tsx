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
  Handshake, User, Clock, CheckSquare,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CrmEvent, CrmTask } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Calendar.

   Meetings AND dated activities share the grid — a calendar that only knows
   about meetings lies to you about how full the day is. Everything is
   drag-to-reschedule, and clicking empty space books at that time.
   ═══════════════════════════════════════════════════════════════════════ */

type View = 'month' | 'week' | 'agenda';

/** One thing on the calendar, from either source. */
type Item =
  | { kind: 'event'; at: Date; event: CrmEvent }
  | { kind: 'task'; at: Date; task: CrmTask };

function itemTime(i: Item): number { return i.at.getTime(); }

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
  return allDay ? 'All day' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A chip on a month cell / week column. */
function ItemChip({ item, onOpen, onDragStart, compact }: {
  item: Item; onOpen: () => void; onDragStart: () => void; compact?: boolean;
}) {
  if (item.kind === 'event') {
    const e = item.event;
    const Icon = e.type === 'call' ? Phone : Users;
    return (
      <button
        draggable
        onDragStart={onDragStart}
        onClick={(ev) => { ev.stopPropagation(); onOpen(); }}
        title={`${e.title}${e.location ? ` · ${e.location}` : ''}`}
        className="w-full flex items-center gap-1 px-1.5 py-1 rounded-md bg-[var(--indigo-subtle)] border border-[var(--indigo)]/25 text-left cursor-grab active:cursor-grabbing hover:border-[var(--indigo)]/60 transition-colors"
      >
        <Icon className="h-2.5 w-2.5 flex-shrink-0 text-[var(--indigo)]" />
        <span className="flex-1 min-w-0 truncate text-[10.5px] font-medium text-[var(--indigo)]">{e.title}</span>
        {!compact && !e.all_day && (
          <span className="text-[9.5px] tabular text-[var(--indigo)]/70 flex-shrink-0">{timeOf(item.at)}</span>
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
      onClick={(ev) => { ev.stopPropagation(); onOpen(); }}
      title={t.title}
      className={cn(
        'w-full flex items-center gap-1 px-1.5 py-1 rounded-md border text-left cursor-grab active:cursor-grabbing transition-colors',
        'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]',
        t.is_done && 'opacity-50',
      )}
    >
      <Icon className={cn('h-2.5 w-2.5 flex-shrink-0', TASK_TYPE_TONE[t.type]?.split(' ')[0])} />
      <span className={cn('flex-1 min-w-0 truncate text-[10.5px] font-medium text-[var(--text-secondary)]', t.is_done && 'line-through')}>
        {t.title}
      </span>
    </button>
  );
}

export function CalendarPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>('month');
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

  const { data: events = [] } = useQuery({
    queryKey: ['crm', 'events', range.from, range.to],
    queryFn: () => crmApi.listEvents(range),
  });
  const { data: tasks = [] } = useQuery({ queryKey: ['crm', 'tasks'], queryFn: () => crmApi.listTasks() });

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
  }, [events, tasks]);

  const itemsFor = (d: Date) => byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) || [];

  /* ── Drag to reschedule ─────────────────────────────────────────────
     Dropping on a day keeps the original time of day and only moves the
     date — nobody means "move this 10am call to midnight". */
  const reschedule = useMutation({
    mutationFn: async ({ item, day }: { item: Item; day: Date }) => {
      const original = item.at;
      const next = new Date(day);
      next.setHours(original.getHours(), original.getMinutes(), 0, 0);
      if (item.kind === 'event') {
        // Preserve the duration when there's an end time.
        const ends = item.event.ends_at ? new Date(item.event.ends_at) : null;
        const durationMs = ends && !Number.isNaN(ends.getTime()) ? ends.getTime() - original.getTime() : null;
        return crmApi.updateEvent(item.event.id, {
          starts_at: next.toISOString(),
          ends_at: durationMs != null ? new Date(next.getTime() + durationMs).toISOString() : undefined,
        });
      }
      return crmApi.updateTask(item.task.id, { due_date: next.toISOString() });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm'] }); toast.success('Rescheduled'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not reschedule'),
  });

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
      else d.setDate(d.getDate() + 14 * dir);
      return d;
    });
  };

  const today = startOfDay(new Date());
  const days = view === 'week' ? weekDays(anchor) : monthMatrix(anchor);

  const periodLabel = view === 'week'
    ? (() => {
        const w = weekDays(anchor);
        const a = w[0], b = w[6];
        const same = a.getMonth() === b.getMonth();
        return same
          ? `${a.toLocaleDateString(undefined, { day: 'numeric' })}–${b.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`
          : `${a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
      })()
    : anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

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
    () => events.filter((e) => new Date(e.starts_at) >= today).length,
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
            <button onClick={() => bookAt(today, new Date().getHours() + 1)} className="btn-primary">
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
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)] tracking-[-0.01em] min-w-[190px]">{periodLabel}</h2>
          <button
            onClick={() => setAnchor(startOfDay(new Date()))}
            className="h-8 px-3 rounded-lg border border-[var(--border-subtle)] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Today
          </button>

          <div className="ml-auto flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
            {(['month', 'week', 'agenda'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  'h-7 px-3 rounded-md text-[12px] font-medium capitalize transition-colors',
                  view === v ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {view === 'agenda' ? (
          <div className="panel overflow-hidden">
            {agenda.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <CalendarDays className="h-6 w-6 mx-auto text-[var(--text-muted)] mb-2" />
                <p className="text-[13px] font-medium text-[var(--text-primary)]">Nothing scheduled from here on</p>
                <p className="text-[12px] text-[var(--text-tertiary)] mt-1">Book a meeting or schedule an activity and it'll appear.</p>
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
                        <span className={cn('text-[12.5px] font-semibold', isToday ? 'text-[var(--indigo)]' : 'text-[var(--text-primary)]')}>
                          {isToday ? 'Today' : item.at.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => openItem(item)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <span className="w-16 flex-shrink-0 text-[11.5px] tabular font-medium text-[var(--text-tertiary)]">
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
                          'block text-[13px] font-medium text-[var(--text-primary)] truncate',
                          item.kind === 'task' && item.task.is_done && 'line-through opacity-60',
                        )}>
                          {item.kind === 'event' ? item.event.title : item.task.title}
                        </span>
                        <span className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--text-tertiary)]">
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
                          className="hidden sm:inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[var(--border-subtle)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
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
        ) : (
          <div className="panel overflow-hidden">
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
              {DOW.map((d) => (
                <div key={d} className="px-2 py-2 text-[11px] font-semibold text-[var(--text-tertiary)] text-center">{d}</div>
              ))}
            </div>

            <div className={cn('grid grid-cols-7', view === 'month' ? 'grid-rows-6' : 'grid-rows-1')}>
              {days.map((day) => {
                const items = itemsFor(day);
                const inMonth = view === 'week' || day.getMonth() === anchor.getMonth();
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
                      if (dragging) reschedule.mutate({ item: dragging, day });
                      setDragging(null);
                      setDropDay(null);
                    }}
                    onClick={() => bookAt(day)}
                    className={cn(
                      'group relative border-b border-r border-[var(--border-subtle)] p-1.5 cursor-pointer transition-colors',
                      view === 'month' ? 'min-h-[104px]' : 'min-h-[420px]',
                      !inMonth && 'bg-[var(--bg-elevated)]/40',
                      isDropTarget ? 'bg-[var(--indigo-subtle)] ring-1 ring-inset ring-[var(--indigo)]/50' : 'hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn(
                        'inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular',
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
                      {items.slice(0, view === 'month' ? 3 : 12).map((item) => (
                        <ItemChip
                          key={`${item.kind}-${item.kind === 'event' ? item.event.id : item.task.id}`}
                          item={item}
                          compact={view === 'month'}
                          onOpen={() => openItem(item)}
                          onDragStart={() => setDragging(item)}
                        />
                      ))}
                      {view === 'month' && items.length > 3 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setAnchor(startOfDay(day)); setView('week'); }}
                          className="w-full text-left px-1.5 text-[10px] font-medium text-[var(--text-tertiary)] hover:text-[var(--indigo)] transition-colors"
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

        <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-tertiary)]">
          <Clock className="h-3 w-3" />
          Drag any meeting or activity onto another day to reschedule it — the time of day is kept.
        </p>
      </div>

      {eventModal && <MeetingModal event={eventModal.event} onClose={() => setEventModal(null)} />}
      {taskModalOpen && <ActivityModal task={taskModal} onClose={() => setTaskModalOpen(false)} />}
    </div>
  );
}
