import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Bookmark, BookmarkPlus, Check, Trash2, X } from 'lucide-react';
import { sameViewConfig, type SavedView, type SavedViewConfig, type SavedViewPage } from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { Chip } from '../ui/Chip';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Saved views: a named set of filters, search, sort and tab.

   The contacts page has five ways to narrow it and somebody working a
   territory sets the same three of them every morning. A view is that
   setup with a name, one click away, kept on the server so it is there on
   every machine. Per page: the leads page and the contacts page are set up
   for different work, and a view saved on one means nothing on the other.

   The chip that matches what is on screen is shown as active, by comparing
   configs rather than remembering which chip was pressed - so changing a
   filter by hand visibly takes you out of the view, and "Update" appears.
   ═══════════════════════════════════════════════════════════════════════ */

export function SavedViewsBar({ page, current, onApply }: {
  page: SavedViewPage;
  current: SavedViewConfig;
  onApply: (config: SavedViewConfig) => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['contact-views', page];
  const { data } = useQuery({ queryKey: key, queryFn: () => contactsApi.views(page), staleTime: 60_000 });
  const views: SavedView[] = Array.isArray(data) ? data : [];
  const unavailable = data && !Array.isArray(data) ? data.unavailable : null;

  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  /** The view last applied, so "Update" knows which one it would change. */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const matching = views.find((v) => sameViewConfig(v.config, current)) ?? null;
  const selected = views.find((v) => v.id === selectedId) ?? null;
  const drifted = !!selected && !sameViewConfig(selected.config, current);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const fail = (e: any, fallback: string) => toast.error(e?.response?.data?.error || fallback);

  const create = useMutation({
    mutationFn: () => contactsApi.createView(page, name.trim(), current),
    onSuccess: (v) => { refresh(); setSelectedId(v.id); setNaming(false); setName(''); toast.success(`Saved "${v.name}"`); },
    onError: (e) => fail(e, 'Could not save the view'),
  });
  const update = useMutation({
    mutationFn: (v: SavedView) => contactsApi.updateView(v.id, { config: current }),
    onSuccess: (v) => { refresh(); toast.success(`Updated "${v.name}"`); },
    onError: (e) => fail(e, 'Could not update the view'),
  });
  const remove = useMutation({
    mutationFn: (v: SavedView) => contactsApi.deleteView(v.id),
    onSuccess: (_r, v) => { refresh(); if (selectedId === v.id) setSelectedId(null); toast.success(`Deleted "${v.name}"`); },
    onError: (e) => fail(e, 'Could not delete the view'),
  });

  const askDelete = (v: SavedView) => confirm({
    title: `Delete "${v.name}"?`,
    body: 'Only the saved view goes. The contacts it shows are not touched.',
    confirmLabel: 'Delete view',
    tone: 'danger',
  }, () => remove.mutate(v));

  if (views.length === 0 && !naming && unavailable) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-saved-views>
      <Bookmark className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" aria-hidden />
      {views.map((v) => (
        <span key={v.id} className="group/view relative inline-flex">
          <Chip
            active={matching?.id === v.id}
            onClick={() => { setSelectedId(v.id); onApply(v.config); }}
            title="Show this view"
          >
            {v.name}
          </Chip>
          <button
            type="button"
            onClick={() => askDelete(v)}
            aria-label={`Delete the view ${v.name}`}
            title="Delete view"
            className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-tertiary)] hover:text-[var(--error)] group-hover/view:inline-flex focus:inline-flex"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      {selected && drifted && (
        <button
          type="button"
          onClick={() => update.mutate(selected)}
          disabled={update.isPending}
          className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-caption font-medium text-[var(--indigo-text)] hover:underline disabled:opacity-50"
          title={`Save the filters on screen into "${selected.name}"`}
        >
          <Check className="h-3 w-3" /> Update "{selected.name}"
        </button>
      )}

      {naming ? (
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
          className="inline-flex items-center gap-1"
        >
          <input
            autoFocus
            aria-label="Name for this view"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setNaming(false); setName(''); } }}
            placeholder="Name this view"
            className="h-7 w-40 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 text-caption text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none"
          />
          <button type="submit" disabled={!name.trim() || create.isPending} className="inline-flex h-7 items-center rounded-full px-2 text-caption font-medium text-[var(--indigo-text)] hover:underline disabled:opacity-40">
            Save
          </button>
          <button type="button" aria-label="Cancel" onClick={() => { setNaming(false); setName(''); }} className="icon-btn h-6 w-6">
            <X className="h-3 w-3" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          disabled={!!unavailable}
          title={unavailable || 'Save the filters, search, sort and tab on screen as a view'}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full px-2 text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40',
            matching && 'hidden',
          )}
        >
          <BookmarkPlus className="h-3.5 w-3.5" /> Save view
        </button>
      )}
    </div>
  );
}
