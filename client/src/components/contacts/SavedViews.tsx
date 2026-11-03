import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Copy, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { sameViewConfig, type ContactsListParams, type SavedView, type SavedViewConfig, type SavedViewPage } from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Saved views, as tabs.

   A view is a named set of filters, search, sort, list and email lights,
   kept on the server so it is there on every machine. They used to be
   small chips tucked beside a bookmark icon; now they are the tabs across
   the top of the table, each with how many people it holds right now, so
   "my UK verified leads (212)" is one click and one glance.

   The tab that matches what is on screen is the active one - decided by
   comparing configs, not by remembering which tab was pressed - so
   changing a filter by hand visibly leaves the view, and "Save changes"
   appears on it. Each tab's menu renames, updates, duplicates or deletes.
   ═══════════════════════════════════════════════════════════════════════ */

function TabMenu({ view, drifted, onRename, onUpdate, onDuplicate, onDelete }: {
  view: SavedView; drifted: boolean;
  onRename: () => void; onUpdate: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const item = (label: string, Icon: typeof Pencil, run: () => void, opts: { danger?: boolean; disabled?: boolean; hint?: string } = {}) => (
    <button
      type="button"
      role="menuitem"
      disabled={opts.disabled}
      title={opts.hint}
      onClick={() => { setOpen(false); run(); }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        opts.danger ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
      )}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      {label}
    </button>
  );
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label={`Options for ${view.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn('flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]', !open && 'opacity-0 group-hover/tab:opacity-100 focus:opacity-100')}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-50 mt-1 min-w-[190px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1 shadow-[var(--shadow-lg)]">
          {item('Rename', Pencil, onRename)}
          {item('Save current filters here', RefreshCw, onUpdate, { disabled: !drifted, hint: drifted ? 'Replace this view with what is on screen' : 'Nothing has changed' })}
          {item('Duplicate', Copy, onDuplicate)}
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          {item('Delete view', Trash2, onDelete, { danger: true })}
        </div>
      )}
    </div>
  );
}

export function SavedViewsBar({ page, current, onApply, onReset, paramsFor }: {
  page: SavedViewPage;
  current: SavedViewConfig;
  onApply: (config: SavedViewConfig) => void;
  /** Back to the page with no view: every filter cleared. */
  onReset: () => void;
  /** The list query a view stands for, so each tab can show its count. */
  paramsFor: (config: SavedViewConfig) => ContactsListParams | null;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['contact-views', page];
  const { data } = useQuery({ queryKey: key, queryFn: () => contactsApi.views(page), staleTime: 60_000 });
  const views: SavedView[] = Array.isArray(data) ? data : [];
  const unavailable = data && !Array.isArray(data) ? data.unavailable : null;

  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  /** The view last opened, so its tab can offer "Save changes" once filters drift. */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const matching = views.find((v) => sameViewConfig(v.config, current)) ?? null;
  const selected = views.find((v) => v.id === selectedId) ?? null;
  const drifted = !!selected && !sameViewConfig(selected.config, current);
  const onDefault = !matching && !selected;

  // How many people each view holds now - one count query per tab, cached.
  const counts = useQueries({
    queries: views.map((v) => {
      const params = paramsFor(v.config);
      return {
        queryKey: ['contacts', 'view-count', v.id, JSON.stringify(v.config)],
        queryFn: async () => (await contactsApi.list({ ...params!, page: 1, limit: 1 })).total,
        enabled: !!params,
        staleTime: 60_000,
      };
    }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const fail = (e: any, fallback: string) => toast.error(e?.response?.data?.error || fallback);

  const create = useMutation({
    mutationFn: (args: { name: string; config: SavedViewConfig }) => contactsApi.createView(page, args.name, args.config),
    onSuccess: (v) => { refresh(); setSelectedId(v.id); setNaming(false); setName(''); toast.success(`Saved "${v.name}"`); },
    onError: (e) => fail(e, 'Could not save the view'),
  });
  const update = useMutation({
    mutationFn: (args: { id: string; patch: { name?: string; config?: SavedViewConfig } }) => contactsApi.updateView(args.id, args.patch),
    onSuccess: (v) => { refresh(); setRenamingId(null); toast.success(`Saved "${v.name}"`); },
    onError: (e) => fail(e, 'Could not update the view'),
  });
  const remove = useMutation({
    mutationFn: (v: SavedView) => contactsApi.deleteView(v.id),
    onSuccess: (_r, v) => { refresh(); if (selectedId === v.id) setSelectedId(null); toast.success(`Deleted "${v.name}"`); },
    onError: (e) => fail(e, 'Could not delete the view'),
  });

  const askDelete = (v: SavedView) => confirm({
    title: `Delete "${v.name}"?`,
    body: 'Only the saved view goes. The people it shows are not touched.',
    confirmLabel: 'Delete view',
    tone: 'danger',
  }, () => remove.mutate(v));

  if (views.length === 0 && !naming && unavailable) return null;

  const tabBase = 'group/tab relative inline-flex items-center gap-1.5 h-9 px-2.5 text-body whitespace-nowrap transition-colors';
  const underline = (on: boolean) => cn('absolute inset-x-1.5 -bottom-px h-[2px] rounded-full', on ? 'bg-[var(--indigo)]' : 'bg-transparent');

  return (
    <div className="flex flex-wrap items-end gap-x-1 border-b border-[var(--border-subtle)]" data-saved-views>
      <div role="tablist" aria-label="Saved views" className="flex flex-wrap items-end gap-0.5">
        <button
          type="button"
          role="tab"
          aria-selected={onDefault}
          onClick={() => { setSelectedId(null); onReset(); }}
          className={cn(tabBase, onDefault ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}
          title="No saved view: clear the filters"
        >
          Default
          <span className={underline(onDefault)} />
        </button>

        {views.map((v, i) => {
          const active = matching?.id === v.id || (selected?.id === v.id && !matching);
          const count = counts[i]?.data;
          if (renamingId === v.id) {
            return (
              <form
                key={v.id}
                onSubmit={(e) => { e.preventDefault(); if (rename.trim()) update.mutate({ id: v.id, patch: { name: rename.trim() } }); }}
                className="inline-flex items-center gap-1 h-9 px-1"
              >
                <input
                  autoFocus
                  aria-label="New name"
                  value={rename}
                  maxLength={60}
                  onChange={(e) => setRename(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setRenamingId(null); }}
                  onBlur={() => setRenamingId(null)}
                  className="h-7 w-36 rounded-md border border-[var(--indigo)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)] outline-none"
                />
              </form>
            );
          }
          return (
            <div key={v.id} className={cn(tabBase, 'pr-1.5', active ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { setSelectedId(v.id); onApply(v.config); }}
                className="inline-flex items-center gap-1.5"
                title={`Show "${v.name}"`}
              >
                {v.name}
                {typeof count === 'number' && (
                  <span className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md px-1 text-micro font-semibold tabular',
                    active ? 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]')}>
                    {count.toLocaleString()}
                  </span>
                )}
              </button>
              {selected?.id === v.id && drifted && (
                <button
                  type="button"
                  onClick={() => update.mutate({ id: v.id, patch: { config: current } })}
                  className="inline-flex items-center gap-0.5 rounded px-1 text-micro font-semibold text-[var(--indigo-text)] hover:bg-[var(--indigo-subtle)]"
                  title={`Save the filters on screen into "${v.name}"`}
                >
                  <Check className="h-3 w-3" /> Save changes
                </button>
              )}
              <TabMenu
                view={v}
                drifted={!sameViewConfig(v.config, current)}
                onRename={() => { setRename(v.name); setRenamingId(v.id); }}
                onUpdate={() => update.mutate({ id: v.id, patch: { config: current } })}
                onDuplicate={() => create.mutate({ name: `${v.name} (copy)`.slice(0, 60), config: v.config })}
                onDelete={() => askDelete(v)}
              />
              <span className={underline(active)} />
            </div>
          );
        })}
      </div>

      {naming ? (
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate({ name: name.trim(), config: current }); }}
          className="inline-flex items-center gap-1 h-9 pl-1"
        >
          <input
            autoFocus
            aria-label="Name for this view"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setNaming(false); setName(''); } }}
            placeholder="Name this view"
            className="h-7 w-40 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none"
          />
          <button type="submit" disabled={!name.trim() || create.isPending} className="btn-primary h-7">Save</button>
          <button type="button" aria-label="Cancel" onClick={() => { setNaming(false); setName(''); }} className="icon-btn h-6 w-6">
            <X className="h-3 w-3" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          disabled={!!unavailable}
          title={unavailable || 'Save the filters, search, sort, list and email lights on screen as a tab'}
          className="inline-flex h-9 items-center gap-1 px-2 text-body font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40 whitespace-nowrap"
          data-save-view
        >
          <Plus className="h-3.5 w-3.5" /> {matching ? 'New view' : 'Save as view'}
        </button>
      )}
    </div>
  );
}
