import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCountUp } from '../../hooks/useCountUp';
import { useSpotlight } from '../../hooks/useSpotlight';
import { CountUp } from '../../components/ui/CountUp';
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
  ChevronRight, ArrowUp, ArrowDown, Download, ShieldCheck, Megaphone,
  Users, Activity, Filter, BarChart3, Trophy, AlertTriangle, Zap, X,
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

/* ═══════════════════════════════════════════════════════════════════════
   SkySend — Dashboard
   A calm, monochrome-leaning operating surface. One accent (indigo); colour
   lives only in the data, as a tonal scale. Typography and rhythm carry it.
   ═══════════════════════════════════════════════════════════════════════ */

const ACCENT = '#6366F1';
/* Tonal indigo scale for multi-segment data viz (kept on-brand) */
const SCALE = ['#4F46E5', '#6366F1', '#818CF8', '#A5B4FC', '#C7D2FE'];

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

/* ─── Segmented control (neutral) ───────────────────── */
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
            size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12px]',
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

/* ─── Delta (tiny, semantic — the only place red/green appears) ── */
function Delta({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null || !isFinite(value)) {
    return <span className={cn('text-[11px] font-medium text-[var(--text-muted)]', className)}>—</span>;
  }
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[11.5px] font-semibold tabular',
      flat ? 'text-[var(--text-tertiary)]' : up ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-500',
      className
    )}>
      {!flat && (up ? <ArrowUp className="h-3 w-3" strokeWidth={2.5} /> : <ArrowDown className="h-3 w-3" strokeWidth={2.5} />)}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* ─── Sparkline (single accent) ─────────────────────── */
function Spark({ data }: { data: number[] }) {
  if (!data || data.length < 2) return <div className="h-8" />;
  const w = 120, h = 32;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 5) - 2.5}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-8 block">
      <defs>
        <linearGradient id="kpi-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.16" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill="url(#kpi-spark)" />
      <polyline points={pts.join(' ')} fill="none" stroke={ACCENT} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ─── KPI tile ──────────────────────────────────────── */
function Kpi({ label, target, format, hint, delta, icon: Icon, spark, onClick }: {
  label: string; target: number; format: (n: number) => string; hint?: string; delta?: number | null;
  icon: any; spark: number[]; onClick?: () => void;
}) {
  const animated = useCountUp(target);
  const spotlight = useSpotlight();
  return (
    <button onClick={onClick} {...spotlight} className="group spotlight text-left panel panel-hover p-4 pb-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
          {label}
        </span>
        <Delta value={delta} />
      </div>
      <div className="mt-3.5 text-[34px] font-semibold text-[var(--text-primary)] tabular leading-none tracking-[-0.035em]">
        {format(animated)}
      </div>
      <div className="mt-2 text-[12px] text-[var(--text-tertiary)] truncate">{hint}</div>
      <div className="mt-3 -mx-1 opacity-90"><Spark data={spark} /></div>
    </button>
  );
}

/* ─── Insight card — auto-computed "what's working / what's not" ─── */
const INSIGHT_TONES = {
  good:    { dot: '#10B981', text: 'text-emerald-600 dark:text-emerald-400' },
  bad:     { dot: '#F43F5E', text: 'text-rose-600 dark:text-rose-400' },
  neutral: { dot: ACCENT,    text: 'text-[var(--indigo)]' },
} as const;

function InsightCard({ tone, icon: Icon, label, name, metric, context, onClick }: {
  tone: keyof typeof INSIGHT_TONES; icon: any; label: string;
  name: string; metric: string; context: string; onClick: () => void;
}) {
  const t = INSIGHT_TONES[tone];
  const spotlight = useSpotlight();
  return (
    <button onClick={onClick} {...spotlight} className="group spotlight text-left panel panel-hover p-4">
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.dot }} />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{label}</span>
        <Icon className="h-3 w-3 text-[var(--text-muted)] ml-auto" strokeWidth={2} />
      </div>
      <p className="text-[14px] font-semibold text-[var(--text-primary)] tracking-[-0.01em] truncate">{name}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={cn('text-[24px] font-semibold tabular leading-none tracking-[-0.03em]', t.text)}>{metric}</span>
        <span className="text-[11.5px] text-[var(--text-tertiary)]">{context}</span>
      </div>
      <span className="mt-2.5 inline-flex items-center gap-0.5 text-[11.5px] font-medium text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] transition-colors">
        View campaign <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
      </span>
    </button>
  );
}

/* ─── Panel header (consistent across every card) ───── */
function Head({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.01em] leading-tight truncate">{title}</h3>
        {desc && <p className="text-[11px] text-[var(--text-tertiary)] leading-tight mt-0.5 truncate">{desc}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

function MoreLink({ to, label = 'View' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="text-[11.5px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 transition-colors">
      {label} <ChevronRight className="h-3 w-3" />
    </Link>
  );
}

/* ─── Performance chart (single accent area) ────────── */
function ChartTooltip({ active, payload, label, metricLabel }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] px-2.5 py-1.5">
      <div className="text-[10px] font-medium text-[var(--text-tertiary)] mb-0.5">{fmtDate(label)}</div>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-[var(--text-secondary)]">{metricLabel}</span>
        <span className="font-semibold tabular text-[var(--text-primary)]">{fmtFull(payload[0].value)}</span>
      </div>
    </div>
  );
}

function PerformanceChart({ data, metric }: { data: TrendDataPoint[]; metric: MetricKey }) {
  if (!data.length) {
    return (
      <div className="h-[260px] flex flex-col items-center justify-center gap-2 text-center">
        <Activity className="h-6 w-6 text-[var(--text-muted)]" strokeWidth={1.5} />
        <p className="text-[13px] text-[var(--text-secondary)]">No activity yet</p>
        <p className="text-[12px] text-[var(--text-tertiary)]">Launch a campaign to see trends.</p>
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="perf-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.16} />
            <stop offset="92%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 6" stroke="var(--border-subtle)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }} axisLine={false}
          tickLine={false} tickFormatter={fmtDate} minTickGap={32} dy={4} />
        <YAxis tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false}
          width={32} tickFormatter={(v) => fmtNum(v)} />
        <Tooltip content={<ChartTooltip metricLabel={METRICS[metric].label} />}
          cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, strokeDasharray: '3 3' }} />
        <Area type="monotone" dataKey={metric} stroke={ACCENT} strokeWidth={2}
          fill="url(#perf-area)" dot={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: 'var(--bg-surface)', fill: ACCENT }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ─── Engagement funnel (single accent, width-encoded) ── */
function Funnel({ sent, opened, clicked, replied }: { sent: number; opened: number; clicked: number; replied: number }) {
  const stages = [
    { label: 'Sent', value: sent },
    { label: 'Opened', value: opened },
    { label: 'Clicked', value: clicked },
    { label: 'Replied', value: replied },
  ];
  const top = sent || 1;
  return (
    <div className="space-y-3.5">
      {stages.map((stage, i) => {
        const pct = Math.max((stage.value / top) * 100, stage.value > 0 ? 3 : 0);
        const prev = i === 0 ? null : stages[i - 1].value;
        const conv = prev && prev > 0 ? (stage.value / prev) * 100 : null;
        return (
          <div key={stage.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] text-[var(--text-secondary)]">{stage.label}</span>
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold tabular text-[var(--text-primary)]">{fmtFull(stage.value)}</span>
                <span className="text-[10.5px] tabular text-[var(--text-tertiary)] w-9 text-right">
                  {conv != null ? `${conv.toFixed(0)}%` : ''}
                </span>
              </div>
            </div>
            <div className="h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700 ease-[var(--ease-out)]"
                style={{ width: `${pct}%`, background: ACCENT, opacity: 1 - i * 0.16 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Radial gauge (single accent) ──────────────────── */
function Gauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const size = 140, stroke = 9, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const tier = pct >= 80 ? 'Excellent' : pct >= 60 ? 'Healthy' : pct >= 40 ? 'Fair' : 'Needs attention';
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ACCENT} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset 0.9s var(--ease-out)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[34px] font-semibold tabular tracking-[-0.03em] text-[var(--text-primary)] leading-none">{pct.toFixed(0)}</span>
        <span className="text-[11px] text-[var(--text-tertiary)] mt-1.5">{tier}</span>
      </div>
    </div>
  );
}

/* ─── Donut (tonal) ─────────────────────────────────── */
function Donut({ segments, centerLabel, centerValue }: {
  segments: { label: string; value: number; color: string }[];
  centerLabel: string; centerValue: string;
}) {
  const total = segments.reduce((a, seg) => a + seg.value, 0) || 1;
  const size = 120, stroke = 12, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth={stroke} />
          {segments.map((seg, i) => {
            const frac = seg.value / total;
            const dash = frac * circ;
            const el = (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color}
                strokeWidth={stroke} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-acc * circ}
                style={{ transition: 'stroke-dasharray 0.7s var(--ease-out)' }} />
            );
            acc += frac;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[20px] font-semibold tabular tracking-[-0.02em] text-[var(--text-primary)] leading-none">{centerValue}</span>
          <span className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{centerLabel}</span>
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: seg.color }} />
            <span className="text-[var(--text-secondary)] truncate">{seg.label}</span>
            <span className="ml-auto font-medium tabular text-[var(--text-primary)]">{fmtFull(seg.value)}</span>
            <span className="text-[var(--text-tertiary)] tabular w-9 text-right">{((seg.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
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
            ? 'High bounce rates can hurt deliverability. Review this account's sending activity.'
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
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-6 w-64" /><Skeleton className="h-3.5 w-80" /></div>
        <div className="flex gap-2"><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-32" /></div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel p-4 space-y-3"><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-24" /><Skeleton className="h-8 w-full" /></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="panel lg:col-span-2 p-4"><Skeleton className="h-4 w-32 mb-4" /><Skeleton className="h-[260px] w-full rounded-lg" /></div>
        <div className="panel p-4 flex flex-col items-center gap-4"><Skeleton className="h-4 w-28 self-start" /><Skeleton className="h-32 w-32 rounded-full" /></div>
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
  const { data: deliverability } = useQuery({
    queryKey: ['analytics', 'deliverability'],
    queryFn: () => analyticsApi.deliverability(),
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
  const spark = (k: MetricKey) => trend.map((d) => Number(d[k] || 0));
  const refreshing = aFetching || tFetching;

  const metricTotal = trend.reduce((a, d) => a + Number(d[metric] || 0), 0);
  const metricChange = (s as any)[CHANGE_KEY[metric]] as number | null;

  const campaigns = Array.isArray(campaignList) ? campaignList : [];
  const topCampaigns = [...campaigns].sort((a, b) => b.sent - a.sent).slice(0, 5);
  const maxSent = Math.max(...topCampaigns.map((c) => c.sent), 1);

  // ── Signals: surface what's working and what isn't, from real data ──
  const qualified = campaigns.filter((c) => c.sent >= 10);
  const topPerformer = [...qualified].filter((c) => c.reply_rate > 0).sort((a, b) => b.reply_rate - a.reply_rate)[0];
  const needsAttention =
    [...qualified].filter((c) => c.bounce_rate >= 2).sort((a, b) => b.bounce_rate - a.bounce_rate)[0] ||
    [...qualified].filter((c) => c.open_rate < 10).sort((a, b) => a.open_rate - b.open_rate)[0];
  const mostActive = [...campaigns].filter((c) => c.sent > 0).sort((a, b) => b.sent - a.sent)[0];
  const hasSignals = Boolean(topPerformer || needsAttention || mostActive);

  const recentMessages = Array.isArray(inboxData?.data) ? inboxData.data : [];
  const name = user?.email?.split('@')[0] || 'there';

  const verified = Number(s.verified_contacts) || 0;
  const bounced = Number(s.bounced_contacts) || 0;
  const suppressed = Number(s.suppressed_count) || 0;
  const totalContacts = Number(s.total_contacts) || 0;
  const otherContacts = Math.max(0, totalContacts - verified - bounced - suppressed);
  const audienceSegments = [
    { label: 'Verified', value: verified, color: ACCENT },
    { label: 'Unverified', value: otherContacts, color: '#A5B4FC' },
    { label: 'Bounced', value: bounced, color: 'var(--text-tertiary)' },
    { label: 'Suppressed', value: suppressed, color: 'var(--text-muted)' },
  ].filter((seg) => seg.value > 0);

  const dcsSegments = (deliverability?.dcs_distribution || []).map((d, i) => ({
    label: d.label, value: d.value, color: SCALE[i % SCALE.length],
  }));

  return (
    <div className="stagger pb-6 space-y-4">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow !text-[var(--text-tertiary)] mb-2">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="text-[24px] font-semibold text-[var(--text-primary)] tracking-[-0.025em] leading-tight">
            {greeting()}, <span className="capitalize">{name}</span>
          </h1>
          <div className="mt-1.5 flex items-center flex-wrap gap-x-2.5 gap-y-1 text-[12.5px] text-[var(--text-tertiary)]">
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

      {/* ── Editorial hero — the headline-number moment ── */}
      <section className="panel relative overflow-hidden">
        {/* Living trend backdrop */}
        <div className="absolute inset-y-0 right-0 w-[62%] opacity-[0.5] pointer-events-none" aria-hidden>
          {trend.length > 1 && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="sent" stroke={ACCENT} strokeWidth={2} fill="url(#hero-area)" dot={false} isAnimationActive />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(90deg, var(--bg-surface) 30%, transparent 78%)' }} aria-hidden />

        <div className="relative px-6 py-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="eyebrow">Emails sent</span>
            <span className="font-data text-[10px] text-[var(--text-muted)] uppercase tracking-[0.1em]">last {period} days</span>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <span className="text-[clamp(40px,6vw,60px)] font-semibold text-[var(--text-primary)] tabular leading-[0.95] tracking-[-0.04em]">
              <CountUp value={s.total_sent} format={fmtFull} />
            </span>
            <div className="mb-2.5"><Delta value={s.sent_change} /></div>
          </div>
          <p className="mt-2.5 text-[13px] text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{fmtFull(s.total_opened)}</span> opens
            <span className="mx-2 text-[var(--border-strong)]">·</span>
            <span className="font-medium text-[var(--text-primary)]">{fmtFull(s.total_clicked)}</span> clicks
            <span className="mx-2 text-[var(--border-strong)]">·</span>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">{fmtFull(s.total_replied)}</span> replies
          </p>
        </div>
      </section>

      {/* ── KPI row ── */}
      <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-3 transition-opacity duration-300', refreshing && 'opacity-60')}>
        <Kpi label="Emails sent" icon={Send} target={s.total_sent} format={fmtNum} hint={`${fmtFull(s.total_sent)} in ${period} days`}
          delta={s.sent_change} spark={spark('sent')} onClick={() => navigate('/analytics')} />
        <Kpi label="Open rate" icon={MailOpen} target={s.avg_open_rate} format={fmtPct} hint={`${fmtFull(s.total_opened)} opens`}
          delta={s.opened_change} spark={spark('opened')} onClick={() => navigate('/analytics')} />
        <Kpi label="Click rate" icon={MousePointerClick} target={s.avg_click_rate} format={fmtPct} hint={`${fmtFull(s.total_clicked)} clicks`}
          delta={s.clicked_change} spark={spark('clicked')} onClick={() => navigate('/analytics')} />
        <Kpi label="Reply rate" icon={MessageSquare} target={s.avg_reply_rate} format={fmtPct} hint={`${fmtFull(s.total_replied)} replies`}
          delta={s.replied_change} spark={spark('replied')} onClick={() => navigate('/inbox')} />
      </div>

      {/* ── Signals — what's working, what's not ── */}
      {hasSignals && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Signals</span>
            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topPerformer && (
              <InsightCard tone="good" icon={Trophy} label="Top performer"
                name={topPerformer.name} metric={fmtPct(topPerformer.reply_rate)}
                context={`reply rate · ${fmtFull(topPerformer.sent)} sent`}
                onClick={() => navigate(`/campaigns/${topPerformer.id}`)} />
            )}
            {needsAttention && needsAttention.id !== topPerformer?.id && (
              <InsightCard tone="bad" icon={AlertTriangle} label="Needs attention"
                name={needsAttention.name}
                metric={needsAttention.bounce_rate >= 2 ? fmtPct(needsAttention.bounce_rate) : fmtPct(needsAttention.open_rate)}
                context={needsAttention.bounce_rate >= 2 ? `bounce rate · check deliverability` : `open rate · review subject lines`}
                onClick={() => navigate(`/campaigns/${needsAttention.id}`)} />
            )}
            {mostActive && (
              <InsightCard tone="neutral" icon={Zap} label="Highest volume"
                name={mostActive.name} metric={fmtNum(mostActive.sent)}
                context={`sent · ${fmtPct(mostActive.open_rate)} opens`}
                onClick={() => navigate(`/campaigns/${mostActive.id}`)} />
            )}
          </div>
        </section>
      )}

      {/* ── Performance + inbox health ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className={cn('panel lg:col-span-2 overflow-hidden transition-opacity duration-300', refreshing && 'opacity-60')}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-[var(--text-tertiary)]" strokeWidth={2} />
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.01em]">Performance</h3>
            </div>
            <Segmented size="sm"
              options={(Object.keys(METRICS) as MetricKey[]).map((k) => ({ value: k, label: METRICS[k].label }))}
              value={metric} onChange={setMetric} />
          </div>
          <div className="px-4 pt-3.5">
            <div className="flex items-end gap-2.5">
              <span className="text-[32px] font-semibold text-[var(--text-primary)] tabular leading-none tracking-[-0.035em]">{fmtFull(metricTotal)}</span>
              <Delta value={metricChange} className="mb-0.5" />
            </div>
            <p className="mt-1 text-[11.5px] text-[var(--text-tertiary)]">{METRICS[metric].label.toLowerCase()} · vs previous {period} days</p>
          </div>
          <div className="px-2 pb-2 pt-1">
            <ErrorBoundary fallback={<div className="h-[260px] flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">Chart unavailable</div>}>
              <PerformanceChart data={trend} metric={metric} />
            </ErrorBoundary>
          </div>
        </section>

        <section className="panel overflow-hidden flex flex-col">
          <Head title="Inbox health" desc="Average deliverability score" action={<MoreLink to="/verification" label="Details" />} />
          <div className="flex-1 flex flex-col items-center justify-center py-6 gap-5">
            <Gauge score={Number(s.avg_dcs_score) || 0} />
            <div className="grid grid-cols-3 gap-px w-full px-4 rounded-lg overflow-hidden border border-[var(--border-subtle)]">
              {[
                { label: 'Verified', value: fmtNum(verified) },
                { label: 'Bounced', value: fmtNum(bounced) },
                { label: 'Suppressed', value: fmtNum(suppressed) },
              ].map((m) => (
                <div key={m.label} className="text-center py-2.5 bg-[var(--bg-surface)]">
                  <div className="text-[15px] font-semibold tabular text-[var(--text-primary)] leading-none">{m.value}</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-1">{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ── Funnel + Audience + Score distribution ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className="panel overflow-hidden">
          <Head title="Engagement funnel" desc={`${fmtPct(s.avg_open_rate)} open → ${fmtPct(s.avg_reply_rate)} reply`} />
          <div className="p-4 pt-4">
            <Funnel sent={s.total_sent} opened={s.total_opened} clicked={s.total_clicked} replied={s.total_replied} />
          </div>
        </section>

        <section className="panel overflow-hidden">
          <Head title="Audience" desc={`${fmtFull(totalContacts)} contacts`} action={<MoreLink to="/contacts" />} />
          <div className="p-4 flex items-center min-h-[160px]">
            {audienceSegments.length > 0 ? (
              <Donut segments={audienceSegments} centerLabel="contacts" centerValue={fmtNum(totalContacts)} />
            ) : (
              <div className="w-full text-center text-[12px] text-[var(--text-tertiary)]">No contacts yet</div>
            )}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <Head title="Score distribution" desc="Deliverability confidence" />
          <div className="p-4 flex items-center min-h-[160px]">
            {dcsSegments.length > 0 ? (
              <Donut segments={dcsSegments} centerLabel="scored" centerValue={fmtNum(dcsSegments.reduce((a, d) => a + d.value, 0))} />
            ) : (
              <div className="w-full text-center text-[12px] text-[var(--text-tertiary)]">No score data yet</div>
            )}
          </div>
        </section>
      </div>

      {/* ── Top campaigns + replies ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className="panel lg:col-span-2 overflow-hidden">
          <Head title="Top campaigns" desc="Ranked by volume" action={<MoreLink to="/analytics" label="All" />} />
          {topCampaigns.length > 0 ? (
            <div className="divide-y divide-[var(--border-subtle)]">
              {topCampaigns.map((c, i) => (
                <button key={c.id} onClick={() => navigate(`/campaigns/${c.id}`)}
                  className="w-full grid grid-cols-[auto,1fr,auto] items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors text-left group">
                  <span className="text-[12px] font-medium tabular text-[var(--text-tertiary)] w-4 text-center flex-shrink-0">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[c.status] || 'var(--text-muted)' }} />
                      <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden max-w-[300px]">
                      <div className="h-full rounded-full" style={{ width: `${(c.sent / maxSent) * 100}%`, background: ACCENT }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-5 text-right">
                    <div className="hidden sm:block w-11">
                      <div className="text-[12.5px] font-semibold tabular text-[var(--text-primary)]">{fmtPct(c.open_rate)}</div>
                      <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-tertiary)]">open</div>
                    </div>
                    <div className="hidden sm:block w-11">
                      <div className="text-[12.5px] font-semibold tabular text-[var(--text-primary)]">{fmtPct(c.reply_rate)}</div>
                      <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-tertiary)]">reply</div>
                    </div>
                    <div className="w-12">
                      <div className="text-[12.5px] font-semibold tabular text-[var(--text-primary)]">{fmtNum(c.sent)}</div>
                      <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-tertiary)]">sent</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <Megaphone className="h-6 w-6 text-[var(--text-muted)] mx-auto mb-2.5" strokeWidth={1.5} />
              <p className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">No campaigns yet</p>
              <p className="text-[12px] text-[var(--text-tertiary)] mb-3">Launch your first sequence to see rankings.</p>
              <button className="btn-primary mx-auto" onClick={() => navigate('/campaigns/new')}><Plus className="h-3.5 w-3.5" /> Create campaign</button>
            </div>
          )}
        </section>

        <section className="panel overflow-hidden flex flex-col">
          <Head title="Latest replies" action={<MoreLink to="/inbox" label={unreadCount > 0 ? `${unreadCount} new` : 'Open'} />} />
          {recentMessages.length > 0 ? (
            <div className="divide-y divide-[var(--border-subtle)] flex-1">
              {recentMessages.slice(0, 5).map((msg: any) => (
                <Link key={msg.id} to="/inbox" className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <Avatar name={msg.contact_name} email={msg.from_email} size="sm" />
                    {!msg.is_read && <span className="absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full ring-2 ring-[var(--bg-surface)]" style={{ background: ACCENT }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-[12px] truncate', msg.is_read ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]')}>
                        {msg.contact_name || msg.from_email?.split('@')[0] || 'Unknown'}
                      </span>
                      <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular">{timeAgo(msg.received_at)}</span>
                    </div>
                    <p className="text-[11px] text-[var(--text-tertiary)] truncate leading-tight mt-0.5">{msg.subject || '(no subject)'}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
              <Inbox className="h-5 w-5 text-[var(--text-muted)] mb-2" strokeWidth={1.5} />
              <p className="text-[12px] text-[var(--text-tertiary)]">No replies yet</p>
            </div>
          )}
          <Link to="/contacts/import" className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--border-subtle)] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
            <Filter className="h-3.5 w-3.5" /> Import contacts
            <ChevronRight className="h-3.5 w-3.5 ml-auto text-[var(--text-muted)]" />
          </Link>
        </section>
      </div>
    </div>
  );
}
