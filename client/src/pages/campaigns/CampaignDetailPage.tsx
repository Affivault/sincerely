import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi } from '../../api/campaigns.api';
import { analyticsApi } from '../../api/analytics.api';
import { Spinner } from '../../components/ui/Spinner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { Avatar } from '../../components/shared/Avatar';
import { formatDate, formatDateTime, formatTimeUntil, cn } from '../../lib/utils';
import {
  ArrowLeft, Play, Pause, Square, Pencil, Trash2, Send, Mail,
  MousePointerClick, MessageSquare, AlertTriangle, Clock, Copy,
  GitBranch, Webhook, Users, BarChart2, TrendingUp, Settings2,
  List, Search, Download, CheckCircle, ChevronRight, Activity,
  Shield, Globe, Target, Zap, RefreshCw, ArrowUpDown, Info,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import toast from 'react-hot-toast';
import type { CampaignStep } from '@lemlist/shared';

type TabId = 'overview' | 'performance' | 'audience' | 'sequence' | 'settings';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview',    label: 'Overview',     icon: BarChart2   },
  { id: 'performance', label: 'Performance',  icon: TrendingUp  },
  { id: 'audience',    label: 'Audience',     icon: Users       },
  { id: 'sequence',    label: 'Sequence',     icon: List        },
  { id: 'settings',    label: 'Settings',     icon: Settings2   },
];

function engagementScore(sent: number, opened: number, clicked: number, replied: boolean) {
  if (sent === 0) return 0;
  return Math.min(100, Math.round((opened / sent) * 35 + (clicked / sent) * 35 + (replied ? 30 : 0)));
}

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [trendDays, setTrendDays] = useState(14);
  const [audienceSearch, setAudienceSearch] = useState('');
  const [audienceSort, setAudienceSort] = useState<'score' | 'name' | 'sent'>('score');

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => campaignsApi.get(id!),
    enabled: !!id,
    refetchInterval: (q) => q.state.data?.status === 'running' ? 30_000 : false,
  });

  const isRunning = campaign?.status === 'running';

  const { data: analytics } = useQuery({
    queryKey: ['analytics', 'campaign', id],
    queryFn: () => analyticsApi.campaign(id!),
    enabled: !!id,
    refetchInterval: isRunning ? 30_000 : false,
  });

  const { data: trend } = useQuery({
    queryKey: ['analytics', 'campaign', id, 'trend', trendDays],
    queryFn: () => analyticsApi.campaignTrend(id!, trendDays),
    enabled: !!id && activeTab === 'performance',
    refetchInterval: isRunning ? 60_000 : false,
  });

  const { data: audienceData } = useQuery({
    queryKey: ['analytics', 'campaign', id, 'contacts'],
    queryFn: () => analyticsApi.campaignContacts(id!),
    enabled: !!id && activeTab === 'audience',
  });

  const { data: pipeline } = useQuery({
    queryKey: ['campaign-contacts', id],
    queryFn: () => campaignsApi.getContacts(id!, { limit: 200 }),
    enabled: !!id && (activeTab === 'overview' || activeTab === 'audience'),
  });

  const launchMut  = useMutation({ mutationFn: () => campaignsApi.launch(id!),  onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Campaign launched'); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to launch') });
  const pauseMut   = useMutation({ mutationFn: () => campaignsApi.pause(id!),   onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Paused'); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to pause') });
  const resumeMut  = useMutation({ mutationFn: () => campaignsApi.resume(id!),  onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Resumed'); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to resume') });
  const cancelMut  = useMutation({ mutationFn: () => campaignsApi.cancel(id!),  onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Cancelled'); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to cancel') });
  const cloneMut   = useMutation({ mutationFn: () => campaignsApi.clone(id!),   onSuccess: (c) => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Cloned'); navigate(`/campaigns/${c.id}`); } });
  const deleteMut  = useMutation({ mutationFn: () => campaignsApi.delete(id!),  onSuccess: () => { toast.success('Deleted'); navigate('/campaigns'); } });

  // Audience data with computed engagement scores
  const audienceRows = useMemo(() => {
    const contacts = audienceData?.contacts || [];
    return contacts.map((c) => ({
      ...c,
      score: engagementScore(c.sent, c.opened, c.clicked, c.replied),
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || '',
    }));
  }, [audienceData]);

  const filteredAudience = useMemo(() => {
    let rows = audienceRows;
    if (audienceSearch.trim()) {
      const q = audienceSearch.toLowerCase();
      rows = rows.filter((r) => r.email.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => {
      if (audienceSort === 'score') return b.score - a.score;
      if (audienceSort === 'sent') return b.sent - a.sent;
      return a.name.localeCompare(b.name);
    });
  }, [audienceRows, audienceSearch, audienceSort]);

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>;
  if (!campaign) return <div className="text-center text-[var(--text-secondary)] py-20">Campaign not found</div>;

  const sent = analytics?.sent || 0;
  const opened = analytics?.opened || 0;
  const clicked = analytics?.clicked || 0;
  const replied = analytics?.replied || 0;
  const bounced = analytics?.bounced || 0;
  const errors = analytics?.errors || 0;
  const openRate = analytics?.open_rate || 0;
  const clickRate = analytics?.click_rate || 0;
  const replyRate = analytics?.reply_rate || 0;
  const bounceRate = analytics?.bounce_rate || 0;

  const totalContacts = campaign.contacts_count || campaign.total_contacts || 0;
  const completedContacts = (campaign as any).completed_contacts || 0;
  const activeContacts = (campaign as any).active_contacts || 0;
  const bouncedContacts = (campaign as any).bounced_contacts || 0;
  const unsubContacts = (campaign as any).unsubscribed_contacts || 0;
  const pendingContacts = Math.max(0, totalContacts - completedContacts - activeContacts - bouncedContacts - unsubContacts);

  const exportUrl = analyticsApi.exportCampaignReport(id!);

  return (
    <div className="space-y-0">
      {/* ── Back nav ── */}
      <button
        onClick={() => navigate('/campaigns')}
        className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
        All campaigns
      </button>

      {/* ── Campaign hero ── */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-gradient-to-br from-[var(--bg-surface)] via-[var(--bg-surface)] to-[var(--bg-elevated)] overflow-hidden mb-5" style={{ boxShadow: '0 1px 0 rgba(15,15,25,0.02), 0 2px 8px rgba(15,15,25,0.04)' }}>
        {/* Decorative pattern */}
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 70% 50%, rgba(99,102,241,0.04) 0%, transparent 60%)', borderRadius: 'inherit' }} />

        <div className="relative px-5 pt-5 pb-4">
          {/* Title row */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                <h1 className="text-[20px] font-semibold text-[var(--text-primary)] tracking-[-0.02em] truncate">{campaign.name}</h1>
                <StatusBadge status={campaign.status} type="campaign" />
                {isRunning && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11.5px] text-[var(--text-tertiary)]">
                <span>Created {formatDate(campaign.created_at)}</span>
                {campaign.started_at && <><span className="text-[var(--border-default)]">·</span><span>Started {formatDate(campaign.started_at)}</span></>}
                <span className="text-[var(--border-default)]">·</span>
                <span>{campaign.steps?.length || 0} steps</span>
                <span className="text-[var(--border-default)]">·</span>
                <span>{totalContacts.toLocaleString()} contacts</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <a href={exportUrl} title="Export CSV" className="icon-btn">
                <Download className="h-3.5 w-3.5" />
              </a>
              <button title="Clone" onClick={() => cloneMut.mutate()} className="icon-btn">
                <Copy className="h-3.5 w-3.5" />
              </button>
              {campaign.status === 'draft' && (
                <>
                  <button onClick={() => navigate(`/campaigns/${id}/edit`)} className="btn-secondary text-[12px] h-8 px-3 rounded-lg gap-1.5">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button onClick={() => launchMut.mutate()} className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-[12px] font-semibold hover:opacity-90 transition-all shadow-[0_1px_3px_rgba(99,102,241,0.4)]">
                    <Play className="h-3 w-3 fill-current" /> Launch
                  </button>
                </>
              )}
              {campaign.status === 'running' && (
                <>
                  <button onClick={() => pauseMut.mutate()} className="btn-secondary text-[12px] h-8 px-3 rounded-lg gap-1.5">
                    <Pause className="h-3.5 w-3.5" /> Pause
                  </button>
                  <button onClick={() => cancelMut.mutate()} className="btn-secondary text-[12px] h-8 px-3 rounded-lg gap-1.5 hover:text-rose-500 hover:border-rose-500/30">
                    <Square className="h-3.5 w-3.5" /> Stop
                  </button>
                </>
              )}
              {campaign.status === 'paused' && (
                <>
                  <button onClick={() => resumeMut.mutate()} className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-[12px] font-semibold hover:opacity-90 transition-all">
                    <Play className="h-3 w-3 fill-current" /> Resume
                  </button>
                  <button onClick={() => cancelMut.mutate()} className="btn-secondary text-[12px] h-8 px-3 rounded-lg gap-1.5 hover:text-rose-500 hover:border-rose-500/30">
                    <Square className="h-3.5 w-3.5" /> Stop
                  </button>
                </>
              )}
              {['draft', 'completed', 'cancelled'].includes(campaign.status) && (
                <button onClick={() => { if (confirm('Delete this campaign permanently?')) deleteMut.mutate(); }} className="icon-btn hover:text-rose-500 hover:bg-rose-500/10" title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 8-stat metric strip */}
          {analytics && sent > 0 && (
            <div className="grid grid-cols-4 xl:grid-cols-8 gap-2 mt-4 pt-4 border-t border-[var(--border-subtle)]">
              <HeroStat label="Sent"       value={sent}       color="#6366F1" />
              <HeroStat label="Delivered"  value={sent - bounced} color="#8B5CF6" sub={bounced > 0 ? `${bounced} bounced` : undefined} />
              <HeroStat label="Opens"      value={opened}     color="#3B82F6" rate={openRate}  rateLabel="open rate" />
              <HeroStat label="Clicks"     value={clicked}    color="#06B6D4" rate={clickRate} rateLabel="click rate" />
              <HeroStat label="Replies"    value={replied}    color="#10B981" rate={replyRate} rateLabel="reply rate" />
              <HeroStat label="Bounced"    value={bounced}    color="#EF4444" rate={bounceRate} rateLabel="bounce rate" negative />
              <HeroStat label="Errors"     value={errors}     color="#F59E0B" negative={errors > 0} />
              <HeroStat label="Audience"   value={totalContacts} color="#94A3B8" sub={activeContacts > 0 ? `${activeContacts} active` : undefined} />
            </div>
          )}
          {analytics && sent === 0 && (
            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] text-[12px] text-[var(--text-tertiary)]">
              No emails sent yet. {campaign.status === 'draft' ? 'Launch this campaign to start sending.' : ''}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="border-t border-[var(--border-subtle)] px-5">
          <div className="flex items-center gap-0">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3.5 h-10 text-[12.5px] font-medium border-b-2 transition-colors -mb-px',
                    activeTab === tab.id
                      ? 'border-[var(--indigo)] text-[var(--indigo)]'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Tab content ── */}

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Contact pipeline */}
          <PipelineCard
            total={totalContacts}
            completed={completedContacts}
            active={activeContacts}
            replied={replied}
            bounced={bouncedContacts}
            unsub={unsubContacts}
            pending={pendingContacts}
          />

          <div className="grid grid-cols-3 gap-4">
            {/* Engagement snapshot */}
            <div className="col-span-2 panel p-4">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-3">Engagement snapshot</h3>
              {sent > 0 ? (
                <div className="space-y-3">
                  <FunnelBar label="Sent"    value={sent}    max={sent}    color="#6366F1" pct={100} />
                  <FunnelBar label="Opened"  value={opened}  max={sent}    color="#3B82F6" pct={openRate} />
                  <FunnelBar label="Clicked" value={clicked} max={sent}    color="#06B6D4" pct={clickRate} />
                  <FunnelBar label="Replied" value={replied} max={sent}    color="#10B981" pct={replyRate} />
                  {bounced > 0 && <FunnelBar label="Bounced" value={bounced} max={sent} color="#EF4444" pct={bounceRate} negative />}
                </div>
              ) : (
                <p className="text-[12px] text-[var(--text-tertiary)] py-4">No activity yet.</p>
              )}
            </div>

            {/* Quick settings */}
            <div className="panel p-4">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-3">Configuration</h3>
              <div className="space-y-2.5">
                <SettingRow icon={Globe}  label="Timezone"    value={campaign.timezone || '—'} />
                <SettingRow icon={Clock}  label="Send window" value={campaign.send_window_start ? `${campaign.send_window_start} – ${campaign.send_window_end}` : 'All day'} />
                <SettingRow icon={Target} label="Daily limit" value={campaign.daily_limit ? `${campaign.daily_limit}/day` : 'Unlimited'} />
                <SettingRow icon={Zap}    label="Delay"       value={`${campaign.delay_between_emails_min ?? 50}–${campaign.delay_between_emails_max ?? 200}s`} />
                <SettingRow icon={CheckCircle} label="Stop on reply" value={campaign.stop_on_reply !== false ? 'Yes' : 'No'} />
                <SettingRow icon={Shield} label="Tracking"    value={[campaign.track_opens !== false && 'Opens', campaign.track_clicks !== false && 'Clicks'].filter(Boolean).join(', ') || 'Off'} />
              </div>
              <button onClick={() => setActiveTab('settings')} className="mt-3 w-full flex items-center justify-center gap-1 text-[11.5px] font-medium text-[var(--indigo)] hover:underline">
                Edit settings <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Rate benchmark cards */}
          {sent > 0 && (
            <div className="grid grid-cols-3 gap-4">
              <BenchmarkCard label="Open rate" value={openRate} good={35} ok={20} unit="%" desc="Industry avg: 20–40%" />
              <BenchmarkCard label="Click rate" value={clickRate} good={5} ok={2} unit="%" desc="Industry avg: 2–5%" />
              <BenchmarkCard label="Reply rate" value={replyRate} good={5} ok={2} unit="%" desc="Good cold email: 3–8%" />
            </div>
          )}
        </div>
      )}

      {/* PERFORMANCE TAB */}
      {activeTab === 'performance' && (
        <div className="space-y-4">
          {/* Trend chart */}
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Daily activity</h3>
                <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">Emails sent, opened, and replied over time</p>
              </div>
              <div className="flex items-center gap-1 bg-[var(--bg-elevated)] rounded-lg p-0.5">
                {[7, 14, 30].map((d) => (
                  <button
                    key={d}
                    onClick={() => setTrendDays(d)}
                    className={cn(
                      'px-3 h-6 rounded-md text-[11px] font-medium transition-all',
                      trendDays === d
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                    )}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            {!trend ? (
              <div className="flex items-center justify-center h-52"><Spinner /></div>
            ) : trend.every((d) => d.sent === 0) ? (
              <div className="flex flex-col items-center justify-center h-52 text-[var(--text-tertiary)]">
                <Activity className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-[12px]">No activity in the last {trendDays} days</p>
              </div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366F1" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradOpened" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradReplied" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '12px' }}
                      itemStyle={{ color: 'var(--text-secondary)' }}
                      labelStyle={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                    <Area type="monotone" dataKey="sent"    name="Sent"    stroke="#6366F1" strokeWidth={2} fill="url(#gradSent)"    dot={false} />
                    <Area type="monotone" dataKey="opened"  name="Opened"  stroke="#3B82F6" strokeWidth={1.5} fill="url(#gradOpened)" dot={false} />
                    <Area type="monotone" dataKey="replied" name="Replied" stroke="#10B981" strokeWidth={1.5} fill="url(#gradReplied)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Rate deep-dive */}
          {sent > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <div className="panel p-4">
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4">Conversion funnel</h3>
                <div className="space-y-3">
                  <FunnelBar label="Sent"    value={sent}    max={sent} color="#6366F1" pct={100}       showCount />
                  <FunnelBar label="Opened"  value={opened}  max={sent} color="#3B82F6" pct={openRate}  showCount dropOff={100 - openRate} />
                  <FunnelBar label="Clicked" value={clicked} max={sent} color="#06B6D4" pct={clickRate} showCount dropOff={openRate - clickRate} />
                  <FunnelBar label="Replied" value={replied} max={sent} color="#10B981" pct={replyRate} showCount dropOff={clickRate - replyRate} />
                </div>
              </div>
              <div className="panel p-4">
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4">Deliverability</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-elevated)]">
                    <span className="text-[12px] text-[var(--text-secondary)]">Total sent</span>
                    <span className="text-[14px] font-semibold text-[var(--text-primary)] tabular-nums">{sent.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-elevated)]">
                    <span className="text-[12px] text-[var(--text-secondary)]">Delivered (est.)</span>
                    <span className="text-[14px] font-semibold text-emerald-600 tabular-nums">{(sent - bounced).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/6 border border-red-500/15">
                    <span className="text-[12px] text-[var(--text-secondary)]">Bounced</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-rose-600 tabular-nums">{bounced}</span>
                      <span className="text-[11px] text-rose-400 tabular-nums">({bounceRate}%)</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/6 border border-amber-500/15">
                    <span className="text-[12px] text-[var(--text-secondary)]">Errors</span>
                    <span className="text-[14px] font-semibold text-amber-600 tabular-nums">{errors}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Rate benchmarks */}
          {sent > 0 && (
            <div className="grid grid-cols-3 gap-4">
              <BenchmarkCard label="Open rate"  value={openRate}  good={35} ok={20} unit="%" desc="Industry avg 20–40%" />
              <BenchmarkCard label="Click rate" value={clickRate} good={5}  ok={2}  unit="%" desc="Industry avg 2–5%" />
              <BenchmarkCard label="Reply rate" value={replyRate} good={5}  ok={2}  unit="%" desc="Good cold email 3–8%" />
            </div>
          )}
        </div>
      )}

      {/* AUDIENCE TAB */}
      {activeTab === 'audience' && (
        <div className="space-y-4">
          {/* Summary strip */}
          <div className="grid grid-cols-5 gap-3">
            <AudienceStat label="Total" value={totalContacts} color="#94A3B8" />
            <AudienceStat label="Active" value={activeContacts} color="#6366F1" />
            <AudienceStat label="Completed" value={completedContacts} color="#10B981" />
            <AudienceStat label="Bounced" value={bouncedContacts} color="#EF4444" />
            <AudienceStat label="Unsubscribed" value={unsubContacts} color="#F59E0B" />
          </div>

          {/* Pipeline state (from campaign-contacts) */}
          {pipeline && pipeline.data && pipeline.data.length > 0 && (
            <div className="panel p-4">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-3">Contact pipeline</h3>
              <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Contact</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Status</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Progress</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Next send</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipeline.data.slice(0, 50).map((cc: any, i: number) => {
                      const totalSteps = campaign.steps?.length || 0;
                      const currentStep = (cc.current_step_order ?? 0) + 1;
                      const pct = totalSteps > 0 ? Math.min(100, Math.round((currentStep / totalSteps) * 100)) : 0;
                      const fullName = [cc.contact?.first_name, cc.contact?.last_name].filter(Boolean).join(' ');
                      return (
                        <tr key={cc.id} className={cn('hover:bg-[var(--bg-hover)] transition-colors', i < pipeline.data.length - 1 && 'border-b border-[var(--border-subtle)]')}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <Avatar name={fullName || cc.contact?.email || '?'} email={cc.contact?.email} size="sm" />
                              <div className="min-w-0">
                                <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{fullName || '—'}</p>
                                {cc.contact?.email && <p className="text-[10.5px] text-[var(--text-tertiary)] truncate">{cc.contact.email}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5"><StatusBadge status={cc.status} type="contact" /></td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2 min-w-[110px]">
                              <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                                <div className="h-full rounded-full bg-gradient-to-r from-[#6366F1] to-[#8B5CF6]" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10.5px] tabular text-[var(--text-tertiary)]">{currentStep}/{totalSteps}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            {cc.next_send_at ? (
                              <span className="text-[11.5px] text-[var(--text-secondary)]" title={formatDateTime(cc.next_send_at)}>
                                {formatTimeUntil(cc.next_send_at)}
                              </span>
                            ) : <span className="text-[11.5px] text-[var(--text-tertiary)]">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-[11px] text-rose-500 max-w-[200px] truncate">{cc.error_message || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Engagement table (from analytics contacts) */}
          {audienceRows.length > 0 && (
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Engagement per contact</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
                    <input
                      value={audienceSearch}
                      onChange={(e) => setAudienceSearch(e.target.value)}
                      placeholder="Search…"
                      className="h-7 pl-8 pr-3 text-[12px] rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[rgba(91,91,245,0.4)] transition-colors w-40"
                    />
                  </div>
                  <select
                    value={audienceSort}
                    onChange={(e) => setAudienceSort(e.target.value as any)}
                    className="h-7 px-2 pr-6 text-[11px] rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] outline-none appearance-none cursor-pointer"
                  >
                    <option value="score">Sort: Score</option>
                    <option value="sent">Sort: Sent</option>
                    <option value="name">Sort: Name</option>
                  </select>
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                <table className="w-full">
                  <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Contact</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Engagement</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Sent</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Opens</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Clicks</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Replied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAudience.slice(0, 100).map((c, i) => (
                      <tr key={c.contact_id} className={cn('hover:bg-[var(--bg-hover)] transition-colors', i < filteredAudience.length - 1 && 'border-b border-[var(--border-subtle)]')}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={c.name || c.email} email={c.email} size="sm" />
                            <div className="min-w-0">
                              {c.name && <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{c.name}</p>}
                              <p className="text-[11px] text-[var(--text-tertiary)] truncate">{c.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2 min-w-[100px]">
                            <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${c.score}%`, background: c.score >= 70 ? '#10B981' : c.score >= 40 ? '#F59E0B' : '#94A3B8' }}
                              />
                            </div>
                            <span className="text-[11px] font-semibold tabular text-[var(--text-secondary)] w-6 text-right">{c.score}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-[12px] tabular text-[var(--text-secondary)]">{c.sent}</td>
                        <td className="px-3 py-2.5 text-right text-[12px] tabular text-[var(--text-secondary)]">{c.opened}</td>
                        <td className="px-3 py-2.5 text-right text-[12px] tabular text-[var(--text-secondary)]">{c.clicked}</td>
                        <td className="px-3 py-2.5 text-center">
                          {c.replied
                            ? <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/10 mx-auto"><CheckCircle className="h-3 w-3 text-emerald-500" /></span>
                            : <span className="text-[var(--text-tertiary)]">—</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredAudience.length === 0 && (
                <p className="text-center py-8 text-[12px] text-[var(--text-tertiary)]">No contacts match your search.</p>
              )}
            </div>
          )}

          {audienceRows.length === 0 && (!pipeline || !pipeline.data?.length) && (
            <div className="panel p-12 text-center">
              <Users className="h-10 w-10 mx-auto text-[var(--text-tertiary)] mb-3 opacity-40" />
              <p className="text-[13px] text-[var(--text-secondary)]">No audience data yet.</p>
            </div>
          )}
        </div>
      )}

      {/* SEQUENCE TAB */}
      {activeTab === 'sequence' && (
        <div className="space-y-2.5">
          {(!campaign.steps || campaign.steps.length === 0) ? (
            <div className="panel p-12 text-center">
              <List className="h-10 w-10 mx-auto text-[var(--text-tertiary)] mb-3 opacity-40" />
              <p className="text-[13px] text-[var(--text-secondary)]">No steps in this campaign.</p>
              {campaign.status === 'draft' && (
                <button onClick={() => navigate(`/campaigns/${id}/edit`)} className="mt-3 btn-primary text-[12px] h-7 px-3">
                  <Pencil className="h-3 w-3" /> Edit sequence
                </button>
              )}
            </div>
          ) : (
            campaign.steps.map((step: CampaignStep, index: number) => (
              <SequenceStepCard key={step.id} step={step} index={index} totalSteps={campaign.steps!.length} />
            ))
          )}
        </div>
      )}

      {/* SETTINGS TAB */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          {/* Identity */}
          <SettingsSection title="Identity" icon={Mail}>
            <div className="grid grid-cols-2 gap-3">
              <SettingBlock label="From name"   value={(campaign as any).from_name || '—'} />
              <SettingBlock label="SMTP account" value={(campaign as any).smtp_account?.name || (campaign as any).smtp_account_id || '—'} />
            </div>
          </SettingsSection>

          {/* Schedule */}
          <SettingsSection title="Schedule" icon={Clock}>
            <div className="grid grid-cols-2 gap-3">
              <SettingBlock label="Timezone"    value={campaign.timezone || '—'} />
              <SettingBlock label="Send days"   value={campaign.send_days?.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1)).join(', ') || 'Mon–Fri'} />
              <SettingBlock label="Send window" value={campaign.send_window_start ? `${campaign.send_window_start} – ${campaign.send_window_end}` : 'All day'} />
            </div>
          </SettingsSection>

          {/* Rate controls */}
          <SettingsSection title="Rate controls" icon={Zap}>
            <div className="grid grid-cols-2 gap-3">
              <SettingBlock label="Daily limit"  value={campaign.daily_limit ? `${campaign.daily_limit} emails/day` : 'Unlimited'} />
              <SettingBlock label="Delay between emails" value={`${campaign.delay_between_emails_min ?? 50}s – ${campaign.delay_between_emails_max ?? 200}s`} />
            </div>
          </SettingsSection>

          {/* Behaviour */}
          <SettingsSection title="Behaviour" icon={Shield}>
            <div className="grid grid-cols-2 gap-3">
              <SettingBlock label="Stop on reply"    value={campaign.stop_on_reply !== false ? 'Yes — stops sequence when contact replies' : 'No'} />
              <SettingBlock label="Track opens"      value={campaign.track_opens !== false ? 'Enabled' : 'Disabled'} />
              <SettingBlock label="Track clicks"     value={campaign.track_clicks !== false ? 'Enabled' : 'Disabled'} />
              <SettingBlock label="Unsubscribe link" value={campaign.include_unsubscribe ? 'Included in every email' : 'Not included'} />
            </div>
          </SettingsSection>

          {campaign.status === 'draft' && (
            <div className="flex justify-end">
              <button onClick={() => navigate(`/campaigns/${id}/edit`)} className="btn-secondary gap-1.5 text-[12px] h-8 px-3 rounded-lg">
                <Pencil className="h-3.5 w-3.5" /> Edit campaign
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────────────────── */

function HeroStat({ label, value, color, rate, rateLabel, sub, negative }: {
  label: string; value: number; color: string; rate?: number; rateLabel?: string; sub?: string; negative?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)] mb-1">{label}</div>
      <div className="text-[22px] font-bold tabular-nums tracking-[-0.02em] leading-none" style={{ color }}>
        {value.toLocaleString()}
      </div>
      {rate !== undefined && (
        <div className="mt-1 text-[10.5px] font-medium" style={{ color: negative && rate > 5 ? '#EF4444' : 'var(--text-tertiary)' }}>
          {rate}% {rateLabel}
        </div>
      )}
      {sub && <div className="mt-0.5 text-[10.5px] text-[var(--text-tertiary)]">{sub}</div>}
    </div>
  );
}

function PipelineCard({ total, completed, active, replied, bounced, unsub, pending }: {
  total: number; completed: number; active: number; replied: number; bounced: number; unsub: number; pending: number;
}) {
  if (total === 0) return null;

  const segments = [
    { label: 'Completed', count: completed, color: '#10B981' },
    { label: 'Active',    count: active,    color: '#6366F1' },
    { label: 'Replied',   count: Math.min(replied, total), color: '#3B82F6' },
    { label: 'Bounced',   count: bounced,   color: '#EF4444' },
    { label: 'Unsubscribed', count: unsub,  color: '#F59E0B' },
    { label: 'Pending',   count: pending,   color: '#334155' },
  ].filter((s) => s.count > 0);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Contact pipeline</h3>
        <span className="text-[11.5px] text-[var(--text-tertiary)]">{total.toLocaleString()} total</span>
      </div>

      <div className="flex h-2.5 w-full rounded-full overflow-hidden gap-px mb-3.5">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className="transition-all duration-500"
            style={{ width: `${(seg.count / total) * 100}%`, background: seg.color }}
            title={`${seg.label}: ${seg.count}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-x-6 gap-y-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: seg.color }} />
            <span className="text-[11px] text-[var(--text-secondary)] flex-1">{seg.label}</span>
            <span className="text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">{seg.count.toLocaleString()}</span>
            <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">({((seg.count / total) * 100).toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FunnelBar({ label, value, max, color, pct, negative, showCount, dropOff }: {
  label: string; value: number; max: number; color: string; pct: number; negative?: boolean; showCount?: boolean; dropOff?: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</span>
        <div className="flex items-center gap-2">
          {showCount && <span className="text-[11.5px] tabular text-[var(--text-tertiary)]">{value.toLocaleString()}</span>}
          <span className="text-[12px] font-semibold tabular-nums" style={{ color: negative && pct > 5 ? '#EF4444' : 'var(--text-primary)' }}>{pct.toFixed(1)}%</span>
          {dropOff !== undefined && dropOff > 0 && (
            <span className="text-[10px] text-[var(--text-tertiary)]">↓ {dropOff.toFixed(0)}%</span>
          )}
        </div>
      </div>
      <div className="h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

function BenchmarkCard({ label, value, good, ok, unit, desc }: {
  label: string; value: number; good: number; ok: number; unit: string; desc: string;
}) {
  const tier = value >= good ? 'good' : value >= ok ? 'ok' : 'poor';
  const tierCfg = {
    good: { label: 'Above average', color: '#10B981', bg: 'bg-emerald-500/8 border-emerald-500/20' },
    ok:   { label: 'Average',       color: '#F59E0B', bg: 'bg-amber-500/8 border-amber-500/20' },
    poor: { label: 'Below average', color: '#EF4444', bg: 'bg-red-500/8 border-red-500/20' },
  }[tier];

  return (
    <div className={cn('panel p-4 border', tierCfg.bg)}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">{label}</div>
          <div className="text-[24px] font-bold tabular-nums tracking-[-0.02em] mt-0.5" style={{ color: tierCfg.color }}>
            {value}{unit}
          </div>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: tierCfg.color, background: `${tierCfg.color}18` }}>
          {tierCfg.label}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden mb-2">
        <div className="h-full rounded-full" style={{ width: `${Math.min((value / (good * 2)) * 100, 100)}%`, background: tierCfg.color }} />
      </div>
      <p className="text-[10.5px] text-[var(--text-tertiary)]">{desc}</p>
    </div>
  );
}

function AudienceStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="panel p-3 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)] mb-1">{label}</div>
      <div className="text-[20px] font-bold tabular-nums tracking-[-0.02em]" style={{ color }}>{value.toLocaleString()}</div>
    </div>
  );
}

function SettingRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)] mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[10.5px] text-[var(--text-tertiary)]">{label}</div>
        <div className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{value}</div>
      </div>
    </div>
  );
}

function SettingsSection({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[var(--border-subtle)]">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--indigo-subtle)]">
          <Icon className="h-3.5 w-3.5 text-[var(--indigo)]" />
        </span>
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function SettingBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
      <div className="text-[10.5px] text-[var(--text-tertiary)] mb-0.5">{label}</div>
      <div className="text-[12.5px] font-medium text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function formatDelay(days: number, hours: number, minutes: number): string {
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.length > 0 ? `Wait ${parts.join(' ')}` : 'Wait (no delay set)';
}

const STEP_CFG: Record<string, { accent: string; iconColor: string; iconBg: string }> = {
  email:        { accent: 'bg-[#6366F1]',  iconColor: 'text-[#6366F1]',  iconBg: 'bg-[rgba(99,102,241,0.08)]' },
  delay:        { accent: 'bg-amber-500',   iconColor: 'text-amber-500',  iconBg: 'bg-amber-500/10' },
  condition:    { accent: 'bg-blue-500',    iconColor: 'text-blue-500',   iconBg: 'bg-blue-500/10' },
  webhook_wait: { accent: 'bg-emerald-500', iconColor: 'text-emerald-500', iconBg: 'bg-emerald-500/10' },
};

function SequenceStepCard({ step, index, totalSteps }: { step: CampaignStep; index: number; totalSteps: number }) {
  const cfg = STEP_CFG[step.step_type] || STEP_CFG.email;
  const isLast = index === totalSteps - 1;

  return (
    <div className="flex gap-3">
      {/* Timeline line */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold flex-shrink-0 ring-2 ring-[var(--border-subtle)]', cfg.iconBg, cfg.iconColor)}>
          {index + 1}
        </div>
        {!isLast && <div className="w-px flex-1 bg-[var(--border-subtle)] my-1.5 min-h-[16px]" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-2">
        <div className="panel p-3.5 relative overflow-hidden">
          <div className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full', cfg.accent)} />
          <div className="pl-2">
            {step.step_type === 'email' && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Mail className={cn('h-3.5 w-3.5 flex-shrink-0', cfg.iconColor)} />
                  <span className="text-[13px] font-semibold text-[var(--text-primary)]">{step.subject || 'Untitled email'}</span>
                  {step.subject_b && (
                    <span className="inline-flex items-center px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold bg-[rgba(99,102,241,0.1)] text-[var(--indigo)]">A/B</span>
                  )}
                  {step.skip_if_replied && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-medium bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
                      Skip if replied
                    </span>
                  )}
                </div>
                {step.body_text && (
                  <p className="mt-1.5 line-clamp-2 text-[11.5px] text-[var(--text-secondary)] leading-relaxed">{step.body_text}</p>
                )}
                {step.subject_b && (
                  <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
                    <span className="text-[10.5px] text-[var(--text-tertiary)] mr-1.5">Variant B:</span>
                    <span className="text-[12px] font-medium text-[var(--text-secondary)]">{step.subject_b}</span>
                  </div>
                )}
              </>
            )}
            {step.step_type === 'delay' && (
              <div className="flex items-center gap-2">
                <Clock className={cn('h-3.5 w-3.5', cfg.iconColor)} />
                <span className="text-[13px] font-medium text-[var(--text-primary)]">
                  {formatDelay(step.delay_days, step.delay_hours, step.delay_minutes)}
                </span>
              </div>
            )}
            {step.step_type === 'condition' && (
              <div className="flex items-center gap-2">
                <GitBranch className={cn('h-3.5 w-3.5', cfg.iconColor)} />
                <span className="text-[13px] font-medium text-[var(--text-primary)]">
                  If {step.condition_field || 'condition'} {step.condition_operator?.replace(/_/g, ' ')}{step.condition_value ? ` "${step.condition_value}"` : ''}
                </span>
              </div>
            )}
            {step.step_type === 'webhook_wait' && (
              <div className="flex items-center gap-2">
                <Webhook className={cn('h-3.5 w-3.5', cfg.iconColor)} />
                <span className="text-[13px] font-medium text-[var(--text-primary)]">Wait for webhook</span>
                {step.webhook_event && (
                  <code className="text-[11px] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded font-mono text-[var(--text-secondary)]">{step.webhook_event}</code>
                )}
                {step.webhook_timeout_hours && (
                  <span className="text-[11px] text-[var(--text-tertiary)]">({step.webhook_timeout_hours}h timeout)</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
