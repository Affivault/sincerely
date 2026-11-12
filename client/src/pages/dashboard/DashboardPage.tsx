import { DayBrief } from '../../components/dashboard/DayBrief';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TodayPanel } from '../../components/dashboard/TodayPanel';
import { TodayQueue } from '../../components/flow/TodayQueue';
import { StatusLine } from '../../components/dashboard/StatusLine';
import { AwayCard } from '../../components/flow/AwayCard';
import { analyticsApi, type TrendDataPoint } from '../../api/analytics.api';
import { settingsApi } from '../../api/settings.api';
import { useAuth } from '../../context/AuthContext';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { SetupChecklist } from '../../components/setup/SetupChecklist';
import { InlineEmpty } from '../../components/shared/EmptyState';
import { PipelineSnapshot } from '../../components/dashboard/PipelineSnapshot';
import { rateReadout, averageRateReadout, rateBarWidth, type RateReadout, formatDayMonth } from '@lemlist/shared';
import {
  Send, MousePointerClick, MessageSquare, CalendarCheck,
  ChevronRight, ArrowUp, ArrowDown, Download, Megaphone, Activity, Sparkles,
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { Segmented, DAY_RANGES } from '../../components/ui/Segmented';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

/* ═══════════════════════════════════════════════════════════════════════
   Sincerely — Dashboard
   A command center, not a report. The page answers three questions in
   order: What needs me right now? (today, queue, calendar) - How is it
   going? (one performance module: outcomes first, the period control
   beside the chart it changes) - What's working? (active campaigns by
   reply rate, and the pipeline they feed). Nothing is counted twice.
   ═══════════════════════════════════════════════════════════════════════ */

// The shared ink token, so the chart follows the buttons (and dark mode).
const ACCENT = 'var(--indigo)';

/* ─── Formatters ─────────────────────────────────────── */
const fmtNum = (n: number | undefined | null): string => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (v >= 10_000) return `${(v / 1_000).toFixed(0)}K`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
};
const fmtFull = (n: number | undefined | null): string => (Number(n) || 0).toLocaleString();
const fmtPct = (n: number | undefined | null): string => `${(Number(n) || 0).toFixed(1)}%`;
// The server's days are 'YYYY-MM-DD'. new Date() reads that as UTC midnight,
// which is the previous evening anywhere west of UTC - every label a day
// early - so it is read as a local date.
const fmtDate = (d: string) => formatDayMonth(new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d));

/* ─── Metric config ─────────────────────────────────── */
const METRICS = {
  sent:     { label: 'Sent',             icon: Send },
  replied:  { label: 'Replied',          icon: MessageSquare },
  meetings: { label: 'Meetings booked',  icon: CalendarCheck },
  clicked:  { label: 'Clicked',          icon: MousePointerClick },
} as const;
type MetricKey = keyof typeof METRICS;

const PERIODS = DAY_RANGES;

/* ─── Delta (the only place red/green appears) ─────────── */
function Delta({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null || !isFinite(value)) {
    return <span className={cn('text-body font-medium text-[var(--text-tertiary)]', className)}>—</span>;
  }
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-body font-semibold tabular',
      flat ? 'text-[var(--text-tertiary)]' : up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
      className
    )}>
      {!flat && (up ? <ArrowUp className="h-3 w-3" strokeWidth={2.5} /> : <ArrowDown className="h-3 w-3" strokeWidth={2.5} />)}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* ─── Metric cell — one selectable column in the performance module ── */
/*
 * A metric, and whether it has earned the right to be a percentage.
 *
 * `readout` carries that decision. Below the sample it can support, the
 * cell says what it really is - "Too early" - and drops the change arrow,
 * because a "+12%" swing computed off nine sends is the same fiction as
 * the rate itself, in a shape that looks even more like news.
 */
function MetricCell({ label, value, delta, active, onClick, readout }: {
  label: string; value: string; delta?: number | null; active: boolean; onClick: () => void;
  readout?: RateReadout;
}) {
  const unproven = !!readout && !readout.isRate;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative flex-1 min-w-0 px-4 py-3 text-left transition-colors',
        active ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-muted)] hover:bg-[var(--bg-surface)]'
      )}
      title={readout?.hint}
    >
      {/* Active metric gets a hairline accent along the top edge */}
      <span className={cn(
        'absolute top-0 left-0 right-0 h-[2px] transition-opacity',
        active ? 'opacity-100' : 'opacity-0'
      )} style={{ background: ACCENT }} />
      <span className="block text-body font-medium text-[var(--text-tertiary)] truncate">{label}</span>
      <span className="mt-1 flex items-baseline gap-2">
        <span className={cn(
          'font-semibold tabular leading-none tracking-[-0.02em]',
          // Smaller and quieter, because it is not a measurement.
          unproven ? 'text-heading text-[var(--text-tertiary)]' : 'text-title',
          !unproven && (active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'),
        )} data-metric-value>{readout ? readout.label : value}</span>
        {!unproven && <Delta value={delta} />}
      </span>
    </button>
  );
}

/* ─── Panel header ──────────────────────────────────── */
function Head({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)]">
      <div className="min-w-0">
        <h2 className="text-strong font-semibold text-[var(--text-primary)] tracking-[-0.01em] leading-tight truncate">{title}</h2>
        {desc && <p className="text-body text-[var(--text-tertiary)] leading-tight mt-0.5 truncate">{desc}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

function MoreLink({ to, label = 'View all' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="text-body font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] inline-flex min-h-6 items-center gap-0.5 transition-colors">
      {label} <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  );
}

/* ─── Performance chart ─────────────────────────────── */
function ChartTooltip({ active, payload, label, metricLabel }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] px-2.5 py-1.5">
      <div className="text-caption font-medium text-[var(--text-tertiary)] mb-0.5">{fmtDate(label)}</div>
      <div className="flex items-center gap-2 text-body">
        <span className="text-[var(--text-secondary)]">{metricLabel}</span>
        <span className="font-semibold tabular text-[var(--text-primary)]">{fmtFull(payload[0].value)}</span>
      </div>
    </div>
  );
}

function PerformanceChart({ data, metric }: { data: TrendDataPoint[]; metric: MetricKey }) {
  if (!data.length) {
    return (
      <div className="h-[268px] flex flex-col items-center justify-center gap-2 text-center">
        <Activity className="h-6 w-6 text-[var(--text-tertiary)]" strokeWidth={1.5} />
        <p className="text-strong text-[var(--text-secondary)]">No activity yet</p>
        <p className="text-body text-[var(--text-tertiary)]">Launch a campaign to see trends.</p>
      </div>
    );
  }
  // The picture in words: the same numbers the area is drawn from.
  const values = data.map((d) => Number((d as any)[metric]) || 0);
  const total = values.reduce((a, b) => a + b, 0);
  const peakAt = values.indexOf(Math.max(...values));
  const summary = `${METRICS[metric].label} per day over ${data.length} days: ${fmtFull(total)} in total, `
    + `busiest on ${fmtDate(data[peakAt].date)} with ${fmtFull(values[peakAt])}`;
  return (
    <div role="img" aria-label={summary}>
    <ResponsiveContainer width="100%" height={268}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="perf-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.15} />
            <stop offset="92%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 6" stroke="var(--border-subtle)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false}
          tickLine={false} tickFormatter={fmtDate} minTickGap={36} dy={6} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false}
          width={34} tickFormatter={(v) => fmtNum(v)} />
        <Tooltip content={<ChartTooltip metricLabel={METRICS[metric].label} />}
          cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, strokeDasharray: '3 3' }} />
        <Area type="monotone" dataKey={metric} stroke={ACCENT} strokeWidth={2}
          fill="url(#perf-area)" dot={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: 'var(--bg-surface)', fill: ACCENT }} />
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  running: 'var(--success)', active: 'var(--success)', paused: 'var(--warning)', draft: 'var(--text-muted)',
  scheduled: 'var(--indigo)', completed: 'var(--text-tertiary)', cancelled: 'var(--error)',
};


/* ─── Loading skeleton ──────────────────────────────── */
function DashboardSkeleton() {
  // The same shape as the page once it loads - header, today's figures,
  // the queue beside the calendar, the performance module - so nothing
  // jumps when the data arrives.
  return (
    <div className="animate-fade-in space-y-6" aria-busy="true">
      <div className="space-y-3 pt-1 sm:pt-3">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-10 w-80 max-w-full" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="fact-strip grid-cols-2 sm:grid-cols-4 lg:grid-cols-[1fr_1fr_1fr_1fr_1.7fr]">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={cn('px-5 py-4 space-y-2.5', i === 4 && 'col-span-2 sm:col-span-4 lg:col-span-1')}>
            <Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-14" /><Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
        <div className="space-y-4">
          <div className="panel p-4 space-y-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          <div className="panel p-4 space-y-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
        </div>
      </div>
    </div>
  );
}

function InboxHealth({ score, verified, bounced, suppressed }: {
  score: number; verified: number; bounced: number; suppressed: number;
}) {
  const pct = Math.max(0, Math.min(100, score));
  const tier = pct >= 80 ? 'Excellent' : pct >= 60 ? 'Healthy' : pct >= 40 ? 'Fair' : 'Needs attention';
  const color = pct >= 60 ? ACCENT : pct >= 40 ? 'var(--warning)' : 'var(--error)';
  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-display font-semibold tabular leading-none tracking-[-0.03em] text-[var(--text-primary)]">
          {pct.toFixed(0)}<span className="text-strong text-[var(--text-tertiary)] font-medium">/100</span>
        </span>
        <span className="text-body font-medium" style={{ color }}>{tier}</span>
      </div>
      <div className="mt-2.5 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3.5">
        {[
          { label: 'Verified', value: verified },
          { label: 'Bounced', value: bounced },
          { label: 'Suppressed', value: suppressed },
        ].map((m) => (
          <div key={m.label}>
            <div className="text-heading font-semibold tabular text-[var(--text-primary)] leading-none">{fmtNum(m.value)}</div>
            <div className="text-caption text-[var(--text-tertiary)] mt-1">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Dashboard ─────────────────────────────────────── */
export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [period, setPeriod] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('dashboard.period'));
      return [7, 30, 90].includes(saved) ? saved : 30;
    } catch { return 30; }
  });
  const [metric, setMetric] = useState<MetricKey>('sent');
  const setPeriodPersist = (p: number) => { setPeriod(p); try { localStorage.setItem('dashboard.period', String(p)); } catch { /* ignore */ } };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    try {
      const blob = await analyticsApi.exportOverviewReport(period);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `overview-report-${period}d-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error('Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  const { data: analytics, isLoading: analyticsLoading, isFetching: aFetching } = useQuery({
    queryKey: ['analytics', 'overview', period],
    queryFn: () => analyticsApi.overview(period),
  });
  const { data: trendData, isLoading: trendLoading, isFetching: tFetching } = useQuery({
    queryKey: ['analytics', 'trend', period],
    queryFn: () => analyticsApi.trend(period),
  });
  // All time: only to know whether anything has ever been sent.
  const { data: campaignList } = useQuery({
    // One key for this list everywhere (the analytics page uses it too).
    queryKey: ['analytics', 'campaign-list'],
    queryFn: () => analyticsApi.campaignList(),
  });
  // The period's own figures, for "what's working".
  const { data: periodCampaignList } = useQuery({
    queryKey: ['analytics', 'campaign-list', period],
    queryFn: () => analyticsApi.campaignList(period),
  });
  const { data: userSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 5 * 60 * 1000,
  });

  if (analyticsLoading || trendLoading) return <DashboardSkeleton />;

  const s = analytics || {
    total_campaigns: 0, active_campaigns: 0, total_contacts: 0,
    total_sent: 0, total_opened: 0, total_clicked: 0, total_replied: 0,
    avg_open_rate: 0, avg_click_rate: 0, avg_reply_rate: 0,
    suppressed_count: 0, avg_dcs_score: 0, verified_contacts: 0, bounced_contacts: 0,
    sent_change: null, opened_change: null, clicked_change: null, replied_change: null,
    contacts_sent: 0, open_rate_change: null, click_rate_change: null, reply_rate_change: null,
  };

  const trend = Array.isArray(trendData) ? trendData : [];
  const refreshing = aFetching || tFetching;

  const metricTotal = trend.reduce((a, d) => a + Number(d[metric] || 0), 0);

  const campaigns = Array.isArray(campaignList) ? campaignList : [];
  /*
   * What's working: campaigns still running, by reply rate over the period.
   * Ranked by volume over all time, an old campaign with a lot of sends sat
   * on top for good. A rate below the sample it can support ranks after the
   * real ones (by volume), rather than a lucky 1-of-3 leading the list.
   * With nothing running, the campaigns that sent in the period stand in.
   */
  const periodCampaigns = (Array.isArray(periodCampaignList) ? periodCampaignList : [])
    .filter((c) => Number(c.sent) > 0);
  const running = periodCampaigns.filter((c) => c.status === 'running');
  const pool = running.length > 0 ? running : periodCampaigns;
  const ranked = pool.map((c) => ({ c, reply: rateReadout(c.replied, c.contacts_sent ?? c.sent, 'replies') }));
  ranked.sort((a, b) => {
    if (a.reply.isRate !== b.reply.isRate) return a.reply.isRate ? -1 : 1;
    if (a.reply.isRate && b.c.reply_rate !== a.c.reply_rate) return b.c.reply_rate - a.c.reply_rate;
    return b.c.sent - a.c.sent;
  });
  const topCampaigns = ranked.slice(0, 5).map((r) => r.c);
  const leaderboardDesc = running.length > 0
    ? `Running campaigns by reply rate, last ${period} days`
    : `By reply rate, last ${period} days`;
  /* Whether the headline rate has enough behind it to be stated as one. */
  /* Rates are over people sent to, so the sample is people too. */
  const sentTo = Number(s.contacts_sent ?? s.total_sent) || 0;
  const headlineReply = averageRateReadout(s.avg_reply_rate, sentTo, 'contacts');

  // Prefer the name the user set in Settings; fall back to the email prefix.
  const settingsFirst = (userSettings?.first_name || '').trim();
  const settingsLast = (userSettings?.last_name || '').trim();
  // First name only: "Good afternoon, Alex", as a person would say it.
  const name = settingsFirst || settingsLast || user?.email?.split('@')[0] || 'there';

  const verified = Number(s.verified_contacts) || 0;
  const bounced = Number(s.bounced_contacts) || 0;
  const suppressed = Number(s.suppressed_count) || 0;
  const totalContacts = Number(s.total_contacts) || 0;
  const listScore = Number(s.avg_dcs_score) || 0;
  // List quality earns a panel only when it needs looking at; a healthy
  // list is already covered by the status line staying quiet.
  const listNeedsWork = listScore > 0 && listScore < 60;

  /*
   * Nothing has ever been sent: a chart of zeros, an empty leaderboard, a
   * funnel of noughts and a deliverability score for mail that does not
   * exist are four panels saying the same nothing. Until the first send the
   * page is about getting there.
   */
  const everSent = campaigns.some((c) => Number(c.sent) > 0) || Number(s.total_sent) > 0;

  return (
    <div className="stagger pb-8 space-y-6">
      {/* ── The day, said the way a colleague would, then set out once as
          a ledger. Anything that has stopped, or changed while you were
          away, is said between the two. ── */}
      <DayBrief
        name={name}
        period={period}
        activeCampaigns={Number(s.active_campaigns) || 0}
        contacts={totalContacts}
        sentInPeriod={Number(s.total_sent) || 0}
        reply={headlineReply}
        trend={trend}
        everSent={everSent}
        onNew={() => navigate('/campaigns/new')}
      >
        {/* Something has stopped, or the autopilot is doing something. */}
        <StatusLine />
        {/* What changed since the last visit, once per return. */}
        <AwayCard />
      </DayBrief>

      {/* Before anything else, for an account that has not sent yet: the
          five things that have to be true, in the order they depend on each
          other. It removes itself for good once they are. */}
      <SetupChecklist />

      {/* Before the first send, the next step comes before everything else. */}
      {!everSent && (
        <FirstSendPanel
          contacts={totalContacts}
          verified={verified}
          bounced={bounced}
          onWrite={() => navigate('/campaigns/new?write=1')}
        />
      )}

      {/* ── The work, and what surrounds it. The day's list - replies,
          meetings, moments, deals and tasks, most urgent first - takes the
          wide column; the rail beside it is the clock, the money and the
          campaigns that are earning it. ── */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <TodayQueue mode="home" />

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Schedule, pipeline and campaigns">
          {/* The deals the outreach is for. Always here: deals do not wait
              for a campaign, and a section that hid itself when it had
              nothing to show read as a section that had gone missing. */}
          <PipelineSnapshot />
          <TodayPanel />

          {everSent && (
            <section className="panel overflow-hidden" data-whats-working>
              <Head title="What's working" desc={leaderboardDesc} action={<MoreLink to="/analytics" label="All" />} />
              {topCampaigns.length > 0 ? (
                <ol className="divide-y divide-[var(--border-subtle)]">
                  {topCampaigns.map((c, i) => {
                    /* Over the people the campaign reached, not its emails. */
                    const reached = c.contacts_sent ?? c.sent;
                    const reply = rateReadout(c.replied, reached, 'replies');
                    const barWidth = rateBarWidth(reply);
                    return (
                      <li key={c.id}>
                        <button onClick={() => navigate(`/campaigns/${c.id}`)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]">
                          {/* A rank: the list is ordered, and the number says so. */}
                          <span className="w-3 flex-shrink-0 text-caption font-semibold tabular text-[var(--text-tertiary)]">{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: STATUS_DOT[c.status] || 'var(--text-muted)' }} />
                              <span className="truncate text-strong font-medium text-[var(--text-primary)]">{c.name}</span>
                            </span>
                            {/*
                              * The bar is a claim about magnitude and cannot carry a
                              * caveat, so below the sample there is no bar at all -
                              * rather than a short one, which reads as "doing badly"
                              * when it means "we do not know yet".
                              */}
                            {barWidth != null && (
                              <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                                <span className="block h-full rounded-full" style={{ width: `${barWidth}%`, background: ACCENT }} />
                              </span>
                            )}
                          </span>
                          <span className="w-16 flex-shrink-0 text-right" title={reply.hint}>
                            <span className={cn('block font-semibold tabular',
                              reply.isRate ? 'text-heading text-[var(--text-primary)]' : 'text-caption text-[var(--text-tertiary)]')}>{reply.label}</span>
                            <span className="block text-caption text-[var(--text-tertiary)]">{fmtNum(c.sent)} sent</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <InlineEmpty icon={Megaphone}>
                  Nothing sent in the last {period} days. Campaigns show here, best reply rate first, once they send.
                </InlineEmpty>
              )}
            </section>
          )}

          {everSent && listNeedsWork && (
            <section className="panel overflow-hidden" data-list-quality>
              {/* It scores the contacts, not a mailbox: "Inbox health 97" with
                  nothing sent was a claim about mail that did not exist. */}
              <Head title="List quality" desc="How safe your contacts are to email" action={<MoreLink to="/verification" label="Details" />} />
              <InboxHealth score={listScore} verified={verified} bounced={bounced} suppressed={suppressed} />
            </section>
          )}
        </aside>
      </div>

      {/* ── How it is going: one performance module. The metric strip drives
          the chart, and the period and export sit on it, beside what they
          change. ── */}
      {everSent && (
      <section className={cn('panel overflow-hidden transition-opacity duration-300', refreshing && 'opacity-60')} data-performance>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-heading font-semibold text-[var(--text-primary)] tracking-[-0.01em]">How it is going</h2>
            <p className="text-body text-[var(--text-tertiary)]">
              <span className="font-semibold tabular text-[var(--text-secondary)]">{fmtFull(metricTotal)}</span>
              {' '}{METRICS[metric].label.toLowerCase()} in the last {period} days, with the change on the {period} before
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriodPersist} />
            <button onClick={exportReport} disabled={exporting} className="btn-secondary disabled:opacity-50" title="Export CSV report">
              <Download className="h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </div>
        {/* Outcomes first. Opens are left to Analytics: Apple and Gmail
            pre-load images, so an open says little about a person. */}
        <div className="grid grid-cols-2 sm:flex sm:divide-x divide-[var(--border-subtle)] border-b border-[var(--border-subtle)]">
          <MetricCell label="Emails sent" value={fmtNum(s.total_sent)} delta={s.sent_change}
            active={metric === 'sent'} onClick={() => setMetric('sent')} />
          {/* Rate cells carry the change in the RATE, not in the count:
              more sends alone moved the old arrow. */}
          <MetricCell label="Reply rate" value={fmtPct(s.avg_reply_rate)} delta={s.reply_rate_change}
            readout={averageRateReadout(s.avg_reply_rate, sentTo, 'contacts')}
            active={metric === 'replied'} onClick={() => setMetric('replied')} />
          <MetricCell label="Meetings booked" value={fmtNum(s.meetings_booked)} delta={s.meetings_booked_change}
            active={metric === 'meetings'} onClick={() => setMetric('meetings')} />
          <MetricCell label="Click rate" value={fmtPct(s.avg_click_rate)} delta={s.click_rate_change}
            readout={averageRateReadout(s.avg_click_rate, sentTo, 'contacts')}
            active={metric === 'clicked'} onClick={() => setMetric('clicked')} />
        </div>
        <div className="px-3 pt-4 pb-2">
          <ErrorBoundary fallback={<div className="h-[240px] flex items-center justify-center text-body text-[var(--text-tertiary)]">Chart unavailable</div>}>
            <PerformanceChart data={trend} metric={metric} />
          </ErrorBoundary>
        </div>
      </section>
      )}
    </div>
  );
}

/**
 * Before the first send: what the list looks like, and the one thing that
 * gets it moving - a drafted sequence to edit.
 */
function FirstSendPanel({ contacts, verified, bounced, onWrite }: {
  contacts: number; verified: number; bounced: number; onWrite: () => void;
}) {
  const safe = contacts > 0 ? Math.round((verified / contacts) * 100) : 0;
  return (
    <section className="panel overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr]">
        <div className="p-5 sm:p-6">
          <p className="text-caption font-medium text-[var(--indigo-text)]">Your first campaign</p>
          <h2 className="mt-1.5 text-title font-semibold text-[var(--text-primary)] tracking-[-0.01em]">
            {contacts > 0 ? 'Your leads are ready. Relay can draft the emails.' : 'Add a few leads, then Relay drafts the emails.'}
          </h2>
          <p className="mt-2 text-body text-[var(--text-secondary)] max-w-[52ch]">
            Pick a list, say what you sell in a sentence or two, and you get a short sequence to read through and edit - with a personal first line for each lead when AI is switched on. Nothing sends until you launch it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={onWrite} disabled={contacts === 0}>
              <Sparkles className="h-3.5 w-3.5" /> Write it with Relay
            </button>
            <Link to={contacts > 0 ? '/campaigns/new' : '/contacts'} className="btn-secondary">
              {contacts > 0 ? 'Start from scratch' : 'Add leads'}
            </Link>
          </div>
        </div>
        <div className="border-t md:border-t-0 md:border-l border-[var(--border-subtle)] p-5 sm:p-6 bg-[var(--bg-muted)]/40">
          <p className="text-caption font-semibold text-[var(--text-tertiary)]">Your list</p>
          <dl className="mt-3 space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-body text-[var(--text-secondary)]">Leads</dt>
              <dd className="text-strong font-semibold tabular text-[var(--text-primary)]">{contacts.toLocaleString()}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-body text-[var(--text-secondary)]">Safe to email</dt>
              <dd className="text-strong font-semibold tabular text-[var(--text-primary)]">{verified.toLocaleString()}{contacts > 0 && <span className="ml-1 text-caption font-normal text-[var(--text-tertiary)]">{safe}%</span>}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-body text-[var(--text-secondary)]">Known bad addresses</dt>
              <dd className="text-strong font-semibold tabular text-[var(--text-primary)]">{bounced.toLocaleString()}</dd>
            </div>
          </dl>
          {contacts > 0 && verified < contacts && (
            <Link to="/verification" className="mt-3 inline-flex min-h-6 items-center gap-1 text-caption font-medium text-[var(--indigo-text)] hover:underline">
              Verify the rest before sending <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
