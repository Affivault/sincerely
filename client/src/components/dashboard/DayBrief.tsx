import type { ReactNode } from 'react';
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { formatLongWeekdayDate, formatTime, type RateReadout } from '@lemlist/shared';
import { analyticsApi, type TrendDataPoint } from '../../api/analytics.api';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   The top of Home, written as the opening of a letter.

   Sincerely writes letters to strangers, and the first screen of the day
   read like every other dashboard: a greeting, then four identical tiles
   with an icon each. This says the same things the way a colleague would
   - "42 emails have gone out today and 3 people have written back" - with
   each figure a link to where you would act on it, and then sets the same
   figures out once, as a ledger, for anyone who wants the columns.

   The salutation is the one place in the app set in the serif the landing
   page uses. Everything under it stays in the working face.
   ═══════════════════════════════════════════════════════════════════════ */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** A figure in the brief: the number, and the way to what it counts. */
function Fig({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="font-semibold tabular text-[var(--text-primary)] underline decoration-[var(--border-strong)] decoration-1 underline-offset-[3px] transition-colors hover:text-[var(--indigo-text)] hover:decoration-[var(--indigo)]"
    >
      {children}
    </Link>
  );
}

const n = (v: number) => v.toLocaleString();

function Change({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  if (before === 0 && now === 0) return <span>same as yesterday</span>;
  if (before === 0) return <span>none yesterday</span>;
  const diff = now - before;
  if (diff === 0) return <span>same as yesterday</span>;
  const good = invert ? diff < 0 : diff > 0;
  return (
    <span className={good ? 'text-emerald-700 dark:text-emerald-400' : undefined}>
      {diff > 0 ? '+' : '−'}{n(Math.abs(diff))} vs yesterday
    </span>
  );
}

/** One column of the ledger. No icon: the label already says what it is. */
function Cell({ to, label, value, sub, alert, quiet, className, children }: {
  to: string; label: string; value: string; sub: ReactNode;
  alert?: boolean; quiet?: boolean; className?: string; children?: ReactNode;
}) {
  return (
    <Link to={to} className={cn('group flex min-w-0 items-end justify-between gap-4 px-5 py-4 transition-colors hover:bg-[var(--bg-muted)]', className)}>
      <span className="min-w-0">
        <span className="block text-body text-[var(--text-tertiary)]">{label}</span>
        <span className={cn(
          'mt-1.5 block font-semibold tabular leading-none tracking-[-0.03em]',
          quiet ? 'text-heading text-[var(--text-tertiary)]' : 'text-hero',
          !quiet && (alert ? 'text-[var(--error)]' : 'text-[var(--text-primary)]'),
        )}>{value}</span>
        <span className="mt-2 block truncate text-caption text-[var(--text-tertiary)]">{sub}</span>
      </span>
      {children}
    </Link>
  );
}

/** Replies per day over the period, as a line you can read at a glance. */
function Spark({ values }: { values: number[] }) {
  const id = useId();
  const max = Math.max(...values, 0);
  if (values.length < 2 || max === 0) return null;
  const W = 100, H = 36, pad = 3;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    H - pad - (v / max) * (H - pad * 2),
  ]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className="h-10 w-full max-w-[150px] flex-shrink overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--indigo)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--indigo)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--indigo)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DayBrief({ name, period, activeCampaigns, contacts, sentInPeriod, reply, trend, everSent, onNew, children }: {
  name: string;
  period: number;
  activeCampaigns: number;
  contacts: number;
  sentInPeriod: number;
  /** The period's reply rate, or the honest "too early" in its place. */
  reply: RateReadout;
  trend: TrendDataPoint[];
  everSent: boolean;
  onNew: () => void;
  /** Whatever has to be said between the brief and the ledger (a stopped job, what changed while away). */
  children?: ReactNode;
}) {
  const { data: t } = useQuery({
    queryKey: ['analytics', 'today'],
    queryFn: analyticsApi.today,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const highBounce = !!t && t.sent >= 20 && t.bounce_rate > 3;
  const next = t?.next_meeting ?? null;

  return (
    <div className="space-y-5" data-day-brief>
      <header className="pt-1 sm:pt-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p className="text-body text-[var(--text-tertiary)]">{formatLongWeekdayDate(new Date())}</p>
            <h1 className="salutation mt-1.5">
              {greeting()}, <span className="capitalize">{name}</span>.
            </h1>
          </div>
          {/* A phone has the create button in its top bar already. */}
          <button className="btn-primary hidden sm:inline-flex" onClick={onNew}>
            <Plus className="h-3.5 w-3.5" /> New campaign
          </button>
        </div>

        <p className="mt-4 max-w-[64ch] text-[16px] leading-[1.65] text-[var(--text-secondary)] sm:text-[17px]" data-brief>
          {!everSent ? (
            <>Nothing has been sent from this workspace yet. The first campaign is the next step, and Relay can draft it with you.</>
          ) : t ? (
            <>
              {t.sent > 0
                ? <><Fig to="/campaigns">{n(t.sent)} {t.sent === 1 ? 'email' : 'emails'}</Fig> {t.sent === 1 ? 'has' : 'have'} gone out today</>
                : <>Nothing has gone out yet today</>}
              {t.replied > 0
                ? <> and <Fig to="/inbox">{n(t.replied)} {t.replied === 1 ? 'person has' : 'people have'} written back</Fig>.</>
                : t.sent > 0 ? <>, with no replies so far.</> : <>.</>}
              {t.queued > 0 && <> {n(t.queued)} more {t.queued === 1 ? 'is' : 'are'} queued before midnight.</>}
              {next
                ? <> Your next meeting is <Fig to="/calendar">{next.title}</Fig> at {formatTime(new Date(next.starts_at))}{next.contact_name ? ` with ${next.contact_name}` : ''}.</>
                : t.meetings > 0 ? <> Today's meetings are done.</> : null}
              {highBounce && (
                <> <span className="font-medium text-[var(--error)]">{t.bounce_rate}% of today's sends bounced</span>, which is worth a look at <Fig to="/leads">your lists</Fig>.</>
              )}
            </>
          ) : (
            <>Here is where things stand.</>
          )}
        </p>
        {everSent && (
          <p className="mt-2 max-w-[64ch] text-strong text-[var(--text-tertiary)]" title={reply.hint}>
            {activeCampaigns > 0 ? n(activeCampaigns) : 'No'} active {activeCampaigns === 1 ? 'campaign' : 'campaigns'} and {n(contacts)} contacts
            {reply.isRate
              ? <>, averaging a <span className="font-medium tabular text-[var(--text-secondary)]">{reply.label}</span> reply rate over the last {period} days.</>
              : <>. {n(sentInPeriod)} sent in the last {period} days, too early for a reply rate.</>}
          </p>
        )}
      </header>

      {children}

      {everSent && t && (
        <section
          aria-label="Today so far"
          data-today-pulse
          className="fact-strip grid-cols-2 sm:grid-cols-4 lg:grid-cols-[1fr_1fr_1fr_1fr_1.7fr]"
        >
          <Cell to="/campaigns" label="Sent today" value={n(t.sent)} sub={<Change now={t.sent} before={t.sent_yesterday} />} />
          <Cell to="/inbox" label="Replies" value={n(t.replied)} sub={<Change now={t.replied} before={t.replied_yesterday} />} />
          <Cell
            to="/leads"
            label="Bounces"
            value={n(t.bounced)}
            alert={highBounce}
            sub={highBounce
              ? <span className="font-medium text-[var(--error)]">{t.bounce_rate}% of today's sends</span>
              : <Change now={t.bounced} before={t.bounced_yesterday} invert />}
          />
          <Cell
            to="/calendar"
            label="Meetings today"
            value={n(t.meetings)}
            sub={next
              ? <>Next at {formatTime(new Date(next.starts_at))}</>
              : t.meetings ? 'All done for today' : 'Nothing booked'}
          />
          <Cell
            to="/analytics"
            label="Reply rate"
            value={reply.label}
            quiet={!reply.isRate}
            sub={<>Last {period} days</>}
            className="col-span-2 sm:col-span-4 lg:col-span-1"
          >
            <Spark values={trend.map((d) => Number(d.replied) || 0)} />
          </Cell>
        </section>
      )}
    </div>
  );
}
