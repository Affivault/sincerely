import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { campaignsApi } from '../../api/campaigns.api';
import { campaignFoldersApi, type CampaignFolder } from '../../api/campaign-folders.api';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/shared/EmptyState';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { PageHeader } from '../../components/shared/PageHeader';
import { PageTabs } from '../../components/shared/Toolbar';
import { formatDate, cn } from '../../lib/utils';
import {
  Megaphone, Plus, Send, Mail, MousePointerClick, MessageSquare, Copy,
  Folder, FolderPlus, FolderOpen, X, Pencil, Trash2, MoreVertical,
  BarChart3, Layers, Play, Pause, Eye, Search, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CampaignWithStats } from '@lemlist/shared';

const STATUS_TABS = [
  { label: 'All',       value: '' },
  { label: 'Draft',     value: 'draft' },
  { label: 'Running',   value: 'running' },
  { label: 'Paused',    value: 'paused' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

const FOLDER_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#EF4444', '#84CC16'];

export function CampaignsListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFolderId, setActiveFolderId] = useState<string | null | 'all'>('all'); // 'all', null = uncategorised, or folder id
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<CampaignFolder | null>(null);
  const [folderAnalyticsId, setFolderAnalyticsId] = useState<string | null>(null);
  const [contextMenuFor, setContextMenuFor] = useState<{ id: string; x: number; y: number } | null>(null);

  const { data: campaignsResp, isLoading } = useQuery({
    queryKey: ['campaigns', 'all', statusFilter],
    queryFn: () => campaignsApi.list({ page: 1, limit: 500, status: statusFilter || undefined }),
    // Auto-refresh every 30 s when viewing running campaigns so stats stay live
    refetchInterval: (query) => {
      const campaigns = (query.state.data as any)?.data ?? [];
      const hasRunning = campaigns.some((c: any) => c.status === 'running');
      return hasRunning ? 30_000 : false;
    },
  });

  const { data: folders = [] } = useQuery({
    queryKey: ['campaign-folders'],
    queryFn: campaignFoldersApi.list,
  });

  const launchMut  = useMutation({ mutationFn: campaignsApi.launch, onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Launched'); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed') });
  const pauseMut   = useMutation({ mutationFn: campaignsApi.pause,  onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Paused'); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to pause') });
  const resumeMut  = useMutation({ mutationFn: campaignsApi.resume, onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Resumed'); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to resume') });
  const deleteMut  = useMutation({ mutationFn: campaignsApi.delete, onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Deleted'); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to delete') });
  const cloneMut   = useMutation({ mutationFn: campaignsApi.clone,  onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Cloned'); navigate(`/campaigns/${c.id}`); } });

  const moveMut = useMutation({
    mutationFn: ({ campaignId, folderId }: { campaignId: string; folderId: string | null }) => campaignFoldersApi.moveCampaign(campaignId, folderId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); qc.invalidateQueries({ queryKey: ['campaign-folders'] }); toast.success('Moved'); setContextMenuFor(null); },
    onError: () => toast.error('Failed to move'),
  });

  const allCampaigns: CampaignWithStats[] = (campaignsResp?.data || []) as any;

  // Filter campaigns by selected folder and search query
  const visibleCampaigns = useMemo(() => {
    let result = allCampaigns;
    if (activeFolderId !== 'all') {
      result = activeFolderId === null
        ? result.filter((c: any) => !c.folder_id)
        : result.filter((c: any) => c.folder_id === activeFolderId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c: any) => c.name?.toLowerCase().includes(q));
    }
    return result;
  }, [allCampaigns, activeFolderId, searchQuery]);

  const activeFolder = folders.find((f) => f.id === activeFolderId);

  // Aggregate stats for current view
  const aggregateStats = useMemo(() => {
    const totals = { sent: 0, opened: 0, clicked: 0, replied: 0 };
    for (const c of visibleCampaigns as any[]) {
      totals.sent     += c.sent_count    || 0;
      totals.opened   += c.opened_count  || 0;
      totals.clicked  += c.clicked_count || 0;
      totals.replied  += c.replied_count || 0;
    }
    return totals;
  }, [visibleCampaigns]);

  const uncategorisedCount = allCampaigns.filter((c: any) => !c.folder_id).length;

  const sentTotal = aggregateStats.sent || 0;
  const openPctAgg  = sentTotal ? (aggregateStats.opened  / sentTotal) * 100 : 0;
  const clickPctAgg = sentTotal ? (aggregateStats.clicked / sentTotal) * 100 : 0;
  const replyPctAgg = sentTotal ? (aggregateStats.replied / sentTotal) * 100 : 0;

  const statusTabs = STATUS_TABS.map((t) => ({
    value: t.value,
    label: t.label,
    count: t.value === ''
      ? visibleCampaigns.length
      : visibleCampaigns.filter((c: any) => c.status === t.value).length,
  }));

  return (
    <div onClick={() => setContextMenuFor(null)}>
      {/* ── Page header — full bleed, decorated ── */}
      <PageHeader
        decorate
        leading={
          activeFolder ? (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-subtle)]"
              style={{ background: `${activeFolder.color}14` }}
            >
              <FolderOpen className="h-4 w-4" style={{ color: activeFolder.color }} />
            </span>
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
              <Megaphone className="h-4 w-4 text-[var(--indigo)]" />
            </span>
          )
        }
        title={
          activeFolderId === 'all' ? 'All campaigns'
            : activeFolderId === null ? 'Uncategorised'
            : activeFolder?.name || 'Campaigns'
        }
        description={
          activeFolderId === 'all'
            ? 'Every outbound sequence across your workspace.'
            : activeFolderId === null
              ? 'Campaigns not yet assigned to a folder.'
              : `${visibleCampaigns.length} campaign${visibleCampaigns.length === 1 ? '' : 's'} in this folder.`
        }
        meta={
          sentTotal > 0 ? (
            <>
              <span className="tabular">{sentTotal.toLocaleString()} sent</span>
              <span className="text-[var(--text-muted)]">·</span>
              <span className="tabular">{aggregateStats.replied.toLocaleString()} replies</span>
              <span className="text-[var(--text-muted)]">·</span>
              <span className="tabular">{replyPctAgg.toFixed(1)}% reply rate</span>
            </>
          ) : (
            <span>{visibleCampaigns.length} campaign{visibleCampaigns.length === 1 ? '' : 's'}</span>
          )
        }
        actions={
          <>
            {activeFolderId && activeFolderId !== 'all' && activeFolderId !== null && (
              <Button variant="secondary" size="sm" onClick={() => setFolderAnalyticsId(activeFolderId)}>
                <BarChart3 className="h-3.5 w-3.5" /> Folder analytics
              </Button>
            )}
            <Button size="sm" onClick={() => navigate('/campaigns/new')}>
              <Plus className="h-3.5 w-3.5" /> New campaign
            </Button>
          </>
        }
      />

      {/* ── Aggregate metrics strip ── */}
      {sentTotal > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <MetricChip icon={Send}              label="Sent"    value={aggregateStats.sent}    tone="indigo" />
          <MetricChip icon={Mail}              label="Opens"   value={aggregateStats.opened}  tone="violet"  rate={openPctAgg} />
          <MetricChip icon={MousePointerClick} label="Clicks"  value={aggregateStats.clicked} tone="cyan"    rate={clickPctAgg} />
          <MetricChip icon={MessageSquare}     label="Replies" value={aggregateStats.replied} tone="emerald" rate={replyPctAgg} />
        </div>
      )}

      {/* ── Two-column body: folder rail + content ── */}
      <div className="grid grid-cols-[200px,1fr] gap-3">
        {/* Folder rail */}
        <aside className="panel-inset p-1.5 self-start sticky top-[60px] max-h-[calc(100vh-80px)] overflow-y-auto">
          <div className="px-2 pt-1 pb-1.5 flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Folders</span>
            <button
              onClick={() => { setEditingFolder(null); setFolderModalOpen(true); }}
              title="New folder"
              className="icon-btn h-6 w-6"
            >
              <FolderPlus className="h-3 w-3" />
            </button>
          </div>

          <FolderRow
            label="All"
            icon={Layers}
            count={allCampaigns.length}
            active={activeFolderId === 'all'}
            onClick={() => setActiveFolderId('all')}
            color="#5B5BF5"
          />
          <FolderRow
            label="Uncategorised"
            icon={Folder}
            count={uncategorisedCount}
            active={activeFolderId === null}
            onClick={() => setActiveFolderId(null)}
            color="#94A3B8"
          />
          {folders.length > 0 && (
            <div className="my-1 mx-2 h-px bg-[var(--border-subtle)]" />
          )}
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              label={f.name}
              icon={activeFolderId === f.id ? FolderOpen : Folder}
              count={f.campaign_count}
              active={activeFolderId === f.id}
              onClick={() => setActiveFolderId(f.id)}
              onEdit={() => { setEditingFolder(f); setFolderModalOpen(true); }}
              onAnalytics={() => setFolderAnalyticsId(f.id)}
              color={f.color}
            />
          ))}
        </aside>

        {/* Main column */}
        <main className="min-w-0">
          {/* Status tabs + search row */}
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] mb-3 pb-px">
            <PageTabs tabs={statusTabs} value={statusFilter} onChange={setStatusFilter} />
            <div className="relative mb-px">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="h-7 pl-8 pr-7 text-[12.5px] rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[rgba(91,91,245,0.4)] focus:bg-[var(--bg-surface)] transition-colors w-40"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>
          ) : visibleCampaigns.length === 0 ? (
            <div className="card p-10">
              <EmptyState
                icon={Megaphone}
                title={activeFolderId === 'all' ? 'No campaigns yet' : 'This folder is empty'}
                description={activeFolderId === 'all' ? 'Build your first outbound sequence and start reaching prospects.' : 'Move campaigns into this folder or create a new one.'}
                actionLabel="New campaign"
                onAction={() => navigate('/campaigns/new')}
              />
            </div>
          ) : (
            <div className="space-y-2">
              {visibleCampaigns.map((campaign: any) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onOpen={() => navigate(`/campaigns/${campaign.id}`)}
                  onLaunch={() => launchMut.mutate(campaign.id)}
                  onPause={()  => pauseMut.mutate(campaign.id)}
                  onResume={() => resumeMut.mutate(campaign.id)}
                  onClone={()  => cloneMut.mutate(campaign.id)}
                  onEdit={()   => navigate(`/campaigns/${campaign.id}/edit`)}
                  onDelete={() => { if (confirm('Delete this campaign?')) deleteMut.mutate(campaign.id); }}
                  onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); setContextMenuFor({ id: campaign.id, x: e.clientX, y: e.clientY }); }}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Context menu */}
      {contextMenuFor && (
        <div
          className="fixed z-50 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg shadow-xl py-1 min-w-[200px] animate-fade-in"
          style={{ top: contextMenuFor.y, left: contextMenuFor.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
            Move to folder
          </div>
          <button
            onClick={() => moveMut.mutate({ campaignId: contextMenuFor.id, folderId: null })}
            className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] flex items-center gap-2"
          >
            <Folder className="h-3.5 w-3.5" /> Uncategorised
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => moveMut.mutate({ campaignId: contextMenuFor.id, folderId: f.id })}
              className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] flex items-center gap-2"
            >
              <Folder className="h-3.5 w-3.5" style={{ color: f.color }} /> {f.name}
            </button>
          ))}
          <div className="border-t border-[var(--border-subtle)] my-1" />
          <button
            onClick={() => { cloneMut.mutate(contextMenuFor.id); setContextMenuFor(null); }}
            className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] flex items-center gap-2"
          >
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </button>
          <button
            onClick={() => { if (confirm('Delete this campaign?')) { deleteMut.mutate(contextMenuFor.id); setContextMenuFor(null); } }}
            className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 flex items-center gap-2"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}

      {/* Folder modal */}
      {folderModalOpen && (
        <FolderModal
          initial={editingFolder}
          onClose={() => { setFolderModalOpen(false); setEditingFolder(null); }}
        />
      )}

      {/* Folder analytics modal */}
      {folderAnalyticsId && (
        <FolderAnalyticsModal folderId={folderAnalyticsId} onClose={() => setFolderAnalyticsId(null)} />
      )}
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────────────────── */

function FolderRow({ label, icon: Icon, count, active, onClick, onEdit, onAnalytics, color }: {
  label: string;
  icon: any;
  count: number;
  active: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onAnalytics?: () => void;
  color: string;
}) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        className={cn(
          'w-full flex items-center gap-2 px-2 h-7 rounded-[6px] text-[12.5px] text-left transition-colors',
          active
            ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_0_0_1px_var(--border-subtle),0_1px_2px_rgba(15,15,25,0.04)] font-medium'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/60 hover:text-[var(--text-primary)]'
        )}
      >
        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: color }} />
        <Icon className="h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.75} />
        <span className="flex-1 truncate">{label}</span>
        <span className="text-[10.5px] text-[var(--text-tertiary)] tabular">{count}</span>
      </button>
      {(onEdit || onAnalytics) && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-px bg-[var(--bg-surface)] rounded shadow-[0_0_0_1px_var(--border-subtle)] px-0.5">
          {onAnalytics && (
            <button onClick={(e) => { e.stopPropagation(); onAnalytics(); }} title="Folder analytics" className="p-0.5 rounded hover:bg-[var(--bg-hover)]">
              <BarChart3 className="h-3 w-3 text-[var(--text-tertiary)] hover:text-[var(--indigo)]" />
            </button>
          )}
          {onEdit && (
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit folder" className="p-0.5 rounded hover:bg-[var(--bg-hover)]">
              <Pencil className="h-3 w-3 text-[var(--text-tertiary)] hover:text-[var(--indigo)]" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const METRIC_TONES: Record<string, { bg: string; text: string; ring: string }> = {
  indigo:  { bg: 'bg-[rgba(91,91,245,0.08)]',  text: 'text-[#5B5BF5]',   ring: 'ring-[rgba(91,91,245,0.18)]' },
  violet:  { bg: 'bg-violet-500/8',             text: 'text-violet-600',  ring: 'ring-violet-500/15' },
  cyan:    { bg: 'bg-cyan-500/8',               text: 'text-cyan-600',    ring: 'ring-cyan-500/15' },
  emerald: { bg: 'bg-emerald-500/8',            text: 'text-emerald-600', ring: 'ring-emerald-500/15' },
};

function MetricChip({ icon: Icon, label, value, rate, tone = 'indigo' }: {
  icon: any; label: string; value: number; rate?: number; tone?: string;
}) {
  const t = METRIC_TONES[tone] || METRIC_TONES.indigo;
  return (
    <div className="surface px-3 py-2.5 transition-all hover:shadow-[var(--shadow-md)]">
      <div className="flex items-center gap-2 mb-1">
        <span className={cn('flex h-5 w-5 items-center justify-center rounded-[5px] ring-1', t.bg, t.ring)}>
          <Icon className={cn('h-3 w-3', t.text)} strokeWidth={2.25} />
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)] flex-1">{label}</span>
        {rate !== undefined && (
          <span className="text-[10.5px] tabular text-[var(--text-tertiary)] font-medium">{rate.toFixed(1)}%</span>
        )}
      </div>
      <div className="text-[18px] font-semibold text-[var(--text-primary)] tabular tracking-[-0.015em] leading-tight">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-slate-400',
  running: 'bg-emerald-500 animate-pulse',
  paused: 'bg-amber-500',
  completed: 'bg-indigo-500',
  cancelled: 'bg-rose-500',
  scheduled: 'bg-blue-500',
};

function CampaignCard({ campaign, onOpen, onLaunch, onPause, onResume, onClone, onEdit, onDelete, onContextMenu }: any) {
  const total = campaign.sent_count || 0;
  const openPct  = total ? (campaign.opened_count  / total) * 100 : 0;
  const clickPct = total ? (campaign.clicked_count / total) * 100 : 0;
  const replyPct = total ? (campaign.replied_count / total) * 100 : 0;

  // Pipeline progress (sent vs total contacts)
  const totalContacts = campaign.contacts_count || campaign.total_contacts || 0;
  const pipelinePct = totalContacts ? Math.min((total / totalContacts) * 100, 100) : 0;

  return (
    <div
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className="group card card-hover relative overflow-hidden cursor-pointer p-4 transition-all"
    >
      {/* Status accent strip on the left edge */}
      <span className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full', STATUS_DOT[campaign.status] || 'bg-slate-400')} />

      <div className="grid grid-cols-[1fr,auto] gap-4 items-start">
        {/* Identity */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[14px] font-semibold text-[var(--text-primary)] truncate tracking-[-0.005em]">{campaign.name}</h3>
            <StatusBadge status={campaign.status} type="campaign" />
          </div>
          <p className="text-[11.5px] text-[var(--text-tertiary)] truncate">
            {campaign.steps_count || 0} steps
            <span className="mx-1.5 text-[var(--text-muted)]">·</span>
            {totalContacts.toLocaleString()} contacts
            <span className="mx-1.5 text-[var(--text-muted)]">·</span>
            Created {formatDate(campaign.created_at)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {campaign.status === 'draft' && (
            <Button size="sm" onClick={onLaunch}>
              <Play className="h-3 w-3" /> Launch
            </Button>
          )}
          {campaign.status === 'running' && (
            <Button size="sm" variant="secondary" onClick={onPause}>
              <Pause className="h-3 w-3" /> Pause
            </Button>
          )}
          {campaign.status === 'paused' && (
            <Button size="sm" onClick={onResume}>
              <Play className="h-3 w-3" /> Resume
            </Button>
          )}
          <button onClick={onEdit} title="Edit" className="icon-btn">
            <Pencil className="h-3 w-3" />
          </button>
          <button onClick={onClone} title="Duplicate" className="icon-btn">
            <Copy className="h-3 w-3" />
          </button>
          {(campaign.status === 'draft' || campaign.status === 'completed' || campaign.status === 'cancelled') && (
            <button onClick={onDelete} title="Delete" className="icon-btn hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Body — rich metrics grid */}
      {total > 0 ? (
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
          {/* Primary metrics row */}
          <div className="grid grid-cols-8 gap-x-3 gap-y-1.5 mb-2">
            <CardMetric color="#5B5BF5" label="Sent"    value={campaign.sent_count}    pct={100}      hidePctBar />
            <CardMetric color="#3B82F6" label="Open %"  value={campaign.opened_count}  pct={openPct} />
            <CardMetric color="#06B6D4" label="Click %"  value={campaign.clicked_count} pct={clickPct} />
            <CardMetric color="#10B981" label="Reply %"  value={campaign.replied_count} pct={replyPct} />
            <CardMetric color="#EF4444" label="Bounce %"  value={campaign.bounced_count || 0} pct={total ? ((campaign.bounced_count || 0) / total) * 100 : 0} negative />
            <CardMetric color="#94A3B8" label="Contacts" value={totalContacts}          pct={pipelinePct} hidePctBar />
            <CardMetric color="#8B5CF6" label="Steps"   value={campaign.steps_count || 0} pct={100} hidePctBar />
            <div>
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)] mb-1">Delivered</div>
              <div className="text-[12.5px] font-semibold text-emerald-600 tabular-nums leading-tight">
                {((total - (campaign.bounced_count || 0)) / Math.max(total, 1) * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          {/* Pipeline progress bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full overflow-hidden bg-[var(--bg-elevated)]">
              <div
                className="h-full bg-gradient-to-r from-[#5B5BF5] to-[#8B5CF6] transition-all duration-500"
                style={{ width: `${Math.min(pipelinePct, 100)}%` }}
              />
            </div>
            <span className="text-[10px] tabular text-[var(--text-tertiary)] flex-shrink-0">
              {total.toLocaleString()} / {totalContacts.toLocaleString()} sent
            </span>
          </div>

          {campaign.bounced_count > 0 && (
            <div className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/8 border border-red-500/15 w-fit">
              <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />
              <span className="text-[10.5px] font-medium text-red-600">
                {campaign.bounced_count} bounce{campaign.bounced_count !== 1 ? 's' : ''} — check deliverability
              </span>
            </div>
          )}
        </div>
      ) : totalContacts > 0 ? (
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)] mb-1.5">
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {totalContacts.toLocaleString()} contacts ready · {campaign.steps_count || 0} steps
            </span>
            <span className="tabular">0% sent</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden bg-[var(--bg-elevated)]">
            <div className="h-full w-0 bg-gradient-to-r from-[#5B5BF5] to-[#8B5CF6]" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CardMetric({ color, label, value, pct, hidePctBar, negative }: {
  color: string; label: string; value: number; pct: number; hidePctBar?: boolean; negative?: boolean;
}) {
  const displayColor = negative && value > 0 ? '#EF4444' : color;
  return (
    <div>
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)] mb-1">{label}</div>
      <div className="text-[12.5px] font-semibold tabular-nums leading-tight" style={{ color: displayColor }}>
        {hidePctBar ? value.toLocaleString() : `${pct.toFixed(1)}%`}
      </div>
      {!hidePctBar && (
        <div className="mt-1 h-[3px] rounded-full overflow-hidden bg-[var(--bg-elevated)]">
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${Math.min(pct, 100)}%`, background: displayColor }}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Folder modal ──────────────────────────────────────────────── */

function FolderModal({ initial, onClose }: { initial: CampaignFolder | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || FOLDER_COLORS[0]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (initial) return campaignFoldersApi.update(initial.id, { name: name.trim(), color });
      return campaignFoldersApi.create({ name: name.trim(), color });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaign-folders'] }); toast.success(initial ? 'Folder updated' : 'Folder created'); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const deleteMut = useMutation({
    mutationFn: () => campaignFoldersApi.delete(initial!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaign-folders'] }); qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Folder deleted'); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{initial ? 'Edit folder' : 'New folder'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)]"><X className="h-4 w-4 text-[var(--text-tertiary)]" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp campaigns" className="input-field" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Colour</label>
            <div className="flex gap-2 flex-wrap">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{ background: c }}
                  className={cn('w-7 h-7 rounded-full transition-all', color === c ? 'ring-2 ring-offset-2 ring-offset-[var(--bg-surface)]' : 'opacity-70 hover:opacity-100')}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
          {initial ? (
            <button
              onClick={() => { if (confirm(`Delete folder "${initial.name}"? Campaigns inside will not be deleted.`)) deleteMut.mutate(); }}
              className="text-xs text-red-500 hover:underline"
            >
              Delete folder
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={() => saveMut.mutate()} disabled={!name.trim() || saveMut.isPending} className="btn-primary">
              {saveMut.isPending ? 'Saving...' : (initial ? 'Save' : 'Create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Folder analytics modal ───────────────────────────────────── */

function FolderAnalyticsModal({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['campaign-folder-analytics', folderId],
    queryFn: () => campaignFoldersApi.analytics(folderId),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#6366F1]" />
            {data?.folder.name || 'Folder analytics'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)]"><X className="h-4 w-4 text-[var(--text-tertiary)]" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <Spinner size="md" />
          ) : !data || data.campaigns.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-secondary)]">
              <Megaphone className="h-10 w-10 mx-auto text-[var(--text-tertiary)] mb-2" />
              <p className="text-sm">No campaigns in this folder yet.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3 mb-5">
                <MetricChip icon={Send}              label="Sent"    value={data.totals.sent}    tone="indigo" />
                <MetricChip icon={Mail}              label="Opened"  value={data.totals.opened}  tone="violet"  rate={data.totals.sent ? (data.totals.opened/data.totals.sent*100) : 0} />
                <MetricChip icon={MousePointerClick} label="Clicked" value={data.totals.clicked} tone="cyan"    rate={data.totals.sent ? (data.totals.clicked/data.totals.sent*100) : 0} />
                <MetricChip icon={MessageSquare}     label="Replied" value={data.totals.replied} tone="emerald" rate={data.totals.sent ? (data.totals.replied/data.totals.sent*100) : 0} />
              </div>

              <div className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mb-2">By campaign</div>
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                  <tr>
                    <th className="text-left py-2 font-medium">Campaign</th>
                    <th className="text-right py-2 font-medium">Sent</th>
                    <th className="text-right py-2 font-medium">Open %</th>
                    <th className="text-right py-2 font-medium">Click %</th>
                    <th className="text-right py-2 font-medium">Reply %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c) => (
                    <tr key={c.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]">
                      <td className="py-2.5 text-[var(--text-primary)] font-medium">{c.name}</td>
                      <td className="py-2.5 text-right text-[var(--text-secondary)] tabular-nums">{c.sent.toLocaleString()}</td>
                      <td className="py-2.5 text-right text-[var(--text-secondary)] tabular-nums">{c.open_rate}%</td>
                      <td className="py-2.5 text-right text-[var(--text-secondary)] tabular-nums">{c.click_rate}%</td>
                      <td className="py-2.5 text-right text-[var(--text-secondary)] tabular-nums">{c.reply_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
