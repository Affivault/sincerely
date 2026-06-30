import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCountUp } from '../../hooks/useCountUp';
import { analyticsApi, type TrendDataPoint } from '../../api/analytics.api';
import { inboxApi } from '../../api/inbox.api';
import { smtpApi } from '../../api/smtp.api';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { useAuth } from '../../context/AuthContext';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Avatar } from '../../components/shared/Avatar';
import {
  Plus, Send, MailOpen, MousePointerClick, MessageSquare, Inbox,
  ChevronRight, ArrowUp, ArrowDown, Download, Megaphone, Activity,
  AlertTriangle, X,
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

/* ═══════════════════════════════════════════════════════════════════════
   Sincerely — Dashboard
   Calm operating surface. One accent (indigo); a single hero chart; the rest
   is plain numbers and lists. Whitespace and hierarchy do the work — no
   competing gauges, donuts, funnels or uppercase microtext.
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
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

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
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

/* ─── Segmented control ─────────────────────────────── */
function Segmented<T extends string | number>({ options, value, onChange, size = 'md' }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex items-center p-0.5 rounded-[8px] bg-[var(--bg-elevated)]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-[6px] font-medium transition-all duration-150',
            size === 'sm' ? 'h-6 px-2.5 text-[12px]' : 'h-7 px-3 text-[12.5px]',
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
    return <span className={cn('text-[12px] font-medium text-[var(--text-muted)]', className)}>—</span>;
  }
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[12px] font-semibold tabular',
      flat ? 'text-[var(--text-tertiary)]' : up ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-500',
      className
    )}>
      {!flat && (up ? <ArrowUp className="h-3 w-3" strokeWidth={2.5} /> : <ArrowDown className="h-3 w-3" strokeWidth={2.5} />)}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* ─── KPI tile — calm: icon + label, big number, delta ── */
function Kpi({ label, icon: Icon, target, format, hint, delta, onClick }: {
  label: string; icon: any; target: number; format: (n: number) => string; hint?: string;
  delta?: number | null; onClick?: () => void;
}) {
  const animated = useCountUp(target);
  return (
    <button onClick={onClick} className="text-left panel panel-hover p-4">
      <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
        <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
        <span className="text-[12.5px] font-medium">{label}</span>
        <Delta value={delta} className="ml-auto" />
      </div>
      <div className="mt-3 text-[28px] font-semibold tabular leading-none tracking-[-0.03em] text-[var(--text-primary)]">
        {format(animated)}
      </div>
      {hint && <div className="mt-2 text-[12px] text-[var(--text-tertiary)] truncate">{hint}</div>}
    </button>
  );
}

/* ─── Panel header ──────────────────────────────────── */
function Head({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)]">
      <div className="min-w-0">
        <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)] tracking-[-0.01em] leading-tight truncate">{title}</h3>
        {desc && <p className="text-[12px] text-[var(--text-tertiary)] leading-tight mt-0.5 truncate">{desc}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

function MoreLink({ to, label = 'View all' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="text-[12px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 transition-colors">
      {label} <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  );
}

/* ─── Performance chart ─────────────────────────────── */
function ChartTooltip({ active, payload, label, metricLabel }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] px-2.5 py-1.5">
      <div className="text-[11px] font-medium text-[var(--text-tertiary)] mb-0.5">{fmtDate(label)}</div>
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="text-[var(--text-secondary)]">{metricLabel}</span>
        <span className="font-semibold tabular text-[var(--text-primary)]">{fmtFull(payload[0].value)}</span>
      </div>
    </div>
  );
}

function PerformanceChart({ data, metric }: { data: TrendDataPoint[]; metric: MetricKey }) {
  if (!data.length) {
    return (
      <div className="h-[280px] flex flex-col items-center justify-center gap-2 text-center">
        <Activity className="h-6 w-6 text-[var(--text-muted)]" strokeWidth={1.5} />
        <p className="text-[13px] text-[var(--text-secondary)]">No activity yet</p>
        <p className="text-[12px] text-[var(--text-tertiary)]">Launch a campaign to see trends.</p>
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
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

const STATUS_DOT: Record<string, string> = {
  running: '#10B981', active: '#10B981', paused: '#F59E0B', draft: 'var(--text-muted)',
  scheduled: '#6366F1', completed: 'var(--text-tertiary)', cancelled: '#F43F5E',
};

/* ─── SMTP health warning banner ────────────────────── */
const SMTP_HEALTH_THRESHOLD = 50;

function SmtpHealthBanner({ accounts, onDismiss }: {
  accounts: Array<{ id: string; label: string; email_address: string; health_score: number }>;
  onDismiss: () => void;
}) {
  const single = accounts.length === 1;
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" strokeWidth={2} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200 leading-snug">
          {single
            ? `Sending account "${accounts[0].label}" has a low health score (${accounts[0].health_score}/100)`
            : `${accounts.length} sending accounts have low health scores`}
        </p>
        <p className="mt-0.5 text-[12px] text-amber-700 dark:text-amber-400">
          {single
            ? "High bounce rates can hurt deliverability. Review this account's sending activity."
            : `Accounts affected: ${accounts.map((a) => a.label || a.email_address).join(', ')}.`}
          {' '}
          <Link to="/smtp" className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200 transition-colors">
            Manage SMTP accounts →
          </Link>
        </p>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss warning"
        className="flex-shrink-0 p-0.5 rounded text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

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

/* ─── Inbox health — calm number + bar + plain stats ─── */
function InboxHealth({ score, verified, bounced, suppressed }: {
  score: number; verified: number; bounced: number; suppressed: number;
}) {
  const pct = Math.max(0, Math.min(100, score));
  const tier = pct >= 80 ? 'Excellent' : pct >= 60 ? 'Healthy' : pct >= 40 ? 'Fair' : 'Needs attention';
  const color = pct >= 60 ? ACCENT : pct >= 40 ? '#F59E0B' : '#F43F5E';
  return (
    <div className="p-4 flex flex-col gap-4 flex-1">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-[28px] font-semibold tabular leading-none tracking-[-0.03em] text-[var(--text-primary)]">
            {pct.toFixed(0)}<span className="text-[14px] text-[var(--text-tertiary)] font-medium">/100</span>
          </span>
          <span className="text-[12.5px] font-medium" style={{ color }}>{tier}</span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-auto">
        {[
          { label: 'Verified', value: verified },
          { label: 'Bounced', value: bounced },
          { label: 'Suppressed', value: suppressed },
        ].map((m) => (
          <div key={m.label}>
            <div className="text-[15px] font-semibold tabular text-[var(--text-primary)] leading-none">{fmtNum(m.value)}</div>
            <div className="text-[11px] text-[var(--text-tertiary)] mt-1">{m.label}</div>
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
  const [smtpBannerDismissed, setSmtpBannerDismissed] = useState(false);

  const setPeriodPersist = (p: number) => { setPeriod(p); try { localStorage.setItem('dashboard.period', String(p)); } catch { /* ignore */ } };

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
  const { data: smtpAccounts } = useQuery({
    queryKey: ['smtp', 'accounts'],
    queryFn: () => smtpApi.list(),
    staleTime: 5 * 60 * 1000,
  });

  if (analyticsLoading && trendLoading) return <DashboardSkeleton />;

  const unhealthySmtpAccounts = (smtpAccounts || [])
    .filter((a) => a.is_active && a.health_score < SMTP_HEALTH_THRESHOLD);

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

  const recentMessages = Array.isArray(inboxData?.data) ? inboxData.data : [];
  const name = user?.email?.split('@')[0] || 'there';

  const verified = Number(s.verified_contacts) || 0;
  const bounced = Number(s.bounced_contacts) || 0;
  const suppressed = Number(s.suppressed_count) || 0;
  const totalContacts = Number(s.total_contacts) || 0;

  return (
    <div className="stagger pb-8 space-y-5">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold text-[var(--text-primary)] tracking-[-0.025em] leading-tight">
            {greeting()}, <span className="capitalize">{name}</span>
          </h1>
          <div className="mt-2 flex items-center flex-wrap gap-x-2.5 gap-y-1 text-[13px] text-[var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.active_campaigns > 0 ? '#10B981' : 'var(--text-muted)' }} />
              {s.active_campaigns} active {s.active_campaigns === 1 ? 'campaign' : 'campaigns'}
            </span>
            <span className="text-[var(--border-strong)]">·</span>
            <span>{fmtFull(totalContacts)} contacts</span>
            <span className="text-[var(--border-strong)]">·</span>
            <span>{fmtPct(s.avg_reply_rate)} avg reply rate</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Segmented options={PERIODS} value={period} onChange={setPeriodPersist} />
          <a href={analyticsApi.exportOverviewReport(period)} className="btn-secondary" title="Export CSV report">
            <Download className="h-3.5 w-3.5" /> Export
          </a>
          <button className="btn-primary" onClick={() => navigate('/campaigns/new')}>
            <Plus className="h-3.5 w-3.5" /> New campaign
          </button>
        </div>
      </header>

      {/* ── SMTP health warning banner ── */}
      {!smtpBannerDismissed && unhealthySmtpAccounts.length > 0 && (
        <SmtpHealthBanner
          accounts={unhealthySmtpAccounts}
          onDismiss={() => setSmtpBannerDismissed(true)}
        />
      )}

      {/* ── KPI row ── */}
      <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-3 transition-opacity duration-300', refreshing && 'opacity-60')}>
        <Kpi label="Emails sent" icon={Send} target={s.total_sent} format={fmtNum} hint={`${fmtFull(s.total_sent)} in ${period} days`}
          delta={s.sent_change} onClick={() => navigate('/analytics')} />
        <Kpi label="Open rate" icon={MailOpen} target={s.avg_open_rate} format={fmtPct} hint={`${fmtFull(s.total_opened)} opens`}
          delta={s.opened_change} onClick={() => navigate('/analytics')} />
        <Kpi label="Click rate" icon={MousePointerClick} target={s.avg_click_rate} format={fmtPct} hint={`${fmtFull(s.total_clicked)} clicks`}
          delta={s.clicked_change} onClick={() => navigate('/analytics')} />
        <Kpi label="Reply rate" icon={MessageSquare} target={s.avg_reply_rate} format={fmtPct} hint={`${fmtFull(s.total_replied)} replies`}
          delta={s.replied_change} onClick={() => navigate('/inbox')} />
      </div>

      {/* ── Performance + inbox health ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className={cn('panel lg:col-span-2 overflow-hidden transition-opacity duration-300', refreshing && 'opacity-60')}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)]">
            <div className="min-w-0">
              <div className="flex items-end gap-2.5">
                <span className="text-[26px] font-semibold text-[var(--text-primary)] tabular leading-none tracking-[-0.03em]">{fmtFull(metricTotal)}</span>
                <Delta value={metricChange} className="mb-0.5" />
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">{METRICS[metric].label.toLowerCase()} · vs previous {period} days</p>
            </div>
            <Segmented size="sm"
              options={(Object.keys(METRICS) as MetricKey[]).map((k) => ({ value: k, label: METRICS[k].label }))}
              value={metric} onChange={setMetric} />
          </div>
          <div className="px-2 pb-2 pt-2">
            <ErrorBoundary fallback={<div className="h-[280px] flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">Chart unavailable</div>}>
              <PerformanceChart data={trend} metric={metric} />
            </ErrorBoundary>
          </div>
        </section>

        <section className="panel overflow-hidden flex flex-col">
          <Head title="Inbox health" desc="Deliverability score" action={<MoreLink to="/verification" label="Details" />} />
          <InboxHealth score={Number(s.avg_dcs_score) || 0} verified={verified} bounced={bounced} suppressed={suppressed} />
        </section>
      </div>

      {/* ── Top campaigns + latest replies ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="panel lg:col-span-2 overflow-hidden">
          <Head title="Top campaigns" desc="Ranked by volume" action={<MoreLink to="/analytics" />} />
          {topCampaigns.length > 0 ? (
            <div className="divide-y divide-[var(--border-subtle)]">
              {topCampaigns.map((c) => (
                <button key={c.id} onClick={() => navigate(`/campaigns/${c.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors text-left group">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[c.status] || 'var(--text-muted)' }} />
                  <p className="flex-1 min-w-0 text-[13px] font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                  <div className="flex items-center gap-5 text-right flex-shrink-0">
                    <div className="hidden sm:block w-12">
                      <div className="text-[13px] font-semibold tabular text-[var(--text-primary)]">{fmtPct(c.open_rate)}</div>
                      <div className="text-[11px] text-[var(--text-tertiary)]">open</div>
                    </div>
                    <div className="hidden sm:block w-12">
                      <div className="text-[13px] font-semibold tabular text-[var(--text-primary)]">{fmtPct(c.reply_rate)}</div>
                      <div className="text-[11px] text-[var(--text-tertiary)]">reply</div>
                    </div>
                    <div className="w-12">
                      <div className="text-[13px] font-semibold tabular text-[var(--text-primary)]">{fmtNum(c.sent)}</div>
                      <div className="text-[11px] text-[var(--text-tertiary)]">sent</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-14 text-center">
              <Megaphone className="h-6 w-6 text-[var(--text-muted)] mx-auto mb-2.5" strokeWidth={1.5} />
              <p className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">No campaigns yet</p>
              <p className="text-[12px] text-[var(--text-tertiary)] mb-3.5">Launch your first sequence to see rankings.</p>
              <button className="btn-primary mx-auto" onClick={() => navigate('/campaigns/new')}><Plus className="h-3.5 w-3.5" /> Create campaign</button>
            </div>
          )}
        </section>

        <section className="panel overflow-hidden flex flex-col">
          <Head title="Latest replies" action={<MoreLink to="/inbox" label={unreadCount > 0 ? `${unreadCount} new` : 'Open'} />} />
          {recentMessages.length > 0 ? (
            <div className="divide-y divide-[var(--border-subtle)] flex-1">
              {recentMessages.slice(0, 5).map((msg: any) => (
                <Link key={msg.id} to="/inbox" className="flex items-start gap-2.5 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <Avatar name={msg.contact_name} email={msg.from_email} size="sm" />
                    {!msg.is_read && <span className="absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full ring-2 ring-[var(--bg-surface)]" style={{ background: ACCENT }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-[12.5px] truncate', msg.is_read ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]')}>
                        {msg.contact_name || msg.from_email?.split('@')[0] || 'Unknown'}
                      </span>
                      <span className="text-[11px] text-[var(--text-tertiary)] flex-shrink-0 tabular">{timeAgo(msg.received_at)}</span>
                    </div>
                    <p className="text-[11.5px] text-[var(--text-tertiary)] truncate leading-tight mt-0.5">{msg.subject || '(no subject)'}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
              <Inbox className="h-5 w-5 text-[var(--text-muted)] mb-2" strokeWidth={1.5} />
              <p className="text-[12px] text-[var(--text-tertiary)]">No replies yet</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
