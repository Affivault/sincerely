import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { campaignsApi } from '../../api/campaigns.api';
import { campaignFoldersApi, type CampaignFolder } from '../../api/campaign-folders.api';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/shared/EmptyState';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatDate, cn } from '../../lib/utils';
import {
  Megaphone, Plus, Send, Mail, MousePointerClick, MessageSquare, Copy,
  Folder, FolderPlus, FolderOpen, X, Pencil, Trash2, MoreVertical,
  BarChart3, Inbox, Search,
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
  });

  const { data: folders = [] } = useQuery({
    queryKey: ['campaign-folders'],
    queryFn: campaignFoldersApi.list,
  });

  const launchMut  = useMutation({ mutationFn: campaignsApi.launch, onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Launched'); }, onError: (e: any) => toast.error(e.response?.data?.error || 'Failed') });
  const pauseMut   = useMutation({ mutationFn: campaignsApi.pause,  onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Paused'); } });
  const resumeMut  = useMutation({ mutationFn: campaignsApi.resume, onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Resumed'); } });
  const deleteMut  = useMutation({ mutationFn: campaignsApi.delete, onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Deleted'); } });
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

  return (
    <div className="flex h-[calc(100vh-3.5rem)]" onClick={() => setContextMenuFor(null)}>
      {/* ── Left sidebar: folders ───────────────────────────────────── */}
      <aside className="w-60 flex-shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Folders</span>
          <button onClick={() => { setEditingFolder(null); setFolderModalOpen(true); }} title="New folder" className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[#6366F1]">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <FolderItem
            label="All campaigns"
            icon={Inbox}
            count={allCampaigns.length}
            active={activeFolderId === 'all'}
            onClick={() => setActiveFolderId('all')}
            color="#6366F1"
          />
          <FolderItem
            label="Uncategorised"
            icon={Folder}
            count={uncategorisedCount}
            active={activeFolderId === null}
            onClick={() => setActiveFolderId(null)}
            color="#94A3B8"
          />
          <div className="my-2 mx-3 border-t border-[var(--border-subtle)]" />
          {folders.map((f) => (
            <FolderItem
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
        </div>
      </aside>

      {/* ── Main: campaigns list ───────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
              {activeFolder && <span className="w-3 h-3 rounded-sm" style={{ background: activeFolder.color }} />}
              {activeFolderId === 'all' ? 'All campaigns' : activeFolderId === null ? 'Uncategorised' : activeFolder?.name}
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {visibleCampaigns.length} campaign{visibleCampaigns.length === 1 ? '' : 's'}
              {aggregateStats.sent > 0 && ` · ${aggregateStats.sent.toLocaleString()} sent · ${aggregateStats.replied.toLocaleString()} replies`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeFolderId && activeFolderId !== 'all' && activeFolderId !== null && (
              <button onClick={() => setFolderAnalyticsId(activeFolderId)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]">
                <BarChart3 className="h-3.5 w-3.5" /> Folder analytics
              </button>
            )}
            <button onClick={() => navigate('/campaigns/new')} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--indigo)] text-white text-[13px] font-medium hover:bg-[var(--indigo-hover)] transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(67,56,202,0.35)]">
              <Plus className="h-4 w-4" /> New Campaign
            </button>
          </div>
        </div>

        {/* Aggregate stat row (folder view) */}
        {aggregateStats.sent > 0 && (
          <div className="grid grid-cols-4 gap-3 px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40">
            <MiniStat icon={Send}              label="Sent"    value={aggregateStats.sent}     color="#6366F1" />
            <MiniStat icon={Mail}              label="Opened"  value={aggregateStats.opened}   color="#3B82F6" rate={aggregateStats.sent ? (aggregateStats.opened/aggregateStats.sent*100) : 0} />
            <MiniStat icon={MousePointerClick} label="Clicked" value={aggregateStats.clicked}  color="#8B5CF6" rate={aggregateStats.sent ? (aggregateStats.clicked/aggregateStats.sent*100) : 0} />
            <MiniStat icon={MessageSquare}     label="Replied" value={aggregateStats.replied}  color="#10B981" rate={aggregateStats.sent ? (aggregateStats.replied/aggregateStats.sent*100) : 0} />
          </div>
        )}

        {/* Status tabs + search */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-[var(--border-subtle)] flex-shrink-0">
          <div className="flex gap-1 flex-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-all',
                  statusFilter === tab.value
                    ? 'bg-[rgba(99,102,241,0.1)] text-[#6366F1]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative flex-shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search campaigns..."
              className="h-7 pl-8 pr-3 text-xs rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[#6366F1]/40 focus:bg-[var(--bg-surface)] transition-colors w-44"
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
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>
          ) : visibleCampaigns.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title={activeFolderId === 'all' ? 'No campaigns' : 'No campaigns in this folder'}
              description={activeFolderId === 'all' ? 'Create your first email campaign to start reaching out.' : 'Move campaigns into this folder, or create a new one.'}
              actionLabel="New Campaign"
              onAction={() => navigate('/campaigns/new')}
            />
          ) : (
            <div className="space-y-3 max-w-5xl">
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
        </div>
      </main>

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

function FolderItem({ label, icon: Icon, count, active, onClick, onEdit, onAnalytics, color }: {
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
          'w-full flex items-center gap-2 px-4 py-1.5 text-[13px] text-left transition-colors',
          active
            ? 'bg-[rgba(99,102,241,0.08)] text-[#6366F1] border-r-2 border-r-[#6366F1]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        )}
      >
        <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: active ? '#6366F1' : color }} />
        <span className="flex-1 truncate font-medium">{label}</span>
        <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">{count}</span>
      </button>
      {(onEdit || onAnalytics) && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--bg-surface)] rounded px-0.5">
          {onAnalytics && (
            <button onClick={(e) => { e.stopPropagation(); onAnalytics(); }} title="Analytics" className="p-0.5 rounded hover:bg-[var(--bg-hover)]">
              <BarChart3 className="h-3 w-3 text-[var(--text-tertiary)]" />
            </button>
          )}
          {onEdit && (
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit" className="p-0.5 rounded hover:bg-[var(--bg-hover)]">
              <Pencil className="h-3 w-3 text-[var(--text-tertiary)]" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, color, rate }: { icon: any; label: string; value: number; color: string; rate?: number }) {
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: `${color}15` }}>
          <Icon className="h-3.5 w-3.5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{label}</div>
          <div className="text-sm font-bold text-[var(--text-primary)] flex items-baseline gap-1.5">
            {value.toLocaleString()}
            {rate !== undefined && <span className="text-[10px] font-medium text-[var(--text-tertiary)]">{rate.toFixed(1)}%</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CampaignCard({ campaign, onOpen, onLaunch, onPause, onResume, onClone, onEdit, onDelete, onContextMenu }: any) {
  const total = campaign.sent_count || 0;
  const openPct  = total ? (campaign.opened_count  / total) * 100 : 0;
  const clickPct = total ? (campaign.clicked_count / total) * 100 : 0;
  const replyPct = total ? (campaign.replied_count / total) * 100 : 0;

  return (
    <div
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className={cn(
        'cursor-pointer rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[#6366F1]/30 hover:shadow-md group',
        campaign.status === 'draft'     && 'border-l-[3px] border-l-slate-400',
        campaign.status === 'running'   && 'border-l-[3px] border-l-[#6366F1]',
        campaign.status === 'paused'    && 'border-l-[3px] border-l-amber-500',
        campaign.status === 'completed' && 'border-l-[3px] border-l-emerald-500',
        campaign.status === 'cancelled' && 'border-l-[3px] border-l-red-500',
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-semibold text-[var(--text-primary)] truncate">{campaign.name}</h3>
            <StatusBadge status={campaign.status} type="campaign" />
          </div>
          <p className="text-xs text-[var(--text-tertiary)]">
            {campaign.steps_count} steps · {campaign.contacts_count} contacts · Created {formatDate(campaign.created_at)}
          </p>
        </div>
        <div className="flex gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {campaign.status === 'draft' && (
            <>
              <button onClick={onLaunch} className="px-3 py-1.5 rounded-lg bg-[#6366F1] text-white text-xs font-medium hover:opacity-90">Launch</button>
              <IconBtn icon={Pencil} onClick={onEdit} title="Edit" />
            </>
          )}
          {campaign.status === 'running' && (
            <button onClick={onPause} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:opacity-90">Pause</button>
          )}
          {campaign.status === 'paused' && (
            <button onClick={onResume} className="px-3 py-1.5 rounded-lg bg-[#6366F1] text-white text-xs font-medium hover:opacity-90">Resume</button>
          )}
          <IconBtn icon={Copy} onClick={onClone} title="Clone" />
          {(campaign.status === 'draft' || campaign.status === 'completed' || campaign.status === 'cancelled') && (
            <IconBtn icon={Trash2} onClick={onDelete} title="Delete" danger />
          )}
        </div>
      </div>

      {/* Engagement bars */}
      {total > 0 && (
        <div className="space-y-2 mt-4 pt-4 border-t border-[var(--border-subtle)]">
          <ProgressRow icon={Send}              label="Sent"    count={campaign.sent_count}    rate={100}     color="#6366F1" />
          <ProgressRow icon={Mail}              label="Opened"  count={campaign.opened_count}  rate={openPct}  color="#3B82F6" />
          <ProgressRow icon={MousePointerClick} label="Clicked" count={campaign.clicked_count} rate={clickPct} color="#8B5CF6" />
          <ProgressRow icon={MessageSquare}     label="Replied" count={campaign.replied_count} rate={replyPct} color="#10B981" />
        </div>
      )}
    </div>
  );
}

function IconBtn({ icon: Icon, onClick, title, danger }: { icon: any; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'p-1.5 rounded-lg transition-colors',
        danger
          ? 'text-[var(--text-tertiary)] hover:bg-red-500/10 hover:text-red-500'
          : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function ProgressRow({ icon: Icon, label, count, rate, color }: { icon: any; label: string; count: number; rate: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: `${color}15` }}>
        <Icon className="h-3 w-3" style={{ color }} />
      </div>
      <span className="text-[var(--text-secondary)] w-16">{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-[var(--bg-elevated)]">
        <div className="h-full transition-all duration-500" style={{ width: `${Math.min(rate, 100)}%`, background: color }} />
      </div>
      <span className="font-medium text-[var(--text-primary)] tabular-nums w-12 text-right">{count.toLocaleString()}</span>
      <span className="text-[var(--text-tertiary)] tabular-nums w-12 text-right">{rate.toFixed(1)}%</span>
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
                <MiniStat icon={Send}              label="Sent"     value={data.totals.sent}     color="#6366F1" />
                <MiniStat icon={Mail}              label="Opened"   value={data.totals.opened}   color="#3B82F6" rate={data.totals.sent ? (data.totals.opened/data.totals.sent*100) : 0} />
                <MiniStat icon={MousePointerClick} label="Clicked"  value={data.totals.clicked}  color="#8B5CF6" rate={data.totals.sent ? (data.totals.clicked/data.totals.sent*100) : 0} />
                <MiniStat icon={MessageSquare}     label="Replied"  value={data.totals.replied}  color="#10B981" rate={data.totals.sent ? (data.totals.replied/data.totals.sent*100) : 0} />
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
