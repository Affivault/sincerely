import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { suppressionApi } from '../../api/suppression.api';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/shared/EmptyState';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card } from '../../components/shared/Card';
import { formatDate, cn } from '../../lib/utils';
import { ShieldOff, Plus, Trash2, Upload, Search, X, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import { DEFAULT_PAGE_SIZE } from '../../lib/constants';

const REASON_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  unsubscribed: { label: 'Unsubscribed', color: 'text-amber-700 dark:text-amber-400 bg-amber-500/10',  dot: 'bg-amber-500'  },
  bounced:      { label: 'Bounced',      color: 'text-rose-700 dark:text-rose-400 bg-rose-500/10',    dot: 'bg-rose-500'   },
  complained:   { label: 'Complained',   color: 'text-orange-700 dark:text-orange-400 bg-orange-500/10',dot: 'bg-orange-500' },
  manual:       { label: 'Manual',       color: 'text-slate-700 dark:text-slate-400 bg-slate-500/10',  dot: 'bg-slate-500'  },
};

export function SuppressionPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addReason, setAddReason] = useState<string>('manual');
  const [addNotes, setAddNotes] = useState('');
  const [bulkText, setBulkText] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['suppression', page, search, reasonFilter],
    queryFn: () => suppressionApi.list({ page, limit: DEFAULT_PAGE_SIZE, search: search || undefined, reason: reasonFilter || undefined }),
  });

  const addMut = useMutation({
    mutationFn: () => suppressionApi.add(addEmail, addReason as any, addNotes || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppression'] });
      toast.success('Email added to suppression list');
      setShowAddModal(false);
      setAddEmail('');
      setAddNotes('');
    },
    onError: () => toast.error('Failed to add email'),
  });

  const bulkMut = useMutation({
    mutationFn: () => {
      const emails = bulkText.split(/[\n,;]+/).map((e) => e.trim()).filter((e) => e.includes('@'));
      return suppressionApi.addBulk(emails, addReason as any);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['suppression'] });
      toast.success(`${res.added} emails added to suppression list`);
      setShowBulkModal(false);
      setBulkText('');
    },
    onError: () => toast.error('Failed to add emails'),
  });

  const removeMut = useMutation({
    mutationFn: suppressionApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppression'] });
      toast.success('Removed from suppression list');
    },
    onError: () => toast.error('Failed to remove'),
  });

  const entries = data?.data || [];
  const totalPages = data?.total_pages || 1;

  return (
    <div>
      <PageHeader
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/8 border border-rose-500/15">
            <ShieldOff className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          </span>
        }
        title="Suppression list"
        description="Emails on this list will never receive campaign messages — bounces, unsubscribes and complaints are added automatically."
        meta={data?.total !== undefined ? <span className="tabular">{data.total.toLocaleString()} suppressed</span> : undefined}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowBulkModal(true)}>
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="h-3.5 w-3.5" /> Add email
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search emails…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(searchInput); setPage(1); } }}
            className="w-full h-8 pl-8 pr-7 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[rgba(91,91,245,0.4)] focus:bg-[var(--bg-surface)] focus:shadow-[0_0_0_3px_rgba(91,91,245,0.12)] outline-none transition"
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearch(''); }} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-[var(--text-tertiary)]" />
            </button>
          )}
        </div>
        <div className="relative">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
          <select
            value={reasonFilter}
            onChange={(e) => { setReasonFilter(e.target.value); setPage(1); }}
            className="h-8 pl-8 pr-7 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[12.5px] text-[var(--text-primary)] focus:border-[rgba(91,91,245,0.4)] focus:shadow-[0_0_0_3px_rgba(91,91,245,0.12)] outline-none transition appearance-none cursor-pointer"
          >
            <option value="">All reasons</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Bounced</option>
            <option value="complained">Complained</option>
            <option value="manual">Manual</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ShieldOff}
          title="No suppressed emails"
          description="Emails you add here will never receive campaign messages."
          actionLabel="Add Email"
          onAction={() => setShowAddModal(true)}
        />
      ) : (
        <>
          <Card padding="none" className="overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60">
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold text-[var(--text-tertiary)] uppercase tracking-[0.08em]">Email</th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold text-[var(--text-tertiary)] uppercase tracking-[0.08em]">Reason</th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold text-[var(--text-tertiary)] uppercase tracking-[0.08em]">Notes</th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold text-[var(--text-tertiary)] uppercase tracking-[0.08em]">Added</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {entries.map((entry) => {
                  const meta = REASON_LABELS[entry.reason] || REASON_LABELS.manual;
                  return (
                    <tr key={entry.id} className="hover:bg-[var(--bg-hover)] transition-colors group">
                      <td className="px-4 py-2.5 text-[12.5px] font-medium text-[var(--text-primary)] tabular">{entry.email}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-medium', meta.color)}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-[var(--text-secondary)] truncate max-w-xs">{entry.notes || <span className="text-[var(--text-muted)]">—</span>}</td>
                      <td className="px-4 py-2.5 text-[12px] text-[var(--text-secondary)] tabular">{formatDate(entry.created_at)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => { if (confirm(`Remove ${entry.email} from suppression list?`)) removeMut.mutate(entry.email); }}
                          className="icon-btn opacity-0 group-hover:opacity-100 hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3">
              <p className="text-[12px] text-[var(--text-secondary)] tabular">Page {page} of {totalPages}</p>
              <div className="flex gap-1.5">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-default)] shadow-2xl w-full max-w-md p-4">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Add to Suppression List</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Email address</label>
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#6366F1]/20 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Reason</label>
                <select
                  value={addReason}
                  onChange={(e) => setAddReason(e.target.value)}
                  className="w-full h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#6366F1]/20 outline-none"
                >
                  <option value="manual">Manual</option>
                  <option value="unsubscribed">Unsubscribed</option>
                  <option value="bounced">Bounced</option>
                  <option value="complained">Complained</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  placeholder="Optional note..."
                  className="w-full h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#6366F1]/20 outline-none"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="secondary" className="flex-1" onClick={() => setShowAddModal(false)}>Cancel</Button>
              <button
                disabled={!addEmail || addMut.isPending}
                onClick={() => addMut.mutate()}
                className="flex-1 py-2 rounded-xl bg-[var(--indigo)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {addMut.isPending ? 'Adding...' : 'Add to list'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-default)] shadow-2xl w-full max-w-md p-4">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Bulk Import</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  Email addresses (one per line, or comma-separated)
                </label>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={8}
                  placeholder={"user1@example.com\nuser2@example.com\nuser3@example.com"}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#6366F1]/20 outline-none resize-none font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Reason</label>
                <select
                  value={addReason}
                  onChange={(e) => setAddReason(e.target.value)}
                  className="w-full h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#6366F1]/20 outline-none"
                >
                  <option value="manual">Manual</option>
                  <option value="unsubscribed">Unsubscribed</option>
                  <option value="bounced">Bounced</option>
                  <option value="complained">Complained</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="secondary" className="flex-1" onClick={() => setShowBulkModal(false)}>Cancel</Button>
              <button
                disabled={!bulkText.trim() || bulkMut.isPending}
                onClick={() => bulkMut.mutate()}
                className="flex-1 py-2 rounded-xl bg-[var(--indigo)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {bulkMut.isPending ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
