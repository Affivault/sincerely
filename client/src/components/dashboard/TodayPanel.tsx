import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ArrowRight, Video, Phone, MapPin, Users } from 'lucide-react';
import {
  clockLabel, durationLabel, durationMinutes, resolveEnd,
  type CalendarEventType, type CrmEvent, formatLongWeekdayDate } from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';
import { calendarApi } from '../../api/calendar.api';
import { cn } from '../../lib/utils';
import { keepPrevious } from '../../lib/listQuery';
import { Refreshing } from '../ui/Refreshing';

/* ═══════════════════════════════════════════════════════════════════════
   What today actually looks like.

   The dashboard could tell you how a campaign performed last week and
   nothing at all about whether you are on a call in ten minutes - which is
   the one thing on this screen that is time-critical. A person opening
   this page at 08:55 needs the 09:00 before they need an open rate.
   ═══════════════════════════════════════════════════════════════════════ */

const LOCATION_ICON = { video: Video, phone: Phone, in_person: MapPin, other: Users } as const;

export function TodayPanel() {
  const dayRange = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }, []);

  const { data: events = [], isLoading, isPlaceholderData: stale } = useQuery({
    queryKey: ['crm', 'events', 'today', dayRange.from],
    queryFn: () => crmApi.listEvents(dayRange),
    // A meeting that appeared elsewhere should surface here without a reload.
    refetchInterval: 120_000,
    ...keepPrevious,
  });
  /*
   * Retired kinds included: this list is looked up in, not chosen from. A
   * meeting booked under a kind that has since been retired still has to
   * know its colour and how long it runs, which is precisely what retiring
   * one promises in its own confirmation.
   */
  const { data: types = [] } = useQuery({
    queryKey: ['calendar', 'types', 'all'],
    queryFn: () => calendarApi.listTypes({ includeArchived: true }),
  });

  const typeById = useMemo(() => {
    const m = new Map<string, CalendarEventType>();
    for (const t of types) m.set(t.id, t);
    return m;
  }, [types]);

  const now = new Date();

  /*
   * Today's meetings, still to come, plus whatever is running right now.
   * A meeting that finished an hour ago is history and would only push the
   * useful rows off the bottom of a small panel.
   */
  const upcoming = useMemo(() => {
    const todayStart = new Date(dayRange.from).getTime();
    const todayEnd = new Date(dayRange.to).getTime();
    return (events as CrmEvent[])
      .filter((e) => {
        if (e.status === 'cancelled') return false;
        const start = new Date(e.starts_at).getTime();
        if (start >= todayEnd || start < todayStart - 86_400_000) return false;
        const end = resolveEnd(e as any, typeById.get(e.event_type_id || '')?.duration_minutes).getTime();
        return end >= now.getTime();
      })
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
      .slice(0, 5);
  }, [events, typeById, dayRange, now]);

  const todayLabel = formatLongWeekdayDate(now);

  return (
    <section className="panel overflow-hidden flex flex-col">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-strong font-semibold text-[var(--text-primary)]">
            <CalendarDays className="h-3.5 w-3.5 text-[var(--indigo)]" />
            Today
          </h3>
          <p className="mt-0.5 truncate text-caption text-[var(--text-tertiary)]">{todayLabel}</p>
        </div>
        <Link
          to="/calendar"
          className="inline-flex flex-shrink-0 items-center gap-1 text-caption font-semibold text-[var(--indigo)] hover:underline"
        >
          Calendar <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <Refreshing active={stale}>
        {isLoading ? (
          <div className="px-4 py-6 space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-9 rounded-lg bg-[var(--bg-elevated)] animate-pulse" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
            <p className="text-body font-medium text-[var(--text-primary)]">Nothing left today</p>
            <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">
              A clear afternoon. Book something, or leave it clear.
            </p>
            <Link
              to="/calendar"
              className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Open the calendar
            </Link>
          </div>
        ) : (
          <div className="flex-1 divide-y divide-[var(--border-subtle)]">
            {upcoming.map((e) => {
              const type = typeById.get(e.event_type_id || '');
              const colour = e.colour || type?.colour || '#6366f1';
              const start = new Date(e.starts_at);
              const mins = durationMinutes(e as any, type?.duration_minutes);
              const end = resolveEnd(e as any, type?.duration_minutes);
              const live = start <= now && end >= now;
              // Ten minutes is about when somebody should be finding the link.
              const soon = !live && start.getTime() - now.getTime() <= 10 * 60_000;
              const Icon = LOCATION_ICON[(type?.location_kind ?? 'other') as keyof typeof LOCATION_ICON] ?? Users;

              return (
                <Link
                  key={e.id}
                  to="/calendar"
                  className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <span className="h-7 w-[3px] flex-shrink-0 rounded-full" style={{ background: colour }} />
                  <span className="w-[54px] flex-shrink-0">
                    <span className="block text-body font-semibold tabular text-[var(--text-primary)]">
                      {clockLabel(start)}
                    </span>
                    <span className="block text-micro tabular text-[var(--text-tertiary)]">
                      {durationLabel(mins)}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-[var(--text-primary)]">
                      {e.title}
                    </span>
                    <span className="flex items-center gap-1 truncate text-caption text-[var(--text-tertiary)]">
                      <Icon className="h-2.5 w-2.5 flex-shrink-0" />
                      {e.contact_name || type?.name || 'Meeting'}
                    </span>
                  </span>
                  {(live || soon) && (
                    <span className={cn(
                      'flex-shrink-0 rounded-full px-1.5 py-0.5 text-micro font-semibold',
                      live
                        ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                        : 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
                    )}>
                      {live ? 'Now' : 'Soon'}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </Refreshing>
    </section>
  );
}
