import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../../api/analytics.api';
import type { TrendDataPoint } from '../../api/analytics.api';
import { campaignsApi } from '../../api/campaigns.api';
import { apiClient } from '../../api/client';
import { Spinner } from '../../components/ui/Spinner';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { StatCard as SharedStatCard } from '../../components/shared/StatCard';
import { Avatar } from '../../components/shared/Avatar';
import { useTheme } from '../../context/ThemeContext';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart,
} from 'recharts';
import {
  Send,
  Mail,
  MousePointerClick,
  MessageSquare,
  AlertTriangle,
  Calendar,
  Target,
  Users,
  ChevronDown,
  Download,
  ShieldOff,
  ShieldCheck,
  Activity,
  TrendingUp,
  BarChart3,
} from 'lucide-react';

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtNum(v: unknown): string {
  return safeNum(v).toLocaleString();
}

function fmtRate(v: unknown): string {
  return safeNum(v).toFixed(1);
}

const LIGHT_COLORS = ['#6366F1', '#818CF8', '#A5B4FC', '#C7D2FE'];
const DARK_COLORS  = ['#818CF8', '#6366F1', '#A5B4FC', '#4338CA'];

const tooltipStyle = {
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '12px',
  boxShadow: 'var(--shadow-lg)',
  padding: '10px 14px',
};

const tooltipLabelStyle = {
  color: 'var(--text-primary)',
  fontWeight: 600,
  marginBottom: '4px',
};

const tooltipItemStyle = {
  color: 'var(--text-secondary)',
  fontSize: '13px',
};

const DATE_RANGE_MAP = { '7d': 7, '30d': 30, '90d': 90 } as const;

/* StatCard removed — use SharedStatCard from components/shared/StatCard */

function EngagementRing({ data, colors }: { data: { name: string; value: number }[]; colors: string[] }) {
  const total = data.reduce((sum, item) => sum + safeNum(item.value), 0);
  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>Engagement breakdown</CardTitle>
        <CardDescription>Where your audience is engaging.</CardDescription>
      </CardHeader>
      <div className="flex items-center gap-4">
        <div className="w-44 h-44 flex-shrink-0">
          <ErrorBoundary fallback={<div className="flex items-center justify-center h-full text-xs text-[var(--text-tertiary)]">Chart unavailable</div>}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={4}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [fmtNum(value), 'Count']}
                  contentStyle={tooltipStyle}
                  itemStyle={tooltipItemStyle}
                  labelStyle={tooltipLabelStyle}
                />
              </PieChart>
            </ResponsiveContainer>
          </ErrorBoundary>
        </div>
        <div className="flex-1 space-y-3">
          {data.map((item, index) => (
            <div
              key={item.name}
              className="flex items-center justify-between py-1.5 px-2 rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    backgroundColor: colors[index % colors.length],
                    boxShadow: `0 0 0 2px var(--bg-surface), 0 0 0 3.5px ${colors[index % colors.length]}30`,
                  }}
                />
                <span className="text-sm text-[var(--text-secondary)]">{item.name}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {fmtNum(item.value)}
                </span>
                <span className="text-xs font-medium text-[var(--text-tertiary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">
                  {total > 0 ? ((safeNum(item.value) / total) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function DcsScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444';
  const label = score >= 80 ? 'Excellent' : score >= 50 ? 'Fair' : score > 0 ? 'Poor' : 'N/A';
  const circumference = 2 * Math.PI * 40;
  const progress = circumference - (score / 100) * circumference;
  return (
    <div className="flex flex-col items-center">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border-subtle)" strokeWidth="10" />
        <circle
          cx="50" cy="50" r="40" fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={progress}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
        <text x="50" y="54" textAnchor="middle" className="text-sm font-bold" fill="var(--text-primary)" fontSize="18" fontWeight="700">
          {score}
        </text>
      </svg>
      <span className="text-xs font-semibold mt-1" style={{ color }}>{label}</span>
    </div>
  );
}

async function downloadReport(url: string, filename: string) {
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

export function AnalyticsDashboardPage() {
  const { theme } = useTheme();
  const COLORS = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const primaryChartColor = '#6366F1';
  const secondaryChartColor = '#818CF8';

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('30d');
  const days = DATE_RANGE_MAP[dateRange];

  const { data: overview, isLoading: overviewLoading, error: overviewError } = useQuery({
    queryKey: ['analytics', 'overview', days],
    queryFn: () => analyticsApi.overview(days),
  });

  const { data: trendData } = useQuery({
    queryKey: ['analytics', 'trend', days],
    queryFn: () => analyticsApi.trend(days),
  });

  const { data: deliverabilityData } = useQuery({
    queryKey: ['analytics', 'deliverability'],
    queryFn: () => analyticsApi.deliverability(),
  });

  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns', 'list'],
    queryFn: () => campaignsApi.list({ limit: 100 }),
  });

  const { data: campaignAnalytics } = useQuery({
    queryKey: ['analytics', 'campaign', selectedCampaignId],
    queryFn: () => analyticsApi.campaign(selectedCampaignId),
    enabled: !!selectedCampaignId,
  });

  const { data: campaignContacts } = useQuery({
    queryKey: ['analytics', 'campaign-contacts', selectedCampaignId],
    queryFn: () => analyticsApi.campaignContacts(selectedCampaignId),
    enabled: !!selectedCampaignId,
  });

  const campaigns = Array.isArray(campaignsData?.data) ? campaignsData.data : [];

  const chartData = useMemo(() => campaignAnalytics
    ? [
        { name: 'Sent', value: safeNum(campaignAnalytics.sent), fill: COLORS[0] },
        { name: 'Opened', value: safeNum(campaignAnalytics.opened), fill: COLORS[1] },
        { name: 'Clicked', value: safeNum(campaignAnalytics.clicked), fill: COLORS[2] },
        { name: 'Replied', value: safeNum(campaignAnalytics.replied), fill: COLORS[3] },
        { name: 'Bounced', value: safeNum(campaignAnalytics.bounced), fill: theme === 'dark' ? '#24242A' : '#E4E4E7' },
      ]
    : [], [campaignAnalytics, COLORS, theme]);

  const formattedTrend = useMemo(() => {
    if (!Array.isArray(trendData) || trendData.length === 0) return [];
    return trendData.map((d: TrendDataPoint) => ({
      ...d,
      label: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }));
  }, [trendData]);

  const pieData = useMemo(() => overview
    ? [
        { name: 'Opened', value: safeNum(overview.total_opened) },
        { name: 'Clicked', value: safeNum(overview.total_clicked) },
        { name: 'Replied', value: safeNum(overview.total_replied) },
        { name: 'No engagement', value: Math.max(0, safeNum(overview.total_sent) - safeNum(overview.total_opened)) },
      ].filter((d) => d.value > 0)
    : [], [overview]);

  const dcsDistribution = useMemo(
    () => (deliverabilityData?.dcs_distribution || []).filter((d) => d.value > 0),
    [deliverabilityData]
  );

  const suppressionByReason = useMemo(
    () => (deliverabilityData?.suppression_by_reason || []).filter((d) => d.value > 0),
    [deliverabilityData]
  );

  const totalContacts = safeNum(overview?.total_contacts);
  const verifiedPct = totalContacts > 0
    ? Math.round((safeNum(overview?.verified_contacts) / totalContacts) * 100)
    : 0;

  if (overviewLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (overviewError) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          decorate
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
              <BarChart3 className="h-4 w-4 text-[var(--indigo)]" />
            </span>
          }
          title="Analytics"
          description="Monitor performance, engagement and delivery metrics across all your campaigns."
        />
        <Card padding="lg" className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-[var(--bg-elevated)] flex items-center justify-center mb-3 border border-[var(--border-subtle)]">
            <AlertTriangle className="h-5 w-5 text-[var(--text-tertiary)]" />
          </div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1">Unable to load analytics</h3>
          <p className="text-[12.5px] text-[var(--text-secondary)] max-w-md mx-auto">
            There was a problem loading your analytics data. Please try refreshing the page.
          </p>
        </Card>
      </div>
    );
  }

  const dateRangeOptions: { value: '7d' | '30d' | '90d'; label: string }[] = [
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
    { value: '90d', label: '90 days' },
  ];

  // Sparklines derived from trend data for each KPI
  const sentSpark    = formattedTrend.slice(-14).map((d: any) => safeNum(d.sent));
  const openedSpark  = formattedTrend.slice(-14).map((d: any) => safeNum(d.opened));
  const clickedSpark = formattedTrend.slice(-14).map((d: any) => safeNum(d.clicked));
  const repliedSpark = formattedTrend.slice(-14).map((d: any) => safeNum(d.replied));

  return (
    <div className="animate-fade-in">
      {/* Page header — decorated hero */}
      <PageHeader
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <BarChart3 className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Analytics"
        description="Monitor performance, engagement, deliverability and suppression across every campaign."
        meta={
          <>
            <Calendar className="h-3 w-3" />
            <span className="tabular">Last {days} days</span>
            {overview && (
              <>
                <span className="sep-dot" />
                <span className="tabular">{fmtNum(overview.total_sent)} sent</span>
                <span className="sep-dot" />
                <span className="tabular">{fmtRate(overview.avg_open_rate)}% open · {fmtRate(overview.avg_reply_rate)}% reply</span>
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
              onClick={() => downloadReport(`/analytics/export/overview?days=${days}`, `overview-report-${dateRange}.csv`)}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </>
        }
      />

      {/* Overview Stats — 7 KPI cards using SharedStatCard with sparklines */}
      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
          <SharedStatCard
            icon={Send} accent="indigo"
            label="Sent"
            value={fmtNum(overview.total_sent)}
            sparkline={sentSpark.length >= 2 ? sentSpark : undefined}
          />
          <SharedStatCard
            icon={Mail} accent="violet"
            label="Opened"
            value={fmtNum(overview.total_opened)}
            hint={`${fmtRate(overview.avg_open_rate)}% open rate`}
            sparkline={openedSpark.length >= 2 ? openedSpark : undefined}
          />
          <SharedStatCard
            icon={MousePointerClick} accent="indigo"
            label="Clicked"
            value={fmtNum(overview.total_clicked)}
            hint={`${fmtRate(overview.avg_click_rate)}% click rate`}
            sparkline={clickedSpark.length >= 2 ? clickedSpark : undefined}
          />
          <SharedStatCard
            icon={MessageSquare} accent="emerald"
            label="Replied"
            value={fmtNum(overview.total_replied)}
            hint={`${fmtRate(overview.avg_reply_rate)}% reply rate`}
            sparkline={repliedSpark.length >= 2 ? repliedSpark : undefined}
          />
          <SharedStatCard
            icon={Target} accent="violet"
            label="Campaigns"
            value={fmtNum(overview.total_campaigns)}
          />
          <SharedStatCard
            icon={ShieldOff} accent="rose"
            label="Suppressed"
            value={fmtNum(overview.suppressed_count)}
            onClick={() => (window.location.href = '/suppression')}
          />
          <SharedStatCard
            icon={ShieldCheck}
            accent={safeNum(overview.avg_dcs_score) >= 80 ? 'emerald' : safeNum(overview.avg_dcs_score) >= 50 ? 'amber' : 'rose'}
            label="Avg DCS"
            value={fmtNum(overview.avg_dcs_score)}
            hint="Deliverability score"
            onClick={() => (window.location.href = '/verification')}
          />
        </div>
      )}

      {/* Performance Trend + Engagement Ring */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card padding="md" className="col-span-2">
          <CardHeader
            action={
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: primaryChartColor }} />
                  Sent
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: secondaryChartColor }} />
                  Opened
                </span>
              </div>
            }
          >
            <CardTitle>Performance trend</CardTitle>
            <CardDescription>Email activity over the last {days} days.</CardDescription>
          </CardHeader>
          <div className="h-60">
            {formattedTrend.length > 0 ? (
              <ErrorBoundary fallback={<div className="flex items-center justify-center h-full text-sm text-[var(--text-tertiary)]">Chart unavailable</div>}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={formattedTrend}>
                    <defs>
                      <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={primaryChartColor} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={primaryChartColor} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorOpened" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={secondaryChartColor} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={secondaryChartColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                      dy={8}
                      interval={days <= 7 ? 0 : days <= 30 ? 4 : 13}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }}
                      dx={-8}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      itemStyle={tooltipItemStyle}
                      labelStyle={tooltipLabelStyle}
                      cursor={{ stroke: 'var(--border-default)', strokeDasharray: '4 4' }}
                    />
                    <Area
                      type="monotone" dataKey="sent" stroke={primaryChartColor} strokeWidth={2.5}
                      fill="url(#colorSent)" name="Sent" dot={false}
                      activeDot={{ r: 5, fill: primaryChartColor, stroke: 'var(--bg-surface)', strokeWidth: 2 }}
                    />
                    <Area
                      type="monotone" dataKey="opened" stroke={secondaryChartColor} strokeWidth={2.5}
                      fill="url(#colorOpened)" name="Opened" dot={false}
                      activeDot={{ r: 5, fill: secondaryChartColor, stroke: 'var(--bg-surface)', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ErrorBoundary>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-[var(--text-tertiary)]">
                No activity data for this period
              </div>
            )}
          </div>
        </Card>

        {pieData.length > 0 ? (
          <EngagementRing data={pieData} colors={COLORS} />
        ) : (
          <Card padding="md" className="flex items-center justify-center">
            <p className="text-[12.5px] text-[var(--text-tertiary)]">No engagement data yet</p>
          </Card>
        )}
      </div>

      {/* Deliverability Health */}
      <Card padding="none" className="mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.005em] flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-[var(--indigo-subtle)]">
                <Activity className="h-3 w-3 text-[var(--indigo)]" />
              </span>
              Deliverability health
            </h2>
            <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">DCS scores, suppression breakdown and contact quality.</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Link to="/verification" className="icon-btn h-7 px-2 text-[12px]">Verify contacts</Link>
            <Link to="/suppression" className="icon-btn h-7 px-2 text-[12px]">Suppression list</Link>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* DCS Gauge + summary */}
          <div className="flex flex-col items-center justify-center gap-4 py-4 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)]">
            <DcsScoreGauge score={safeNum(overview?.avg_dcs_score)} />
            <div className="text-center">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Average DCS Score</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                {fmtNum(safeNum(overview?.verified_contacts))} of {fmtNum(totalContacts)} verified ({verifiedPct}%)
              </p>
            </div>
            <div className="w-full px-4 space-y-1.5">
              {[
                { label: 'Verified (≥60)', value: safeNum(overview?.verified_contacts), color: '#10B981' },
                { label: 'Bounced contacts', value: safeNum(overview?.bounced_contacts), color: '#EF4444' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-[var(--text-secondary)]">{item.label}</span>
                  </div>
                  <span className="font-semibold text-[var(--text-primary)]">{fmtNum(item.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* DCS distribution bar chart */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-[var(--text-tertiary)]" />
              DCS Score Distribution
            </h4>
            {dcsDistribution.length > 0 ? (
              <div className="h-48">
                <ErrorBoundary fallback={<div className="flex items-center justify-center h-full text-sm text-[var(--text-tertiary)]">Chart unavailable</div>}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dcsDistribution} barSize={36}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        axisLine={false} tickLine={false}
                        tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                        dy={6}
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} dx={-6} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        itemStyle={tooltipItemStyle}
                        labelStyle={tooltipLabelStyle}
                        cursor={{ fill: 'var(--bg-hover)', radius: 6 }}
                      />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Contacts">
                        {dcsDistribution.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ErrorBoundary>
              </div>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center gap-2">
                <ShieldCheck className="h-8 w-8 text-[var(--text-tertiary)]" strokeWidth={1.5} />
                <p className="text-sm text-[var(--text-tertiary)]">No DCS scores yet</p>
                <Link to="/verification" className="text-xs font-medium text-[#6366F1] hover:underline">
                  Start verifying contacts →
                </Link>
              </div>
            )}
          </div>

          {/* Suppression by reason */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-1.5">
              <ShieldOff className="h-4 w-4 text-[var(--text-tertiary)]" />
              Suppression by Reason
            </h4>
            {suppressionByReason.length > 0 ? (
              <div className="space-y-3">
                {suppressionByReason.map((item) => {
                  const total = suppressionByReason.reduce((s, r) => s + r.value, 0);
                  const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                          <span className="text-[var(--text-secondary)]">{item.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[var(--text-primary)]">{fmtNum(item.value)}</span>
                          <span className="text-[var(--text-tertiary)]">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: item.color }}
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-tertiary)]">Total suppressed</span>
                    <span className="font-bold text-[var(--text-primary)]">
                      {fmtNum(suppressionByReason.reduce((s, r) => s + r.value, 0))}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center gap-2">
                <ShieldOff className="h-8 w-8 text-[var(--text-tertiary)]" strokeWidth={1.5} />
                <p className="text-sm text-[var(--text-tertiary)]">No suppressed contacts</p>
                <p className="text-xs text-[var(--text-tertiary)]">Contacts you block from receiving emails appear here</p>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Campaign Deep Dive */}
      <Card padding="none" className="mb-4 overflow-hidden">
        <div className="p-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.005em]">Campaign deep dive</h2>
              <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                Select a campaign to view detailed analytics.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedCampaignId && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => downloadReport(`/analytics/export/campaigns/${selectedCampaignId}`, `campaign-report.csv`)}
                >
                  <Download className="h-3.5 w-3.5" /> Export report
                </Button>
              )}
              <div className="relative">
                <select
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  className="appearance-none pl-3 pr-9 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[12.5px] text-[var(--text-primary)] focus:outline-none focus:border-[rgba(91,91,245,0.4)] focus:shadow-[0_0_0_3px_rgba(91,91,245,0.12)] min-w-[200px] transition cursor-pointer"
                >
                  <option value="">Choose a campaign…</option>
                  {campaigns.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        {campaignAnalytics ? (
          <div className="p-6 space-y-4">
            {/* Campaign stats — 5 tiles incl. Suppressed */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {[
                { icon: Send, label: 'Sent', value: campaignAnalytics.sent, rate: undefined, color: '#6366F1' },
                { icon: Mail, label: 'Opened', value: campaignAnalytics.opened, rate: campaignAnalytics.open_rate, color: '#818CF8' },
                { icon: MousePointerClick, label: 'Clicked', value: campaignAnalytics.clicked, rate: campaignAnalytics.click_rate, color: '#A5B4FC' },
                { icon: MessageSquare, label: 'Replied', value: campaignAnalytics.replied, rate: campaignAnalytics.reply_rate, color: '#10B981' },
                { icon: AlertTriangle, label: 'Bounced', value: campaignAnalytics.bounced, rate: campaignAnalytics.bounce_rate, color: '#EF4444' },
              ].map(({ icon: Icon, label, value, rate, color }) => (
                <div key={label} className="relative overflow-hidden p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] transition-all duration-200 hover:border-[var(--border-default)] group">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[var(--bg-surface)]">
                      <Icon className="h-4 w-4" style={{ color }} strokeWidth={1.5} />
                    </div>
                    <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
                  </div>
                  <p className="stat-value">{fmtNum(value)}</p>
                  {rate !== undefined && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-1 font-medium">{fmtRate(rate)}% rate</p>
                  )}
                </div>
              ))}
            </div>

            {/* Campaign Funnel Bar chart */}
            {chartData.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-[var(--text-primary)] mb-4">Campaign Funnel</h4>
                <div className="h-56">
                  <ErrorBoundary fallback={<div className="flex items-center justify-center h-full text-sm text-[var(--text-tertiary)]">Chart unavailable</div>}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} barSize={40}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                        <XAxis
                          dataKey="name" axisLine={false} tickLine={false}
                          tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} dy={8}
                        />
                        <YAxis
                          axisLine={false} tickLine={false}
                          tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} dx={-8}
                        />
                        <Tooltip
                          contentStyle={tooltipStyle} itemStyle={tooltipItemStyle}
                          labelStyle={tooltipLabelStyle} cursor={{ fill: 'var(--bg-hover)', radius: 8 }}
                        />
                        <Bar dataKey="value" radius={[8, 8, 0, 0]} name="Count">
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ErrorBoundary>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="mx-auto w-10 h-10 rounded-xl bg-[var(--bg-elevated)] flex items-center justify-center mb-3 border border-[var(--border-subtle)]">
              <Target className="h-4 w-4 text-[var(--text-tertiary)]" />
            </div>
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">No campaign selected</h3>
            <p className="text-[12.5px] text-[var(--text-secondary)] max-w-xs mx-auto">
              Choose a campaign from the dropdown above to explore detailed performance analytics.
            </p>
          </div>
        )}

        {/* Contact breakdown table */}
        {campaignContacts && Array.isArray(campaignContacts.contacts) && campaignContacts.contacts.length > 0 && (
          <div className="p-4 border-t border-[var(--border-subtle)]">
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <span className="flex items-center justify-center h-5 w-5 rounded-[5px] bg-[var(--bg-elevated)]">
                <Users className="h-3 w-3 text-[var(--text-primary)]" />
              </span>
              Contact breakdown
            </h3>
            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--bg-elevated)]">
                    <th className="table-header py-3 px-4 text-left">Contact</th>
                    <th className="table-header py-3 px-4 text-left">Status</th>
                    <th className="table-header py-3 px-4 text-center">Sent</th>
                    <th className="table-header py-3 px-4 text-center">Opened</th>
                    <th className="table-header py-3 px-4 text-center">Clicked</th>
                    <th className="table-header py-3 px-4 text-center">Replied</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignContacts.contacts.slice(0, 10).map((c: any) => (
                    <tr
                      key={c.contact_id}
                      className="border-t border-[var(--border-subtle)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                    >
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            name={[c.first_name, c.last_name].filter(Boolean).join(' ') || undefined}
                            email={c.email}
                            size="md"
                          />
                          <div className="min-w-0">
                            <span className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                              {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Unknown'}
                            </span>
                            {(c.first_name || c.last_name) && (
                              <p className="text-[11px] text-[var(--text-tertiary)] truncate">{c.email}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge
                          variant={
                            c.status === 'replied' ? 'info' :
                            c.status === 'bounced' ? 'danger' :
                            c.status === 'unsubscribed' ? 'danger' :
                            c.status === 'opened' || c.status === 'clicked' ? 'success' :
                            'default'
                          }
                        >
                          {c.status || 'pending'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-center text-[var(--text-secondary)] font-medium">{fmtNum(c.sent)}</td>
                      <td className="py-2.5 px-4 text-center text-[var(--text-secondary)] font-medium">{fmtNum(c.opened)}</td>
                      <td className="py-2.5 px-4 text-center text-[var(--text-secondary)] font-medium">{fmtNum(c.clicked)}</td>
                      <td className="py-2.5 px-4 text-center">
                        {c.replied ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                            <MessageSquare className="h-3 w-3" />
                            Yes
                          </span>
                        ) : (
                          <span className="text-[var(--text-tertiary)]">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {campaignContacts.contacts.length > 10 && (
                <div className="py-2.5 px-4 text-center bg-[var(--bg-elevated)] border-t border-[var(--border-subtle)]">
                  <p className="text-[11.5px] font-medium text-[var(--text-tertiary)]">
                    Showing 10 of {campaignContacts.contacts.length} contacts
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Campaign Comparison */}
      <CampaignComparison campaigns={campaigns} />
    </div>
  );
}

/* ─── Campaign Comparison ──────────────────────────────────────── */

function CampaignComparison({ campaigns }: { campaigns: any[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: comparisonData = [], isLoading } = useQuery({
    queryKey: ['analytics', 'compare', selectedIds],
    queryFn: async () => {
      const results = await Promise.all(selectedIds.map((id) => analyticsApi.campaign(id)));
      return results.map((res, i) => ({ ...res, campaign: campaigns.find((c) => c.id === selectedIds[i]) }));
    },
    enabled: selectedIds.length > 0,
  });

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) {
        toast.error('Select up to 4 campaigns to compare');
        return prev;
      }
      return [...prev, id];
    });
  };

  const colors = ['#6366F1', '#10B981', '#F59E0B', '#EC4899'];

  return (
    <Card padding="none" className="mt-4 overflow-hidden">
      <div className="p-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.005em]">Compare campaigns</h2>
            <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
              Select up to 4 campaigns to see their performance side by side.
            </p>
          </div>
          {selectedIds.length > 0 && (
            <button
              onClick={() => setSelectedIds([])}
              className="text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1"
            >
              Clear ({selectedIds.length})
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {campaigns.map((c: any) => {
            const active = selectedIds.includes(c.id);
            const idx = selectedIds.indexOf(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleId(c.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11.5px] font-medium border transition-all',
                  active
                    ? 'border-transparent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                )}
                style={active ? { background: colors[idx] } : undefined}
              >
                {active && <span className="text-[10px] opacity-80 tabular">#{idx + 1}</span>}
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      {selectedIds.length === 0 ? (
        <div className="p-10 text-center text-[var(--text-tertiary)]">
          <div className="mx-auto w-10 h-10 rounded-xl bg-[var(--bg-elevated)] flex items-center justify-center mb-2 border border-[var(--border-subtle)]">
            <BarChart3 className="h-4 w-4" />
          </div>
          <p className="text-[12.5px]">Pick at least 2 campaigns above to start comparing.</p>
        </div>
      ) : isLoading ? (
        <div className="p-10 text-center"><Spinner size="md" /></div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Stat comparison table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="text-left py-2 font-medium">Campaign</th>
                  <th className="text-right py-2 font-medium">Sent</th>
                  <th className="text-right py-2 font-medium">Opened</th>
                  <th className="text-right py-2 font-medium">Open %</th>
                  <th className="text-right py-2 font-medium">Clicked</th>
                  <th className="text-right py-2 font-medium">Click %</th>
                  <th className="text-right py-2 font-medium">Replied</th>
                  <th className="text-right py-2 font-medium">Reply %</th>
                  <th className="text-right py-2 font-medium">Bounced</th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((d: any, i: number) => (
                  <tr key={d.campaign_id} className="border-b border-[var(--border-subtle)]">
                    <td className="py-3 font-medium text-[var(--text-primary)]">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: colors[i] }} />
                        <span className="truncate max-w-[200px]">{d.campaign?.name || '...'}</span>
                      </div>
                    </td>
                    <td className="py-3 text-right tabular-nums text-[var(--text-secondary)]">{(d.sent || 0).toLocaleString()}</td>
                    <td className="py-3 text-right tabular-nums text-[var(--text-secondary)]">{(d.opened || 0).toLocaleString()}</td>
                    <td className="py-3 text-right tabular-nums text-[var(--text-secondary)]">{(d.open_rate || 0).toFixed(1)}%</td>
                    <td className="py-3 text-right tabular-nums text-[var(--text-secondary)]">{(d.clicked || 0).toLocaleString()}</td>
                    <td className="py-3 text-right tabular-nums text-[var(--text-secondary)]">{(d.click_rate || 0).toFixed(1)}%</td>
                    <td className="py-3 text-right tabular-nums text-[var(--text-secondary)]">{(d.replied || 0).toLocaleString()}</td>
                    <td className="py-3 text-right tabular-nums font-semibold text-[#10B981]">{(d.reply_rate || 0).toFixed(1)}%</td>
                    <td className="py-3 text-right tabular-nums text-red-500">{(d.bounced || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bar chart comparison */}
          {comparisonData.length >= 2 && (
            <div>
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">Engagement rates</h4>
              <div className="h-64">
                <ErrorBoundary fallback={<div className="text-sm text-[var(--text-tertiary)]">Chart unavailable</div>}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={['Open %', 'Click %', 'Reply %'].map((metric, i) => {
                        const row: any = { metric };
                        comparisonData.forEach((d: any, ci: number) => {
                          row[d.campaign?.name || `C${ci + 1}`] = i === 0 ? d.open_rate : i === 1 ? d.click_rate : d.reply_rate;
                        });
                        return row;
                      })}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} unit="%" />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-default)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {comparisonData.map((d: any, i: number) => (
                        <Bar key={d.campaign_id} dataKey={d.campaign?.name || `C${i + 1}`} fill={colors[i]} radius={[4, 4, 0, 0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </ErrorBoundary>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
