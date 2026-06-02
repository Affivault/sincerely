import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { campaignsApi } from '../../api/campaigns.api';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/shared/EmptyState';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatDate, cn } from '../../lib/utils';
import { Megaphone, Plus, Send, Mail, MousePointerClick, MessageSquare, Copy, AlertTriangle, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { CampaignWithStats } from '@lemlist/shared';
import { DEFAULT_PAGE_SIZE } from '../../lib/constants';

const STATUS_TABS = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Running', value: 'running' },
  { label: 'Paused', value: 'paused' },
  { label: 'Completed', value: 'completed' },
];

export function CampaignsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  function handleSearch(value: string) {
    setSearchQuery(value);
    setPage(1);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['campaigns', page, statusFilter, searchQuery],
    queryFn: () =>
      campaignsApi.list({
        page,
        limit: DEFAULT_PAGE_SIZE,
        status: statusFilter || undefined,
        search: searchQuery || undefined,
      }),
  });

  const launchMutation = useMutation({
    mutationFn: campaignsApi.launch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign launched');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to launch'),
  });

  const pauseMutation = useMutation({
    mutationFn: campaignsApi.pause,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign paused');
    },
  });

  const resumeMutation = useMutation({
    mutationFn: campaignsApi.resume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign resumed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: campaignsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign deleted');
    },
  });

  const cloneMutation = useMutation({
    mutationFn: campaignsApi.clone,
    onSuccess: (cloned) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign cloned');
      navigate(`/campaigns/${cloned.id}`);
    },
    onError: () => toast.error('Failed to clone campaign'),
  });

  const campaigns = data?.data || [];
  const totalPages = data?.total_pages || 1;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Campaigns</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Manage your email outreach campaigns{data?.total !== undefined ? ` · ${data.total} total` : ''}</p>
        </div>
        <button onClick={() => navigate('/campaigns/new')} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-sm font-semibold hover:opacity-90 transition-all shadow-[0_2px_8px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_16px_rgba(99,102,241,0.45)]">
          <Plus className="h-4 w-4" />
          New Campaign
        </button>
      </div>

      {/* Search + Status filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search campaigns…"
            className="w-56 pl-8 pr-8 py-2 text-sm rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/40 focus:border-[#6366F1] transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 p-1 bg-[var(--bg-elevated)] rounded-2xl w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setPage(1); }}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200',
              statusFilter === tab.value
                ? 'bg-[rgba(99,102,241,0.1)] text-[#6366F1]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={searchQuery ? `No campaigns match "${searchQuery}"` : 'No campaigns'}
          description={searchQuery ? 'Try a different search term or clear the search.' : 'Create your first email campaign to start reaching out.'}
          actionLabel={searchQuery ? 'Clear search' : 'New Campaign'}
          onAction={searchQuery ? () => handleSearch('') : () => navigate('/campaigns/new')}
        />
      ) : (
        <>
          <div className="space-y-3">
            {campaigns.map((campaign: CampaignWithStats) => (
              <div
                key={campaign.id}
                className={cn(
                  "cursor-pointer rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 transition-all duration-200 hover:border-[var(--border-default)] hover:shadow-card hover:bg-gradient-to-r hover:from-transparent hover:to-[var(--bg-elevated)] group overflow-hidden",
                  campaign.status === 'draft' && 'border-l-[3px] border-l-slate-400',
                  campaign.status === 'running' && 'border-l-[3px] border-l-[#6366F1]',
                  campaign.status === 'paused' && 'border-l-[3px] border-l-amber-500',
                  campaign.status === 'completed' && 'border-l-[3px] border-l-emerald-500',
                  campaign.status === 'cancelled' && 'border-l-[3px] border-l-red-500',
                )}
                onClick={() => navigate(`/campaigns/${campaign.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--text-primary)] transition-colors">{campaign.name}</h3>
                      <StatusBadge status={campaign.status} type="campaign" />
                    </div>
                    <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                      {campaign.steps_count} steps · {campaign.contacts_count} contacts · Created {formatDate(campaign.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    {campaign.status === 'draft' && (
                      <>
                        <button className="btn-primary rounded-lg px-3 py-1.5 text-xs" onClick={() => launchMutation.mutate(campaign.id)}>
                          Launch
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/campaigns/${campaign.id}/edit`)}
                        >
                          Edit
                        </Button>
                      </>
                    )}
                    {campaign.status === 'running' && (
                      <Button variant="secondary" size="sm" onClick={() => pauseMutation.mutate(campaign.id)}>
                        Pause
                      </Button>
                    )}
                    {campaign.status === 'paused' && (
                      <button className="btn-primary rounded-lg px-3 py-1.5 text-xs" onClick={() => resumeMutation.mutate(campaign.id)}>
                        Resume
                      </button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Clone campaign"
                      onClick={() => cloneMutation.mutate(campaign.id)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {(campaign.status === 'draft' || campaign.status === 'completed' || campaign.status === 'cancelled') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm('Delete this campaign?')) deleteMutation.mutate(campaign.id);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>

                {/* Contact progression bar — running/paused/completed campaigns */}
                {campaign.contacts_count > 0 && ['running', 'paused', 'completed'].includes(campaign.status) && (() => {
                  const c = campaign as any;
                  const done = (c.completed_contacts || 0) + (c.bounced_contacts || 0) + (c.unsubscribed_contacts || 0);
                  const pct = Math.min(100, Math.round((done / campaign.contacts_count) * 100));
                  return (
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            campaign.status === 'completed'
                              ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                              : 'bg-gradient-to-r from-[#6366F1] to-[#8B5CF6]'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-[var(--text-tertiary)] tabular-nums whitespace-nowrap">
                        {done}/{campaign.contacts_count} done
                      </span>
                    </div>
                  );
                })()}

                {/* Stats row */}
                {(campaign.sent_count > 0 || campaign.status !== 'draft') && (
                  <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex gap-6 text-sm text-[var(--text-secondary)]">
                    <span className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-[rgba(99,102,241,0.1)] flex items-center justify-center">
                        <Send className="h-3.5 w-3.5 text-[#6366F1]" />
                      </div>
                      <span className="font-bold text-[var(--text-primary)]">{campaign.sent_count}</span> sent
                    </span>
                    <span className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-[rgba(59,130,246,0.1)] flex items-center justify-center">
                        <Mail className="h-3.5 w-3.5 text-blue-500" />
                      </div>
                      <span className="font-bold text-[var(--text-primary)]">{campaign.opened_count}</span> opened
                      {campaign.sent_count > 0 && (
                        <span className="text-xs text-[var(--text-tertiary)]">
                          ({Math.round((campaign.opened_count / campaign.sent_count) * 100)}%)
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-[rgba(139,92,246,0.1)] flex items-center justify-center">
                        <MousePointerClick className="h-3.5 w-3.5 text-violet-500" />
                      </div>
                      <span className="font-bold text-[var(--text-primary)]">{campaign.clicked_count}</span> clicked
                      {campaign.sent_count > 0 && (
                        <span className="text-xs text-[var(--text-tertiary)]">
                          ({Math.round((campaign.clicked_count / campaign.sent_count) * 100)}%)
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-[rgba(16,185,129,0.1)] flex items-center justify-center">
                        <MessageSquare className="h-3.5 w-3.5 text-emerald-500" />
                      </div>
                      <span className="font-bold text-[var(--text-primary)]">{campaign.replied_count}</span> replied
                      {campaign.sent_count > 0 && (
                        <span className="text-xs text-[var(--text-tertiary)]">
                          ({Math.round((campaign.replied_count / campaign.sent_count) * 100)}%)
                        </span>
                      )}
                    </span>
                    {campaign.bounced_count > 0 && (
                      <span className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-[rgba(239,68,68,0.1)] flex items-center justify-center">
                          <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                        </div>
                        <span className="font-bold text-red-500">{campaign.bounced_count}</span>
                        <span className="text-red-400">bounced</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-[var(--text-secondary)]">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
