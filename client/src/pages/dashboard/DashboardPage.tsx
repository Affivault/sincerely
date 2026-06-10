import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, type TrendDataPoint } from '../../api/analytics.api';
import { inboxApi } from '../../api/inbox.api';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { useAuth } from '../../context/AuthContext';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Avatar } from '../../components/shared/Avatar';
import {
  Plus, Send, MailOpen, MousePointerClick, MessageSquare, Inbox,
  ChevronRight, ArrowUpRight, ArrowDownRight, Sparkles, Download,
  ShieldCheck, Megaphone, Users, Zap, Target, Flame, TrendingUp,
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

/* ═══════════════════════════════════════════════════════════════════════
   SkySend — Command Center dashboard
   A curated, data-dense analytics surface in the spirit of Apollo /
   Amplemarket: restrained premium surfaces, colour reserved for data viz.
   ═══════════════════════════════════════════════════════════════════════ */

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
  sent:    { label: 'Sent',    color: '#6366F1', icon: Send },
  opened:  { label: 'Opened',  color: '#8B5CF6', icon: MailOpen },
  clicked: { label: 'Clicked', color: '#06B6D4', icon: MousePointerClick },
  replied: { label: 'Replied', color: '#10B981', icon: MessageSquare },
} as const;
type MetricKey = keyof typeof METRICS;

const PERIODS = [
  { days: 7,  label: '7D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
];

/* ─── Segmented control ─────────────────────────────── */
function Segmented<T extends string | number>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center p-0.5 rounded-[9px] bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 px-3 rounded-[7px] text-[12px] font-semibold transition-all duration-150',
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

/* ─── Delta chip ────────────────────────────────────── */
function Delta({ value, inverted }: { value: number | null | undefined; inverted?: boolean }) {
  if (value == null || !isFinite(value)) {
    return <span className="text-[11px] font-medium text-[var(--text-muted)]">—</span>;
  }
  const good = inverted ? value < 0 : value > 0;
  const flat = value === 0;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 h-[20px] px-1.5 rounded-full text-[11px] font-bold tabular',
      flat ? 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
        : good ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
        : 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
    )}>
      {!flat && (value > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* ─── Full-bleed sparkline (KPI footer) ─────────────── */
function MiniSpark({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return <div className="h-9" />;
  const w = 100, h = 36;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 6) - 3}`);
  const uid = color.replace('#', '');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-9 block">
      <defs>
        <linearGradient id={`ms-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={`url(#ms-${uid})`} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ─── KPI tile ──────────────────────────────────────── */
function Kpi({ label, value, hint, delta, deltaInverted, metric, spark, onClick }: {
  label: string; value: string; hint?: string; delta?: number | null; deltaInverted?: boolean;
  metric: MetricKey; spark: number[]; onClick?: () => void;
}) {
  const { color, icon: Icon } = METRICS[metric];
  return (
    <button
      onClick={onClick}
      className="group relative text-left panel panel-hover overflow-hidden p-4 pb-0"
    >
      <span className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${color}, ${color}00)` }} />
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-[7px]" style={{ background: `${color}1A` }}>
            <Icon className="h-3.5 w-3.5" strokeWidth={2.2} style={{ color }} />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">{label}</span>
        </span>
        <Delta value={delta} inverted={deltaInverted} />
      </div>
      <div className="mt-2.5 text-[30px] font-bold text-[var(--text-primary)] tabular leading-none tracking-[-0.03em]">
        {value}
      </div>
      <div className="mt-1 mb-2.5 text-[11.5px] text-[var(--text-tertiary)] truncate">{hint}</div>
      <div className="-mx-4">
        <MiniSpark data={spark} color={color} />
      </div>
    </button>
  );
}

/* ─── Performance chart with metric toggles ─────────── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] px-3 py-2 min-w-[140px]">
      <div className="text-[10px] font-medium text-[var(--text-tertiary)] mb-1.5">{fmtDate(label)}</div>
      <div className="space-y-1">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-[11.5px]">
            <span className="w-2 h-2 rounded-full" style={{ background: p.stroke }} />
            <span className="text-[var(--text-secondary)]">{METRICS[p.dataKey as MetricKey]?.label}</span>
            <span className="ml-auto font-bold tabular text-[var(--text-primary)]">{fmtFull(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerformanceChart({ data, active }: { data: TrendDataPoint[]; active: Set<MetricKey> }) {
  if (!data.length) {
    return (
      <div className="h-[300px] flex flex-col items-center justify-center gap-2 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
          <TrendingUp className="h-5 w-5 text-[var(--text-tertiary)]" strokeWidth={1.6} />
        </div>
        <p className="text-[13px] text-[var(--text-secondary)]">No sending activity yet</p>
        <p className="text-[12px] text-[var(--text-tertiary)]">Launch a campaign to see performance trends.</p>
      </div>
    );
  }
  const keys = (Object.keys(METRICS) as MetricKey[]).filter((k) => active.has(k));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 12, right: 6, left: 6, bottom: 0 }}>
        <defs>
          {keys.map((k) => (
            <linearGradient key={k} id={`area-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={METRICS[k].color} stopOpacity={0.28} />
              <stop offset="95%" stopColor={METRICS[k].color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="2 5" stroke="var(--border-subtle)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }} axisLine={false}
          tickLine={false} tickFormatter={fmtDate} minTickGap={28} />
        <YAxis tick={{ fontSize: 10.5, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false}
          width={34} tickFormatter={(v) => fmtNum(v)} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, strokeDasharray: '3 3' }} />
        {keys.map((k) => (
          <Area key={k} type="monotone" dataKey={k} stroke={METRICS[k].color} strokeWidth={2.25}
            fill={`url(#area-${k})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-surface)' }} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ─── Engagement funnel ─────────────────────────────── */
function Funnel({ sent, opened, clicked, replied }: { sent: number; opened: number; clicked: number; replied: number }) {
  const stages = [
    { key: 'sent',    label: 'Sent',    value: sent,    color: '#6366F1' },
    { key: 'opened',  label: 'Opened',  value: opened,  color: '#8B5CF6' },
    { key: 'clicked', label: 'Clicked', value: clicked, color: '#06B6D4' },
    { key: 'replied', label: 'Replied', value: replied, color: '#10B981' },
  ];
  const top = sent || 1;
  return (
    <div className="space-y-3">
      {stages.map((stage, i) => {
        const pctOfTop = Math.max((stage.value / top) * 100, stage.value > 0 ? 4 : 0);
        const prev = i === 0 ? null : stages[i - 1].value;
        const conv = prev && prev > 0 ? (stage.value / prev) * 100 : null;
        return (
          <div key={stage.key}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: stage.color }} />
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">{stage.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold tabular text-[var(--text-primary)]">{fmtFull(stage.value)}</span>
                {conv != null ? (
                  <span className="text-[10.5px] font-semibold tabular text-[var(--text-tertiary)] w-11 text-right">
                    {conv.toFixed(0)}%
                  </span>
                ) : <span className="w-11" />}
              </div>
            </div>
            <div className="h-2.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700 ease-[var(--ease-out)]"
                style={{ width: `${pctOfTop}%`, background: `linear-gradient(90deg, ${stage.color}, ${stage.color}cc)` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Radial health gauge ───────────────────────────── */
function Gauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const size = 132, stroke = 11, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  const tier = pct >= 80 ? { label: 'Excellent', color: '#10B981' }
    : pct >= 60 ? { label: 'Good', color: '#06B6D4' }
    : pct >= 40 ? { label: 'Fair', color: '#F59E0B' }
    : { label: 'Needs work', color: '#F43F5E' };
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tier.color} />
            <stop offset="100%" stopColor={tier.color} stopOpacity={0.6} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#gauge-grad)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.9s var(--ease-out)', filter: `drop-shadow(0 2px 6px ${tier.color}66)` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-bold tabular tracking-[-0.03em] text-[var(--text-primary)] leading-none">{pct.toFixed(0)}</span>
        <span className="text-[11px] font-semibold mt-1" style={{ color: tier.color }}>{tier.label}</span>
      </div>
    </div>
  );
}

/* ─── Donut chart ───────────────────────────────────── */
function Donut({ segments, centerLabel, centerValue }: {
  segments: { label: string; value: number; color: string }[];
  centerLabel: string; centerValue: string;
}) {
  const total = segments.reduce((a, seg) => a + seg.value, 0) || 1;
  const size = 128, stroke = 14, r = (size - stroke) / 2;
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
                strokeLinecap="butt" style={{ transition: 'stroke-dasharray 0.7s var(--ease-out)' }} />
            );
            acc += frac;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-bold tabular tracking-[-0.02em] text-[var(--text-primary)] leading-none">{centerValue}</span>
          <span className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{centerLabel}</span>
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ background: seg.color }} />
            <span className="text-[var(--text-secondary)] truncate">{seg.label}</span>
            <span className="ml-auto font-semibold tabular text-[var(--text-primary)]">{fmtFull(seg.value)}</span>
            <span className="text-[var(--text-tertiary)] tabular w-9 text-right">{((seg.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Section header ────────────────────────────────── */
function SectionHead({ icon: Icon, title, desc, color, action }: {
  icon: any; title: string; desc?: string; color: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px] flex-shrink-0" style={{ background: `${color}1A` }}>
          <Icon className="h-[15px] w-[15px]" strokeWidth={2.1} style={{ color }} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.01em] leading-tight truncate">{title}</h3>
          {desc && <p className="text-[11px] text-[var(--text-tertiary)] leading-tight truncate">{desc}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  running: '#10B981', active: '#10B981', paused: '#F59E0B', draft: '#94A3B8',
  scheduled: '#3B82F6', completed: '#6366F1', cancelled: '#F43F5E',
};

/* ─── Loading skeleton ──────────────────────────────── */
function DashboardSkeleton() {
  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-7 w-72" /><Skeleton className="h-3.5 w-96" /></div>
        <div className="flex gap-2"><Skeleton className="h-9 w-32" /><Skeleton className="h-9 w-36" /></div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel p-4 space-y-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-20" /><Skeleton className="h-9 w-full" /></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="panel lg:col-span-2 p-4"><Skeleton className="h-4 w-40 mb-4" /><Skeleton className="h-[300px] w-full rounded-lg" /></div>
        <div className="panel p-4 space-y-4"><Skeleton className="h-4 w-32" /><Skeleton className="h-32 w-32 rounded-full mx-auto" /></div>
      </div>
    </div>
  );
}

/* ─── Dashboard ─────────────────────────────────────── */
export function DashboardPage() {
  const navigate = useNavigate();
  const unreadCount = useUnreadCount();
  const { user } = useAuth();
  const [period, setPeriod] = useState<number>(30);
  const [activeMetrics, setActiveMetrics] = useState<Set<MetricKey>>(new Set(['sent', 'opened', 'replied']));

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics', 'overview', period],
    queryFn: () => analyticsApi.overview(period),
  });
  const { data: trendData, isLoading: trendLoading } = useQuery({
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

  if (analyticsLoading && trendLoading) return <DashboardSkeleton />;

  const s = analytics || {
    total_campaigns: 0, active_campaigns: 0, total_contacts: 0,
    total_sent: 0, total_opened: 0, total_clicked: 0, total_replied: 0,
    avg_open_rate: 0, avg_click_rate: 0, avg_reply_rate: 0,
    suppressed_count: 0, avg_dcs_score: 0, verified_contacts: 0, bounced_contacts: 0,
    sent_change: null, opened_change: null, clicked_change: null, replied_change: null,
  };

  const trend = Array.isArray(trendData) ? trendData : [];
  const spark = (k: MetricKey) => trend.map((d) => Number(d[k] || 0));

  const campaigns = Array.isArray(campaignList) ? campaignList : [];
  const topCampaigns = [...campaigns].sort((a, b) => b.sent - a.sent).slice(0, 5);
  const maxSent = Math.max(...topCampaigns.map((c) => c.sent), 1);

  const recentMessages = Array.isArray(inboxData?.data) ? inboxData.data : [];
  const name = user?.email?.split('@')[0] || 'there';

  const toggleMetric = (k: MetricKey) => {
    setActiveMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(k)) { if (next.size > 1) next.delete(k); } else next.add(k);
      return next;
    });
  };

  // Audience composition
  const verified = Number(s.verified_contacts) || 0;
  const bounced = Number(s.bounced_contacts) || 0;
  const suppressed = Number(s.suppressed_count) || 0;
  const totalContacts = Number(s.total_contacts) || 0;
  const otherContacts = Math.max(0, totalContacts - verified - bounced - suppressed);
  const audienceSegments = [
    { label: 'Verified', value: verified, color: '#10B981' },
    { label: 'Unverified', value: otherContacts, color: '#6366F1' },
    { label: 'Bounced', value: bounced, color: '#F43F5E' },
    { label: 'Suppressed', value: suppressed, color: '#F59E0B' },
  ].filter((seg) => seg.value > 0);

  const dcsSegments = (deliverability?.dcs_distribution || []).map((d) => ({ label: d.label, value: d.value, color: d.color }));

  return (
    <div className="animate-fade-in pb-6 space-y-5">
      {/* ── Header band ── */}
      <div className="relative -mx-8 -mt-7 px-8 pt-7 pb-6 mb-1 overflow-hidden hero-gradient border-b border-[var(--border-subtle)]">
        <div className="absolute inset-0 pattern-dots opacity-40 pointer-events-none" />
        <div className="absolute -top-24 right-20 h-52 w-80 rounded-full blur-3xl opacity-60 pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.22), transparent 70%)' }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="eyebrow">Command center</span>
              <span className="chip chip-emerald"><span className="live-dot scale-75" />{s.active_campaigns} live</span>
            </div>
            <h1 className="text-[26px] font-bold text-[var(--text-primary)] tracking-[-0.03em] leading-tight">
              {greeting()}, <span className="gradient-text-brand capitalize">{name}</span>
            </h1>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              {trend.length > 0
                ? `${fmtFull(s.total_sent)} emails sent · ${fmtPct(s.avg_reply_rate)} reply rate over the last ${period} days.`
                : 'Your outreach metrics will appear here as campaigns send.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Segmented options={PERIODS.map((p) => ({ value: p.days, label: p.label }))} value={period} onChange={setPeriod} />
            <a href={analyticsApi.exportOverviewReport(period)}
              className="btn-secondary" title="Export CSV report">
              <Download className="h-3.5 w-3.5" /> Export
            </a>
            <button className="btn-primary" onClick={() => navigate('/campaigns/new')}>
              <Plus className="h-3.5 w-3.5" /> New campaign
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Emails sent" metric="sent" value={fmtNum(s.total_sent)} hint={`${fmtFull(s.total_sent)} total`}
          delta={s.sent_change} spark={spark('sent')} onClick={() => navigate('/analytics')} />
        <Kpi label="Open rate" metric="opened" value={fmtPct(s.avg_open_rate)} hint={`${fmtFull(s.total_opened)} opens`}
          delta={s.opened_change} spark={spark('opened')} onClick={() => navigate('/analytics')} />
        <Kpi label="Click rate" metric="clicked" value={fmtPct(s.avg_click_rate)} hint={`${fmtFull(s.total_clicked)} clicks`}
          delta={s.clicked_change} spark={spark('clicked')} onClick={() => navigate('/analytics')} />
        <Kpi label="Reply rate" metric="replied" value={fmtPct(s.avg_reply_rate)} hint={`${fmtFull(s.total_replied)} replies`}
          delta={s.replied_change} spark={spark('replied')} onClick={() => navigate('/inbox')} />
      </div>

      {/* ── Performance chart + deliverability ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className="panel lg:col-span-2 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[rgba(99,102,241,0.12)]">
                <TrendingUp className="h-[15px] w-[15px] text-[var(--c-indigo)]" strokeWidth={2.2} />
              </span>
              <div>
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)] leading-tight">Performance trends</h3>
                <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">Daily engagement over {period} days</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {(Object.keys(METRICS) as MetricKey[]).map((k) => {
                const on = activeMetrics.has(k);
                return (
                  <button key={k} onClick={() => toggleMetric(k)}
                    className={cn('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11.5px] font-semibold border transition-all duration-150',
                      on ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)]')}
                    style={on ? { background: `${METRICS[k].color}14`, borderColor: `${METRICS[k].color}59` } : undefined}>
                    <span className="w-2 h-2 rounded-full transition-colors" style={{ background: on ? METRICS[k].color : 'var(--border-strong)' }} />
                    {METRICS[k].label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="p-3 pr-4">
            <ErrorBoundary fallback={<div className="h-[300px] flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">Chart unavailable</div>}>
              <PerformanceChart data={trend} active={activeMetrics} />
            </ErrorBoundary>
          </div>
        </section>

        {/* Deliverability */}
        <section className="panel overflow-hidden flex flex-col">
          <SectionHead icon={ShieldCheck} title="Inbox health" desc="Avg. deliverability score" color="#10B981"
            action={<Link to="/verification" className="text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 transition-colors">Details <ChevronRight className="h-3 w-3" /></Link>} />
          <div className="flex-1 flex flex-col items-center justify-center py-5 gap-4">
            <Gauge score={Number(s.avg_dcs_score) || 0} />
            <div className="grid grid-cols-3 gap-2 w-full px-4">
              {[
                { label: 'Verified', value: fmtNum(verified), color: '#10B981' },
                { label: 'Bounced', value: fmtNum(bounced), color: '#F43F5E' },
                { label: 'Suppressed', value: fmtNum(suppressed), color: '#F59E0B' },
              ].map((m) => (
                <div key={m.label} className="text-center rounded-lg bg-[var(--bg-elevated)]/60 border border-[var(--border-subtle)] py-2">
                  <div className="text-[15px] font-bold tabular leading-none" style={{ color: m.color }}>{m.value}</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-1">{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ── Funnel + Audience + DCS distribution ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className="panel overflow-hidden">
          <SectionHead icon={Target} title="Engagement funnel" desc={`${fmtPct(s.avg_open_rate)} → ${fmtPct(s.avg_reply_rate)} conversion`} color="#8B5CF6" />
          <div className="p-4">
            <Funnel sent={s.total_sent} opened={s.total_opened} clicked={s.total_clicked} replied={s.total_replied} />
          </div>
        </section>

        <section className="panel overflow-hidden">
          <SectionHead icon={Users} title="Audience" desc={`${fmtFull(totalContacts)} contacts`} color="#06B6D4"
            action={<Link to="/contacts" className="text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 transition-colors">View <ChevronRight className="h-3 w-3" /></Link>} />
          <div className="p-4">
            {audienceSegments.length > 0 ? (
              <Donut segments={audienceSegments} centerLabel="contacts" centerValue={fmtNum(totalContacts)} />
            ) : (
              <div className="h-[128px] flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">No contacts yet</div>
            )}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <SectionHead icon={Flame} title="Score distribution" desc="Deliverability confidence (DCS)" color="#F59E0B" />
          <div className="p-4">
            {dcsSegments.length > 0 ? (
              <Donut segments={dcsSegments} centerLabel="scored" centerValue={fmtNum(dcsSegments.reduce((a, d) => a + d.value, 0))} />
            ) : (
              <div className="h-[128px] flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">No score data yet</div>
            )}
          </div>
        </section>
      </div>

      {/* ── Top campaigns + Replies ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className="panel lg:col-span-2 overflow-hidden">
          <SectionHead icon={Zap} title="Top campaigns" desc="Ranked by volume this period" color="#6366F1"
            action={<Link to="/analytics" className="text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 transition-colors">All <ChevronRight className="h-3 w-3" /></Link>} />
          {topCampaigns.length > 0 ? (
            <div className="divide-y divide-[var(--border-subtle)]">
              {topCampaigns.map((c, i) => (
                <button key={c.id} onClick={() => navigate(`/campaigns/${c.id}`)}
                  className="w-full grid grid-cols-[auto,1fr,auto] items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors text-left group">
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-[7px] text-[11px] font-bold tabular flex-shrink-0',
                    i === 0 ? 'bg-amber-400/20 text-amber-600 dark:text-amber-400' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]')}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[c.status] || '#94A3B8' }} />
                      <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden max-w-[280px]">
                      <div className="h-full rounded-full" style={{ width: `${(c.sent / maxSent) * 100}%`, background: 'linear-gradient(90deg,#6366F1,#8B5CF6)' }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div className="hidden sm:block w-12">
                      <div className="text-[12.5px] font-bold tabular text-[var(--text-primary)]">{fmtPct(c.open_rate)}</div>
                      <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-tertiary)]">open</div>
                    </div>
                    <div className="hidden sm:block w-12">
                      <div className="text-[12.5px] font-bold tabular text-emerald-600 dark:text-emerald-400">{fmtPct(c.reply_rate)}</div>
                      <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-tertiary)]">reply</div>
                    </div>
                    <div className="w-14">
                      <div className="text-[12.5px] font-bold tabular text-[var(--text-primary)]">{fmtNum(c.sent)}</div>
                      <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-tertiary)]">sent</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <div className="inline-flex items-center justify-center h-11 w-11 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] mb-3">
                <Megaphone className="h-5 w-5 text-[var(--text-tertiary)]" strokeWidth={1.6} />
              </div>
              <p className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">No campaigns yet</p>
              <p className="text-[12px] text-[var(--text-tertiary)] mb-3">Launch your first sequence to see rankings.</p>
              <button className="btn-primary mx-auto" onClick={() => navigate('/campaigns/new')}><Plus className="h-3.5 w-3.5" /> Create campaign</button>
            </div>
          )}
        </section>

        <section className="panel overflow-hidden flex flex-col">
          <SectionHead icon={Inbox} title="Latest replies" desc="From your unified inbox" color="#06B6D4"
            action={<Link to="/inbox" className="text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 transition-colors">{unreadCount > 0 ? `${unreadCount} new` : 'Open'} <ChevronRight className="h-3 w-3" /></Link>} />
          {recentMessages.length > 0 ? (
            <div className="divide-y divide-[var(--border-subtle)] flex-1">
              {recentMessages.slice(0, 5).map((msg: any) => (
                <Link key={msg.id} to="/inbox" className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <Avatar name={msg.contact_name} email={msg.from_email} size="sm" />
                    {!msg.is_read && <span className="absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full bg-[var(--c-cyan)] ring-2 ring-[var(--bg-surface)]" />}
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
              <Inbox className="h-5 w-5 text-[var(--text-tertiary)] mb-2" strokeWidth={1.6} />
              <p className="text-[12px] text-[var(--text-tertiary)]">No replies yet</p>
            </div>
          )}
          <Link to="/inbox" className="m-3 mt-0 flex items-center gap-2.5 rounded-[10px] tint tint-violet p-3 group">
            <span className="tile tile-violet h-8 w-8"><Sparkles className="h-4 w-4" /></span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">AI Assist</p>
              <p className="text-[10.5px] text-[var(--text-tertiary)]">Auto-tagging + reply drafting</p>
            </div>
            <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </section>
      </div>
    </div>
  );
}
