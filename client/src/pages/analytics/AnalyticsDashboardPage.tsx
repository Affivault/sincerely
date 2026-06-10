import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  analyticsApi,
  type TrendDataPoint,
  type FunnelStep,
  type AbTestStep,
  type CampaignContact,
  type CampaignListItem,
  type HeatmapDay,
} from '../../api/analytics.api';
import type { OverviewAnalytics } from '../../api/analytics.api';
import { apiClient } from '../../api/client';
import { Spinner } from '../../components/ui/Spinner';
import { Skeleton } from '../../components/ui/Skeleton';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Avatar } from '../../components/shared/Avatar';
import { useTheme } from '../../context/ThemeContext';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import {
  Send, Mail, MousePointerClick, MessageSquare, AlertTriangle,
  Calendar, Target, Users, ChevronDown, Download, ShieldOff,
  ShieldCheck, Activity, TrendingUp, TrendingDown, BarChart3,
  FlaskConical, Layers, Thermometer, ArrowRight, Trophy,
  ChevronUp, ChevronsUpDown, Eye, Search, Filter, Clock, Zap,
} from 'lucide-react';

// ─── Helpers ───────────────────────────────────────────────────────────────

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtNum(v: unknown): string {
  return safeNum(v).toLocaleString();
}

function fmtPct(v: unknown): string {
  return `${safeNum(v).toFixed(1)}%`;
}

function engagementScore(c: CampaignContact): number {
  if (c.is_bounced) return 0;
  const s = Math.max(1, c.sent);
  return Math.min(100, Math.round((c.opened / s) * 35 + (c.clicked / s) * 35 + (c.replied ? 30 : 0)));
}

function contactStatusFilter(c: CampaignContact, filter: string): boolean {
  switch (filter) {
    case 'engaged': return engagementScore(c) >= 50;
    case 'silent': return !c.is_bounced && engagementScore(c) < 10;
    case 'bounced': return c.is_bounced;
    case 'replied': return c.replied;
    default: return true;
  }
}

async function downloadCsv(url: string, filename: string) {
  try {
    const resp = await apiClient.get(url, { responseType: 'blob' });
    const blob = new Blob([resp.data], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch {
    window.open(url, '_blank');
  }
}

/* Cohesive, analogous palette — indigo→violet→cyan for the engagement
   series, emerald for the success outcome, rose reserved for bounces. */
const CHART_COLORS = {
  sent: '#6366F1',
  opened: '#8B5CF6',
  clicked: '#06B6D4',
  replied: '#10B981',
  bounced: '#F43F5E',
};

const tooltipStyle = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '10px',
  boxShadow: 'var(--shadow-lg)',
  padding: '8px 12px',
  fontSize: '12px',
};

// ─── Micro components ──────────────────────────────────────────────────────

function ChangeChip({ change }: { change: number | null }) {
  if (change === null) return null;
  const up = change >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full',
        up ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
      )}
    >
      {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {Math.abs(change).toFixed(1)}%
    </span>
  );
}

function MetricBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden bg-[var(--bg-elevated)]">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${w}%`, backgroundColor: color }} />
    </div>
  );
}

function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: string; sortDir: 'asc' | 'desc' }) {
  if (sortKey !== col) return <ChevronsUpDown className="h-3 w-3 text-[var(--text-tertiary)]" />;
  return sortDir === 'asc'
    ? <ChevronUp className="h-3 w-3 text-[var(--indigo)]" />
    : <ChevronDown className="h-3 w-3 text-[var(--indigo)]" />;
}

function EmptyDeepDive({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="w-12 h-12 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center">
        <Icon className="h-5 w-5 text-[var(--text-tertiary)]" strokeWidth={1.5} />
      </div>
      <p className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="text-[12px] text-[var(--text-tertiary)] max-w-sm text-center">{description}</p>
    </div>
  );
}

// ─── Funnel visualisation ──────────────────────────────────────────────────

function FunnelViz({ sent, opened, clicked, replied, bounced }: {
  sent: number; opened: number; clicked: number; replied: number; bounced: number;
}) {
  const bars = [
    { label: 'Sent', count: sent, color: CHART_COLORS.sent },
    { label: 'Opened', count: opened, color: CHART_COLORS.opened },
    { label: 'Clicked', count: clicked, color: CHART_COLORS.clicked },
    { label: 'Replied', count: replied, color: CHART_COLORS.replied },
    { label: 'Bounced', count: bounced, color: CHART_COLORS.bounced },
  ];
  return (
    <div className="space-y-2 py-2">
      {bars.map((bar, i) => {
        const pct = sent > 0 ? (bar.count / sent) * 100 : 0;
        const prev = i > 0 ? bars[i - 1].count : null;
        const dropped = prev !== null && prev > 0 ? prev - bar.count : null;
        const dropPct = dropped !== null && prev ? ((dropped / prev) * 100).toFixed(0) : null;
        return (
          <div key={bar.label}>
            {dropped !== null && dropped > 0 && (
              <div className="flex items-center gap-2 pl-[80px] mb-1">
                <div className="w-px h-3 bg-[var(--border-subtle)] ml-3" />
                <span className="text-[10.5px] text-[var(--text-tertiary)]">
                  ↓ {fmtNum(dropped)} dropped ({dropPct}%)
                </span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="w-[72px] text-right text-[11.5px] font-medium text-[var(--text-secondary)] flex-shrink-0">
                {bar.label}
              </span>
              <div className="flex-1 h-9 bg-[var(--bg-elevated)] rounded-lg overflow-hidden border border-[var(--border-subtle)]">
                <div
                  className="h-full rounded-lg flex items-center transition-all duration-700 ease-out"
                  style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: bar.color, opacity: 0.85 }}
                />
              </div>
              <div className="w-36 flex-shrink-0">
                <span className="text-[13px] font-bold tabular-nums text-[var(--text-primary)]">{fmtNum(bar.count)}</span>
                <span className="ml-1.5 text-[11px] text-[var(--text-tertiary)] tabular-nums">
                  {sent > 0 ? `(${pct.toFixed(1)}%)` : ''}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Heatmap ───────────────────────────────────────────────────────────────

function HeatmapGrid({ grid, maxValue }: { grid: HeatmapDay[]; maxValue: number }) {
  const hours = Array.from({ length: 24 }, (_, i) => (i < 10 ? `0${i}` : `${i}`));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="flex gap-px mb-1 pl-[52px]">
          {hours.map((h) => (
            <div key={h} className="w-[22px] text-[8.5px] text-center text-[var(--text-tertiary)] flex-shrink-0">
              {Number(h) % 3 === 0 ? h : ''}
            </div>
          ))}
        </div>
        <div className="space-y-px">
          {grid.map((row) => (
            <div key={row.day} className="flex items-center gap-px">
              <span className="w-[48px] text-[10px] text-right pr-2 flex-shrink-0 text-[var(--text-tertiary)] font-medium">
                {row.day}
              </span>
              {row.hours.map((val, h) => {
                const intensity = maxValue > 0 ? val / maxValue : 0;
                return (
                  <div
                    key={h}
                    className="w-[22px] h-[22px] rounded-[3px] flex-shrink-0 transition-colors"
                    style={{
                      backgroundColor: intensity > 0
                        ? `rgba(99, 102, 241, ${Math.min(1, intensity * 1.2).toFixed(2)})`
                        : 'var(--bg-elevated)',
                    }}
                    title={val > 0 ? `${row.day} ${h}:00 — ${val} engagements` : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3 pl-[52px]">
          <span className="text-[10px] text-[var(--text-tertiary)]">Low</span>
          <div className="flex gap-0.5">
            {[0.1, 0.25, 0.45, 0.65, 0.85, 1].map((o) => (
              <div key={o} className="w-4 h-4 rounded-sm" style={{ backgroundColor: `rgba(99,102,241,${o})` }} />
            ))}
          </div>
          <span className="text-[10px] text-[var(--text-tertiary)]">High</span>
        </div>
      </div>
    </div>
  );
}

// ─── A/B variant card ──────────────────────────────────────────────────────

function VariantCard({ variant, label, subject, stats, isWinner }: {
  variant: 'a' | 'b';
  label: string;
  subject: string;
  stats: { sent: number; open_rate: number; click_rate: number; reply_rate: number };
  isWinner: boolean;
}) {
  const metricMax = Math.max(stats.open_rate, 100);
  return (
    <div className={cn(
      'rounded-xl border p-5 relative transition-all',
      isWinner
        ? 'border-emerald-500/40 bg-emerald-500/5 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]'
        : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
    )}>
      {isWinner && (
        <div className="absolute top-3 right-3 flex items-center gap-1 text-[10.5px] font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
          <Trophy className="h-3 w-3" /> Winner
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        <span className={cn(
          'text-[11px] font-bold px-2 py-0.5 rounded',
          variant === 'a' ? 'bg-indigo-500/15 text-indigo-400' : 'bg-violet-500/15 text-violet-400'
        )}>
          Variant {variant.toUpperCase()}
        </span>
      </div>
      <p className="text-[12px] text-[var(--text-secondary)] mb-4 line-clamp-2 italic">"{subject}"</p>

      <div className="space-y-3">
        {[
          { label: 'Open rate', value: stats.open_rate, color: CHART_COLORS.opened },
          { label: 'Click rate', value: stats.click_rate, color: CHART_COLORS.clicked },
          { label: 'Reply rate', value: stats.reply_rate, color: CHART_COLORS.replied },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div className="flex justify-between text-[11.5px] mb-1">
              <span className="text-[var(--text-secondary)]">{label}</span>
              <span className="font-bold text-[var(--text-primary)]">{fmtPct(value)}</span>
            </div>
            <MetricBar value={value} max={metricMax} color={color} />
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
        <span className="text-[11px] text-[var(--text-tertiary)]">{fmtNum(stats.sent)} emails sent</span>
      </div>
    </div>
  );
}

// ─── Campaign Leaderboard ──────────────────────────────────────────────────

function CampaignLeaderboard({
  campaigns,
  onSelect,
}: { campaigns: CampaignListItem[]; onSelect: (id: string) => void }) {
  const [sortKey, setSortKey] = useState<keyof CampaignListItem>('sent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    return [...campaigns].sort((a, b) => {
      const av = safeNum(a[sortKey]);
      const bv = safeNum(b[sortKey]);
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [campaigns, sortKey, sortDir]);

  const toggleSort = (key: keyof CampaignListItem) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const maxSent = Math.max(1, ...campaigns.map((c) => c.sent));

  const cols: { key: keyof CampaignListItem; label: string }[] = [
    { key: 'sent', label: 'Sent' },
    { key: 'open_rate', label: 'Opens' },
    { key: 'click_rate', label: 'Clicks' },
    { key: 'reply_rate', label: 'Replies' },
    { key: 'bounce_rate', label: 'Bounce' },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)]">
            <th className="text-left py-2.5 px-4 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
              Campaign
            </th>
            {cols.map((c) => (
              <th
                key={c.key}
                className="text-right py-2.5 px-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold cursor-pointer hover:text-[var(--text-primary)] select-none"
                onClick={() => toggleSort(c.key)}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  {c.label}
                  <SortIcon col={c.key} sortKey={String(sortKey)} sortDir={sortDir} />
                </span>
              </th>
            ))}
            <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold w-32">
              Volume
            </th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr
              key={c.id}
              className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group"
              onClick={() => onSelect(c.id)}
            >
              <td className="py-3 px-4">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full flex-shrink-0',
                      c.status === 'running' ? 'bg-emerald-500' :
                      c.status === 'paused' ? 'bg-amber-500' :
                      c.status === 'completed' ? 'bg-[var(--text-tertiary)]' : 'bg-[var(--border-subtle)]'
                    )}
                  />
                  <span className="font-medium text-[12.5px] text-[var(--text-primary)] max-w-[200px] truncate">
                    {c.name}
                  </span>
                </div>
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-[12.5px] font-medium text-[var(--text-secondary)]">
                {fmtNum(c.sent)}
              </td>
              <td className="py-3 px-3 text-right">
                <span className={cn(
                  'tabular-nums text-[12.5px] font-semibold',
                  c.open_rate >= 30 ? 'text-emerald-500' : c.open_rate >= 15 ? 'text-amber-500' : 'text-[var(--text-secondary)]'
                )}>
                  {fmtPct(c.open_rate)}
                </span>
              </td>
              <td className="py-3 px-3 text-right">
                <span className="tabular-nums text-[12.5px] font-medium text-[var(--text-secondary)]">
                  {fmtPct(c.click_rate)}
                </span>
              </td>
              <td className="py-3 px-3 text-right">
                <span className={cn(
                  'tabular-nums text-[12.5px] font-semibold',
                  c.reply_rate >= 5 ? 'text-emerald-500' : 'text-[var(--text-secondary)]'
                )}>
                  {fmtPct(c.reply_rate)}
                </span>
              </td>
              <td className="py-3 px-3 text-right">
                <span className={cn(
                  'tabular-nums text-[12.5px]',
                  c.bounce_rate >= 5 ? 'text-rose-500 font-semibold' : 'text-[var(--text-tertiary)]'
                )}>
                  {fmtPct(c.bounce_rate)}
                </span>
              </td>
              <td className="py-3 px-3 w-32">
                <MetricBar value={c.sent} max={maxSent} color="#6366F1" />
              </td>
              <td className="py-3 px-2">
                <ArrowRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Deliverability section ────────────────────────────────────────────────

function DeliverabilitySection({
  deliverability,
  overview,
}: {
  deliverability: { dcs_distribution: { label: string; value: number; color: string }[]; suppression_by_reason: { label: string; value: number; color: string }[] } | undefined;
  overview: OverviewAnalytics | undefined;
}) {
  const avgDcs = safeNum(overview?.avg_dcs_score);
  const dcsColor = avgDcs >= 80 ? '#10B981' : avgDcs >= 50 ? '#F59E0B' : '#EF4444';
  const circumference = 2 * Math.PI * 36;
  const progress = circumference - (avgDcs / 100) * circumference;

  const totalContacts = safeNum(overview?.total_contacts);
  const verifiedPct = totalContacts > 0
    ? Math.round((safeNum(overview?.verified_contacts) / totalContacts) * 100)
    : 0;

  const suppressionTotal = (deliverability?.suppression_by_reason || []).reduce((s, r) => s + r.value, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* DCS Gauge */}
      <div className="flex flex-col items-center gap-4 p-5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
        <svg width="88" height="88" viewBox="0 0 88 88">
          <circle cx="44" cy="44" r="36" fill="none" stroke="var(--border-subtle)" strokeWidth="9" />
          <circle
            cx="44" cy="44" r="36" fill="none"
            stroke={dcsColor} strokeWidth="9"
            strokeDasharray={circumference}
            strokeDashoffset={progress}
            strokeLinecap="round"
            transform="rotate(-90 44 44)"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
          <text x="44" y="49" textAnchor="middle" fill="var(--text-primary)" fontSize="17" fontWeight="700">
            {avgDcs}
          </text>
        </svg>
        <div className="text-center">
          <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">Avg. DCS Score</p>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
            {fmtNum(overview?.verified_contacts)} of {fmtNum(totalContacts)} verified ({verifiedPct}%)
          </p>
        </div>
        <div className="w-full space-y-1.5">
          {[
            { label: 'Verified (DCS≥60)', value: safeNum(overview?.verified_contacts), color: '#10B981' },
            { label: 'Bounced contacts', value: safeNum(overview?.bounced_contacts), color: '#EF4444' },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="text-[var(--text-secondary)]">{row.label}</span>
              </div>
              <span className="font-semibold text-[var(--text-primary)]">{fmtNum(row.value)}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 w-full">
          <Link to="/verification" className="icon-btn flex-1 h-7 text-[11px] justify-center text-center">Verify</Link>
          <Link to="/suppression" className="icon-btn flex-1 h-7 text-[11px] justify-center text-center">Suppressed</Link>
        </div>
      </div>

      {/* DCS Distribution */}
      <div className="p-5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
        <h4 className="text-[12.5px] font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          DCS Distribution
        </h4>
        {(deliverability?.dcs_distribution || []).filter((d) => d.value > 0).length > 0 ? (
          <div className="h-44">
            <ErrorBoundary fallback={<p className="text-xs text-center text-[var(--text-tertiary)]">Chart unavailable</p>}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(deliverability?.dcs_distribution || []).filter((d) => d.value > 0)} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 9.5 }} dy={5} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} dx={-4} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--bg-hover)', radius: 6 }} />
                  <Bar dataKey="value" radius={[5, 5, 0, 0]} name="Contacts">
                    {(deliverability?.dcs_distribution || []).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ErrorBoundary>
          </div>
        ) : (
          <EmptyDeepDive icon={ShieldCheck} title="No DCS data yet" description="Verify contacts to see their scores here." />
        )}
      </div>

      {/* Suppression breakdown */}
      <div className="p-5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
        <h4 className="text-[12.5px] font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-1.5">
          <ShieldOff className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          Suppression Breakdown
        </h4>
        {(deliverability?.suppression_by_reason || []).some((r) => r.value > 0) ? (
          <div className="space-y-3">
            {(deliverability?.suppression_by_reason || []).filter((r) => r.value > 0).map((item) => {
              const pct = suppressionTotal > 0 ? Math.round((item.value / suppressionTotal) * 100) : 0;
              return (
                <div key={item.label}>
                  <div className="flex justify-between text-[11.5px] mb-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-[var(--text-secondary)]">{item.label}</span>
                    </div>
                    <span className="font-semibold text-[var(--text-primary)]">{fmtNum(item.value)} <span className="text-[var(--text-tertiary)] font-normal">({pct}%)</span></span>
                  </div>
                  <MetricBar value={item.value} max={suppressionTotal} color={item.color} />
                </div>
              );
            })}
            <div className="pt-2 border-t border-[var(--border-subtle)]">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-tertiary)]">Total suppressed</span>
                <span className="font-bold text-[var(--text-primary)]">{fmtNum(suppressionTotal)}</span>
              </div>
            </div>
          </div>
        ) : (
          <EmptyDeepDive icon={ShieldOff} title="No suppressions" description="Contacts blocked from receiving emails appear here." />
        )}
      </div>
    </div>
  );
}

// ─── Campaign contacts tab ─────────────────────────────────────────────────

function ContactsTab({ contacts }: { contacts: CampaignContact[] }) {
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState<'score' | 'opened' | 'clicked' | 'sent'>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return contacts
      .filter((c) => contactStatusFilter(c, filter))
      .filter((c) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          c.email.toLowerCase().includes(q) ||
          (c.first_name || '').toLowerCase().includes(q) ||
          (c.last_name || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const av = sortKey === 'score' ? engagementScore(a) : safeNum((a as any)[sortKey]);
        const bv = sortKey === 'score' ? engagementScore(b) : safeNum((b as any)[sortKey]);
        return sortDir === 'desc' ? bv - av : av - bv;
      });
  }, [contacts, filter, search, sortKey, sortDir]);

  const filterCounts = useMemo(() => ({
    all: contacts.length,
    engaged: contacts.filter((c) => engagementScore(c) >= 50).length,
    replied: contacts.filter((c) => c.replied).length,
    silent: contacts.filter((c) => !c.is_bounced && engagementScore(c) < 10).length,
    bounced: contacts.filter((c) => c.is_bounced).length,
  }), [contacts]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'engaged', 'replied', 'silent', 'bounced'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11.5px] font-medium border transition-all',
              filter === f
                ? 'bg-[var(--indigo)] border-[var(--indigo)] text-white'
                : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span className={cn(
              'text-[10px] px-1 py-px rounded font-bold',
              filter === f ? 'bg-white/20 text-white' : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)]'
            )}>
              {filterCounts[f]}
            </span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 px-2.5 h-7 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
          <Search className="h-3 w-3 text-[var(--text-tertiary)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="bg-transparent text-[11.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] w-32"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
              <th className="text-left py-2.5 px-4 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">Contact</th>
              <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">Status</th>
              <th
                className="text-right py-2.5 px-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold cursor-pointer hover:text-[var(--text-primary)] select-none"
                onClick={() => { setSortKey('score'); setSortDir(sortKey === 'score' && sortDir === 'desc' ? 'asc' : 'desc'); }}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  Engagement <SortIcon col="score" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th
                className="text-right py-2.5 px-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold cursor-pointer hover:text-[var(--text-primary)] select-none"
                onClick={() => { setSortKey('sent'); setSortDir(sortKey === 'sent' && sortDir === 'desc' ? 'asc' : 'desc'); }}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  Sent <SortIcon col="sent" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th
                className="text-right py-2.5 px-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold cursor-pointer hover:text-[var(--text-primary)] select-none"
                onClick={() => { setSortKey('opened'); setSortDir(sortKey === 'opened' && sortDir === 'desc' ? 'asc' : 'desc'); }}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  Opens <SortIcon col="opened" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th
                className="text-right py-2.5 px-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold cursor-pointer hover:text-[var(--text-primary)] select-none"
                onClick={() => { setSortKey('clicked'); setSortDir(sortKey === 'clicked' && sortDir === 'desc' ? 'asc' : 'desc'); }}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  Clicks <SortIcon col="clicked" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className="text-center py-2.5 px-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">Reply</th>
              <th className="text-right py-2.5 px-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">DCS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 50).map((c) => {
              const score = engagementScore(c);
              const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
              return (
                <tr key={c.contact_id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors">
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={name || undefined} email={c.email} size="md" />
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{name || c.email}</p>
                        {name && <p className="text-[11px] text-[var(--text-tertiary)] truncate">{c.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <Badge variant={
                      c.is_bounced ? 'danger' :
                      c.replied ? 'success' :
                      c.status === 'unsubscribed' ? 'danger' :
                      score >= 50 ? 'info' : 'default'
                    }>
                      {c.is_bounced ? 'Bounced' : c.status || 'pending'}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-16">
                        <MetricBar value={score} max={100} color={score >= 70 ? '#10B981' : score >= 40 ? '#F59E0B' : '#94A3B8'} />
                      </div>
                      <span className={cn(
                        'text-[11.5px] font-bold tabular-nums w-7 text-right',
                        score >= 70 ? 'text-emerald-500' : score >= 40 ? 'text-amber-500' : 'text-[var(--text-tertiary)]'
                      )}>
                        {score}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[12px] text-[var(--text-secondary)]">{c.sent}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[12px] text-[var(--text-secondary)]">{c.opened}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[12px] text-[var(--text-secondary)]">{c.clicked}</td>
                  <td className="py-2.5 px-3 text-center">
                    {c.replied ? (
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                        <MessageSquare className="h-2.5 w-2.5" /> Yes
                      </span>
                    ) : (
                      <span className="text-[var(--text-tertiary)]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {c.dcs_score != null ? (
                      <span className={cn(
                        'text-[11.5px] font-semibold tabular-nums',
                        c.dcs_score >= 80 ? 'text-emerald-500' : c.dcs_score >= 50 ? 'text-amber-500' : 'text-rose-500'
                      )}>
                        {c.dcs_score}
                      </span>
                    ) : (
                      <span className="text-[var(--text-tertiary)]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 50 && (
          <div className="py-2 px-4 text-center bg-[var(--bg-elevated)] border-t border-[var(--border-subtle)]">
            <p className="text-[11px] text-[var(--text-tertiary)]">Showing 50 of {filtered.length} contacts</p>
          </div>
        )}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-[var(--text-tertiary)] text-[12.5px]">
            No contacts match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

const DATE_RANGE_MAP = { '7d': 7, '30d': 30, '90d': 90 } as const;

type Mode = 'overview' | 'campaign';
type CampaignTab = 'stats' | 'funnel' | 'abtest' | 'contacts' | 'heatmap';

export function AnalyticsDashboardPage() {
  const { theme } = useTheme();
  const [mode, setMode] = useState<Mode>('overview');
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [selectedId, setSelectedId] = useState<string>('');
  const [campaignTab, setCampaignTab] = useState<CampaignTab>('stats');
  const [campaignSearch, setCampaignSearch] = useState('');

  const days = DATE_RANGE_MAP[dateRange];

  // ── Global queries ──────────────────────────────────────────────────────
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['analytics', 'overview', days],
    queryFn: () => analyticsApi.overview(days),
  });

  const { data: trendData } = useQuery({
    queryKey: ['analytics', 'trend', days],
    queryFn: () => analyticsApi.trend(days),
  });

  const { data: deliverability } = useQuery({
    queryKey: ['analytics', 'deliverability'],
    queryFn: () => analyticsApi.deliverability(),
  });

  const { data: campaignList } = useQuery({
    queryKey: ['analytics', 'campaign-list'],
    queryFn: () => analyticsApi.campaignList(),
  });

  // ── Campaign deep-dive queries ──────────────────────────────────────────
  const { data: campaignStats } = useQuery({
    queryKey: ['analytics', 'campaign', selectedId],
    queryFn: () => analyticsApi.campaign(selectedId),
    enabled: !!selectedId,
  });

  const { data: campaignTrend } = useQuery({
    queryKey: ['analytics', 'campaign-trend', selectedId, days],
    queryFn: () => analyticsApi.campaignTrend(selectedId, days),
    enabled: !!selectedId && campaignTab === 'stats',
  });

  const { data: funnelData } = useQuery({
    queryKey: ['analytics', 'funnel', selectedId],
    queryFn: () => analyticsApi.campaignFunnel(selectedId),
    enabled: !!selectedId && campaignTab === 'funnel',
  });

  const { data: abTestData } = useQuery({
    queryKey: ['analytics', 'ab-test', selectedId],
    queryFn: () => analyticsApi.campaignAbTest(selectedId),
    enabled: !!selectedId && campaignTab === 'abtest',
  });

  const { data: campaignContacts } = useQuery({
    queryKey: ['analytics', 'campaign-contacts', selectedId],
    queryFn: () => analyticsApi.campaignContacts(selectedId),
    enabled: !!selectedId && campaignTab === 'contacts',
  });

  const { data: heatmapData } = useQuery({
    queryKey: ['analytics', 'heatmap', selectedId],
    queryFn: () => analyticsApi.campaignHeatmap(selectedId),
    enabled: !!selectedId && campaignTab === 'heatmap',
  });

  // ── Derived data ────────────────────────────────────────────────────────
  const formattedTrend = useMemo(() => {
    if (!Array.isArray(trendData) || trendData.length === 0) return [];
    return trendData.map((d: TrendDataPoint) => ({
      ...d,
      label: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }));
  }, [trendData]);

  const formattedCampaignTrend = useMemo(() => {
    if (!Array.isArray(campaignTrend) || campaignTrend.length === 0) return [];
    return campaignTrend.map((d: TrendDataPoint) => ({
      ...d,
      label: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }));
  }, [campaignTrend]);

  const trendSpark = (k: 'sent' | 'opened' | 'clicked' | 'replied') =>
    formattedTrend.map((d: any) => Number(d[k] || 0));

  const pieData = useMemo(() => {
    if (!overview) return [];
    return [
      { name: 'Opened', value: safeNum(overview.total_opened) },
      { name: 'Clicked', value: safeNum(overview.total_clicked) },
      { name: 'Replied', value: safeNum(overview.total_replied) },
      { name: 'No engagement', value: Math.max(0, safeNum(overview.total_sent) - safeNum(overview.total_opened)) },
    ].filter((d) => d.value > 0);
  }, [overview]);

  // Indigo tonal scale + a neutral for "no engagement" — matches the dashboard donuts
  const PIE_COLORS = ['#6366F1', '#8B5CF6', '#06B6D4', theme === 'dark' ? '#2A2A33' : '#E4E4E7'];

  const filteredCampaigns = useMemo(() => {
    const list = campaignList || [];
    if (!campaignSearch) return list;
    const q = campaignSearch.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [campaignList, campaignSearch]);

  const selectedCampaign = useMemo(
    () => (campaignList || []).find((c) => c.id === selectedId),
    [campaignList, selectedId]
  );

  const selectCampaign = useCallback((id: string) => {
    setSelectedId(id);
    setCampaignTab('stats');
    setMode('campaign');
  }, []);

  if (overviewLoading) {
    return (
      <div className="animate-fade-in space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3.5 w-72" />
          </div>
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="surface p-4 space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
        <div className="card p-4">
          <Skeleton className="h-4 w-40 mb-4" />
          <Skeleton className="h-[260px] w-full rounded-lg" />
        </div>
      </div>
    );
  }

  const dateRangeOptions = [
    { value: '7d' as const, label: '7d' },
    { value: '30d' as const, label: '30d' },
    { value: '90d' as const, label: '90d' },
  ];

  return (
    <div className="animate-fade-in space-y-4">
      {/* Header */}
      <PageHeader
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <BarChart3 className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Analytics"
        description="Deep performance intelligence across every campaign, contact, and sequence step."
        meta={
          <>
            <Calendar className="h-3 w-3" />
            <span className="tabular">Last {days} days</span>
            {overview && (
              <>
                <span className="sep-dot" />
                <span className="tabular">{fmtNum(overview.total_sent)} sent</span>
                <span className="sep-dot" />
                <span className="tabular">{fmtPct(overview.avg_open_rate)} open · {fmtPct(overview.avg_reply_rate)} reply</span>
              </>
            )}
          </>
        }
        actions={
          <>
            <div className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5">
              {dateRangeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDateRange(opt.value)}
                  className={cn(
                    'px-2.5 h-7 text-[12px] font-medium rounded-md transition-all',
                    dateRange === opt.value
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadCsv(`/analytics/export/overview?days=${days}`, `overview-${dateRange}.csv`)}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </>
        }
      />

      {/* Mode switcher */}
      <div className="flex items-center gap-2 p-1 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl w-fit">
        <button
          onClick={() => setMode('overview')}
          className={cn(
            'inline-flex items-center gap-2 px-4 h-8 rounded-lg text-[12.5px] font-medium transition-all',
            mode === 'overview'
              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
          )}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Portfolio Overview
        </button>
        <button
          onClick={() => setMode('campaign')}
          className={cn(
            'inline-flex items-center gap-2 px-4 h-8 rounded-lg text-[12.5px] font-medium transition-all',
            mode === 'campaign'
              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
          )}
        >
          <Eye className="h-3.5 w-3.5" />
          Campaign Deep Dive
          {selectedCampaign && (
            <span className="text-[10.5px] font-semibold bg-[var(--indigo)]/20 text-[var(--indigo)] px-1.5 py-0.5 rounded-full">
              {selectedCampaign.name.slice(0, 14)}{selectedCampaign.name.length > 14 ? '…' : ''}
            </span>
          )}
        </button>
      </div>

      {/* ── OVERVIEW MODE ────────────────────────────────────────────────── */}
      {mode === 'overview' && (
        <>
          {/* KPI row */}
          {overview && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Emails sent" value={fmtNum(overview.total_sent)} icon={Send} accent="indigo"
                delta={overview.sent_change ?? undefined} sparkline={trendSpark('sent')} hint={`${fmtNum(overview.total_sent)} total`} />
              <StatCard label="Open rate" value={fmtPct(overview.avg_open_rate)} icon={Mail} accent="violet"
                delta={overview.opened_change ?? undefined} sparkline={trendSpark('opened')} hint={`${fmtNum(overview.total_opened)} opens`} />
              <StatCard label="Click rate" value={fmtPct(overview.avg_click_rate)} icon={MousePointerClick} accent="cyan"
                delta={overview.clicked_change ?? undefined} sparkline={trendSpark('clicked')} hint={`${fmtNum(overview.total_clicked)} clicks`} />
              <StatCard label="Reply rate" value={fmtPct(overview.avg_reply_rate)} icon={MessageSquare} accent="emerald"
                delta={overview.replied_change ?? undefined} sparkline={trendSpark('replied')} hint={`${fmtNum(overview.total_replied)} replies`} />
            </div>
          )}

          {/* Trend + Donut */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 p-5 panel">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Performance Trend</h3>
                  <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">All metrics over the last {days} days</p>
                </div>
                <div className="flex items-center gap-3">
                  {Object.entries(CHART_COLORS).slice(0, 4).map(([key, color]) => (
                    <span key={key} className="flex items-center gap-1 text-[10.5px] text-[var(--text-tertiary)]">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                      {key.charAt(0).toUpperCase() + key.slice(1)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="h-56">
                {formattedTrend.length > 0 ? (
                  <ErrorBoundary fallback={<div className="flex items-center justify-center h-full text-sm text-[var(--text-tertiary)]">Chart unavailable</div>}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={formattedTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} dy={6} interval={days <= 7 ? 0 : days <= 30 ? 4 : 13} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} dx={-4} />
                        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'var(--border-default)', strokeDasharray: '4 4' }} />
                        {(['sent', 'opened', 'clicked', 'replied'] as const).map((key) => (
                          <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[key]} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: CHART_COLORS[key], stroke: 'var(--bg-surface)', strokeWidth: 2 }} name={key.charAt(0).toUpperCase() + key.slice(1)} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </ErrorBoundary>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-[var(--text-tertiary)]">No activity data yet</div>
                )}
              </div>
            </div>

            <div className="p-5 panel">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">Engagement Mix</h3>
              <p className="text-[11.5px] text-[var(--text-secondary)] mb-3">Distribution across activities</p>
              {pieData.length > 0 ? (
                <>
                  <div className="h-36">
                    <ErrorBoundary fallback={<div className="h-full flex items-center justify-center text-xs text-[var(--text-tertiary)]">Chart unavailable</div>}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={42} outerRadius={60} paddingAngle={3} dataKey="value" strokeWidth={0}>
                            {pieData.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number) => [fmtNum(v), 'Count']} contentStyle={tooltipStyle} />
                        </PieChart>
                      </ResponsiveContainer>
                    </ErrorBoundary>
                  </div>
                  <div className="space-y-2 mt-2">
                    {pieData.map((item, i) => {
                      const total = pieData.reduce((s, d) => s + d.value, 0);
                      return (
                        <div key={item.name} className="flex items-center justify-between text-[11.5px]">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                            <span className="text-[var(--text-secondary)]">{item.name}</span>
                          </div>
                          <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                            {total > 0 ? `${((item.value / total) * 100).toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-40 text-[12px] text-[var(--text-tertiary)]">No data yet</div>
              )}
            </div>
          </div>

          {/* Campaign Leaderboard */}
          {(campaignList?.length ?? 0) > 0 && (
            <div className="panel overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <div>
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Campaign Leaderboard</h3>
                  <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">Click any row to deep-dive into that campaign</p>
                </div>
                <span className="text-[11px] text-[var(--text-tertiary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full">
                  {campaignList!.length} campaigns
                </span>
              </div>
              <CampaignLeaderboard campaigns={campaignList!} onSelect={selectCampaign} />
            </div>
          )}

          {/* Deliverability */}
          <div className="panel overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-[var(--indigo-subtle)]">
                    <Activity className="h-3 w-3 text-[var(--indigo)]" />
                  </span>
                  Deliverability Health
                </h3>
                <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">DCS scores, contact quality and suppression breakdown</p>
              </div>
            </div>
            <div className="p-5">
              <DeliverabilitySection deliverability={deliverability} overview={overview} />
            </div>
          </div>
        </>
      )}

      {/* ── CAMPAIGN DEEP DIVE MODE ───────────────────────────────────────── */}
      {mode === 'campaign' && (
        <>
          {/* Campaign selector */}
          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center gap-3">
              <Search className="h-4 w-4 text-[var(--text-tertiary)] flex-shrink-0" />
              <input
                value={campaignSearch}
                onChange={(e) => setCampaignSearch(e.target.value)}
                placeholder="Search campaigns…"
                className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              />
              <span className="text-[11px] text-[var(--text-tertiary)] flex-shrink-0">
                {filteredCampaigns.length} campaign{filteredCampaigns.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filteredCampaigns.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-[var(--text-tertiary)]">No campaigns found</p>
              ) : (
                filteredCampaigns.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => selectCampaign(c.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border-subtle)] last:border-0',
                      selectedId === c.id && 'bg-[var(--indigo-subtle)]'
                    )}
                  >
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full flex-shrink-0',
                      c.status === 'running' ? 'bg-emerald-500' :
                      c.status === 'paused' ? 'bg-amber-500' : 'bg-[var(--text-tertiary)]'
                    )} />
                    <span className={cn('flex-1 text-[12.5px] font-medium truncate', selectedId === c.id ? 'text-[var(--indigo)]' : 'text-[var(--text-primary)]')}>
                      {c.name}
                    </span>
                    <div className="flex items-center gap-4 flex-shrink-0 text-[11.5px] text-[var(--text-tertiary)]">
                      <span>{fmtNum(c.sent)} sent</span>
                      <span className={c.open_rate >= 30 ? 'text-emerald-500 font-semibold' : ''}>{fmtPct(c.open_rate)} open</span>
                      <span className={c.reply_rate >= 5 ? 'text-emerald-500 font-semibold' : ''}>{fmtPct(c.reply_rate)} reply</span>
                    </div>
                    {selectedId === c.id && <span className="text-[var(--indigo)] text-[11px] font-semibold">Selected</span>}
                  </button>
                ))
              )}
            </div>
          </div>

          {!selectedId ? (
            <EmptyDeepDive
              icon={Target}
              title="Select a campaign above"
              description="Choose any campaign to unlock detailed stats, funnel analysis, A/B testing results, contact-level insights, and engagement heatmaps."
            />
          ) : (
            <>
              {/* Campaign header */}
              {selectedCampaign && (
                <div className="flex items-center justify-between px-5 py-4 panel">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
                      <Target className="h-5 w-5 text-[var(--indigo)]" strokeWidth={1.5} />
                    </div>
                    <div>
                      <h2 className="text-[14px] font-bold text-[var(--text-primary)]">{selectedCampaign.name}</h2>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant={selectedCampaign.status === 'running' ? 'success' : selectedCampaign.status === 'paused' ? 'warning' : 'default'}>
                          {selectedCampaign.status}
                        </Badge>
                        <span className="text-[11px] text-[var(--text-tertiary)]">{fmtNum(selectedCampaign.sent)} total emails sent</span>
                        <span className="sep-dot text-[var(--text-tertiary)]" />
                        <span className="text-[11px] text-[var(--text-tertiary)]">Created {new Date(selectedCampaign.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => downloadCsv(`/analytics/export/campaigns/${selectedId}`, `campaign-${selectedId}.csv`)}
                    >
                      <Download className="h-3.5 w-3.5" /> Export
                    </Button>
                  </div>
                </div>
              )}

              {/* Inner tabs */}
              <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] pb-0">
                {[
                  { id: 'stats', label: 'Stats', icon: BarChart3 },
                  { id: 'funnel', label: 'Funnel', icon: Layers },
                  { id: 'abtest', label: 'A/B Tests', icon: FlaskConical },
                  { id: 'contacts', label: 'Contacts', icon: Users },
                  { id: 'heatmap', label: 'Heatmap', icon: Thermometer },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setCampaignTab(id as CampaignTab)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-2.5 text-[12.5px] font-medium border-b-2 transition-all -mb-px',
                      campaignTab === id
                        ? 'border-[var(--indigo)] text-[var(--indigo)]'
                        : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Stats tab ── */}
              {campaignTab === 'stats' && campaignStats && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {[
                      { label: 'Sent', value: campaignStats.sent, sub: undefined, color: '#6366F1', icon: Send },
                      { label: 'Open Rate', value: fmtPct(campaignStats.open_rate), sub: fmtNum(campaignStats.opened) + ' opens', color: '#10B981', icon: Mail },
                      { label: 'Click Rate', value: fmtPct(campaignStats.click_rate), sub: fmtNum(campaignStats.clicked) + ' clicks', color: '#F59E0B', icon: MousePointerClick },
                      { label: 'Reply Rate', value: fmtPct(campaignStats.reply_rate), sub: fmtNum(campaignStats.replied) + ' replies', color: '#EC4899', icon: MessageSquare },
                      { label: 'Bounce Rate', value: fmtPct(campaignStats.bounce_rate), sub: fmtNum(campaignStats.bounced) + ' bounced', color: '#EF4444', icon: AlertTriangle },
                    ].map(({ label, value, sub, color, icon: Icon }) => (
                      <div key={label} className="p-4 panel hover:border-[var(--border-default)] transition-all">
                        <div className="flex items-center justify-center h-7 w-7 rounded-lg mb-3" style={{ backgroundColor: `${color}18` }}>
                          <Icon className="h-3.5 w-3.5" style={{ color }} strokeWidth={1.75} />
                        </div>
                        <p className="text-xl font-bold text-[var(--text-primary)] tabular-nums leading-tight">
                          {typeof value === 'number' ? fmtNum(value) : value}
                        </p>
                        <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">{label}</p>
                        {sub && <p className="text-[10.5px] text-[var(--text-tertiary)]">{sub}</p>}
                      </div>
                    ))}
                  </div>

                  <div className="p-5 panel">
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4">Daily Activity — Last {days} days</h3>
                    <div className="h-56">
                      {formattedCampaignTrend.length > 0 ? (
                        <ErrorBoundary fallback={<div className="flex items-center justify-center h-full text-sm text-[var(--text-tertiary)]">Chart unavailable</div>}>
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={formattedCampaignTrend}>
                              <defs>
                                {(['sent', 'opened', 'clicked', 'replied'] as const).map((key) => (
                                  <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={CHART_COLORS[key]} stopOpacity={0.15} />
                                    <stop offset="95%" stopColor={CHART_COLORS[key]} stopOpacity={0} />
                                  </linearGradient>
                                ))}
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} dy={6} interval={days <= 7 ? 0 : 4} />
                              <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} dx={-4} />
                              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'var(--border-default)', strokeDasharray: '4 4' }} />
                              {(['sent', 'opened', 'clicked', 'replied'] as const).map((key) => (
                                <Area key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[key]} strokeWidth={2} fill={`url(#grad-${key})`} dot={false} name={key.charAt(0).toUpperCase() + key.slice(1)} activeDot={{ r: 4, fill: CHART_COLORS[key], stroke: 'var(--bg-surface)', strokeWidth: 2 }} />
                              ))}
                            </AreaChart>
                          </ResponsiveContainer>
                        </ErrorBoundary>
                      ) : (
                        <div className="flex items-center justify-center h-full text-sm text-[var(--text-tertiary)]">No activity data for this campaign yet</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Funnel tab ── */}
              {campaignTab === 'funnel' && (
                <div className="space-y-4">
                  {campaignStats && (
                    <div className="p-6 panel">
                      <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">Overall Engagement Funnel</h3>
                      <p className="text-[11.5px] text-[var(--text-secondary)] mb-5">Contact journey from send to reply across all steps</p>
                      <FunnelViz
                        sent={campaignStats.sent}
                        opened={campaignStats.opened}
                        clicked={campaignStats.clicked}
                        replied={campaignStats.replied}
                        bounced={campaignStats.bounced}
                      />
                    </div>
                  )}

                  {funnelData && funnelData.length > 0 && (
                    <div className="p-5 panel">
                      <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4">Step-by-Step Breakdown</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--border-subtle)]">
                              {['Step', 'Subject', 'Delay', 'Sent', 'Opened', 'Open %', 'Clicked', 'Click %', 'Replied', 'Reply %', 'Bounced'].map((h) => (
                                <th key={h} className={cn(
                                  'py-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold',
                                  h === 'Subject' ? 'text-left px-3' : 'text-right px-2'
                                )}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {funnelData.map((step: FunnelStep) => (
                              <tr key={step.step_id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors">
                                <td className="py-2.5 px-2 text-right text-[12px] font-bold text-[var(--text-primary)]">
                                  {step.step_number}
                                </td>
                                <td className="py-2.5 px-3 max-w-[200px]">
                                  <p className="text-[12px] text-[var(--text-primary)] truncate">{step.subject}</p>
                                </td>
                                <td className="py-2.5 px-2 text-right text-[11.5px] text-[var(--text-tertiary)]">
                                  {step.delay_days > 0 ? `+${step.delay_days}d` : '—'}
                                </td>
                                <td className="py-2.5 px-2 text-right tabular-nums text-[12px] text-[var(--text-secondary)]">{fmtNum(step.sent)}</td>
                                <td className="py-2.5 px-2 text-right tabular-nums text-[12px] text-[var(--text-secondary)]">{fmtNum(step.opened)}</td>
                                <td className="py-2.5 px-2 text-right tabular-nums text-[12px] font-semibold" style={{ color: CHART_COLORS.opened }}>{fmtPct(step.open_rate)}</td>
                                <td className="py-2.5 px-2 text-right tabular-nums text-[12px] text-[var(--text-secondary)]">{fmtNum(step.clicked)}</td>
                                <td className="py-2.5 px-2 text-right tabular-nums text-[12px] font-semibold" style={{ color: CHART_COLORS.clicked }}>{fmtPct(step.click_rate)}</td>
                                <td className="py-2.5 px-2 text-right tabular-nums text-[12px] text-[var(--text-secondary)]">{fmtNum(step.replied)}</td>
                                <td className="py-2.5 px-2 text-right tabular-nums text-[12px] font-semibold" style={{ color: CHART_COLORS.replied }}>{fmtPct(step.reply_rate)}</td>
                                <td className="py-2.5 px-2 text-right tabular-nums text-[12px]" style={{ color: step.bounced > 0 ? CHART_COLORS.bounced : 'var(--text-tertiary)' }}>{fmtNum(step.bounced)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {!funnelData && (
                    <div className="flex items-center justify-center py-10"><Spinner size="md" /></div>
                  )}
                </div>
              )}

              {/* ── A/B Tests tab ── */}
              {campaignTab === 'abtest' && (
                <>
                  {!abTestData ? (
                    <div className="flex items-center justify-center py-10"><Spinner size="md" /></div>
                  ) : !abTestData.has_ab_test || abTestData.steps.length === 0 ? (
                    <EmptyDeepDive
                      icon={FlaskConical}
                      title="No A/B tests configured"
                      description="Set up A/B subject line or body variants on campaign steps to compare performance here."
                    />
                  ) : (
                    <div className="space-y-6">
                      {abTestData.steps.map((step: AbTestStep) => (
                        <div key={step.step_id} className="panel overflow-hidden">
                          <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center gap-3">
                            <span className="flex items-center justify-center h-6 w-6 rounded-full bg-[var(--indigo-subtle)] text-[11px] font-bold text-[var(--indigo)]">
                              {step.step_number}
                            </span>
                            <h4 className="text-[13px] font-semibold text-[var(--text-primary)]">Step {step.step_number} — A/B Test</h4>
                            {step.winner && (
                              <span className={cn(
                                'ml-auto text-[11px] font-semibold px-2.5 py-1 rounded-full',
                                'bg-emerald-500/10 text-emerald-500'
                              )}>
                                Variant {step.winner.toUpperCase()} wins
                                {step.significant && ' (significant)'}
                              </span>
                            )}
                            {!step.significant && step.variant_a.sent < step.min_sample && (
                              <span className="ml-auto text-[11px] text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-full">
                                Need {step.min_sample}+ sends per variant for significance
                              </span>
                            )}
                          </div>
                          <div className="p-5 grid grid-cols-2 gap-4">
                            <VariantCard
                              variant="a"
                              label="Variant A"
                              subject={step.subject_a}
                              stats={step.variant_a}
                              isWinner={step.winner === 'a'}
                            />
                            <VariantCard
                              variant="b"
                              label="Variant B"
                              subject={step.subject_b}
                              stats={step.variant_b}
                              isWinner={step.winner === 'b'}
                            />
                          </div>
                          {step.winner && (
                            <div className="px-5 pb-4">
                              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-[12px] text-emerald-600">
                                <Trophy className="h-4 w-4 flex-shrink-0" />
                                <span>
                                  Variant {step.winner.toUpperCase()} outperforms by{' '}
                                  <strong>{Math.abs(step.variant_a.open_rate - step.variant_b.open_rate).toFixed(1)}pp</strong> on open rate
                                  {step.significant ? ' — statistically significant result.' : '.'}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ── Contacts tab ── */}
              {campaignTab === 'contacts' && (
                <>
                  {!campaignContacts ? (
                    <div className="flex items-center justify-center py-10"><Spinner size="md" /></div>
                  ) : campaignContacts.contacts.length === 0 ? (
                    <EmptyDeepDive icon={Users} title="No contacts in this campaign" description="Add contacts to this campaign to see their individual performance here." />
                  ) : (
                    <div className="panel overflow-hidden">
                      <div className="px-5 py-3.5 border-b border-[var(--border-subtle)]">
                        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Contact Performance</h3>
                        <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">
                          Engagement scores, activity counts and deliverability for each contact
                        </p>
                      </div>
                      <div className="p-4">
                        <ContactsTab contacts={campaignContacts.contacts} />
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Heatmap tab ── */}
              {campaignTab === 'heatmap' && (
                <>
                  {!heatmapData ? (
                    <div className="flex items-center justify-center py-10"><Spinner size="md" /></div>
                  ) : heatmapData.max_value === 0 ? (
                    <EmptyDeepDive
                      icon={Thermometer}
                      title="No engagement data yet"
                      description="Once contacts open, click, or reply, this heatmap will show you which hours and days drive the most engagement."
                    />
                  ) : (
                    <div className="p-5 panel">
                      <div className="mb-4">
                        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Engagement Heatmap</h3>
                        <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">
                          Combined opens, clicks and replies by day of week and hour of day (contact's local time)
                        </p>
                      </div>
                      <HeatmapGrid grid={heatmapData.grid} maxValue={heatmapData.max_value} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
