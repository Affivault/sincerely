import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { campaignsApi } from '../../api/campaigns.api';
import { campaignFoldersApi, type CampaignFolder } from '../../api/campaign-folders.api';
import { Spinner } from '../../components/ui/Spinner';
import { Skeleton } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { EmptyState } from '../../components/shared/EmptyState';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { PageHeader } from '../../components/shared/PageHeader';
import { PageTabs } from '../../components/shared/Toolbar';
import { formatDate, formatRelativeTime, cn } from '../../lib/utils';
import {
  Megaphone, Plus, Send, Mail, MousePointerClick, MessageSquare, Copy,
  Folder, FolderPlus, FolderOpen, X, Pencil, Trash2,
  BarChart3, Layers, Play, Pause, Search, AlertTriangle, MoreVertical,
  ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight,
  Clock, Gauge, Calendar, ArrowUpRight, Ban, Users, CheckCircle2,
} from 'lucide-react';

/* Shared column template so the header and every row stay perfectly aligned */
const ROW_GRID = 'grid grid-cols-[minmax(220px,1fr)_72px_72px_72px_72px_72px_170px_96px] items-center gap-x-3';

/* Sortable columns for the campaigns table */
type SortKey = 'name' | 'sent' | 'open' | 'click' | 'reply' | 'bounce' | 'created';
function sortValue(c: any, key: SortKey): number | string {
  const sent = c.sent_count || 0;
  switch (key) {
    case 'name':   return (c.name || '').toLowerCase();
    case 'sent':   return sent;
    case 'open':   return sent ? (c.opened_count || 0) / sent : -1;
    case 'click':  return sent ? (c.clicked_count || 0) / sent : -1;
    case 'reply':  return sent ? (c.replied_count || 0) / sent : -1;
    case 'bounce': return sent ? (c.bounced_count || 0) / sent : -1;
    default:       return new Date(c.created_at || 0).getTime();
  }
}
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggingCampaignId, setDraggingCampaignId] = useState<string | null>(null);
  const [dropFolderKey, setDropFolderKey] = useState<string | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    try { const sv = localStorage.getItem('campaigns.collapsedFolders'); return new Set(sv ? JSON.parse(sv) : []); } catch { return new Set(); }
  });
  const toggleFolderCollapse = (id: string) => setCollapsedFolders((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id);
    try { localStorage.setItem('campaigns.collapsedFolders', JSON.stringify([...n])); } catch { /* ignore */ }
    return n;
  });

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

  // Column sorting
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  };

  // Filter campaigns by selected folder and search query, then sort
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
    const dir = sortDir === 'desc' ? -1 : 1;
    return [...result].sort((a: any, b: any) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [allCampaigns, activeFolderId, searchQuery, sortKey, sortDir]);

  const activeFolder = folders.find((f) => f.id === activeFolderId);

  // Drag a campaign onto a folder row to move it (mirrors the Lead Lists DnD)
  const folderDropProps = (key: string, folderId: string | null) => ({
    dropActive: dropFolderKey === key && !!draggingCampaignId,
    onDragOver: (e: React.DragEvent) => { if (draggingCampaignId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropFolderKey(key); } },
    onDragLeave: () => setDropFolderKey((k) => (k === key ? null : k)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain') || draggingCampaignId;
      if (id) moveMut.mutate({ campaignId: id, folderId });
      setDropFolderKey(null); setDraggingCampaignId(null);
    },
  });

  // Aggregate stats for current view
  const aggregateStats = useMemo(() => {
    const totals = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
    for (const c of visibleCampaigns as any[]) {
      totals.sent     += c.sent_count    || 0;
      totals.opened   += c.opened_count  || 0;
      totals.clicked  += c.clicked_count || 0;
      totals.replied  += c.replied_count || 0;
      totals.bounced  += c.bounced_count || 0;
    }
    return totals;
  }, [visibleCampaigns]);

  const uncategorisedCount = allCampaigns.filter((c: any) => !c.folder_id).length;

  const sentTotal = aggregateStats.sent || 0;
  const openPctAgg   = sentTotal ? (aggregateStats.opened  / sentTotal) * 100 : 0;
  const clickPctAgg  = sentTotal ? (aggregateStats.clicked / sentTotal) * 100 : 0;
  const replyPctAgg  = sentTotal ? (aggregateStats.replied / sentTotal) * 100 : 0;
  const bouncePctAgg = sentTotal ? (aggregateStats.bounced / sentTotal) * 100 : 0;

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
          <MetricChip icon={Send}              label="Sent"    value={aggregateStats.sent}    tone="indigo" />
          <MetricChip icon={Mail}              label="Opens"   value={aggregateStats.opened}  tone="violet"  rate={openPctAgg} />
          <MetricChip icon={MousePointerClick} label="Clicks"  value={aggregateStats.clicked} tone="cyan"    rate={clickPctAgg} />
          <MetricChip icon={MessageSquare}     label="Replies" value={aggregateStats.replied} tone="emerald" rate={replyPctAgg} />
          <MetricChip icon={Ban}               label="Bounces" value={aggregateStats.bounced} tone="rose"    rate={bouncePctAgg} />
        </div>
      )}

      {/* ── Two-column body: folder rail + content ── */}
      <div className="grid grid-cols-[200px,1fr] gap-3">
        {/* Folder rail */}
        <aside className="panel-inset p-1.5 self-start sticky top-[56px] max-h-[calc(100vh-72px)] overflow-y-auto">
          <div className="px-2 pt-1 pb-1.5 flex items-center justify-between">
            <span className="text-[10.5px] font-semibold text-[var(--text-tertiary)]">Folders</span>
            <button
              onClick={() => { setEditingFolder(null); setNewFolderParent(null); setFolderModalOpen(true); }}
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
            {...folderDropProps('uncat', null)}
          />
          {folders.length > 0 && (
            <div className="my-1 mx-2 h-px bg-[var(--border-subtle)]" />
          )}
          {folders.filter((f) => !f.parent_id).map((f) => {
            const children = folders.filter((c) => c.parent_id === f.id);
            const isOpen = !collapsedFolders.has(f.id);
            return (
              <div key={f.id}>
                <FolderRow
                  label={f.name}
                  icon={activeFolderId === f.id ? FolderOpen : Folder}
                  count={f.campaign_count}
                  active={activeFolderId === f.id}
                  onClick={() => setActiveFolderId(f.id)}
                  onEdit={() => { setNewFolderParent(null); setEditingFolder(f); setFolderModalOpen(true); }}
                  onAnalytics={() => setFolderAnalyticsId(f.id)}
                  onAddSub={() => { setEditingFolder(null); setNewFolderParent(f.id); setFolderModalOpen(true); }}
                  color={f.color}
                  collapsible={children.length > 0}
                  collapsed={!isOpen}
                  onToggleCollapse={() => toggleFolderCollapse(f.id)}
                  {...folderDropProps(f.id, f.id)}
                />
                {isOpen && children.map((c) => (
                  <FolderRow
                    key={c.id}
                    indent
                    label={c.name}
                    icon={activeFolderId === c.id ? FolderOpen : Folder}
                    count={c.campaign_count}
                    active={activeFolderId === c.id}
                    onClick={() => setActiveFolderId(c.id)}
                    onEdit={() => { setNewFolderParent(null); setEditingFolder(c); setFolderModalOpen(true); }}
                    onAnalytics={() => setFolderAnalyticsId(c.id)}
                    color={c.color}
                    {...folderDropProps(c.id, c.id)}
                  />
                ))}
              </div>
            );
          })}
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
            <div className="panel overflow-hidden">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-[15px] border-b border-[var(--border-subtle)] last:border-0">
                  <Skeleton className="h-2 w-2 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-1/3" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="h-1.5 w-28 rounded-full" />
                </div>
              ))}
            </div>
          ) : visibleCampaigns.length === 0 ? (
            <div className="panel p-10">
              <EmptyState
                icon={Megaphone}
                title={activeFolderId === 'all' ? 'No campaigns yet' : 'This folder is empty'}
                description={activeFolderId === 'all' ? 'Build your first outbound sequence and start reaching prospects.' : 'Move campaigns into this folder or create a new one.'}
                actionLabel="New campaign"
                onAction={() => navigate('/campaigns/new')}
              />
            </div>
          ) : (
            <div className="panel overflow-hidden">
              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  {/* Column header — click to sort */}
                  <div className={cn(ROW_GRID, 'px-4 h-10 border-b border-[var(--border-subtle)] bg-[var(--bg-muted)]/40')}>
                    {([
                      { key: 'name' as SortKey,   label: 'Campaign', right: false },
                      { key: 'sent' as SortKey,   label: 'Sent',     right: true },
                      { key: 'open' as SortKey,   label: 'Open',     right: true },
                      { key: 'click' as SortKey,  label: 'Click',    right: true },
                      { key: 'reply' as SortKey,  label: 'Reply',    right: true },
                      { key: 'bounce' as SortKey, label: 'Bounce',   right: true },
                    ]).map((col) => (
                      <button
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'group/sort inline-flex items-center gap-1 text-[11px] font-medium transition-colors select-none',
                          col.right && 'justify-end',
                          sortKey === col.key ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                        )}
                      >
                        {col.label}
                        {sortKey === col.key
                          ? (sortDir === 'desc' ? <ChevronDown className="h-3 w-3 text-[var(--indigo)]" /> : <ChevronUp className="h-3 w-3 text-[var(--indigo)]" />)
                          : <ChevronsUpDown className="h-3 w-3 opacity-0 group-hover/sort:opacity-60 transition-opacity" />}
                      </button>
                    ))}
                    <span className="text-[11px] font-medium text-[var(--text-tertiary)]">Pipeline</span>
                    <span />
                  </div>
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {visibleCampaigns.map((campaign: any) => (
                      <div key={campaign.id}>
                        <CampaignRow
                          campaign={campaign}
                          expanded={expandedId === campaign.id}
                          onToggleSnapshot={() => setExpandedId((id) => (id === campaign.id ? null : campaign.id))}
                          onOpen={() => navigate(`/campaigns/${campaign.id}`)}
                          onLaunch={() => launchMut.mutate(campaign.id)}
                          onPause={()  => pauseMut.mutate(campaign.id)}
                          onResume={() => resumeMut.mutate(campaign.id)}
                          onEdit={()   => navigate(`/campaigns/${campaign.id}/edit`)}
                          onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); setContextMenuFor({ id: campaign.id, x: e.clientX, y: e.clientY }); }}
                          dragging={draggingCampaignId === campaign.id}
                          onDragStart={() => setDraggingCampaignId(campaign.id)}
                          onDragEnd={() => { setDraggingCampaignId(null); setDropFolderKey(null); }}
                        />
                        {expandedId === campaign.id && (
                          <CampaignSnapshot campaign={campaign} onOpenReport={() => navigate(`/campaigns/${campaign.id}`)} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Context menu — portaled to body so it can never be offset by an
          ancestor transform, and clamped to stay fully on-screen */}
      {contextMenuFor && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setContextMenuFor(null)} />
          <div
            className="fixed z-[61] bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg shadow-xl py-1 min-w-[200px] max-h-[80vh] overflow-y-auto animate-fade-in"
            style={{
              top: Math.max(8, Math.min(contextMenuFor.y, window.innerHeight - 320)),
              left: Math.max(8, Math.min(contextMenuFor.x, window.innerWidth - 224)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
          <div className="px-3 py-1.5 text-[10px] text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
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
        </>,
        document.body
      )}

      {/* Folder modal */}
      {folderModalOpen && (
        <FolderModal
          initial={editingFolder}
          parentId={newFolderParent}
          parentName={newFolderParent ? folders.find((f) => f.id === newFolderParent)?.name : undefined}
          onClose={() => { setFolderModalOpen(false); setEditingFolder(null); setNewFolderParent(null); }}
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

function FolderRow({ label, icon: Icon, count, active, onClick, onEdit, onAnalytics, onAddSub, color, indent, collapsible, collapsed, onToggleCollapse, dropActive, onDragOver, onDragLeave, onDrop }: {
  label: string;
  icon: any;
  count: number;
  active: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onAnalytics?: () => void;
  onAddSub?: () => void;
  color: string;
  indent?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  dropActive?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={cn('group relative rounded-[6px] transition-shadow', dropActive && 'ring-1 ring-[var(--indigo)] bg-[var(--indigo-subtle)]')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        onClick={onClick}
        className={cn(
          'w-full flex items-center gap-2 px-2 h-7 rounded-[6px] text-[12.5px] text-left transition-colors',
          indent && 'pl-6',
          active
            ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_0_0_1px_var(--border-subtle),0_1px_2px_rgba(15,15,25,0.04)] font-medium'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/60 hover:text-[var(--text-primary)]'
        )}
      >
        {collapsible ? (
          <span
            onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
            className="flex-shrink-0 -ml-1 p-0.5 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <ChevronRight className={cn('h-3 w-3 text-[var(--text-tertiary)] transition-transform', !collapsed && 'rotate-90')} />
          </span>
        ) : !indent ? <span className="w-3 flex-shrink-0" /> : null}
        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: color }} />
        <Icon className="h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.75} />
        <span className="flex-1 truncate">{label}</span>
        <span className="text-[10.5px] text-[var(--text-tertiary)] tabular">{count}</span>
      </button>
      {(onEdit || onAnalytics || onAddSub) && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-px bg-[var(--bg-surface)] rounded shadow-[0_0_0_1px_var(--border-subtle)] px-0.5">
          {onAddSub && (
            <button onClick={(e) => { e.stopPropagation(); onAddSub(); }} title="New sub-folder" className="p-0.5 rounded hover:bg-[var(--bg-hover)]">
              <FolderPlus className="h-3 w-3 text-[var(--text-tertiary)] hover:text-[var(--indigo)]" />
            </button>
          )}
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

function MetricChip({ icon: Icon, label, value, rate }: {
  icon: any; label: string; value: number; rate?: number; tone?: string;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
        <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
        <span className="text-[12.5px] font-medium">{label}</span>
        {rate !== undefined && (
          <span className="ml-auto text-[12px] tabular font-semibold text-[var(--text-secondary)]">{rate.toFixed(1)}%</span>
        )}
      </div>
      <div className="mt-2.5 text-[26px] font-semibold text-[var(--text-primary)] tabular tracking-[-0.03em] leading-none">
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

function CampaignRow({ campaign, expanded, onToggleSnapshot, onOpen, onLaunch, onPause, onResume, onEdit, onContextMenu, dragging, onDragStart, onDragEnd }: any) {
  const total = campaign.sent_count || 0;
  const openPct   = total ? (campaign.opened_count  / total) * 100 : 0;
  const clickPct  = total ? (campaign.clicked_count / total) * 100 : 0;
  const replyPct  = total ? (campaign.replied_count / total) * 100 : 0;
  const totalContacts = campaign.contacts_count || campaign.total_contacts || 0;
  const pipelinePct = totalContacts ? Math.min((total / totalContacts) * 100, 100) : 0;
  const bounced   = campaign.bounced_count || 0;
  const bouncePct = total ? (bounced / total) * 100 : 0;

  const metric = (v: string, strong = false, warn = false) => (
    <span className={cn(
      'text-[13.5px] tabular text-right',
      warn ? 'font-semibold text-rose-500' : strong ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'
    )}>{v}</span>
  );

  return (
    <div
      onClick={onOpen}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', campaign.id); e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={onDragEnd}
      title="Drag to a folder to move this campaign"
      className={cn(ROW_GRID, 'group px-4 py-3.5 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors', dragging && 'opacity-50')}
    >
      {/* Identity */}
      <div className="min-w-0 flex items-center gap-2.5">
        <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', STATUS_DOT[campaign.status] || 'bg-slate-400')} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)] truncate tracking-[-0.005em]">{campaign.name}</h3>
            <StatusBadge status={campaign.status} type="campaign" />
            {bounced > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-500 flex-shrink-0" title={`${bounced} bounces — check deliverability`}>
                <AlertTriangle className="h-3 w-3" />{bounced}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)] truncate mt-0.5">
            {campaign.steps_count || 0} steps · {totalContacts.toLocaleString()} contacts · <span title={formatDate(campaign.created_at)}>{formatRelativeTime(campaign.created_at)}</span>
          </p>
        </div>
      </div>

      {/* Metrics */}
      {metric(total ? total.toLocaleString() : '—', true)}
      {metric(total ? `${openPct.toFixed(1)}%` : '—')}
      {metric(total ? `${clickPct.toFixed(1)}%` : '—')}
      {metric(total ? `${replyPct.toFixed(1)}%` : '—', true)}
      {metric(total ? `${bouncePct.toFixed(1)}%` : '—', false, bouncePct > 3)}

      {/* Pipeline */}
      <div className="min-w-0">
        <div className="h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
          <div className="h-full rounded-full bg-[var(--indigo)] transition-all duration-500" style={{ width: `${pipelinePct}%` }} />
        </div>
        <div className="text-[9.5px] tabular text-[var(--text-tertiary)] mt-1 truncate flex items-center gap-1">
          {total.toLocaleString()} / {totalContacts.toLocaleString()} sent
          {campaign.status === 'running' && (campaign.active_contacts ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-500 flex-shrink-0"
              title={`${campaign.active_contacts} contact${campaign.active_contacts === 1 ? '' : 's'} still in sequence`}
            >
              <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse inline-block" />
              {campaign.active_contacts}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onToggleSnapshot}
          title={expanded ? 'Hide snapshot' : 'Show snapshot'}
          className={cn('icon-btn transition-transform', expanded ? '!text-[var(--indigo)] !bg-[var(--indigo-subtle)] rotate-180' : '')}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {campaign.status === 'draft' && (
          <button onClick={onLaunch} title="Launch" className="icon-btn !text-[var(--indigo)] hover:!bg-[var(--indigo-subtle)]"><Play className="h-3.5 w-3.5" /></button>
        )}
        {campaign.status === 'running' && (
          <button onClick={onPause} title="Pause" className="icon-btn"><Pause className="h-3.5 w-3.5" /></button>
        )}
        {campaign.status === 'paused' && (
          <button onClick={onResume} title="Resume" className="icon-btn !text-[var(--indigo)] hover:!bg-[var(--indigo-subtle)]"><Play className="h-3.5 w-3.5" /></button>
        )}
        <button onClick={onEdit} title="Edit" className="icon-btn opacity-0 group-hover:opacity-100 transition-opacity"><Pencil className="h-3.5 w-3.5" /></button>
        <button onClick={(e) => { e.stopPropagation(); onContextMenu(e); }} title="More" className="icon-btn"><MoreVertical className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

/* ─── Per-campaign snapshot (expandable insights) ───────────────── */

const DAY_SHORT: Record<string, string> = {
  monday: 'M', tuesday: 'T', wednesday: 'W', thursday: 'T', friday: 'F', saturday: 'S', sunday: 'S',
};
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function FunnelRow({ icon: Icon, label, value, pct, tone }: {
  icon: any; label: string; value: number; pct: number; tone: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 w-[88px] flex-shrink-0">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} style={{ color: tone }} />
        <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">{label}</span>
      </div>
      <div className="flex-1 h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%`, background: tone }} />
      </div>
      <div className="w-[112px] flex-shrink-0 text-right">
        <span className="text-[12.5px] font-semibold text-[var(--text-primary)] tabular">{value.toLocaleString()}</span>
        <span className="text-[11px] text-[var(--text-tertiary)] tabular ml-1.5">{pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function CampaignSnapshot({ campaign: c, onOpenReport }: { campaign: any; onOpenReport: () => void }) {
  const sent = c.sent_count || 0;
  const pct = (n: number) => (sent ? (n / sent) * 100 : 0);
  const opened = c.opened_count || 0;
  const clicked = c.clicked_count || 0;
  const replied = c.replied_count || 0;
  const bounced = c.bounced_count || 0;
  const unsub = c.unsubscribed_contacts || 0;

  const totalContacts = c.contacts_count || c.total_contacts || 0;
  const active = c.active_contacts || 0;
  const completed = c.completed_contacts || 0;
  const remaining = Math.max(totalContacts - active - completed - bounced, 0);

  const bouncePct = sent ? (bounced / sent) * 100 : 0;
  const window = c.send_window_start && c.send_window_end ? `${c.send_window_start}–${c.send_window_end}` : 'Any time';
  const activeDays = (c.send_days || []) as string[];

  const seg = (n: number, color: string, title: string) =>
    totalContacts > 0 && n > 0 ? (
      <div className="h-full transition-all" style={{ width: `${(n / totalContacts) * 100}%`, background: color }} title={title} />
    ) : null;

  return (
    <div className="bg-[var(--bg-muted)]/40 border-t border-[var(--border-subtle)] px-4 py-4 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-8 gap-y-5">
        {/* Conversion funnel */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <span className="font-data text-[10px] font-semibold text-[var(--text-tertiary)]">Conversion funnel</span>
            {sent === 0 && <span className="text-[10.5px] text-[var(--text-tertiary)]">No emails sent yet</span>}
          </div>
          <div className="space-y-2">
            <FunnelRow icon={Send}              label="Sent"    value={sent}    pct={sent ? 100 : 0} tone="#6366F1" />
            <FunnelRow icon={Mail}              label="Opened"  value={opened}  pct={pct(opened)}    tone="#8B5CF6" />
            <FunnelRow icon={MousePointerClick} label="Clicked" value={clicked} pct={pct(clicked)}   tone="#06B6D4" />
            <FunnelRow icon={MessageSquare}     label="Replied" value={replied} pct={pct(replied)}   tone="#10B981" />
          </div>

          {/* Delivery health */}
          <div className="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-[var(--border-subtle)]">
            <div className="flex items-center gap-1.5" title="Bounce rate">
              <AlertTriangle className={cn('h-3.5 w-3.5', bouncePct > 3 ? 'text-rose-500' : 'text-[var(--text-tertiary)]')} strokeWidth={2} />
              <span className="text-[11.5px] text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text-primary)] tabular">{bounced.toLocaleString()}</span> bounced
                <span className="text-[var(--text-tertiary)] tabular ml-1">({bouncePct.toFixed(1)}%)</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5" title="Unsubscribed">
              <Ban className="h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={2} />
              <span className="text-[11.5px] text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text-primary)] tabular">{unsub.toLocaleString()}</span> unsubscribed
              </span>
            </div>
          </div>
        </div>

        {/* Audience + schedule */}
        <div className="space-y-4">
          {/* Audience progress */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-data text-[10px] font-semibold text-[var(--text-tertiary)]">Audience</span>
              <span className="text-[11px] text-[var(--text-tertiary)] tabular">{totalContacts.toLocaleString()} contacts</span>
            </div>
            <div className="flex h-2.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
              {seg(completed, '#6366F1', `${completed} completed`)}
              {seg(active, '#10B981', `${active} active`)}
              {seg(bounced, '#F43F5E', `${bounced} bounced`)}
              {seg(remaining, 'var(--border-strong)', `${remaining} not started`)}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              <LegendDot color="#10B981" icon={Users}        label="Active"    value={active} />
              <LegendDot color="#6366F1" icon={CheckCircle2} label="Completed" value={completed} />
              {remaining > 0 && <LegendDot color="var(--border-strong)" label="Pending" value={remaining} />}
            </div>
          </div>

          {/* Sending config */}
          <div>
            <span className="font-data text-[10px] font-semibold text-[var(--text-tertiary)]">Sending config</span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
              <ConfigItem icon={Layers}   label="Steps"       value={`${c.steps_count || 0}`} />
              <ConfigItem icon={Gauge}    label="Daily limit" value={c.daily_limit ? `${c.daily_limit}/day` : '—'} />
              <ConfigItem icon={Clock}    label="Window"      value={window} />
              <ConfigItem icon={Calendar} label="Timezone"    value={c.timezone || 'UTC'} />
            </div>
            <div className="flex items-center gap-1 mt-2.5">
              {DAY_ORDER.map((d) => {
                const on = activeDays.includes(d);
                return (
                  <span
                    key={d}
                    title={d.charAt(0).toUpperCase() + d.slice(1)}
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold capitalize',
                      on ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                    )}
                  >
                    {DAY_SHORT[d]}
                  </span>
                );
              })}
            </div>
          </div>

          <button
            onClick={onOpenReport}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--indigo)] hover:gap-2 transition-all"
          >
            Open full report
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, icon: Icon, label, value }: { color: string; icon?: any; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
      <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: color }} />
      {Icon && <Icon className="h-3 w-3 text-[var(--text-tertiary)]" strokeWidth={2} />}
      {label}
      <span className="font-semibold text-[var(--text-primary)] tabular">{value.toLocaleString()}</span>
    </span>
  );
}

function ConfigItem({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" strokeWidth={2} />
      <div className="min-w-0">
        <div className="text-[10px] text-[var(--text-tertiary)] leading-none">{label}</div>
        <div className="text-[11.5px] font-medium text-[var(--text-primary)] truncate mt-0.5">{value}</div>
      </div>
    </div>
  );
}

/* ─── Folder modal ──────────────────────────────────────────────── */

function FolderModal({ initial, parentId, parentName, onClose }: { initial: CampaignFolder | null; parentId?: string | null; parentName?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || FOLDER_COLORS[0]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (initial) return campaignFoldersApi.update(initial.id, { name: name.trim(), color });
      return campaignFoldersApi.create({ name: name.trim(), color, parent_id: parentId ?? null });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaign-folders'] }); toast.success(initial ? 'Folder updated' : parentId ? 'Sub-folder created' : 'Folder created'); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const deleteMut = useMutation({
    mutationFn: () => campaignFoldersApi.delete(initial!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaign-folders'] }); qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Folder deleted'); onClose(); },
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={initial ? 'Edit folder' : parentId ? 'New sub-folder' : 'New folder'}
      description={initial ? 'Rename or recolour this folder.' : parentName ? `Inside “${parentName}” — e.g. a project or quarter.` : 'Group related campaigns together.'}
      size="sm"
      footer={
        <div className="flex items-center justify-between w-full">
          {initial ? (
            <button
              onClick={() => { if (confirm(`Delete folder "${initial.name}"? Campaigns inside will not be deleted.`)) deleteMut.mutate(); }}
              className="text-[12px] font-medium text-[var(--error)] hover:underline"
            >
              Delete folder
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="campaign-folder-form" size="md" disabled={!name.trim() || saveMut.isPending}>
              {saveMut.isPending ? 'Saving…' : (initial ? 'Save changes' : 'Create folder')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="campaign-folder-form" onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-4">
        <Input label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp campaigns" />
        <div>
          <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-2">Colour</label>
          <div className="flex gap-2 flex-wrap">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{ background: c }}
                className={cn('w-7 h-7 rounded-full transition-all', color === c ? 'ring-2 ring-offset-2 ring-offset-[var(--bg-surface)] ring-[var(--text-primary)]' : 'opacity-70 hover:opacity-100')}
              />
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Folder analytics modal ───────────────────────────────────── */

function FolderAnalyticsModal({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['campaign-folder-analytics', folderId],
    queryFn: () => campaignFoldersApi.analytics(folderId),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="xl"
      title={data?.folder.name || 'Folder analytics'}
      description="Aggregate performance across every campaign in this folder."
    >
      {isLoading ? (
        <div className="py-12 flex justify-center"><Spinner size="md" /></div>
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

          <div className="font-data text-[10px] text-[var(--text-tertiary)] mb-2">By campaign</div>
          <table className="w-full text-sm">
            <thead className="font-data text-[10px] text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
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
                <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors">
                  <td className="py-2.5 text-[var(--text-primary)] font-medium">{c.name}</td>
                  <td className="py-2.5 text-right text-[var(--text-secondary)] tabular">{c.sent.toLocaleString()}</td>
                  <td className="py-2.5 text-right text-[var(--text-secondary)] tabular">{c.open_rate}%</td>
                  <td className="py-2.5 text-right text-[var(--text-secondary)] tabular">{c.click_rate}%</td>
                  <td className="py-2.5 text-right text-[var(--text-secondary)] tabular">{c.reply_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}
