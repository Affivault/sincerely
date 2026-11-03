import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock, Clock3, MailWarning, MessageSquareReply, Send } from 'lucide-react';
import { analyticsApi } from '../../api/analytics.api';
import { formatTime } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Today so far.

   The dashboard's figures were a period (7, 30, 90 days) and sat below
   the day's queue, so "is today going normally?" had no answer above the
   fold. This is that answer: sent, replies, bounces and meetings for
   today, each beside yesterday's, plus what is still queued before
   midnight. Each tile goes where you would act on it.

   A bounce rate over 3% is called out in red: that is the line mailbox
   providers start to care about, and it is worth stopping to look.
   ═══════════════════════════════════════════════════════════════════════ */

function Change({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  if (before === 0 && now === 0) return <span className="text-[var(--text-tertiary)]">same as yesterday</span>;
  if (before === 0) return <span className="text-[var(--text-tertiary)]">none yesterday</span>;
  const diff = now - before;
  if (diff === 0) return <span className="text-[var(--text-tertiary)]">same as yesterday</span>;
  const good = invert ? diff < 0 : diff > 0;
  return (
    <span className={good ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--text-secondary)]'}>
      {diff > 0 ? '+' : '−'}{Math.abs(diff).toLocaleString()} vs yesterday
    </span>
  );
}

function Tile({ to, icon: Icon, label, value, sub, tone = 'default' }: {
  to: string; icon: typeof Send; label: string; value: string; sub: ReactNode; tone?: 'default' | 'alert';
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex min-w-0 items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-hover)]',
        tone === 'alert' && 'bg-rose-500/[0.05]',
      )}
    >
      <span className={cn(
        'mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg',
        tone === 'alert' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] group-hover:text-[var(--indigo-text)]',
      )}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-caption text-[var(--text-tertiary)]">{label}</span>
        <span className={cn('block text-display font-semibold tabular leading-tight tracking-[-0.02em]', tone === 'alert' ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--text-primary)]')}>{value}</span>
        <span className="block text-caption truncate">{sub}</span>
      </span>
    </Link>
  );
}

export function TodayPulse() {
  const { data: t } = useQuery({
    queryKey: ['analytics', 'today'],
    queryFn: analyticsApi.today,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  if (!t) return null;

  const highBounce = t.sent >= 20 && t.bounce_rate > 3;
  const nextAt = t.next_meeting ? new Date(t.next_meeting.starts_at) : null;

  return (
    <section className="panel overflow-hidden" aria-label="Today so far" data-today-pulse>
      <div className="flex items-center gap-2 px-4 pt-3">
        <h2 className="text-strong font-semibold text-[var(--text-primary)]">Today so far</h2>
        {t.queued > 0 && (
          <span className="inline-flex items-center gap-1 text-caption text-[var(--text-tertiary)]">
            <Clock3 className="h-3 w-3" />
            {t.queued.toLocaleString()} more queued before midnight
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-[var(--border-subtle)] mt-1">
        <Tile to="/campaigns" icon={Send} label="Emails sent" value={t.sent.toLocaleString()} sub={<Change now={t.sent} before={t.sent_yesterday} />} />
        <Tile to="/inbox" icon={MessageSquareReply} label="Replies" value={t.replied.toLocaleString()} sub={<Change now={t.replied} before={t.replied_yesterday} />} />
        <Tile
          to="/leads"
          icon={MailWarning}
          label="Bounces"
          value={t.bounced.toLocaleString()}
          tone={highBounce ? 'alert' : 'default'}
          sub={highBounce
            ? <span className="text-rose-700 dark:text-rose-400 font-medium">{t.bounce_rate}% of today's sends - check your lists</span>
            : <Change now={t.bounced} before={t.bounced_yesterday} invert />}
        />
        <Tile
          to="/calendar"
          icon={CalendarClock}
          label="Meetings today"
          value={t.meetings.toLocaleString()}
          sub={nextAt
            ? <span className="text-[var(--text-secondary)]">Next {formatTime(nextAt)}{t.next_meeting?.contact_name ? ` with ${t.next_meeting.contact_name}` : ''}</span>
            : <span className="text-[var(--text-tertiary)]">{t.meetings ? 'All done for today' : 'Nothing booked'}</span>}
        />
      </div>
    </section>
  );
}
