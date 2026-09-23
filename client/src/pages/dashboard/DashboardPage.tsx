import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TodayPanel } from '../../components/dashboard/TodayPanel';
import { FlowTeaser } from '../../components/dashboard/FlowTeaser';
import { analyticsApi, type TrendDataPoint } from '../../api/analytics.api';
import { inboxApi } from '../../api/inbox.api';
import { smtpApi } from '../../api/smtp.api';
import { settingsApi } from '../../api/settings.api';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { useAuth } from '../../context/AuthContext';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { SetupChecklist } from '../../components/setup/SetupChecklist';
import { EmptyState, InlineEmpty } from '../../components/shared/EmptyState';
import { rateReadout, averageRateReadout, rateBarWidth, type RateReadout, formatDayMonth } from '@lemlist/shared';
import { Avatar } from '../../components/shared/Avatar';
import {
  Plus, Send, MailOpen, MousePointerClick, MessageSquare, Inbox,
  ChevronRight, ArrowUp, ArrowDown, Download, Megaphone, Activity,
  AlertTriangle, Reply, Flame, Clock, CheckCircle2, X,
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

const ACCENT = '#6366F1';

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
function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return formatDayMonth(new Date(date));
}

/* ─── Metric config ─────────────────────────────────── */
const METRICS = {
  sent:    { label: 'Sent',    icon: Send },
  opened:  { label: 'Opened',  icon: MailOpen },
  clicked: { label: 'Clicked', icon: MousePointerClick },
  replied: { label: 'Replied', icon: MessageSquare },
} as const;
type MetricKey = keyof typeof METRICS;
const CHANGE_KEY: Record<MetricKey, 'sent_change' | 'opened_change' | 'clicked_change' | 'replied_change'> = {
  sent: 'sent_change', opened: 'opened_change', clicked: 'clicked_change', replied: 'replied_change',
};

const PERIODS = [
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
];

/* Reply-intent chips for the live replies feed (mirrors inbox colors) */
const INTENT_CHIP: Record<string, { label: string; cls: string }> = {
  interested: { label: 'Interested', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  meeting: { label: 'Meeting', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  objection: { label: 'Objection', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  not_now: { label: 'Not now', cls: 'bg-slate-500/10 text-slate-500' },
  out_of_office: { label: 'OOO', cls: 'bg-purple-500/10 text-purple-500' },
  unsubscribe: { label: 'Unsub', cls: 'bg-red-500/10 text-red-500' },
  bounce: { label: 'Bounce', cls: 'bg-red-500/10 text-red-500' },
};

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
    return <span className={cn('text-body font-medium text-[var(--text-muted)]', className)}>—</span>;
  }
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-body font-semibold tabular',
      flat ? 'text-[var(--text-tertiary)]' : up ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-500',
      className
    )}>
      {!flat && (up ? <ArrowUp className="h-3 w-3" strokeWidth={2.5} /> : <ArrowDown className="h-3 w-3" strokeWidth={2.5} />)}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* ─── Attention row — one work item in the "Needs attention" queue ────
   Quiet list rows, not stat cards: the count is a neutral chip on the
   right, urgency is a small tinted icon, the row is the tap target. */
function AttentionRow({ icon: Icon, count, label, sub, to, tone = 'default', onDismiss }: {
  icon: any; count: number; label: string; sub: string; to: string;
  tone?: 'default' | 'warn' | 'hot';
  /** Shows a hover-revealed dismiss control instead of the row always being permanent. */
  onDismiss?: () => void;
}) {
  const navigate = useNavigate();
  const iconCls =
    tone === 'warn' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    : tone === 'hot' ? 'bg-rose-500/10 text-rose-500'
    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]';
  return (
    <button
      onClick={() => navigate(to)}
      className="group w-full flex items-center gap-3 px-4 h-[46px] text-left hover:bg-[var(--bg-hover)] transition-colors"
    >
      <span className={cn('flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0', iconCls)}>
        <Icon className="h-[13px] w-[13px]" strokeWidth={2} />
      </span>
      <span className="text-strong font-medium text-[var(--text-primary)] flex-shrink-0">{label}</span>
      <span className="text-body text-[var(--text-tertiary)] truncate flex-1 min-w-0">{sub}</span>
      <span className={cn(
        'flex h-[19px] min-w-[19px] items-center justify-center rounded-md px-1.5 text-caption font-semibold tabular flex-shrink-0',
        tone === 'warn' ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400' : 'bg-[var(--bg-active)] text-[var(--text-secondary)]'
      )}>
        {fmtNum(count)}
      </span>
      {onDismiss ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onDismiss(); } }}
          title="Dismiss"
          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] transition-opacity flex-shrink-0"
        >
          <X className="h-3 w-3" />
        </span>
      ) : (
        <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      )}
    </button>
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
        <h3 className="text-strong font-semibold text-[var(--text-primary)] tracking-[-0.01em] leading-tight truncate">{title}</h3>
        {desc && <p className="text-body text-[var(--text-tertiary)] leading-tight mt-0.5 truncate">{desc}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

function MoreLink({ to, label = 'View all' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="text-body font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 transition-colors">
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
        <Activity className="h-6 w-6 text-[var(--text-muted)]" strokeWidth={1.5} />
        <p className="text-strong text-[var(--text-secondary)]">No activity yet</p>
        <p className="text-body text-[var(--text-tertiary)]">Launch a campaign to see trends.</p>
      </div>
    );
  }
  return (
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
                <ArrowDown className="h-3 w-3 text-[var(--text-muted)]" strokeWidth={2} />
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
  running: '#10B981', active: '#10B981', paused: '#F59E0B', draft: 'var(--text-muted)',
  scheduled: '#6366F1', completed: 'var(--text-tertiary)', cancelled: '#F43F5E',
};

/* Accounts under this health score surface in the attention queue */
const SMTP_HEALTH_THRESHOLD = 50;

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
  const color = pct >= 60 ? ACCENT : pct >= 40 ? '#F59E0B' : '#F43F5E';
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
  const unreadCount = useUnreadCount();
  const { user } = useAuth();
  const [period, setPeriod] = useState<number>(() => {
    const saved = Number(localStorage.getItem('dashboard.period'));
    return [7, 30, 90].includes(saved) ? saved : 30;
  });
  const [metric, setMetric] = useState<MetricKey>('sent');
  // Persisted by which accounts are unhealthy, not just a boolean — so
  // dismissing today's warning doesn't also hide tomorrow's warning about
  // a different account, and the dismissal survives navigating away and back.
  const [dismissedSmtpSignature, setDismissedSmtpSignature] = useState<string | null>(() => {
    try { return localStorage.getItem('dashboard.smtpBannerDismissed'); } catch { return null; }
  });

  const setPeriodPersist = (p: number) => { setPeriod(p); try { localStorage.setItem('dashboard.period', String(p)); } catch { /* ignore */ } };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    try {
      const blob = await analyticsApi.exportOverviewReport(period);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `overview-report-${period}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
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
  const { data: inboxData } = useQuery({
    queryKey: ['inbox', 'dashboard'],
    queryFn: () => inboxApi.list({ limit: 5, folder: 'inbox' }),
  });
  const { data: inboxCounts } = useQuery({
    queryKey: ['inbox', 'counts'],
    queryFn: inboxApi.counts,
  });
  const { data: scheduledEmails } = useQuery({
    queryKey: ['inbox', 'scheduled'],
    queryFn: inboxApi.listScheduled,
  });
  const { data: smtpAccounts } = useQuery({
    queryKey: ['smtp', 'accounts'],
    queryFn: () => smtpApi.list(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: userSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 5 * 60 * 1000,
  });

  if (analyticsLoading || trendLoading) return <DashboardSkeleton />;

  const unhealthySmtpAccounts = (smtpAccounts || [])
    .filter((a) => a.is_active && a.health_score < SMTP_HEALTH_THRESHOLD);
  const smtpBannerSignature = unhealthySmtpAccounts.length
    ? unhealthySmtpAccounts.map((a) => a.id).sort().join(',')
    : null;
  const smtpBannerDismissed = smtpBannerSignature !== null && smtpBannerSignature === dismissedSmtpSignature;
  const dismissSmtpBanner = () => {
    setDismissedSmtpSignature(smtpBannerSignature);
    try { if (smtpBannerSignature) localStorage.setItem('dashboard.smtpBannerDismissed', smtpBannerSignature); } catch { /* ignore */ }
  };

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
  const metricChange = (s as any)[CHANGE_KEY[metric]] as number | null;

  const campaigns = Array.isArray(campaignList) ? campaignList : [];
  const topCampaigns = [...campaigns].sort((a, b) => b.sent - a.sent).slice(0, 5);
  /* Whether the headline rate has enough behind it to be stated as one. */
  const headlineReply = averageRateReadout(s.avg_reply_rate, s.total_sent, 'emails');

  const recentMessages = Array.isArray(inboxData?.data) ? inboxData.data : [];
  // Prefer the name the user set in Settings; fall back to the email prefix.
  const settingsFirst = (userSettings?.first_name || '').trim();
  const settingsLast = (userSettings?.last_name || '').trim();
  const name = settingsFirst || settingsLast
    ? [settingsFirst, settingsLast].filter(Boolean).join(' ')
    : (user?.email?.split('@')[0] || 'there');

  const verified = Number(s.verified_contacts) || 0;
  const bounced = Number(s.bounced_contacts) || 0;
  const suppressed = Number(s.suppressed_count) || 0;
  const totalContacts = Number(s.total_contacts) || 0;

  /* Action queue — real work items pulled from the inbox counts endpoint */
  const intents = (inboxCounts?.intents || {}) as Record<string, number>;
  const needsReply = (intents.interested || 0) + (intents.objection || 0) + (intents.meeting || 0);
  const hotLeads = (intents.interested || 0) + (intents.meeting || 0);
  const unreadReplies = inboxCounts?.unread ?? unreadCount;
  const scheduledCount = Array.isArray(scheduledEmails) ? scheduledEmails.length : 0;
  const allClear = needsReply === 0 && unreadReplies === 0 && scheduledCount === 0 && hotLeads === 0;

  return (
    <div className="stagger pb-8 space-y-5">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-display font-semibold text-[var(--text-primary)] tracking-[-0.025em] leading-tight">
            {greeting()}, <span className="capitalize">{name}</span>
          </h1>
          <div className="mt-2 flex items-center flex-wrap gap-x-2.5 gap-y-1 text-strong text-[var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.active_campaigns > 0 ? '#10B981' : 'var(--text-muted)' }} />
              {s.active_campaigns} active {s.active_campaigns === 1 ? 'campaign' : 'campaigns'}
            </span>
            <span className="text-[var(--border-strong)]">·</span>
            <span>{fmtFull(totalContacts)} contacts</span>
            <span className="text-[var(--border-strong)]">·</span>
            {/* The headline figure only claims to be one once it can be. */}
            <span title={headlineReply.hint}>
              {headlineReply.isRate
                ? `${headlineReply.label} avg reply rate`
                : `${fmtFull(s.total_sent)} sent — too early for a reply rate`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Segmented options={PERIODS} value={period} onChange={setPeriodPersist} />
          <button onClick={exportReport} disabled={exporting} className="btn-secondary disabled:opacity-50" title="Export CSV report">
            <Download className="h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'Export'}
          </button>
          <button className="btn-primary" onClick={() => navigate('/campaigns/new')}>
            <Plus className="h-3.5 w-3.5" /> New campaign
          </button>
        </div>
      </header>

      {/* Before anything else, for an account that has not sent yet: the
          five things that have to be true, in the order they depend on each
          other. It removes itself for good once they are. */}
      <SetupChecklist />

      {/* ── Row 1: work first — the attention queue + live replies ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="panel lg:col-span-2 overflow-hidden">
          <Head
            title="Needs attention"
            desc="Everything waiting on you, in one queue"
            action={allClear && !unhealthySmtpAccounts.length ? undefined : <MoreLink to="/inbox" label="Open unibox" />}
          />
          {allClear && unhealthySmtpAccounts.length === 0 ? (
            <div className="flex items-center gap-2.5 px-4 py-8 justify-center">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" strokeWidth={2} />
              <span className="text-strong text-[var(--text-secondary)]">All clear — nothing waiting on you right now.</span>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {needsReply > 0 && (
                <AttentionRow icon={Reply} count={needsReply} label="Need a reply" sub="Interested, objections & meeting requests" to="/inbox" tone="warn" />
              )}
              {hotLeads > 0 && (
                <AttentionRow icon={Flame} count={hotLeads} label="Hot leads" sub="Interested or booked a meeting" to="/inbox" tone="hot" />
              )}
              {unreadReplies > 0 && (
                <AttentionRow icon={Inbox} count={unreadReplies} label="Unread replies" sub="Waiting in your unibox" to="/inbox" />
              )}
              {scheduledCount > 0 && (
                <AttentionRow icon={Clock} count={scheduledCount} label="Scheduled sends" sub="Queued from compose & replies" to="/inbox" />
              )}
              {!smtpBannerDismissed && unhealthySmtpAccounts.length > 0 && (
                <AttentionRow
                  icon={AlertTriangle}
                  count={unhealthySmtpAccounts.length}
                  label={unhealthySmtpAccounts.length === 1 ? 'Inbox health low' : 'Inboxes health low'}
                  sub={unhealthySmtpAccounts.map((a) => a.label || a.email_address).join(', ')}
                  to="/email-accounts"
                  tone="warn"
                  onDismiss={dismissSmtpBanner}
                />
              )}
            </div>
          )}
        </section>

        {/* The right-hand column carries the two time-critical things: what
            is happening today, and what has just come in. */}
        <div className="flex flex-col gap-4">
        <FlowTeaser />
        <TodayPanel />

        <section className="panel overflow-hidden flex flex-col">
          <Head title="Latest replies" action={<MoreLink to="/inbox" label={unreadReplies > 0 ? `${unreadReplies} new` : 'Open'} />} />
          {recentMessages.length > 0 ? (
            <div className="divide-y divide-[var(--border-subtle)] flex-1">
              {recentMessages.slice(0, 4).map((msg: any) => {
                const chip = msg.sara_intent ? INTENT_CHIP[msg.sara_intent] : null;
                return (
                  <Link key={msg.id} to="/inbox" className="flex items-start gap-2.5 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors">
                    <div className="relative flex-shrink-0 mt-0.5">
                      <Avatar name={msg.contact_name} email={msg.from_email} size="sm" />
                      {!msg.is_read && <span className="absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full ring-2 ring-[var(--bg-surface)]" style={{ background: ACCENT }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('text-body truncate', msg.is_read ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]')}>
                          {msg.contact_name || msg.from_email?.split('@')[0] || 'Unknown'}
                        </span>
                        <span className="text-caption text-[var(--text-tertiary)] flex-shrink-0 tabular">{timeAgo(msg.received_at)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                        <p className="text-caption text-[var(--text-tertiary)] truncate leading-tight flex-1">{msg.subject || '(no subject)'}</p>
                        {chip && (
                          <span className={cn('text-micro font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0', chip.cls)}>{chip.label}</span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
              <Inbox className="h-5 w-5 text-[var(--text-muted)] mb-2" strokeWidth={1.5} />
              <InlineEmpty>No replies yet</InlineEmpty>
            </div>
          )}
        </section>
        </div>
      </div>

      {/* ── Row 2: one performance module — metric strip drives the chart ── */}
      <section className={cn('panel overflow-hidden transition-opacity duration-300', refreshing && 'opacity-60')}>
        <div className="flex divide-x divide-[var(--border-subtle)] border-b border-[var(--border-subtle)]">
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
                  <span className="w-6 text-body font-semibold tabular text-[var(--text-muted)] flex-shrink-0">{String(i + 1).padStart(2, '0')}</span>
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
                    <ChevronRight className="h-4 w-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
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
            <Head title="Inbox health" desc="Deliverability score" action={<MoreLink to="/verification" label="Details" />} />
            <InboxHealth score={Number(s.avg_dcs_score) || 0} verified={verified} bounced={bounced} suppressed={suppressed} />
          </section>
        </div>
      </div>
    </div>
  );
}
