import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { analyticsApi, type CampaignListItem, type FunnelStep, type AbTestStep, type CampaignContact } from '../../api/analytics.api';
import { cn } from '../../lib/utils';
import {
  BarChart2, Search, TrendingUp, Mail, MousePointerClick,
  MessageSquare, AlertTriangle, ShieldCheck, Shield, ShieldX,
  ChevronRight, ExternalLink, Download, Trophy, FlaskConical,
  XCircle, CheckCircle2,
} from 'lucide-react';

/* ─── helpers ─────────────────────────────────────────────────── */

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ─── chart tooltip ───────────────────────────────────────────── */

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-xl p-3 text-[11.5px] min-w-[140px]">
      <p className="text-[var(--text-tertiary)] mb-2 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-[var(--text-secondary)] capitalize">
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
            {p.dataKey}
          </span>
          <span className="font-semibold text-[var(--text-primary)] tabular">{(p.value || 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── KPI card ────────────────────────────────────────────────── */

function KpiCard({ label, value, sub, accent = '#6366F1', icon: Icon, loading }: {
  label: string; value: string | number; sub?: string;
  accent?: string; icon: React.ElementType; loading?: boolean;
}) {
  return (
    <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">{label}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: accent + '18' }}>
          <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
        </span>
      </div>
      {loading ? (
        <div className="h-7 w-16 rounded-md bg-[var(--bg-elevated)] animate-pulse" />
      ) : (
        <p className="text-[26px] font-semibold tabular tracking-[-0.02em] text-[var(--text-primary)] leading-none">{value}</p>
      )}
      {sub && <p className="text-[11.5px] text-[var(--text-tertiary)] mt-1.5">{sub}</p>}
    </div>
  );
}

/* ─── rate bar ────────────────────────────────────────────────── */

function RateBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden flex-1">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, value)}%`, background: color }} />
    </div>
  );
}

/* ─── DCS badge ───────────────────────────────────────────────── */

function DcsBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-[11px] text-[var(--text-tertiary)]">—</span>;
  const cls = score >= 80 ? 'bg-emerald-500/10 text-emerald-700'
    : score >= 50 ? 'bg-amber-500/10 text-amber-700'
    : 'bg-rose-500/10 text-rose-700';
  return (
    <span className={cn('inline-flex items-center gap-0.5 px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-bold', cls)}>
      {score >= 80 ? <ShieldCheck className="h-2.5 w-2.5" /> : score >= 50 ? <Shield className="h-2.5 w-2.5" /> : <ShieldX className="h-2.5 w-2.5" />}
      {score}
    </span>
  );
}

/* ─── campaign status badge ───────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'bg-emerald-500/10 text-emerald-700',
    completed: 'bg-slate-500/10 text-slate-600',
    draft: 'bg-amber-500/10 text-amber-700',
  };
  return (
    <span className={cn('inline-flex items-center px-1.5 h-[18px] rounded-[4px] text-[10px] font-bold uppercase tracking-wider', map[status] || 'bg-slate-500/10 text-slate-600')}>
      {status}
    </span>
  );
}

/* ─── main page ───────────────────────────────────────────────── */

type ContactFilterTab = 'all' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed';

const TREND_COLORS = {
  sent: '#6366F1',
  opened: '#8B5CF6',
  clicked: '#10B981',
  replied: '#06B6D4',
} as const;

export function AnalyticsDashboardPage() {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'completed'>('all');
  const [trendDays, setTrendDays] = useState(30);
  const [contactTab, setContactTab] = useState<ContactFilterTab>('all');

  /* ── overview queries ──────────────────────────────────────── */
  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ['analytics-overview', trendDays],
    queryFn: () => analyticsApi.overview(trendDays),
  });
  const { data: overviewTrend } = useQuery({
    queryKey: ['analytics-trend', trendDays],
    queryFn: () => analyticsApi.trend(trendDays),
  });
  const { data: deliverability } = useQuery({
    queryKey: ['analytics-deliverability'],
    queryFn: analyticsApi.deliverability,
  });
  const { data: campaignList = [] } = useQuery({
    queryKey: ['analytics-campaign-list'],
    queryFn: analyticsApi.campaignList,
  });

  /* ── campaign deep-dive queries ────────────────────────────── */
  const { data: campaign, isLoading: campLoading } = useQuery({
    queryKey: ['analytics-campaign', selectedId],
    queryFn: () => analyticsApi.campaign(selectedId!),
    enabled: !!selectedId,
  });
  const { data: funnel = [] } = useQuery({
    queryKey: ['analytics-funnel', selectedId],
    queryFn: () => analyticsApi.campaignFunnel(selectedId!),
    enabled: !!selectedId,
  });
  const { data: abTest = [] } = useQuery({
    queryKey: ['analytics-ab', selectedId],
    queryFn: () => analyticsApi.campaignAbTest(selectedId!),
    enabled: !!selectedId,
  });
  const { data: campTrend = [] } = useQuery({
    queryKey: ['analytics-camp-trend', selectedId, trendDays],
    queryFn: () => analyticsApi.campaignTrend(selectedId!, trendDays),
    enabled: !!selectedId,
  });
  const { data: contactsData } = useQuery({
    queryKey: ['analytics-contacts', selectedId],
    queryFn: () => analyticsApi.campaignContacts(selectedId!),
    enabled: !!selectedId,
  });

  /* ── derived ───────────────────────────────────────────────── */
  const selectedCampaign = (campaignList as CampaignListItem[]).find((c) => c.id === selectedId);

  const filteredList = useMemo(() => {
    return (campaignList as CampaignListItem[]).filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [campaignList, search, statusFilter]);

  const filteredContacts: CampaignContact[] = useMemo(() => {
    const all = contactsData?.contacts || [];
    switch (contactTab) {
      case 'opened':      return all.filter((c) => c.opened > 0);
      case 'clicked':     return all.filter((c) => c.clicked > 0);
      case 'replied':     return all.filter((c) => c.replied);
      case 'bounced':     return all.filter((c) => c.is_bounced);
      case 'unsubscribed':return all.filter((c) => c.is_unsubscribed);
      default:            return all;
    }
  }, [contactsData, contactTab]);

  /* ─────────────────────────────────────────────────────────────
     SIDEBAR
  ──────────────────────────────────────────────────────────── */
  const Sidebar = (
    <aside className="w-56 flex-shrink-0 border-r border-[var(--border-subtle)] flex flex-col overflow-hidden">
      <div className="px-4 pt-5 pb-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#5B5BF5] to-[#8B5CF6]">
            <BarChart2 className="h-3.5 w-3.5 text-white" />
          </span>
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">Analytics</span>
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)]">Every metric that matters</p>
      </div>

      <div className="px-2 pt-2">
        <button
          onClick={() => setSelectedId(null)}
          className={cn(
            'w-full flex items-center gap-2.5 h-8 px-2.5 rounded-[6px] text-[12.5px] font-medium transition-all',
            !selectedId
              ? 'bg-[rgba(99,102,241,0.12)] text-[#6366F1]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          )}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          Platform Overview
        </button>
      </div>

      <div className="px-2 pt-3 pb-2 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Campaigns</span>
          <span className="text-[10px] font-semibold text-[var(--text-tertiary)] tabular">{(campaignList as CampaignListItem[]).length}</span>
        </div>

        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--text-tertiary)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full h-7 pl-7 pr-2.5 text-[11.5px] rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[#6366F1] transition-all"
          />
        </div>

        <div className="flex gap-1 mb-2">
          {(['all', 'running', 'completed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'flex-1 h-5 rounded text-[10px] font-semibold capitalize transition-all',
                statusFilter === s ? 'bg-[#6366F1] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="space-y-0.5">
          {filteredList.length === 0 && (
            <p className="text-[11px] text-[var(--text-tertiary)] italic px-2 py-4 text-center">No campaigns</p>
          )}
          {filteredList.map((c) => (
            <button
              key={c.id}
              onClick={() => { setSelectedId(c.id); setContactTab('all'); }}
              className={cn(
                'w-full text-left px-2.5 py-2 rounded-[6px] transition-all',
                selectedId === c.id ? 'bg-[rgba(99,102,241,0.1)]' : 'hover:bg-[var(--bg-hover)]'
              )}
            >
              <p className={cn('text-[12px] font-medium truncate', selectedId === c.id ? 'text-[#6366F1]' : 'text-[var(--text-primary)]')}>
                {c.name}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {c.status === 'running' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0 animate-pulse" />}
                <span className="text-[10px] text-[var(--text-tertiary)] capitalize">{c.status}</span>
                <span className="text-[10.5px] text-[var(--text-tertiary)] tabular ml-auto">{fmt(c.sent)}</span>
                {c.sent > 0 && (
                  <span className="text-[10.5px] font-semibold text-[#6366F1] tabular">{c.open_rate}%</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );

  /* ─────────────────────────────────────────────────────────────
     OVERVIEW
  ──────────────────────────────────────────────────────────── */
  const DayPicker = (
    <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-0.5">
      {([7, 30, 90] as const).map((d) => (
        <button key={d} onClick={() => setTrendDays(d)}
          className={cn('h-7 px-3 rounded-md text-[11.5px] font-semibold transition-all',
            trendDays === d ? 'bg-[#5B5BF5] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
          {d}d
        </button>
      ))}
    </div>
  );

  const TrendChart = ({ data, idPrefix }: { data: typeof overviewTrend; idPrefix: string }) => (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data || []} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
        <defs>
          {Object.entries(TREND_COLORS).map(([k, color]) => (
            <linearGradient key={k} id={`${idPrefix}-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.15} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip />} />
        {Object.entries(TREND_COLORS).map(([k, color]) => (
          <Area key={k} type="monotone" dataKey={k} stroke={color} strokeWidth={1.5} fill={`url(#${idPrefix}-${k})`} dot={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );

  const TrendLegend = (
    <div className="flex items-center gap-4 text-[11px]">
      {Object.entries(TREND_COLORS).map(([k, color]) => (
        <span key={k} className="flex items-center gap-1.5 capitalize text-[var(--text-secondary)]">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {k}
        </span>
      ))}
    </div>
  );

  const OverviewContent = (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-[var(--text-primary)] tracking-[-0.02em]">Platform Overview</h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">All activity across every campaign</p>
        </div>
        {DayPicker}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Emails Sent"  value={fmt(overview?.total_sent)}           icon={Mail}            accent="#6366F1" loading={ovLoading} sub={`${overview?.total_campaigns || 0} campaigns`} />
        <KpiCard label="Open Rate"    value={`${overview?.avg_open_rate ?? 0}%`}  icon={TrendingUp}      accent="#8B5CF6" loading={ovLoading} sub={`${fmt(overview?.total_opened)} opens`} />
        <KpiCard label="Click Rate"   value={`${overview?.avg_click_rate ?? 0}%`} icon={MousePointerClick} accent="#10B981" loading={ovLoading} sub={`${fmt(overview?.total_clicked)} clicks`} />
        <KpiCard label="Reply Rate"   value={`${overview?.avg_reply_rate ?? 0}%`} icon={MessageSquare}   accent="#06B6D4" loading={ovLoading} sub={`${fmt(overview?.total_replied)} replies`} />
        <KpiCard label="Avg DCS"      value={overview?.avg_dcs_score ?? '—'}      icon={ShieldCheck}     accent="#10B981" loading={ovLoading} sub={`${fmt(overview?.verified_contacts)} verified`} />
        <KpiCard label="Suppressed"   value={fmt(overview?.suppressed_count)}     icon={XCircle}         accent="#F43F5E" loading={ovLoading} sub={`${fmt(overview?.bounced_contacts)} bounced`} />
      </div>

      {/* Trend chart */}
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">Activity Trend</p>
            <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">Last {trendDays} days</p>
          </div>
          {TrendLegend}
        </div>
        <TrendChart data={overviewTrend} idPrefix="ov" />
      </div>

      {/* Deliverability + suppression */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5">
          <p className="text-[12.5px] font-semibold text-[var(--text-primary)] mb-4">Contact Health (DCS Score)</p>
          <div className="space-y-3">
            {(deliverability?.dcs_distribution || []).map((d) => {
              const total = (deliverability?.dcs_distribution || []).reduce((a, b) => a + b.value, 0);
              const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
              return (
                <div key={d.label} className="flex items-center gap-3">
                  <span className="w-28 text-[11.5px] text-[var(--text-secondary)] flex-shrink-0">{d.label}</span>
                  <div className="flex-1 h-2 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: d.color }} />
                  </div>
                  <span className="w-14 text-right text-[11.5px] font-semibold tabular text-[var(--text-primary)]">{d.value.toLocaleString()}</span>
                  <span className="w-8 text-right text-[10.5px] text-[var(--text-tertiary)]">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5">
          <p className="text-[12.5px] font-semibold text-[var(--text-primary)] mb-4">Suppression Breakdown</p>
          <div className="space-y-3">
            {(deliverability?.suppression_by_reason || []).map((s) => {
              const total = (deliverability?.suppression_by_reason || []).reduce((a, b) => a + b.value, 0);
              const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
              return (
                <div key={s.label} className="flex items-center gap-3">
                  <span className="w-28 text-[11.5px] text-[var(--text-secondary)] flex-shrink-0">{s.label}</span>
                  <div className="flex-1 h-2 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                  </div>
                  <span className="w-14 text-right text-[11.5px] font-semibold tabular text-[var(--text-primary)]">{s.value.toLocaleString()}</span>
                  <span className="w-8 text-right text-[10.5px] text-[var(--text-tertiary)]">{pct}%</span>
                </div>
              );
            })}
          </div>
          {overview && (
            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-[11.5px] text-[var(--text-secondary)]">Total suppressed</span>
              <span className="text-[13px] font-semibold text-rose-600">{overview.suppressed_count.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Campaign table */}
      {(campaignList as CampaignListItem[]).length > 0 && (
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">All Campaigns</p>
            <span className="text-[11.5px] text-[var(--text-tertiary)]">{(campaignList as CampaignListItem[]).length} total</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                {['Campaign', 'Status', 'Sent', 'Open Rate', 'Reply Rate'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{h}</th>
                ))}
                <th className="px-4 py-2.5 w-12" />
              </tr>
            </thead>
            <tbody>
              {(campaignList as CampaignListItem[]).map((c, i) => (
                <tr key={c.id} onClick={() => { setSelectedId(c.id); setContactTab('all'); }}
                  className={cn('group cursor-pointer transition-colors hover:bg-[var(--bg-hover)]', i < (campaignList as CampaignListItem[]).length - 1 && 'border-b border-[var(--border-subtle)]')}>
                  <td className="px-4 py-3 text-[12.5px] font-medium text-[var(--text-primary)]">{c.name}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)] tabular">{c.sent.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold tabular w-10 text-[var(--text-primary)]">{c.open_rate}%</span>
                      <RateBar value={c.open_rate} color="#8B5CF6" />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold tabular w-10 text-[var(--text-primary)]">{c.reply_rate}%</span>
                      <RateBar value={c.reply_rate} color="#06B6D4" />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  /* ─────────────────────────────────────────────────────────────
     CAMPAIGN DEEP-DIVE
  ──────────────────────────────────────────────────────────── */
  const DeepDive = selectedId && (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            {campLoading
              ? <div className="h-7 w-48 rounded-lg bg-[var(--bg-elevated)] animate-pulse" />
              : <h1 className="text-[22px] font-semibold text-[var(--text-primary)] tracking-[-0.02em]">{selectedCampaign?.name}</h1>}
            {selectedCampaign && <StatusBadge status={selectedCampaign.status} />}
          </div>
          <p className="text-[13px] text-[var(--text-secondary)]">
            {campaign?.total_contacts?.toLocaleString() || '—'} contacts enrolled · {campaign?.sent?.toLocaleString() || 0} emails sent
          </p>
        </div>
        <div className="flex items-center gap-2">
          {DayPicker}
          <a href={analyticsApi.exportCampaignReport(selectedId)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-default)] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all">
            <Download className="h-3.5 w-3.5" />
            Export
          </a>
        </div>
      </div>

      {/* Rate KPIs */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Open Rate',   pct: campaign?.open_rate,   count: campaign?.opened,  icon: TrendingUp,       color: '#8B5CF6', unit: 'opens'   },
          { label: 'Click Rate',  pct: campaign?.click_rate,  count: campaign?.clicked, icon: MousePointerClick, color: '#10B981', unit: 'clicks'  },
          { label: 'Reply Rate',  pct: campaign?.reply_rate,  count: campaign?.replied, icon: MessageSquare,    color: '#06B6D4', unit: 'replies'  },
          { label: 'Bounce Rate', pct: campaign?.bounce_rate, count: campaign?.bounced, icon: AlertTriangle,    color: '#F43F5E', unit: 'bounces'  },
          { label: 'Errors',      pct: null,                  count: campaign?.errors,  icon: XCircle,          color: '#94A3B8', unit: 'errors'   },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{item.label}</span>
              <item.icon className="h-3.5 w-3.5" style={{ color: item.color }} />
            </div>
            <p className="text-[24px] font-semibold tabular tracking-[-0.02em] leading-none"
              style={{ color: (item.count || 0) > 0 ? item.color : 'var(--text-tertiary)' }}>
              {campLoading ? '—' : item.pct != null ? `${item.pct}%` : (item.count?.toLocaleString() || '0')}
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-1">{(item.count || 0).toLocaleString()} {item.unit}</p>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">Activity Timeline</p>
            <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">Last {trendDays} days</p>
          </div>
          {TrendLegend}
        </div>
        <TrendChart data={campTrend} idPrefix="cd" />
      </div>

      {/* Step funnel */}
      {(funnel as FunnelStep[]).length > 0 && (
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">Email Sequence Funnel</p>
            <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">Unique contacts per step — shows drop-off at each stage</p>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {(funnel as FunnelStep[]).map((step) => (
              <div key={step.step_id} className="px-5 py-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[10px] font-bold text-[var(--text-secondary)] flex-shrink-0">
                    {step.step_order}
                  </span>
                  <span className="text-[12.5px] font-medium text-[var(--text-primary)] flex-1 truncate">{step.subject}</span>
                  {step.has_ab && (
                    <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] bg-violet-500/10 text-violet-700 text-[10px] font-bold">
                      <FlaskConical className="h-2.5 w-2.5" />
                      A/B
                    </span>
                  )}
                  <span className="text-[11px] text-[var(--text-tertiary)] tabular flex-shrink-0">{step.sent.toLocaleString()} sent</span>
                </div>
                <div className="space-y-1.5">
                  {[
                    { label: 'Opened',  value: step.opened,  pct: step.open_rate,   color: '#8B5CF6' },
                    { label: 'Clicked', value: step.clicked, pct: step.click_rate,  color: '#10B981' },
                    { label: 'Replied', value: step.replied, pct: step.reply_rate,  color: '#06B6D4' },
                    ...(step.bounced > 0 ? [{ label: 'Bounced', value: step.bounced, pct: step.bounce_rate, color: '#F43F5E' }] : []),
                  ].map((m) => (
                    <div key={m.label} className="flex items-center gap-2">
                      <span className="w-12 text-[10.5px] text-[var(--text-tertiary)]">{m.label}</span>
                      <div className="flex-1 h-2 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: step.sent > 0 ? `${(m.value / step.sent) * 100}%` : '0%', background: m.color }} />
                      </div>
                      <span className="w-9 text-right text-[11px] font-semibold tabular text-[var(--text-primary)]">{m.pct}%</span>
                      <span className="w-12 text-right text-[10.5px] text-[var(--text-tertiary)] tabular">{m.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* A/B test */}
      {(abTest as AbTestStep[]).length > 0 && (
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center gap-2.5">
            <FlaskConical className="h-4 w-4 text-violet-600" />
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">A/B Test Results</p>
            <span className="text-[11.5px] text-[var(--text-tertiary)]">
              {(abTest as AbTestStep[]).length} step{(abTest as AbTestStep[]).length !== 1 ? 's' : ''} with subject line variations
            </span>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {(abTest as AbTestStep[]).map((step) => (
              <div key={step.step_id} className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Step {step.step_order}</span>
                  {step.winner && (
                    <span className="inline-flex items-center gap-1 px-2 h-5 rounded-full bg-amber-500/10 text-amber-700 text-[10.5px] font-bold">
                      <Trophy className="h-2.5 w-2.5" />
                      Variant {step.winner.toUpperCase()} winning
                    </span>
                  )}
                  {!step.winner && !step.significant && step.variant_a.sent + step.variant_b.sent > 0 && (
                    <span className="text-[10.5px] text-[var(--text-tertiary)]">
                      Need {step.min_sample}+ sends per variant for a reliable result
                    </span>
                  )}
                  {!step.winner && step.significant && (
                    <span className="text-[10.5px] text-[var(--text-tertiary)]">Too close to call</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {(['a', 'b'] as const).map((v) => {
                    const stats = v === 'a' ? step.variant_a : step.variant_b;
                    const subject = v === 'a' ? step.subject_a : step.subject_b;
                    const isWinner = step.winner === v;
                    const isLoser = step.winner !== null && step.winner !== v;
                    return (
                      <div key={v} className={cn(
                        'rounded-xl border p-4',
                        isWinner ? 'border-emerald-500/40 bg-emerald-500/5'
                          : isLoser ? 'border-[var(--border-subtle)] opacity-60'
                          : 'border-[var(--border-subtle)]'
                      )}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={cn('text-[10.5px] font-bold uppercase tracking-wider', isWinner ? 'text-emerald-600' : 'text-[var(--text-tertiary)]')}>
                            Variant {v.toUpperCase()} {isWinner && '★'}
                          </span>
                          <span className="text-[11px] text-[var(--text-tertiary)] tabular">{stats.sent.toLocaleString()} sent</span>
                        </div>
                        <p className="text-[12px] font-medium text-[var(--text-primary)] mb-3 italic line-clamp-2">"{subject}"</p>
                        <div className="space-y-2">
                          {[
                            { label: 'Opens',   value: stats.open_rate,  color: '#8B5CF6' },
                            { label: 'Clicks',  value: stats.click_rate, color: '#10B981' },
                            { label: 'Replies', value: stats.reply_rate, color: '#06B6D4' },
                          ].map((m) => (
                            <div key={m.label} className="flex items-center gap-2">
                              <span className="w-11 text-[10.5px] text-[var(--text-tertiary)]">{m.label}</span>
                              <div className="flex-1 h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${m.value}%`, background: m.color }} />
                              </div>
                              <span className="w-10 text-right text-[11.5px] font-bold tabular" style={{ color: m.color }}>{m.value}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contact table */}
      {contactsData && (
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">Contact Breakdown</p>
            <div className="flex items-center gap-1 bg-[var(--bg-elevated)] rounded-lg p-0.5">
              {([
                ['all',          'All'],
                ['opened',       'Opened'],
                ['clicked',      'Clicked'],
                ['replied',      'Replied'],
                ['bounced',      'Bounced'],
                ['unsubscribed', 'Unsub'],
              ] as [ContactFilterTab, string][]).map(([tab, label]) => (
                <button key={tab} onClick={() => setContactTab(tab)}
                  className={cn('h-6 px-2.5 rounded-md text-[11px] font-semibold transition-all',
                    contactTab === tab ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                  {['Contact', 'DCS', 'Status', 'Sends', 'Opens', 'Clicks', 'Replied'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{h}</th>
                  ))}
                  <th className="px-4 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {filteredContacts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-[12.5px] text-[var(--text-tertiary)]">No contacts match this filter</td>
                  </tr>
                ) : filteredContacts.slice(0, 100).map((c, i) => {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
                  const statusCls: Record<string, string> = {
                    completed: 'bg-emerald-500/10 text-emerald-700',
                    active: 'bg-blue-500/10 text-blue-700',
                    bounced: 'bg-rose-500/10 text-rose-700',
                    unsubscribed: 'bg-amber-500/10 text-amber-700',
                    pending: 'bg-slate-500/10 text-slate-600',
                  };
                  return (
                    <tr key={c.contact_id} onClick={() => navigate(`/contacts/${c.contact_id}`)}
                      className={cn('group cursor-pointer hover:bg-[var(--bg-hover)] transition-colors',
                        i < filteredContacts.length - 1 && 'border-b border-[var(--border-subtle)]')}>
                      <td className="px-4 py-2.5">
                        <p className="text-[12.5px] font-medium text-[var(--text-primary)]">{name || '—'}</p>
                        <p className="text-[11px] text-[var(--text-tertiary)]">{c.email}</p>
                      </td>
                      <td className="px-4 py-2.5"><DcsBadge score={c.dcs_score} /></td>
                      <td className="px-4 py-2.5">
                        <span className={cn('inline-flex items-center px-1.5 h-[18px] rounded-[4px] text-[10px] font-bold uppercase tracking-wider', statusCls[c.status] || statusCls.pending)}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-[var(--text-secondary)] tabular">{c.sent}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-[12px] font-semibold tabular flex items-center gap-1', c.opened > 0 ? 'text-violet-600' : 'text-[var(--text-tertiary)]')}>
                          {c.opened > 0 && <CheckCircle2 className="h-3 w-3" />}{c.opened}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-[12px] font-semibold tabular flex items-center gap-1', c.clicked > 0 ? 'text-emerald-600' : 'text-[var(--text-tertiary)]')}>
                          {c.clicked > 0 && <CheckCircle2 className="h-3 w-3" />}{c.clicked}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {c.replied
                          ? <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] bg-cyan-500/10 text-cyan-700 text-[10.5px] font-bold"><CheckCircle2 className="h-2.5 w-2.5" />Yes</span>
                          : <span className="text-[11px] text-[var(--text-tertiary)]">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <ExternalLink className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredContacts.length > 100 && (
            <div className="px-5 py-3 border-t border-[var(--border-subtle)] text-center text-[11.5px] text-[var(--text-tertiary)]">
              Showing first 100 of {filteredContacts.length.toLocaleString()} contacts
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ─── layout ───────────────────────────────────────────────── */
  return (
    <div className="flex h-[calc(100vh-56px)] -m-5 overflow-hidden">
      {Sidebar}
      <main className="flex-1 overflow-y-auto p-5">
        {selectedId ? DeepDive : OverviewContent}
      </main>
    </div>
  );
}
