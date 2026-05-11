import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi } from '../../api/campaigns.api';
import { analyticsApi } from '../../api/analytics.api';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatDate, formatDateTime } from '../../lib/utils';
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

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => campaignsApi.get(id!),
    enabled: !!id,
  });

  const { data: analytics } = useQuery({
    queryKey: ['analytics', 'campaign', id],
    queryFn: () => analyticsApi.campaign(id!),
    enabled: !!id,
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
  });

  const resumeMutation = useMutation({
    mutationFn: () => campaignsApi.resume(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign resumed');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => campaignsApi.cancel(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign cancelled');
    },
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

  const deleteMutation = useMutation({
    mutationFn: () => campaignsApi.delete(id!),
    onSuccess: () => {
      toast.success('Campaign deleted');
      navigate('/campaigns');
    },
  });

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
    <div className="space-y-6">
      <button
        onClick={() => navigate('/campaigns')}
        className="flex items-center gap-1 text-sm text-secondary hover:text-primary transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Campaigns
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-primary">{campaign.name}</h1>
            <StatusBadge status={campaign.status} type="campaign" />
          </div>
          <p className="mt-1 text-sm text-secondary">
            Created {formatDate(campaign.created_at)}
            {campaign.started_at && ` · Started ${formatDate(campaign.started_at)}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" title="Clone campaign" onClick={() => cloneMutation.mutate()}>
            <Copy className="h-4 w-4" /> Clone
          </Button>
          {campaign.status === 'draft' && (
            <>
              <Button variant="secondary" onClick={() => navigate(`/campaigns/${id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button onClick={() => launchMutation.mutate()}>
                <Play className="h-4 w-4" /> Launch
              </Button>
            </>
          )}
          {campaign.status === 'running' && (
            <>
              <Button variant="secondary" onClick={() => pauseMutation.mutate()}>
                <Pause className="h-4 w-4" /> Pause
              </Button>
              <Button variant="danger" onClick={() => cancelMutation.mutate()}>
                <Square className="h-4 w-4" /> Cancel
              </Button>
            </>
          )}
          {campaign.status === 'paused' && (
            <>
              <Button onClick={() => resumeMutation.mutate()}>
                <Play className="h-4 w-4" /> Resume
              </Button>
              <Button variant="danger" onClick={() => cancelMutation.mutate()}>
                <Square className="h-4 w-4" /> Cancel
              </Button>
            </>
          )}
          {(campaign.status === 'draft' || campaign.status === 'completed' || campaign.status === 'cancelled') && (
            <Button
              variant="danger"
              onClick={() => {
                if (confirm('Delete this campaign permanently?')) deleteMutation.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-[var(--bg-elevated)] rounded-2xl w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
              activeTab === tab.id
                ? 'bg-[rgba(99,102,241,0.1)] text-[#6366F1]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {analytics && (
            <>
              <div className="grid grid-cols-5 gap-4">
                <StatCard icon={Send} label="Sent" value={analytics.sent} colorVariant="sent" />
                <StatCard icon={Mail} label="Opened" value={analytics.opened} rate={analytics.open_rate} colorVariant="opened" />
                <StatCard icon={MousePointerClick} label="Clicked" value={analytics.clicked} rate={analytics.click_rate} colorVariant="clicked" />
                <StatCard icon={MessageSquare} label="Replied" value={analytics.replied} rate={analytics.reply_rate} colorVariant="replied" />
                <StatCard icon={AlertTriangle} label="Bounced" value={analytics.bounced} rate={analytics.bounce_rate} isNegative colorVariant="bounced" />
              </div>

              {chartData.some((d) => d.value > 0) && (
                <div className="rounded-2xl border border-subtle bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-elevated)] p-5">
                  <h3 className="mb-4 text-base font-semibold text-primary">Performance</h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="name" tick={{ fill: '#a1a1a1', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickLine={false} />
                        <YAxis tick={{ fill: '#a1a1a1', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickLine={false} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#111113', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff' }}
                          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                        />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="rounded-2xl border border-subtle bg-surface p-5 shadow-[var(--shadow-sm)]">
            <h3 className="mb-4 text-base font-semibold text-primary">Campaign Settings</h3>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                <dt className="text-tertiary">Timezone</dt>
                <dd className="font-medium text-primary">{campaign.timezone}</dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                <dt className="text-tertiary">Send Window</dt>
                <dd className="font-medium text-primary">
                  {campaign.send_window_start || '—'} – {campaign.send_window_end || '—'}
                </dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                <dt className="text-tertiary">Send Days</dt>
                <dd className="font-medium capitalize text-primary">
                  {campaign.send_days?.join(', ') || 'Weekdays'}
                </dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                <dt className="text-tertiary">Total Contacts</dt>
                <dd className="font-medium text-primary">{campaign.total_contacts}</dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                <dt className="text-tertiary">Daily Limit</dt>
                <dd className="font-medium text-primary">{campaign.daily_limit || 'Unlimited'}</dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                <dt className="text-tertiary">Delay Between Emails</dt>
                <dd className="font-medium text-primary">{campaign.delay_between_emails_min ?? campaign.delay_between_emails ?? 50}s – {campaign.delay_between_emails_max ?? campaign.delay_between_emails ?? 200}s</dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                <dt className="text-tertiary">Stop on Reply</dt>
                <dd className="font-medium text-primary">{campaign.stop_on_reply !== false ? 'Yes' : 'No'}</dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                <dt className="text-tertiary">Tracking</dt>
                <dd className="font-medium text-primary">
                  {[
                    campaign.track_opens !== false && 'Opens',
                    campaign.track_clicks !== false && 'Clicks',
                  ].filter(Boolean).join(', ') || 'None'}
                </dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                <dt className="text-tertiary">Unsubscribe Link</dt>
                <dd className="font-medium text-primary">{campaign.include_unsubscribe ? 'Included' : 'Not included'}</dd>
              </div>
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
        <div>
          {!campaignContacts?.data?.length ? (
            <p className="py-8 text-center text-sm text-tertiary">No contacts in this campaign.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-subtle text-left text-tertiary">
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Current Step</th>
                    <th className="px-4 py-3 font-medium">Next Send</th>
                    <th className="px-4 py-3 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignContacts.data.map((cc: any) => (
                    <tr key={cc.id} className="border-b border-subtle last:border-0 hover:bg-hover">
                      <td className="px-4 py-3">
                        <span className="font-medium text-primary">
                          {[cc.contact?.first_name, cc.contact?.last_name].filter(Boolean).join(' ') || cc.contact?.email || '—'}
                        </span>
                        {cc.contact?.email && (
                          <span className="ml-2 text-tertiary">{cc.contact.email}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={cc.status} type="contact" />
                      </td>
                      <td className="px-4 py-3 text-secondary">Step {cc.current_step_order + 1}</td>
                      <td className="px-4 py-3 text-secondary">
                        {cc.next_send_at ? formatDateTime(cc.next_send_at) : '—'}
                      </td>
                      <td className="px-4 py-3 text-[var(--error)]">{cc.error_message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STAT_CARD_ICON_BG: Record<string, string> = {
  sent: 'bg-gradient-to-br from-[#6366F1] to-[#8B5CF6]',
  opened: 'bg-gradient-to-br from-blue-500 to-cyan-500',
  clicked: 'bg-gradient-to-br from-violet-500 to-purple-600',
  replied: 'bg-gradient-to-br from-emerald-500 to-teal-500',
  bounced: 'bg-gradient-to-br from-red-500 to-rose-600',
};

function StatCard({ icon: Icon, label, value, rate, isNegative, colorVariant }: {
  icon: React.ElementType;
  label: string;
  value: number;
  rate?: number;
  isNegative?: boolean;
  colorVariant?: string;
}) {
  const iconBg = colorVariant ? (STAT_CARD_ICON_BG[colorVariant] || STAT_CARD_ICON_BG.sent) : (isNegative ? STAT_CARD_ICON_BG.bounced : STAT_CARD_ICON_BG.sent);
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <span className="text-sm text-secondary">{label}</span>
      </div>
      <p className="text-3xl font-bold text-primary">{value}</p>
      {rate !== undefined && rate > 0 && (
        <span className="inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-[rgba(99,102,241,0.08)] text-[#6366F1]">{rate}%</span>
      )}
      {rate !== undefined && rate === 0 && <p className="text-xs text-tertiary mt-1">0%</p>}
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

const STEP_BORDER: Record<string, string> = {
  email: 'border-l-[#6366F1]',
  delay: 'border-l-amber-500',
  condition: 'border-l-blue-500',
  webhook_wait: 'border-l-emerald-500',
};

function SequenceStepCard({ step, index }: { step: CampaignStep; index: number }) {
  const borderColor = STEP_BORDER[step.step_type] || 'border-l-zinc-500';

  return (
    <div className={`rounded-lg border border-subtle bg-surface p-4 overflow-hidden border-l-[3px] ${borderColor}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(99,102,241,0.1)] text-xs font-semibold text-[#6366F1]">
          {index + 1}
        </span>

        {step.step_type === 'email' && (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0 text-[#6366F1]" />
              <span className="font-medium text-primary truncate">{step.subject || 'Untitled Email'}</span>
              {step.subject_b && (
                <Badge variant="info">A/B</Badge>
              )}
            </div>
            {step.body_text && (
              <p className="mt-1 line-clamp-2 text-sm text-secondary">{step.body_text}</p>
            )}
          </div>
        )}

        {step.step_type === 'delay' && (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            <span className="font-medium text-primary">
              {formatDelay(step.delay_days, step.delay_hours, step.delay_minutes)}
            </span>
          </div>
        )}

        {step.step_type === 'condition' && (
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-blue-500" />
            <span className="font-medium text-primary">
              Condition: {step.condition_field || 'unknown'}
              {step.condition_operator && (
                <span className="ml-1 text-secondary font-normal">
                  {step.condition_operator.replace(/_/g, ' ')}
                  {step.condition_value ? ` "${step.condition_value}"` : ''}
                </span>
              )}
            </span>
          </div>
        )}

        {step.step_type === 'webhook_wait' && (
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-emerald-500" />
            <span className="font-medium text-primary">
              Wait for webhook
              {step.webhook_event && (
                <span className="ml-1 font-mono text-xs bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded text-secondary">
                  {step.webhook_event}
                </span>
              )}
            </span>
            {step.webhook_timeout_hours && (
              <span className="text-xs text-tertiary">(timeout: {step.webhook_timeout_hours}h)</span>
            )}
          </div>
        )}

        {step.skip_if_replied && (
          <Badge variant="info">Skip if replied</Badge>
        )}
      </div>
    </div>
  );
}
