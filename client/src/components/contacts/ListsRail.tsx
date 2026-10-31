import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ChevronRight, Folder, FolderPlus, FolderMinus, MoreHorizontal, PanelLeftClose, Pencil, Pin, PinOff,
  Plus, Search, ShieldOff, Trash2, Users, X, Megaphone, ArrowDownAZ, Palette, Check, Radar, Contact2,
} from 'lucide-react';
import type { ContactList, ListKind } from '@lemlist/shared';
import { UNLISTED_LIST_ID } from '@lemlist/shared';
import { listsApi } from '../../api/contacts.api';
import { listFoldersApi, type ListFolder } from '../../api/list-folders.api';
import { usePopover } from '../../hooks/usePopover';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   The lists sidebar on Leads and Contacts.

   Lists are how people steer the whole outbound cycle - which audience a
   campaign sends to, which accounts sit together in the CRM - so this is a
   navigator, not a link dump. Every list has a colour of its own, its size,
   and (on Leads) whether a campaign is sending to it now. Lists can be
   searched, sorted, pinned to the top, grouped in folders, recoloured and
   renamed in place. Folder names are plain text with a coloured mark, never
   coloured text, which read as a wall of green on the Leads page.
   ═══════════════════════════════════════════════════════════════════════ */

/** The palette lists and folders are drawn from. Readable as a mark in both themes. */
export const LIST_COLORS = ['#4F5BD5', '#3F8763', '#B88124', '#BE4A3B', '#A3507A', '#3D7F89', '#6E4E8E', '#6B7280'];

type SortMode = 'name' | 'size' | 'recent';
const SORT_LABEL: Record<SortMode, string> = { name: 'A to Z', size: 'Largest first', recent: 'Newest first' };

function readSet(key: string): Set<string> {
  try { const v = localStorage.getItem(key); return new Set(v ? JSON.parse(v) : []); } catch { return new Set(); }
}
function writeSet(key: string, set: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* storage blocked */ }
}

interface RailProps {
  kind: ListKind;
  lists: ContactList[];
  folders: ListFolder[];
  activeListId: string | null;
  /** Everybody on the page, for "All leads" / "All contacts". */
  total?: number;
  unlistedCount: number;
  onSelect: (listId: string | null) => void;
  onCreateList: () => void;
  onEditList: (list: ContactList) => void;
  onCreateFolder: () => void;
  onEditFolder: (folder: ListFolder) => void;
  onTrash: (listId: string) => void;
  onCollapse: () => void;
}

export function ListsRail({
  kind, lists, folders, activeListId, total, unlistedCount,
  onSelect, onCreateList, onEditList, onCreateFolder, onEditFolder, onTrash, onCollapse,
}: RailProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const noun = kind === 'lead' ? 'lead' : 'contact';
  const live = lists.filter((l: any) => !l.is_trashed);

  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<SortMode>(() => {
    try { const v = localStorage.getItem(`lists.sort.${kind}`); return v === 'size' || v === 'recent' ? v : 'name'; } catch { return 'name'; }
  });
  const setSort = (v: SortMode) => { setSortState(v); try { localStorage.setItem(`lists.sort.${kind}`, v); } catch { /* ignore */ } };
  const [pinned, setPinned] = useState<Set<string>>(() => readSet(`lists.pinned.${kind}`));
  const togglePin = (id: string) => setPinned((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    writeSet(`lists.pinned.${kind}`, next);
    return next;
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readSet('contacts.collapsedFolders'));
  const toggleFolder = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    writeSet('contacts.collapsedFolders', next);
    return next;
  });

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ listId: string; x: number; y: number } | null>(null);
  const menuPop = usePopover(!!menu, () => setMenu(null));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['lists'] });
    qc.invalidateQueries({ queryKey: ['list-folders'] });
  };
  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => listsApi.update(id, { name }),
    onSuccess: () => { invalidate(); setRenamingId(null); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not rename the list'),
  });
  const colorMut = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string }) => listsApi.update(id, { color }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not change the colour'),
  });
  const moveMut = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) => listFoldersApi.moveList(id, folderId),
    onSuccess: () => { invalidate(); setMenu(null); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not move the list'),
  });

  const sorter = useMemo(() => {
    const byName = (a: ContactList, b: ContactList) => a.name.localeCompare(b.name);
    if (sort === 'size') return (a: ContactList, b: ContactList) => (b.contact_count || 0) - (a.contact_count || 0) || byName(a, b);
    if (sort === 'recent') return (a: ContactList, b: ContactList) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return byName;
  }, [sort]);

  const q = query.trim().toLowerCase();
  const matching = useMemo(() => live.filter((l) => !q || l.name.toLowerCase().includes(q)).sort(sorter), [live, q, sorter]);
  const pinnedLists = q ? [] : matching.filter((l) => pinned.has(l.id));
  const folderIds = new Set(folders.map((f) => f.id));
  // A pinned list sits in Pinned only, unless a search is narrowing things down.
  const filed = q ? matching : matching.filter((l) => !pinned.has(l.id));
  const groups = [
    ...folders.map((f) => ({ key: f.id, folder: f as ListFolder | null, lists: filed.filter((l) => l.folder_id === f.id) })),
    { key: 'uncat', folder: null as ListFolder | null, lists: filed.filter((l) => !l.folder_id || !folderIds.has(l.folder_id)) },
  ].filter((g) => g.folder || g.lists.length > 0)
    // While searching, a folder with nothing matching is noise.
    .filter((g) => !q || g.lists.length > 0);

  const menuList = menu ? live.find((l) => l.id === menu.listId) || null : null;
  const openMenu = (listId: string, el: HTMLElement, at?: { x: number; y: number }) => {
    const r = el.getBoundingClientRect();
    menuPop.returnFocusTo.current = el;
    setMenu({ listId, x: at?.x ?? r.right - 8, y: at?.y ?? r.bottom + 4 });
  };

  // Escape out of a rename without saving.
  const renameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (renamingId) renameRef.current?.select(); }, [renamingId]);

  const Row = ({ list }: { list: ContactList }) => {
    const active = activeListId === list.id;
    const liveCount = (list as any).live_campaigns || 0;
    if (renamingId === list.id) {
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = renameValue.trim();
            if (name && name !== list.name) renameMut.mutate({ id: list.id, name }); else setRenamingId(null);
          }}
          className="px-1 py-0.5"
        >
          <input
            ref={renameRef}
            aria-label="List name"
            value={renameValue}
            maxLength={80}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => setRenamingId(null)}
            onKeyDown={(e) => { if (e.key === 'Escape') setRenamingId(null); }}
            autoFocus
            className="w-full h-8 px-2 text-body rounded-md border border-[var(--indigo)] bg-[var(--bg-elevated)] text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--indigo)]/15"
          />
        </form>
      );
    }
    return (
      <div
        className="group/list relative"
        draggable
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', list.id); e.dataTransfer.effectAllowed = 'move'; setDragging(list.id); }}
        onDragEnd={() => { setDragging(null); setDropKey(null); }}
      >
        <button
          type="button"
          onClick={() => onSelect(list.id)}
          onDoubleClick={() => { setRenameValue(list.name); setRenamingId(list.id); }}
          onContextMenu={(e) => {
            e.preventDefault();
            const fromKeyboard = e.clientX === 0 && e.clientY === 0;
            openMenu(list.id, e.currentTarget, fromKeyboard ? undefined : { x: e.clientX, y: e.clientY });
          }}
          title={list.description || list.name}
          className={cn(
            'w-full flex items-center gap-2.5 h-9 pl-2 pr-9 rounded-lg text-left transition-colors',
            dragging === list.id && 'opacity-50',
            active
              ? 'bg-[var(--indigo-subtle)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
          )}
        >
          {/* The list's own colour, as a tile with its initial. */}
          <span
            aria-hidden
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-micro font-bold leading-none"
            style={{ color: list.color || 'var(--text-tertiary)', background: `color-mix(in srgb, ${list.color || '#6B7280'} 15%, transparent)` }}
          >
            {(list.name.trim()[0] || '#').toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate text-body', active ? 'font-semibold' : 'font-medium')}>{list.name}</span>
            {kind === 'lead' && liveCount > 0 && (
              <span className="flex items-center gap-1 text-micro text-[var(--text-tertiary)]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {liveCount} campaign{liveCount === 1 ? '' : 's'} sending
              </span>
            )}
          </span>
          <span className={cn('text-caption tabular-nums transition-opacity group-hover/list:opacity-0 group-focus-within/list:opacity-0', active ? 'text-[var(--indigo-text)] font-semibold' : 'text-[var(--text-tertiary)]')}>
            {(list.contact_count || 0).toLocaleString()}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Options for "${list.name}"`}
          title="Options"
          onClick={(e) => { e.stopPropagation(); openMenu(list.id, e.currentTarget); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] group-hover/list:opacity-100 group-focus-within/list:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  const ViewRow = ({ icon: Icon, label, count, active, onClick, title }: {
    icon: React.ElementType; label: string; count?: number; active: boolean; onClick: () => void; title?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'w-full flex items-center gap-2.5 h-9 px-2 rounded-lg text-left transition-colors',
        active ? 'bg-[var(--bg-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className={cn('flex-1 truncate text-body', active ? 'font-semibold' : 'font-medium')}>{label}</span>
      {count != null && <span className="text-caption tabular-nums text-[var(--text-tertiary)]">{count.toLocaleString()}</span>}
    </button>
  );

  const SectionLabel = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
    <div className="flex items-center justify-between px-2 pt-3 pb-1">
      <span className="text-micro font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{children}</span>
      {right}
    </div>
  );

  return (
    <div className="sticky top-[calc(var(--chrome-h,56px)+4px)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 max-h-[calc(100vh-var(--chrome-h,56px)-24px)] overflow-y-auto">
      {/* Header: what these lists are for, and the two ways to add */}
      <div className="flex items-start gap-2 px-1.5 pt-1 pb-2">
        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--indigo-subtle)] text-[var(--indigo-text)]">
          {kind === 'lead' ? <Radar className="h-3.5 w-3.5" /> : <Contact2 className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-strong font-semibold text-[var(--text-primary)] leading-tight">{kind === 'lead' ? 'Lead lists' : 'Contact lists'}</p>
          <p className="text-micro leading-snug text-[var(--text-tertiary)]">
            {kind === 'lead' ? 'Audiences campaigns send to' : 'CRM groups, never emailed cold'}
          </p>
        </div>
        <button type="button" aria-label="Hide lists" title="Hide lists" onClick={onCollapse} className="icon-btn h-7 w-7 flex-shrink-0">
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-1.5 pb-2">
        <button
          type="button"
          onClick={onCreateList}
          className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg bg-[var(--indigo)] text-white text-body font-semibold hover:bg-[var(--indigo-hover)] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New {noun} list
        </button>
        <button
          type="button"
          onClick={onCreateFolder}
          aria-label="New folder"
          title="New folder"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      </div>

      {live.length > 4 && (
        <div className="relative px-1.5 pb-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <input
            aria-label="Search lists"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            placeholder="Find a list"
            className="w-full h-8 pl-8 pr-7 text-body rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)]"
          />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 icon-btn h-5 w-5">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* Views that are not lists */}
      {!q && (
        <div className="space-y-0.5 pt-1">
          <ViewRow icon={Users} label={kind === 'lead' ? 'All leads' : 'All contacts'} count={total} active={!activeListId} onClick={() => onSelect(null)} />
          <ViewRow
            icon={FolderMinus}
            label="Not in a list"
            count={unlistedCount}
            active={activeListId === UNLISTED_LIST_ID}
            onClick={() => onSelect(UNLISTED_LIST_ID)}
            title={`${kind === 'lead' ? 'Leads' : 'Contacts'} that are in no list yet`}
          />
        </div>
      )}

      {pinnedLists.length > 0 && (
        <>
          <SectionLabel>Pinned</SectionLabel>
          <div className="space-y-0.5">{pinnedLists.map((l) => <Row key={`p-${l.id}`} list={l} />)}</div>
        </>
      )}

      <SectionLabel
        right={live.length > 1 && (
          <button
            type="button"
            onClick={() => setSort(sort === 'name' ? 'size' : sort === 'size' ? 'recent' : 'name')}
            title="Change the order"
            className="inline-flex items-center gap-1 rounded px-1 text-micro font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            <ArrowDownAZ className="h-3 w-3" /> {SORT_LABEL[sort]}
          </button>
        )}
      >
        {q ? `Matching "${query.trim()}"` : 'Lists'}
      </SectionLabel>

      {live.length === 0 ? (
        <div className="mx-1.5 my-1 rounded-lg border border-dashed border-[var(--border-default)] px-3 py-4 text-center">
          <p className="text-body font-medium text-[var(--text-primary)]">No {noun} lists yet</p>
          <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">
            {kind === 'lead' ? 'Group leads into audiences, then point a campaign at one.' : 'Group contacts by account, stage or anything you like.'}
          </p>
        </div>
      ) : matching.length === 0 ? (
        <p className="px-2 py-2 text-caption text-[var(--text-tertiary)]">No list matches that.</p>
      ) : (
        <div className="space-y-1">
          {groups.map((g) => {
            const isFolder = !!g.folder;
            const isCollapsed = isFolder && !q && collapsed.has(g.key);
            const isDrop = dropKey === g.key && !!dragging;
            const dropProps = {
              onDragOver: (e: React.DragEvent) => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropKey(g.key); } },
              onDragLeave: () => setDropKey((k) => (k === g.key ? null : k)),
              onDrop: (e: React.DragEvent) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || dragging;
                if (id) moveMut.mutate({ id, folderId: g.folder?.id ?? null });
                setDropKey(null); setDragging(null);
              },
            };
            return (
              <div key={g.key} {...dropProps} className={cn('rounded-lg transition-colors', isDrop && 'bg-[var(--indigo-subtle)] ring-1 ring-[var(--indigo)]/40')}>
                {isFolder && (
                  <div className="group/folder flex items-center gap-1.5 h-8 px-1.5 rounded-lg hover:bg-[var(--bg-hover)]">
                    <button
                      type="button"
                      onClick={() => toggleFolder(g.key)}
                      aria-expanded={!isCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <ChevronRight className={cn('h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)] transition-transform', !isCollapsed && 'rotate-90')} />
                      <Folder className="h-3.5 w-3.5 flex-shrink-0" style={{ color: g.folder!.color || 'var(--text-tertiary)' }} fill="currentColor" fillOpacity={0.18} />
                      <span className="truncate text-body font-semibold text-[var(--text-primary)]">{g.folder!.name}</span>
                      <span className="text-micro tabular-nums text-[var(--text-tertiary)]">{g.lists.length}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit folder "${g.folder!.name}"`}
                      title="Rename, recolour or delete"
                      onClick={() => onEditFolder(g.folder!)}
                      className="icon-btn h-6 w-6 opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {!isCollapsed && (
                  <div className={cn('space-y-0.5', isFolder && 'ml-3 pl-2 border-l border-[var(--border-subtle)]')}>
                    {g.lists.map((l) => <Row key={l.id} list={l} />)}
                    {isFolder && g.lists.length === 0 && (
                      <p className="px-2 py-1.5 text-caption text-[var(--text-tertiary)]">{isDrop ? 'Drop to file it here' : 'Empty. Drag a list here.'}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
        <Link
          to="/suppression"
          className="flex items-center gap-2.5 h-8 px-2 rounded-lg text-body font-medium text-[var(--text-tertiary)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
        >
          <ShieldOff className="h-3.5 w-3.5" /> Do not email
        </Link>
      </div>

      {/* A list's options, from its ... button or a right-click */}
      {menu && menuList && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" aria-hidden onClick={() => setMenu(null)} />
          <div
            {...menuPop.panelProps}
            role="group"
            aria-label={`Options for "${menuList.name}"`}
            className="fixed z-[61] w-60 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1 shadow-xl animate-fade-in max-h-[80vh] overflow-y-auto"
            style={{ top: Math.max(8, Math.min(menu.y, window.innerHeight - 470)), left: Math.max(8, Math.min(menu.x, window.innerWidth - 248)) }}
          >
            <MenuItem icon={Pencil} onClick={() => { setRenameValue(menuList.name); setRenamingId(menuList.id); setMenu(null); }}>Rename</MenuItem>
            <MenuItem icon={Palette} onClick={() => { onEditList(menuList); setMenu(null); }}>Edit details</MenuItem>
            <MenuItem icon={pinned.has(menuList.id) ? PinOff : Pin} onClick={() => { togglePin(menuList.id); setMenu(null); }}>
              {pinned.has(menuList.id) ? 'Unpin' : 'Pin to top'}
            </MenuItem>
            {kind === 'lead' && (
              <MenuItem icon={Megaphone} onClick={() => { setMenu(null); navigate(`/campaigns/new?list=${menuList.id}`); }}>Start a campaign</MenuItem>
            )}
            <div className="px-2.5 pt-2 pb-1 text-micro font-semibold text-[var(--text-tertiary)]">Colour</div>
            <div className="flex flex-wrap gap-1.5 px-2.5 pb-2" role="group" aria-label="Colour">
              {LIST_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={menuList.color === c}
                  onClick={() => colorMut.mutate({ id: menuList.id, color: c })}
                  className="flex h-5 w-5 items-center justify-center rounded-md ring-offset-1 ring-offset-[var(--bg-surface)] transition-transform hover:scale-110"
                  style={{ background: c }}
                >
                  {menuList.color === c && <Check className="h-3 w-3 text-white" />}
                </button>
              ))}
            </div>
            <div className="my-1 border-t border-[var(--border-subtle)]" />
            <div className="px-2.5 pt-1 pb-1 text-micro font-semibold text-[var(--text-tertiary)]">Move to folder</div>
            <MenuItem icon={Folder} active={!menuList.folder_id} onClick={() => moveMut.mutate({ id: menuList.id, folderId: null })}>No folder</MenuItem>
            {folders.map((f) => (
              <MenuItem key={f.id} icon={Folder} iconColor={f.color || undefined} active={menuList.folder_id === f.id} onClick={() => moveMut.mutate({ id: menuList.id, folderId: f.id })}>
                {f.name}
              </MenuItem>
            ))}
            <MenuItem icon={FolderPlus} onClick={() => { setMenu(null); onCreateFolder(); }}>New folder…</MenuItem>
            <div className="my-1 border-t border-[var(--border-subtle)]" />
            <MenuItem icon={Trash2} danger onClick={() => { const id = menuList.id; setMenu(null); onTrash(id); }}>Move to trash</MenuItem>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, children, onClick, danger, active, iconColor }: {
  icon: React.ElementType; children: React.ReactNode; onClick: () => void; danger?: boolean; active?: boolean; iconColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 h-8 px-2.5 rounded-lg text-left text-body transition-colors',
        danger ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" style={iconColor ? { color: iconColor } : undefined} />
      <span className="flex-1 truncate">{children}</span>
      {active && <Check className="h-3.5 w-3.5 text-[var(--indigo-text)]" />}
    </button>
  );
}
