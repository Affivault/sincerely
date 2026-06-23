import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi } from '../../api/campaigns.api';
import { analyticsApi } from '../../api/analytics.api';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { StatCard } from '../../components/shared/StatCard';
import { Avatar } from '../../components/shared/Avatar';
import { formatDate, formatDateTime, formatTimeUntil, cn } from '../../lib/utils';
import {
  ArrowLeft,
  Play,
  Pause,
  Square,
  Pencil,
  Trash2,
  Send,
  Mail,
  MousePointerClick,
  MessageSquare,
  AlertTriangle,
  Clock,
  Copy,
  GitBranch,
  Webhook,
  Search,
  X,
  RefreshCw,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import toast from 'react-hot-toast';
import type { CampaignStep } from '@lemlist/shared';

type TabId = 'overview' | 'sequence' | 'contacts';

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [contactSearch, setContactSearch] = useState('');
  const [contactStatusFilter, setContactStatusFilter] = useState('');

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => campaignsApi.get(id!),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 30_000 : false,
  });

  const isRunning = campaign?.status === 'running';

  const { data: analytics } = useQuery({
    queryKey: ['analytics', 'campaign', id],
    queryFn: () => analyticsApi.campaign(id!),
    enabled: !!id,
    refetchInterval: isRunning ? 30_000 : false,
  });

  const { data: campaignContacts } = useQuery({
    queryKey: ['campaign-contacts', id],
    queryFn: () => campaignsApi.getContacts(id!, { limit: 100 }),
    enabled: !!id && activeTab === 'contacts',
  });

  const launchMutation = useMutation({
    mutationFn: () => campaignsApi.launch(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign launched');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to launch'),
  });

  const pauseMutation = useMutation({
    mutationFn: () => campaignsApi.pause(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign paused');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to pause campaign'),
  });

  const resumeMutation = useMutation({
    mutationFn: () => campaignsApi.resume(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign resumed');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to resume campaign'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => campaignsApi.cancel(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign cancelled');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to cancel campaign'),
  });

  const cloneMutation = useMutation({
    mutationFn: () => campaignsApi.clone(id!),
    onSuccess: (cloned) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign cloned');
      navigate(`/campaigns/${cloned.id}`);
    },
    onError: () => toast.error('Failed to clone campaign'),
  });

  const retryErrorsMutation = useMutation({
    mutationFn: () => campaignsApi.retryErrors(id!),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['campaign-contacts', id] });
      toast.success(`Retried ${result.retried} errored contact${result.retried !== 1 ? 's' : ''}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to retry errors'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => campaignsApi.delete(id!),
    onSuccess: () => {
      toast.success('Campaign deleted');
      navigate('/campaigns');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to delete campaign'),
  });

  const filteredContacts = useMemo(() => {
    const all = campaignContacts?.data ?? [];
    return all.filter((cc: any) => {
      if (contactStatusFilter && cc.status !== contactStatusFilter) return false;
      if (contactSearch) {
        const q = contactSearch.toLowerCase();
        const name = [cc.contact?.first_name, cc.contact?.last_name].filter(Boolean).join(' ').toLowerCase();
        const email = (cc.contact?.email || '').toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      return true;
    });
  }, [campaignContacts?.data, contactSearch, contactStatusFilter]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!campaign) {
    return <div className="text-center text-secondary">Campaign not found</div>;
  }

  const chartData = analytics
    ? [
        { name: 'Sent', value: analytics.sent, fill: '#6366F1' },
        { name: 'Opened', value: analytics.opened, fill: '#818CF8' },
        { name: 'Clicked', value: analytics.clicked, fill: '#A5B4FC' },
        { name: 'Replied', value: analytics.replied, fill: '#6366F1' },
        { name: 'Bounced', value: analytics.bounced, fill: '#ef4444' },
      ]
    : [];

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'sequence', label: `Sequence (${campaign.steps?.length || 0})` },
    { id: 'contacts', label: `Contacts (${campaign.contacts_count || 0})` },
  ];

  return (
    <div className="space-y-5">
      {/* Top nav */}
      <button
        onClick={() => navigate('/campaigns')}
        className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group"
      >
        <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
        Campaigns
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-[18px] font-semibold text-[var(--text-primary)] truncate">{campaign.name}</h1>
            <StatusBadge status={campaign.status} type="campaign" />
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
            Created {formatDate(campaign.created_at)}
            {campaign.started_at && ` · Started ${formatDate(campaign.started_at)}`}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button title="Clone campaign" onClick={() => cloneMutation.mutate()} className="icon-btn">
            <Copy className="h-3.5 w-3.5" />
          </button>
          {campaign.status === 'draft' && (
            <>
              <button onClick={() => navigate(`/campaigns/${id}/edit`)} className="btn-secondary">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button onClick={() => launchMutation.mutate()} className="btn-primary">
                <Play className="h-3.5 w-3.5" /> Launch
              </button>
            </>
          )}
          {campaign.status === 'running' && (
            <>
              <button onClick={() => pauseMutation.mutate()} className="btn-secondary text-[12px] h-8 px-3 rounded-lg gap-1.5">
                <Pause className="h-3.5 w-3.5" /> Pause
              </button>
              <button onClick={() => cancelMutation.mutate()} className="btn-secondary text-[12px] h-8 px-3 rounded-lg gap-1.5 hover:text-rose-500 hover:border-rose-500/30">
                <Square className="h-3.5 w-3.5" /> Cancel
              </button>
            </>
          )}
          {campaign.status === 'paused' && (
            <>
              <button onClick={() => resumeMutation.mutate()} className="btn-primary">
                <Play className="h-3.5 w-3.5" /> Resume
              </button>
              <button onClick={() => cancelMutation.mutate()} className="btn-secondary hover:text-rose-500 hover:border-rose-500/30">
                <Square className="h-3.5 w-3.5" /> Cancel
              </button>
            </>
          )}
          {(campaign.status === 'draft' || campaign.status === 'completed' || campaign.status === 'cancelled') && (
            <button
              onClick={() => { if (confirm('Delete this campaign permanently?')) deleteMutation.mutate(); }}
              className="icon-btn hover:text-rose-500 hover:bg-rose-500/10"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs — segmented control */}
      <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-3.5 h-7 rounded-md text-[12px] font-medium transition-all',
              activeTab === tab.id
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {analytics && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatCard icon={Send} label="Sent" value={analytics.sent} accent="indigo" />
                <StatCard icon={Mail} label="Opened" value={analytics.opened} hint={`${analytics.open_rate}% open rate`} accent="violet" />
                <StatCard icon={MousePointerClick} label="Clicked" value={analytics.clicked} hint={`${analytics.click_rate}% click rate`} accent="cyan" />
                <StatCard icon={MessageSquare} label="Replied" value={analytics.replied} hint={`${analytics.reply_rate}% reply rate`} accent="emerald" />
                <StatCard icon={AlertTriangle} label="Bounced" value={analytics.bounced} hint={`${analytics.bounce_rate}% bounce rate`} accent="rose" />
              </div>

              {chartData.some((d) => d.value > 0) && (
                <div className="panel p-4">
                  <h3 className="mb-4 text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.01em]">Performance</h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="2 6" stroke="var(--border-subtle)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} dy={4} />
                        <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', color: 'var(--text-primary)', fontSize: '12px', boxShadow: 'var(--shadow-lg)' }}
                          cursor={{ fill: 'var(--bg-hover)' }}
                        />
                        <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={64} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}

          <ContactProgressCard campaign={campaign} />

          <div className="panel overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border-subtle)]">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.005em]">Campaign Settings</h3>
            </div>
            <dl className="divide-y divide-[var(--border-subtle)]">
              {[
                { label: 'Timezone', value: campaign.timezone },
                { label: 'Send Window', value: `${campaign.send_window_start || '—'} – ${campaign.send_window_end || '—'}` },
                { label: 'Send Days', value: campaign.send_days?.join(', ') || 'Weekdays' },
                { label: 'Total Contacts', value: String(campaign.total_contacts ?? 0) },
                { label: 'Daily Limit', value: String(campaign.daily_limit || 'Unlimited') },
                { label: 'Delay Between Emails', value: `${campaign.delay_between_emails_min ?? campaign.delay_between_emails ?? 50}s – ${campaign.delay_between_emails_max ?? campaign.delay_between_emails ?? 200}s` },
                { label: 'Stop on Reply', value: campaign.stop_on_reply !== false ? 'Yes' : 'No' },
                { label: 'Tracking', value: [campaign.track_opens !== false && 'Opens', campaign.track_clicks !== false && 'Clicks'].filter(Boolean).join(', ') || 'None' },
                { label: 'Unsubscribe Link', value: campaign.include_unsubscribe ? 'Included' : 'Not included' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between px-5 py-3">
                  <dt className="text-[12.5px] text-[var(--text-secondary)]">{label}</dt>
                  <dd className="text-[12.5px] font-medium text-[var(--text-primary)] text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* Sequence Tab */}
      {activeTab === 'sequence' && (
        <div className="space-y-3">
          {(!campaign.steps || campaign.steps.length === 0) ? (
            <p className="py-8 text-center text-sm text-tertiary">No steps in this campaign.</p>
          ) : (
            campaign.steps.map((step: CampaignStep, index: number) => (
              <SequenceStepCard key={step.id} step={step} index={index} />
            ))
          )}
        </div>
      )}

      {/* Contacts Tab */}
      {activeTab === 'contacts' && (
        <div className="space-y-3">
          {campaignContacts?.data?.length ? (
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search by name or email…"
                  className="w-full h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-8 pr-8 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo-subtle)] transition-all"
                />
                {contactSearch && (
                  <button onClick={() => setContactSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <select
                value={contactStatusFilter}
                onChange={(e) => setContactStatusFilter(e.target.value)}
                className="h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-[12.5px] text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo-subtle)] transition-all"
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="bounced">Bounced</option>
                <option value="unsubscribed">Unsubscribed</option>
                <option value="suppressed">Suppressed</option>
                <option value="error">Error</option>
              </select>
              <span className="text-[11.5px] text-[var(--text-tertiary)] whitespace-nowrap tabular">
                {filteredContacts.length} / {campaignContacts.data.length}
              </span>
              {campaignContacts.data.some((cc: any) => cc.status === 'error') && (
                <button
                  onClick={() => retryErrorsMutation.mutate()}
                  disabled={retryErrorsMutation.isPending}
                  className="ml-auto flex items-center gap-1.5 h-8 px-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-[12.5px] font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${retryErrorsMutation.isPending ? 'animate-spin' : ''}`} />
                  Retry Errors
                </button>
              )}
            </div>
          ) : null}

          {!campaignContacts?.data?.length ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--bg-elevated)] mb-3">
                <MessageSquare className="h-5 w-5 text-[var(--text-tertiary)]" />
              </span>
              <p className="text-[13px] text-[var(--text-secondary)]">No contacts in this campaign.</p>
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              <Search className="h-8 w-8 text-[var(--text-tertiary)] mb-3" />
              <p className="text-[13px] text-[var(--text-secondary)]">No contacts match your filter.</p>
              <button onClick={() => { setContactSearch(''); setContactStatusFilter(''); }} className="mt-2 text-[12px] text-[var(--indigo)] hover:underline">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                    <th className="px-4 py-2.5 text-left font-data text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-[0.08em]">Contact</th>
                    <th className="px-4 py-2.5 text-left font-data text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-[0.08em]">Status</th>
                    <th className="px-4 py-2.5 text-left font-data text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-[0.08em]">Progress</th>
                    <th className="px-4 py-2.5 text-left font-data text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-[0.08em]">Next Send</th>
                    <th className="px-4 py-2.5 text-left font-data text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-[0.08em]">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.map((cc: any, i: number) => {
                    const totalSteps = campaign.steps?.length || 0;
                    const currentStep = (cc.current_step_order ?? 0) + 1;
                    const progressPct = totalSteps > 0 ? Math.min(100, Math.round((currentStep / totalSteps) * 100)) : 0;
                    const fullName = [cc.contact?.first_name, cc.contact?.last_name].filter(Boolean).join(' ');
                    return (
                      <tr key={cc.id} className={cn("hover:bg-[var(--bg-hover)] transition-colors", i < filteredContacts.length - 1 && "border-b border-[var(--border-subtle)]")}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={fullName || cc.contact?.email || '?'} email={cc.contact?.email} size="sm" />
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{fullName || '—'}</p>
                              {cc.contact?.email && <p className="text-[11px] text-[var(--text-tertiary)] truncate">{cc.contact.email}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={cc.status} type="contact" />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="flex-1 h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[var(--indigo)] transition-all duration-300"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                            <span className="text-[11px] tabular text-[var(--text-secondary)] whitespace-nowrap">
                              {totalSteps > 0 ? `${currentStep}/${totalSteps}` : `Step ${currentStep}`}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {cc.next_send_at ? (
                            <span className="text-[12px] text-[var(--text-secondary)]" title={formatDateTime(cc.next_send_at)}>
                              {formatTimeUntil(cc.next_send_at)}
                            </span>
                          ) : <span className="text-[12px] text-[var(--text-tertiary)]">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-rose-500">{cc.error_message || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContactProgressCard({ campaign }: { campaign: any }) {
  const total = campaign.contacts_count || 0;
  if (total === 0) return null;

  const segments = [
    { label: 'Completed', count: campaign.completed_contacts || 0, color: 'bg-emerald-500' },
    { label: 'Active', count: campaign.active_contacts || 0, color: 'bg-[var(--indigo)]' },
    { label: 'Bounced', count: campaign.bounced_contacts || 0, color: 'bg-red-500' },
    { label: 'Unsubscribed', count: campaign.unsubscribed_contacts || 0, color: 'bg-amber-500' },
    { label: 'Suppressed', count: campaign.suppressed_contacts || 0, color: 'bg-purple-500' },
  ];

  const accounted = segments.reduce((s, seg) => s + seg.count, 0);
  const pending = Math.max(0, total - accounted);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.01em]">Contact Progress</h3>
        <span className="text-[12px] text-[var(--text-secondary)]">{total} total</span>
      </div>

      {/* Segmented progress bar */}
      <div className="flex h-3 w-full rounded-full overflow-hidden gap-px bg-[var(--bg-elevated)] mb-4">
        {segments.map((seg) =>
          seg.count > 0 ? (
            <div
              key={seg.label}
              className={`${seg.color} transition-all duration-500`}
              style={{ width: `${(seg.count / total) * 100}%` }}
              title={`${seg.label}: ${seg.count}`}
            />
          ) : null
        )}
        {pending > 0 && (
          <div
            className="bg-[var(--bg-hover)]"
            style={{ width: `${(pending / total) * 100}%` }}
            title={`Pending: ${pending}`}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${seg.color}`} />
            <span className="text-xs text-secondary">{seg.label}</span>
            <span className="text-xs font-semibold text-primary">{seg.count}</span>
          </div>
        ))}
        {pending > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--bg-hover)] border border-subtle" />
            <span className="text-xs text-secondary">Pending</span>
            <span className="text-xs font-semibold text-primary">{pending}</span>
          </div>
        )}
      </div>
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
  email:       { accent: 'bg-[var(--indigo)]',   iconColor: 'text-[var(--indigo)]',   iconBg: 'bg-[rgba(99,102,241,0.1)]'  },
  delay:       { accent: 'bg-amber-500',    iconColor: 'text-amber-500',   iconBg: 'bg-amber-500/10'            },
  condition:   { accent: 'bg-blue-500',     iconColor: 'text-blue-500',    iconBg: 'bg-blue-500/10'             },
  webhook_wait:{ accent: 'bg-emerald-500',  iconColor: 'text-emerald-500', iconBg: 'bg-emerald-500/10'          },
};

function SequenceStepCard({ step, index }: { step: CampaignStep; index: number }) {
  const cfg = STEP_CFG[step.step_type] || STEP_CFG.email;

  return (
    <div className="card card-hover relative overflow-hidden">
      <div className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full', cfg.accent)} />
      <div className="flex items-center gap-3 pl-3">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', cfg.iconBg, cfg.iconColor)}>
          {index + 1}
        </span>

        {step.step_type === 'email' && (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Mail className={cn('h-3.5 w-3.5 shrink-0', cfg.iconColor)} />
              <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{step.subject || 'Untitled Email'}</span>
              {step.subject_b && (
                <span className="inline-flex items-center px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold bg-[rgba(99,102,241,0.08)] text-[var(--indigo)]">A/B</span>
              )}
            </div>
            {step.body_text && (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--text-secondary)]">{step.body_text}</p>
            )}
          </div>
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
              Condition: {step.condition_field || 'unknown'}
              {step.condition_operator && (
                <span className="ml-1 text-[var(--text-secondary)] font-normal">
                  {step.condition_operator.replace(/_/g, ' ')}
                  {step.condition_value ? ` "${step.condition_value}"` : ''}
                </span>
              )}
            </span>
          </div>
        )}

        {step.step_type === 'webhook_wait' && (
          <div className="flex items-center gap-2">
            <Webhook className={cn('h-3.5 w-3.5', cfg.iconColor)} />
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              Wait for webhook
              {step.webhook_event && (
                <span className="ml-1 font-mono text-[11px] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded text-[var(--text-secondary)]">
                  {step.webhook_event}
                </span>
              )}
            </span>
            {step.webhook_timeout_hours && (
              <span className="text-[11px] text-[var(--text-tertiary)]">(timeout: {step.webhook_timeout_hours}h)</span>
            )}
          </div>
        )}

        {step.skip_if_replied && (
          <span className="inline-flex items-center px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold bg-[var(--bg-elevated)] text-[var(--text-secondary)] ml-auto flex-shrink-0">Skip if replied</span>
        )}
      </div>
    </div>
  );
}
