import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { suppressionApi } from '../../api/suppression.api';
import { useDebounce } from '../../hooks/useDebounce';
import { SkeletonList } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { EmptyState } from '../../components/shared/EmptyState';
import { PageHeader } from '../../components/shared/PageHeader';
import { SettingsShell } from '../../components/shared/SettingsShell';
import { Card } from '../../components/shared/Card';
import { formatDate, cn } from '../../lib/utils';
import { ShieldOff, Plus, Trash2, Upload, Search, X, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import { DEFAULT_PAGE_SIZE } from '../../lib/constants';

/* Shared select styling that matches the Input primitive */
const SELECT_CLS = 'w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] transition-[border-color,box-shadow]';

const REASON_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  unsubscribed: { label: 'Unsubscribed', color: 'text-amber-700 dark:text-amber-400 bg-amber-500/10',  dot: 'bg-amber-500'  },
  bounced:      { label: 'Bounced',      color: 'text-rose-700 dark:text-rose-400 bg-rose-500/10',    dot: 'bg-rose-500'   },
  complained:   { label: 'Complained',   color: 'text-orange-700 dark:text-orange-400 bg-orange-500/10',dot: 'bg-orange-500' },
  manual:       { label: 'Manual',       color: 'text-slate-700 dark:text-slate-400 bg-slate-500/10',  dot: 'bg-slate-500'  },
};

export function SuppressionPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
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

  // Reset to page 1 whenever the debounced search term settles on a new value
  useEffect(() => {
    setPage(1);
  }, [search]);

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
      toast.success(
        res.duplicates_collapsed > 0
          ? `${res.added} emails added (${res.duplicates_collapsed} duplicate${res.duplicates_collapsed === 1 ? '' : 's'} skipped)`
          : `${res.added} emails added to suppression list`
      );
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
    <SettingsShell>
    <div>
      <PageHeader
        className="!mx-0 !mt-0 rounded-xl border border-[var(--border-subtle)]"
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
            className="w-full h-8 pl-8 pr-7 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[rgba(91,91,245,0.4)] focus:bg-[var(--bg-surface)] focus:shadow-[0_0_0_3px_rgba(91,91,245,0.12)] outline-none transition"
          />
          {searchInput && (
            <button onClick={() => setSearchInput('')} className="absolute right-2 top-1/2 -translate-y-1/2">
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
        <SkeletonList rows={6} />
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
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-[var(--text-tertiary)]">Email</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-[var(--text-tertiary)]">Reason</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-[var(--text-tertiary)]">Notes</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-[var(--text-tertiary)]">Added</th>
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
        <Modal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          title="Add to suppression list"
          description="Suppressed addresses never receive campaign emails."
          size="md"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setShowAddModal(false)}>Cancel</Button>
              <Button type="submit" form="suppress-add-form" size="md" disabled={!addEmail || addMut.isPending}>
                {addMut.isPending ? 'Adding…' : 'Add to list'}
              </Button>
            </>
          }
        >
          <form id="suppress-add-form" onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="space-y-4">
            <Input label="Email address" type="email" autoFocus value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="user@example.com" />
            <div className="space-y-1">
              <label className="block text-[12px] font-medium text-[var(--text-secondary)]">Reason</label>
              <select value={addReason} onChange={(e) => setAddReason(e.target.value)} className={SELECT_CLS}>
                <option value="manual">Manual</option>
                <option value="unsubscribed">Unsubscribed</option>
                <option value="bounced">Bounced</option>
                <option value="complained">Complained</option>
              </select>
            </div>
            <Input label="Notes (optional)" value={addNotes} onChange={(e) => setAddNotes(e.target.value)} placeholder="Optional note…" />
          </form>
        </Modal>
      )}

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <Modal
          isOpen={showBulkModal}
          onClose={() => setShowBulkModal(false)}
          title="Bulk import"
          description="Paste addresses to suppress — one per line or comma-separated."
          size="md"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setShowBulkModal(false)}>Cancel</Button>
              <Button type="submit" form="suppress-bulk-form" size="md" disabled={!bulkText.trim() || bulkMut.isPending}>
                {bulkMut.isPending ? 'Importing…' : 'Import'}
              </Button>
            </>
          }
        >
          <form id="suppress-bulk-form" onSubmit={(e) => { e.preventDefault(); bulkMut.mutate(); }} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-[12px] font-medium text-[var(--text-secondary)]">Email addresses</label>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={8}
                autoFocus
                placeholder={"user1@example.com\nuser2@example.com\nuser3@example.com"}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-3 py-2 text-[13px] text-[var(--text-primary)] font-data placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] transition-[border-color,box-shadow] resize-none"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[12px] font-medium text-[var(--text-secondary)]">Reason</label>
              <select value={addReason} onChange={(e) => setAddReason(e.target.value)} className={SELECT_CLS}>
                <option value="manual">Manual</option>
                <option value="unsubscribed">Unsubscribed</option>
                <option value="bounced">Bounced</option>
                <option value="complained">Complained</option>
              </select>
            </div>
          </form>
        </Modal>
      )}
    </div>
    </SettingsShell>
  );
}
