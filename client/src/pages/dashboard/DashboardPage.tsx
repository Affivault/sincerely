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
import { EmptyState } from '../../components/shared/EmptyState';
import { rateReadout, averageRateReadout, rateBarWidth, type RateReadout, formatDayMonth } from '@lemlist/shared';
import {
  Plus, Send, MailOpen, MousePointerClick, MessageSquare,
  ChevronRight, ArrowUp, ArrowDown, Download, Megaphone, Activity, Sparkles,
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

/* ═══════════════════════════════════════════════════════════════════════
   Sincerely — Dashboard
   A command center, not a report. The page answers three questions in
   order: What needs me right now? (action queue) — How is sending going?
   (KPIs w/ sparklines + trend + funnel) — What's working? (leaderboard,
   live replies). One accent; length and hierarchy carry the data.
   ═══════════════════════════════════════════════════════════════════════ */

const ACCENT = '#3B4AA3';

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
const fmtDate = (d: string) => formatDayMonth(new Date(d));

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
/* ─── Metric config ─────────────────────────────────── */
const METRICS = {
  sent:    { label: 'Sent',    icon: Send },
  opened:  { label: 'Opened',  icon: MailOpen },
  clicked: { label: 'Clicked', icon: MousePointerClick },
  replied: { label: 'Replied', icon: MessageSquare },
} as const;
type MetricKey = keyof typeof METRICS;

const PERIODS = [
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
];

/* ─── Segmented control ─────────────────────────────── */
function Segmented<T extends string | number>({ options, value, onChange, size = 'md' }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex items-center p-0.5 rounded-lg bg-[var(--bg-elevated)]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'rounded-md font-medium transition-all duration-150',
            size === 'sm' ? 'h-6 px-2.5 text-body' : 'h-7 px-3 text-body',
            value === o.value
              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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

/* ─── Conversion funnel — one hue, length is the data ── */
function Funnel({ sent, opened, clicked, replied }: {
  sent: number; opened: number; clicked: number; replied: number;
}) {
  const stages = [
    { label: 'Sent', value: sent },
    { label: 'Opened', value: opened },
    { label: 'Clicked', value: clicked },
    { label: 'Replied', value: replied },
  ];
  const max = Math.max(sent, 1);
  return (
    <div className="p-4 space-y-1">
      {stages.map((st, i) => {
        const widthPct = Math.max((st.value / max) * 100, st.value > 0 ? 2 : 0);
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev && prev > 0 ? (st.value / prev) * 100 : null;
        return (
          <div key={st.label}>
            {i > 0 && (
              <div className="flex items-center gap-1.5 pl-[76px] py-1 text-caption text-[var(--text-tertiary)]">
                <ArrowDown className="h-3 w-3 text-[var(--text-tertiary)]" strokeWidth={2} />
                <span className="tabular font-medium">{conv != null ? `${conv.toFixed(1)}%` : '—'}</span>
                <span>of {stages[i - 1].label.toLowerCase()}</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="w-[64px] text-body font-medium text-[var(--text-secondary)] flex-shrink-0 text-right">{st.label}</span>
              <div className="flex-1 h-6 rounded bg-[var(--bg-elevated)] overflow-hidden">
                <div
                  className="h-full rounded transition-all duration-700"
                  style={{ width: `${widthPct}%`, background: ACCENT, opacity: 1 - i * 0.18 }}
                />
              </div>
              <span className="w-[52px] text-body font-semibold tabular text-[var(--text-primary)] flex-shrink-0">{fmtNum(st.value)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  running: '#3F8763', active: '#3F8763', paused: '#B88124', draft: 'var(--text-muted)',
  scheduled: '#3B4AA3', completed: 'var(--text-tertiary)', cancelled: '#B54B53',
};


/* ─── Loading skeleton ──────────────────────────────── */
function DashboardSkeleton() {
  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-7 w-64" /><Skeleton className="h-4 w-80" /></div>
        <div className="flex gap-2"><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-32" /></div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel p-4 space-y-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-24" /><Skeleton className="h-3 w-20" /></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="panel lg:col-span-2 p-4"><Skeleton className="h-4 w-32 mb-4" /><Skeleton className="h-[280px] w-full rounded-lg" /></div>
        <div className="panel p-4 space-y-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-10 w-full" /><Skeleton className="h-16 w-full" /></div>
      </div>
    </div>
  );
}

/* ─── Inbox health — compact score + stats ──────────── */
function InboxHealth({ score, verified, bounced, suppressed }: {
  score: number; verified: number; bounced: number; suppressed: number;
}) {
  const pct = Math.max(0, Math.min(100, score));
  const tier = pct >= 80 ? 'Excellent' : pct >= 60 ? 'Healthy' : pct >= 40 ? 'Fair' : 'Needs attention';
  const color = pct >= 60 ? ACCENT : pct >= 40 ? '#B88124' : '#B54B53';
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
  const { data: campaignList } = useQuery({
    queryKey: ['analytics', 'campaignList'],
    queryFn: () => analyticsApi.campaignList(),
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
  };

  const trend = Array.isArray(trendData) ? trendData : [];
  const refreshing = aFetching || tFetching;

  const metricTotal = trend.reduce((a, d) => a + Number(d[metric] || 0), 0);

  const campaigns = Array.isArray(campaignList) ? campaignList : [];
  const topCampaigns = [...campaigns].sort((a, b) => b.sent - a.sent).slice(0, 5);
  /* Whether the headline rate has enough behind it to be stated as one. */
  const headlineReply = averageRateReadout(s.avg_reply_rate, s.total_sent, 'emails');

  // Prefer the name the user set in Settings; fall back to the email prefix.
  const settingsFirst = (userSettings?.first_name || '').trim();
  const settingsLast = (userSettings?.last_name || '').trim();
  // First name only: "Good afternoon, Alex", as a person would say it.
  const name = settingsFirst || settingsLast || user?.email?.split('@')[0] || 'there';

  const verified = Number(s.verified_contacts) || 0;
  const bounced = Number(s.bounced_contacts) || 0;
  const suppressed = Number(s.suppressed_count) || 0;
  const totalContacts = Number(s.total_contacts) || 0;

  /*
   * Nothing has ever been sent: a chart of zeros, an empty leaderboard, a
   * funnel of noughts and a deliverability score for mail that does not
   * exist are four panels saying the same nothing. Until the first send the
   * page is about getting there.
   */
  const everSent = campaigns.some((c) => Number(c.sent) > 0) || Number(s.total_sent) > 0;

  return (
    <div className="stagger pb-8 space-y-5">
      {/* What changed since the last visit, once per return. */}
      <AwayCard />
      {/* What the deliverability autopilot is doing, only when it is doing something. */}
      {/* Something has stopped - shown only when it has. */}
      <StatusLine />
      {/* ── Header ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-hero font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--text-primary)]">
            {greeting()}, <span className="capitalize">{name}</span>
          </h1>
          {/* Said as a sentence, not as a strip of dot-joined stats. */}
          <p className="mt-2 text-strong text-[var(--text-secondary)]">
            {s.active_campaigns > 0 ? s.active_campaigns : 'No'} active {s.active_campaigns === 1 ? 'campaign' : 'campaigns'} and {fmtFull(totalContacts)} contacts
            {/* The headline figure only claims to be one once it can be. */}
            <span title={headlineReply.hint}>
              {headlineReply.isRate
                ? <>, averaging a <span className="font-medium text-[var(--text-primary)] tabular">{headlineReply.label}</span> reply rate.</>
                : <>. {fmtFull(s.total_sent)} sent, too early for a reply rate.</>}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {everSent && (
            <>
              <Segmented options={PERIODS} value={period} onChange={setPeriodPersist} />
              <button onClick={exportReport} disabled={exporting} className="btn-secondary disabled:opacity-50" title="Export CSV report">
                <Download className="h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'Export'}
              </button>
            </>
          )}
          <button className="btn-primary" onClick={() => navigate('/campaigns/new')}>
            <Plus className="h-3.5 w-3.5" /> New campaign
          </button>
        </div>
      </header>

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

      {/* ── Row 1: the day's work, as one list - replies, meetings, moments,
          deals and tasks, most urgent first - and the calendar beside it. ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TodayQueue mode="home" />
        </div>
        <div className="flex flex-col gap-4">
          <TodayPanel />
        </div>
      </div>

      {everSent && (<>
      {/* ── Row 2: one performance module — metric strip drives the chart ── */}
      <section className={cn('panel overflow-hidden transition-opacity duration-300', refreshing && 'opacity-60')}>
        <div className="grid grid-cols-2 sm:flex sm:divide-x divide-[var(--border-subtle)] border-b border-[var(--border-subtle)]">
          <MetricCell label="Emails sent" value={fmtNum(s.total_sent)} delta={s.sent_change}
            active={metric === 'sent'} onClick={() => setMetric('sent')} />
          <MetricCell label="Open rate" value={fmtPct(s.avg_open_rate)} delta={s.opened_change}
            readout={averageRateReadout(s.avg_open_rate, s.total_sent, 'emails')}
            active={metric === 'opened'} onClick={() => setMetric('opened')} />
          <MetricCell label="Click rate" value={fmtPct(s.avg_click_rate)} delta={s.clicked_change}
            readout={averageRateReadout(s.avg_click_rate, s.total_sent, 'emails')}
            active={metric === 'clicked'} onClick={() => setMetric('clicked')} />
          <MetricCell label="Reply rate" value={fmtPct(s.avg_reply_rate)} delta={s.replied_change}
            readout={averageRateReadout(s.avg_reply_rate, s.total_sent, 'emails')}
            active={metric === 'replied'} onClick={() => setMetric('replied')} />
        </div>
        <div className="flex items-center justify-between px-4 pt-3">
          <p className="text-body text-[var(--text-tertiary)]">
            <span className="font-semibold tabular text-[var(--text-secondary)]">{fmtFull(metricTotal)}</span>
            {' '}{METRICS[metric].label.toLowerCase()} · vs previous {period} days
          </p>
        </div>
        <div className="px-2 pb-2">
          <ErrorBoundary fallback={<div className="h-[240px] flex items-center justify-center text-body text-[var(--text-tertiary)]">Chart unavailable</div>}>
            <PerformanceChart data={trend} metric={metric} />
          </ErrorBoundary>
        </div>
      </section>

      {/* ── Row 3: what's working — campaigns + funnel/health rail ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="panel lg:col-span-2 overflow-hidden">
          <Head title="Campaign leaderboard" desc="Ranked by volume" action={<MoreLink to="/analytics" />} />
          {topCampaigns.length > 0 ? (
            <div className="divide-y divide-[var(--border-subtle)]">
              {topCampaigns.map((c, i) => {
                /* Real counts, not the rate reconstructed from itself. */
                const open = rateReadout(c.opened, c.sent, 'opens');
                const reply = rateReadout(c.replied, c.sent, 'replies');
                const barWidth = rateBarWidth(reply);
                return (
                <button key={c.id} onClick={() => navigate(`/campaigns/${c.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors text-left group">
                  <span className="w-6 text-body font-semibold tabular text-[var(--text-tertiary)] flex-shrink-0">{String(i + 1).padStart(2, '0')}</span>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[c.status] || 'var(--text-muted)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-strong font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                    {/*
                      * The bar is a claim about magnitude and cannot carry a
                      * caveat, so below the sample there is no bar at all -
                      * rather than a short one, which reads as "doing badly"
                      * when it means "we do not know yet".
                      */}
                    {barWidth != null && (
                      <div className="mt-1.5 h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden max-w-[220px]">
                        <div className="h-full rounded-full" style={{ width: `${barWidth}%`, background: ACCENT }} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-5 text-right flex-shrink-0">
                    <div className="hidden sm:block w-12" title={open.hint}>
                      <div className={cn('text-strong font-semibold tabular',
                        open.isRate ? 'text-[var(--text-primary)]' : 'text-caption text-[var(--text-tertiary)]')}>{open.label}</div>
                      <div className="text-caption text-[var(--text-tertiary)]">open</div>
                    </div>
                    <div className="hidden sm:block w-12" title={reply.hint}>
                      <div className={cn('text-strong font-semibold tabular',
                        reply.isRate ? 'text-[var(--text-primary)]' : 'text-caption text-[var(--text-tertiary)]')}>{reply.label}</div>
                      <div className="text-caption text-[var(--text-tertiary)]">reply</div>
                    </div>
                    <div className="w-12">
                      <div className="text-strong font-semibold tabular text-[var(--text-primary)]">{fmtNum(c.sent)}</div>
                      <div className="text-caption text-[var(--text-tertiary)]">sent</div>
                    </div>
                    <ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
                  </div>
                </button>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Megaphone}
              title="No campaigns yet"
              description="Launch your first sequence to see rankings."
              actionLabel="Create campaign"
              onAction={() => navigate('/campaigns/new')}
            />
          )}
        </section>

        <div className="space-y-4">
          <section className={cn('panel overflow-hidden transition-opacity duration-300', refreshing && 'opacity-60')}>
            <Head title="Conversion funnel" desc={`Last ${period} days`} />
            <Funnel sent={Number(s.total_sent) || 0} opened={Number(s.total_opened) || 0}
              clicked={Number(s.total_clicked) || 0} replied={Number(s.total_replied) || 0} />
          </section>
          <section className="panel overflow-hidden">
            {/* It scores the contacts, not a mailbox: "Inbox health 97" with
                nothing sent was a claim about mail that did not exist. */}
            <Head title="List quality" desc="How safe your contacts are to email" action={<MoreLink to="/verification" label="Details" />} />
            <InboxHealth score={Number(s.avg_dcs_score) || 0} verified={verified} bounced={bounced} suppressed={suppressed} />
          </section>
        </div>
      </div>
      </>)}
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
            Pick a list, say what you sell in a sentence or two, and you get a short sequence to read through and edit - with a personal first line for each lead when Claude is switched on. Nothing sends until you launch it.
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
