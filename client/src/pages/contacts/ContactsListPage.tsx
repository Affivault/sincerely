import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { contactsApi, listsApi } from '../../api/contacts.api';
import { listFoldersApi, type ListFolder } from '../../api/list-folders.api';
import { Spinner } from '../../components/ui/Spinner';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Avatar } from '../../components/shared/Avatar';
import { formatDate, cn } from '../../lib/utils';
import {
  Plus,
  Upload,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Users,
  FolderOpen,
  Folder,
  FolderPlus,
  Pencil,
  ArrowRight,
  ShieldCheck,
  ShieldX,
  Shield,
  ShieldOff,
  RotateCcw,
  Filter,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CreateContactInput, ContactWithTags, ContactList } from '@lemlist/shared';
import { DEFAULT_PAGE_SIZE } from '../../lib/constants';

const FOLDER_COLORS = ['#10B981', '#6366F1', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#EF4444', '#84CC16'];

const emptyContact: CreateContactInput = {
  email: '',
  first_name: '',
  last_name: '',
  company: '',
  job_title: '',
  phone: '',
  linkedin_url: '',
  website: '',
};


export function ContactsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showListModal, setShowListModal] = useState(false);
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [form, setForm] = useState<CreateContactInput>({ ...emptyContact });
  const [editId, setEditId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [listForm, setListForm] = useState({ name: '', description: '' });
  const [editingList, setEditingList] = useState<ContactList | null>(null);

  const activeListId = searchParams.get('list') || null;

  // Reset to page 1 whenever the active list changes so stale page numbers
  // don't cause empty results on smaller lists.
  useEffect(() => {
    setPage(1);
  }, [activeListId]);

  const { data: contactsData, isLoading } = useQuery({
    queryKey: ['contacts', page, search, activeListId],
    queryFn: () => contactsApi.list({
      page,
      limit: DEFAULT_PAGE_SIZE,
      search: search || undefined,
      list_id: activeListId || undefined,
    }),
  });

  const { data: lists } = useQuery({
    queryKey: ['lists'],
    queryFn: listsApi.list,
  });

  // Folders
  const { data: folders = [] } = useQuery({
    queryKey: ['list-folders'],
    queryFn: listFoldersApi.list,
  });

  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<ListFolder | null>(null);
  const [listContextMenu, setListContextMenu] = useState<{ listId: string; x: number; y: number } | null>(null);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const folderMoveMut = useMutation({
    mutationFn: ({ listId, folderId }: { listId: string; folderId: string | null }) => listFoldersApi.moveList(listId, folderId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lists'] }); queryClient.invalidateQueries({ queryKey: ['list-folders'] }); toast.success('Moved'); setListContextMenu(null); },
  });
  const trashListMut = useMutation({
    mutationFn: (listId: string) => listFoldersApi.trashList(listId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lists'] }); queryClient.invalidateQueries({ queryKey: ['list-folders'] }); toast.success('List moved to trash'); setListContextMenu(null); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to trash list'),
  });
  const renameListMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => listsApi.update(id, { name } as any),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lists'] }); toast.success('Renamed'); setRenamingListId(null); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to rename'),
  });

  // Group lists by folder for sidebar rendering
  const groupedLists = useMemo(() => {
    const groups: { folder: ListFolder | null; lists: ContactList[] }[] = [];
    const byFolder = new Map<string, ContactList[]>();
    const uncategorised: ContactList[] = [];

    for (const list of (lists || []) as any[]) {
      if (list.is_trashed) continue;
      if (list.folder_id) {
        if (!byFolder.has(list.folder_id)) byFolder.set(list.folder_id, []);
        byFolder.get(list.folder_id)!.push(list);
      } else {
        uncategorised.push(list);
      }
    }

    // Folders first
    for (const f of folders) {
      groups.push({ folder: f, lists: byFolder.get(f.id) || [] });
    }
    // Then uncategorised
    if (uncategorised.length > 0) {
      groups.push({ folder: null, lists: uncategorised });
    }
    return groups;
  }, [lists, folders]);

  const { data: stats } = useQuery({
    queryKey: ['contact-stats'],
    queryFn: contactsApi.getStats,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateContactInput) =>
      editId ? contactsApi.update(editId, input) : contactsApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
      toast.success(editId ? 'Contact updated' : 'Contact created');
      closeCreateModal();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: contactsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
      toast.success('Contact deleted');
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => contactsApi.bulkDelete(ids),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
      toast.success(`Deleted ${result.deleted} contacts`);
      setSelectedContacts(new Set());
    },
  });

  const createListMutation = useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      editingList ? listsApi.update(editingList.id, input) : listsApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      toast.success(editingList ? 'List updated' : 'List created');
      closeListModal();
    },
  });

  const addToListMutation = useMutation({
    mutationFn: ({ listId, contactIds }: { listId: string; contactIds: string[] }) =>
      listsApi.addContacts(listId, contactIds),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      toast.success(`Added ${result.success} contacts to list`);
      setShowAddToListModal(false);
      setSelectedContacts(new Set());
    },
  });

  const importMutation = useMutation({
    mutationFn: ({ file, mapping }: { file: File; mapping: Record<string, string> }) =>
      contactsApi.import(file, mapping),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
      toast.success(`Imported ${result.imported} contacts`);
      setShowImportModal(false);
      setImportFile(null);
      setCsvHeaders([]);
      setColumnMapping({});
    },
  });

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setEditId(null);
    setForm({ ...emptyContact });
  };

  const closeListModal = () => {
    setShowListModal(false);
    setEditingList(null);
    setListForm({ name: '', description: '' });
  };

  const openEdit = (contact: ContactWithTags) => {
    setEditId(contact.id);
    setForm({
      email: contact.email,
      first_name: contact.first_name || '',
      last_name: contact.last_name || '',
      company: contact.company || '',
      job_title: contact.job_title || '',
      phone: contact.phone || '',
      linkedin_url: contact.linkedin_url || '',
      website: contact.website || '',
    });
    setShowCreateModal(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const firstLine = text.split('\n')[0];
      const headers = firstLine.split(',').map((h) => h.trim().replace(/"/g, ''));
      setCsvHeaders(headers);
      const autoMap: Record<string, string> = {};
      for (const h of headers) {
        const lower = h.toLowerCase();
        if (lower.includes('email')) autoMap[h] = 'email';
        else if (lower === 'first name' || lower === 'first_name') autoMap[h] = 'first_name';
        else if (lower === 'last name' || lower === 'last_name') autoMap[h] = 'last_name';
        else if (lower.includes('company')) autoMap[h] = 'company';
        else if (lower.includes('title')) autoMap[h] = 'job_title';
        else if (lower.includes('phone')) autoMap[h] = 'phone';
      }
      setColumnMapping(autoMap);
    };
    reader.onerror = () => toast.error('Failed to read file — please try again');
    reader.readAsText(file);
  };

  const handleExport = async () => {
    try {
      const ids = selectedContacts.size > 0 ? Array.from(selectedContacts) : undefined;
      const blob = await contactsApi.export(ids, 'csv');
      const url = URL.createObjectURL(blob as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contacts.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Contacts exported');
    } catch {
      toast.error('Export failed');
    }
  };

  const toggleSelectContact = (id: string) => {
    setSelectedContacts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const contacts = contactsData?.data || [];
    if (selectedContacts.size === contacts.length) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(contacts.map((c: any) => c.id)));
    }
  };

  const contacts = contactsData?.data || [];
  const totalPages = contactsData?.total_pages || 1;
  const totalContacts = contactsData?.total || 0;
  const allSelected = contacts.length > 0 && selectedContacts.size === contacts.length;
  const someSelected = selectedContacts.size > 0;

  const currentListName = activeListId && lists
    ? lists.find((l) => l.id === activeListId)?.name || 'List'
    : 'All Contacts';

  return (
    <div className="flex gap-5">
      {/* Sidebar */}
      <div className="w-52 flex-shrink-0" onClick={() => setListContextMenu(null)}>
        <div className="sticky top-20 panel-inset p-1.5 space-y-0.5">
          {/* All Contacts */}
          <button
            onClick={() => setSearchParams({})}
            className={cn(
              "w-full flex items-center gap-2.5 h-8 px-2.5 rounded-[6px] text-[13px] font-medium transition-all",
              !activeListId
                ? "bg-[rgba(99,102,241,0.1)] text-[#6366F1]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            )}
          >
            <Users className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 text-left">All Contacts</span>
            <span className={cn(
              "text-[10px] font-semibold tabular px-1.5 rounded",
              !activeListId ? "text-[#6366F1]" : "text-[var(--text-tertiary)]"
            )}>
              {stats?.total || 0}
            </span>
          </button>

          {/* Lists section */}
          <div className="pt-2">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
                Lead Lists
              </span>
              <div className="flex gap-0.5">
                <button
                  onClick={() => { setEditingFolder(null); setFolderModalOpen(true); }}
                  className="icon-btn h-5 w-5"
                  title="New folder"
                >
                  <FolderPlus className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setShowListModal(true)}
                  className="icon-btn h-5 w-5"
                  title="New list"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="space-y-0.5">
              {groupedLists.map((group) => (
                <div key={group.folder?.id || 'uncat'}>
                  {group.folder ? (
                    <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                      <Folder className="h-3 w-3" style={{ color: group.folder.color }} />
                      <span className="flex-1 truncate" style={{ color: group.folder.color }}>{group.folder.name}</span>
                      <button
                        onClick={() => { setEditingFolder(group.folder); setFolderModalOpen(true); }}
                        className="p-0.5 rounded hover:bg-[var(--bg-hover)] opacity-0 group-hover:opacity-100"
                        title="Edit folder"
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ) : group.lists.length > 0 && groupedLists.length > 1 ? (
                    <div className="px-2 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                      Uncategorised
                    </div>
                  ) : null}

                  {group.lists.map((list: any) => (
                    <div key={list.id} className="relative group">
                      {renamingListId === list.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (renameValue.trim()) renameListMut.mutate({ id: list.id, name: renameValue.trim() });
                          }}
                          className="px-2 py-1"
                        >
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => setRenamingListId(null)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setRenamingListId(null); }}
                            autoFocus
                            className="w-full px-2 py-1 text-[12px] rounded border border-[#6366F1] bg-[var(--bg-elevated)] outline-none"
                          />
                        </form>
                      ) : (
                        <button
                          onClick={() => setSearchParams({ list: list.id })}
                          onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); setListContextMenu({ listId: list.id, x: e.clientX, y: e.clientY }); }}
                          className={cn(
                            "w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] text-[12px] font-medium transition-all",
                            activeListId === list.id
                              ? "bg-[rgba(99,102,241,0.1)] text-[#6366F1]"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                          )}
                        >
                          <FolderOpen className="h-3 w-3 flex-shrink-0" />
                          <span className="flex-1 text-left truncate">{list.name}</span>
                          <span className={cn(
                            "text-[10px] font-semibold tabular",
                            activeListId === list.id ? "text-[#6366F1]" : "text-[var(--text-tertiary)]"
                          )}>
                            {list.contact_count || 0}
                          </span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}

              {(!lists || lists.length === 0) && (
                <p className="px-2 py-2 text-[11px] text-[var(--text-tertiary)] italic">
                  No lists yet
                </p>
              )}
            </div>
          </div>

          {/* Other section */}
          <div className="pt-2">
            <div className="px-2 mb-1">
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
                Other
              </span>
            </div>
            <Link
              to="/suppression"
              className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] text-[12px] font-medium text-[var(--text-secondary)] hover:text-rose-500 hover:bg-rose-500/10 transition-all"
            >
              <ShieldOff className="h-3 w-3 flex-shrink-0" />
              <span className="flex-1 text-left">Do not email</span>
            </Link>
          </div>
        </div>
      </div>

      {/* List right-click context menu */}
      {listContextMenu && (
        <div
          className="fixed z-50 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg shadow-xl py-1 min-w-[200px] animate-fade-in"
          style={{ top: listContextMenu.y, left: listContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const list = (lists || []).find((l: any) => l.id === listContextMenu.listId);
              if (list) { setRenameValue(list.name); setRenamingListId(list.id); setListContextMenu(null); }
            }}
            className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] flex items-center gap-2"
          >
            <Pencil className="h-3.5 w-3.5" /> Rename
          </button>

          <div className="border-t border-[var(--border-subtle)] my-1" />
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Move to folder</div>
          <button
            onClick={() => folderMoveMut.mutate({ listId: listContextMenu.listId, folderId: null })}
            className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] flex items-center gap-2"
          >
            <Folder className="h-3.5 w-3.5" /> Uncategorised
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => folderMoveMut.mutate({ listId: listContextMenu.listId, folderId: f.id })}
              className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] flex items-center gap-2"
            >
              <Folder className="h-3.5 w-3.5" style={{ color: f.color }} /> {f.name}
            </button>
          ))}

          <div className="border-t border-[var(--border-subtle)] my-1" />
          <button
            onClick={() => {
              if (confirm('Move this list to trash?')) trashListMut.mutate(listContextMenu.listId);
            }}
            className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 flex items-center gap-2"
          >
            <Trash2 className="h-3.5 w-3.5" /> Move to trash
          </button>
        </div>
      )}

      {/* Folder modal */}
      {folderModalOpen && (
        <ListFolderModal
          initial={editingFolder}
          onClose={() => { setFolderModalOpen(false); setEditingFolder(null); }}
        />
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* Header */}
        <PageHeader
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B5BF5] to-[#8B5CF6] shadow-[0_1px_3px_rgba(91,91,245,0.4)]">
              <Users className="h-4 w-4 text-white" />
            </span>
          }
          title={currentListName}
          description={totalContacts === 0
            ? 'No contacts yet — start building your audience'
            : `${totalContacts.toLocaleString()} contact${totalContacts !== 1 ? 's' : ''} in your database`
          }
          actions={
            <div className="flex items-center gap-2">
              <button onClick={() => navigate('/contacts/import')} className="btn-secondary rounded-lg text-[12px] h-8 px-3 gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                Import CSV
              </button>
              <button onClick={handleExport} className="btn-secondary rounded-lg text-[12px] h-8 px-3 gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg bg-[#5B5BF5] text-white text-[12px] font-semibold hover:bg-[#4F46E5] transition-all shadow-[0_1px_3px_rgba(91,91,245,0.4)]"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Contact
              </button>
            </div>
          }
        />

        {/* KPI strip */}
        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total contacts" value={stats.total.toLocaleString()} icon={Users} accent="indigo" />
            <StatCard label="Verified" value={(stats.verified ?? 0).toLocaleString()} icon={ShieldCheck} accent="emerald" hint={stats.total > 0 ? `${Math.round((stats.verified / stats.total) * 100)}% of total` : undefined} />
            <StatCard label="Lists" value={lists?.length ?? 0} icon={FolderOpen} accent="violet" />
          </div>
        )}

        {/* Search and filters bar */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name, email, or company…"
              className="w-full h-8 pl-8 pr-4 text-[12px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 transition-all"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); setPage(1); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 icon-btn h-4 w-4"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {search && (
            <span className="text-[11px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-elevated)] px-2.5 py-1 rounded-md">
              {totalContacts} result{totalContacts !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Bulk actions bar */}
        {someSelected && (
          <div className="flex items-center gap-4 mb-5 px-4 py-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)] animate-fade-in">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-[#6366F1] text-white text-[11px] font-bold">
                {selectedContacts.size}
              </span>
              <span className="text-sm font-medium text-[var(--text-primary)]">
                contact{selectedContacts.size !== 1 ? 's' : ''} selected
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={() => setShowAddToListModal(true)} className="btn-secondary text-sm h-8 rounded-lg">
                <FolderOpen className="h-3.5 w-3.5" />
                Add to list
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete ${selectedContacts.size} contacts?`)) {
                    bulkDeleteMutation.mutate(Array.from(selectedContacts));
                  }
                }}
                className="btn-danger text-sm h-8 rounded-lg"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
              <button
                onClick={() => setSelectedContacts(new Set())}
                className="p-1.5 ml-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-all duration-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner size="lg" />
          </div>
        ) : contacts.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="flex items-center justify-center h-20 w-20 rounded-3xl bg-gradient-to-br from-[rgba(99,102,241,0.08)] to-[rgba(139,92,246,0.08)] mb-5 border border-[rgba(99,102,241,0.15)]">
              <Users className="h-9 w-9 text-[#6366F1]" strokeWidth={1.5} />
            </div>
            <h3 className="text-heading-sm text-[var(--text-primary)] mb-2">No contacts yet</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-6 max-w-sm text-center">
              Get started by adding your first contact manually or importing a CSV file with your existing data.
            </p>
            <div className="flex items-center gap-3">
              <button onClick={() => setShowCreateModal(true)} className="btn-primary rounded-lg">
                <Plus className="h-4 w-4" />
                Add Contact
              </button>
              <button onClick={() => navigate('/contacts/import')} className="btn-secondary rounded-lg">
                <Upload className="h-4 w-4" />
                Import CSV
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-md overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                  <th className="px-5 py-2.5 w-12">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-[var(--border-default)] cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                    Contact
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                    Email
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                    Company
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                    Added
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                    Health
                  </th>
                  <th className="px-4 py-2.5 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact: any, index: number) => {
                  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
                  return (
                    <tr
                      key={contact.id}
                      className={cn(
                        "group transition-colors duration-150",
                        index < contacts.length - 1 && "border-b border-[var(--border-subtle)]",
                        selectedContacts.has(contact.id)
                          ? "bg-[rgba(99,102,241,0.04)]"
                          : "hover:bg-[var(--bg-hover)]"
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedContacts.has(contact.id)}
                          onChange={() => toggleSelectContact(contact.id)}
                          className="rounded border-[var(--border-default)] cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => navigate(`/contacts/${contact.id}`)}
                          className="flex items-center gap-2.5"
                        >
                          <Avatar
                            name={fullName || contact.email}
                            email={contact.email}
                            size="sm"
                          />
                          <div className="min-w-0 text-left">
                            <span className="text-[13px] font-medium text-[var(--text-primary)]">
                              {fullName || '---'}
                            </span>
                            {contact.job_title && (
                              <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                                {contact.job_title}
                              </p>
                            )}
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[12px] text-[var(--text-secondary)]">{contact.email}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {contact.company
                          ? <span className="text-[12px] text-[var(--text-secondary)]">{contact.company}</span>
                          : <span className="text-[12px] text-[var(--text-tertiary)]">—</span>
                        }
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[11px] text-[var(--text-tertiary)]">
                          {formatDate(contact.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {contact.is_bounced ? (
                          <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold text-rose-700 bg-rose-500/10">
                            <ShieldX className="h-3 w-3" />
                            Bounced
                          </span>
                        ) : contact.is_unsubscribed ? (
                          <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold text-amber-700 bg-amber-500/10">
                            <ShieldX className="h-3 w-3" />
                            Opted out
                          </span>
                        ) : contact.dcs_score !== null && contact.dcs_score !== undefined ? (
                          <span title={`DCS: ${contact.dcs_score}/100`} className={cn(
                            'inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold',
                            contact.dcs_score >= 80
                              ? 'text-emerald-700 bg-emerald-500/10'
                              : contact.dcs_score >= 50
                              ? 'text-amber-700 bg-amber-500/10'
                              : 'text-rose-700 bg-rose-500/10'
                          )}>
                            {contact.dcs_score >= 80
                              ? <ShieldCheck className="h-3 w-3" />
                              : contact.dcs_score >= 50
                              ? <Shield className="h-3 w-3" />
                              : <ShieldX className="h-3 w-3" />
                            }
                            {contact.dcs_score}
                          </span>
                        ) : (
                          <span className="text-[11px] text-[var(--text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEdit(contact)} className="icon-btn" title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => { if (confirm('Delete this contact?')) deleteMutation.mutate(contact.id); }}
                            className="icon-btn hover:text-rose-500 hover:bg-rose-500/10"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-5 px-1">
            <p className="text-[13px] text-[var(--text-tertiary)]">
              Showing{' '}
              <span className="font-medium text-[var(--text-secondary)]">
                {(page - 1) * DEFAULT_PAGE_SIZE + 1}
              </span>
              {' '}-{' '}
              <span className="font-medium text-[var(--text-secondary)]">
                {Math.min(page * DEFAULT_PAGE_SIZE, totalContacts)}
              </span>
              {' '}of{' '}
              <span className="font-medium text-[var(--text-secondary)]">
                {totalContacts.toLocaleString()}
              </span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="inline-flex items-center justify-center h-9 w-9 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed border border-[var(--border-subtle)] rounded-lg hover:bg-[var(--bg-hover)] hover:border-[var(--border-default)] transition-all duration-200"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center h-9 px-4 text-[13px] font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-subtle)]">
                <span className="text-[var(--text-primary)]">{page}</span>
                <span className="mx-1.5 text-[var(--text-muted)]">/</span>
                <span>{totalPages}</span>
              </div>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="inline-flex items-center justify-center h-9 w-9 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed border border-[var(--border-subtle)] rounded-lg hover:bg-[var(--bg-hover)] hover:border-[var(--border-default)] transition-all duration-200"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Contact Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={closeCreateModal} />
          <div className="relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md shadow-xl animate-slide-up">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  {editId ? 'Edit Contact' : 'Add Contact'}
                </h2>
                <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                  {editId ? 'Update contact information' : 'Create a new contact in your database'}
                </p>
              </div>
              <button
                onClick={closeCreateModal}
                className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-all duration-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }}
              className="px-6 py-5 space-y-5"
            >
              <div>
                <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                  Email <span className="text-[var(--error)]">*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="contact@company.com"
                  required
                  className="input-field rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={form.first_name || ''}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    placeholder="John"
                    className="input-field rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={form.last_name || ''}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    placeholder="Doe"
                    className="input-field rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                  Company
                </label>
                <input
                  type="text"
                  value={form.company || ''}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  placeholder="Acme Inc."
                  className="input-field rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-[var(--border-subtle)]">
                <button type="button" onClick={closeCreateModal} className="btn-secondary rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary rounded-lg">
                  {createMutation.isPending ? 'Saving...' : editId ? 'Update Contact' : 'Add Contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowImportModal(false)} />
          <div className="relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg shadow-xl animate-slide-up">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Import Contacts</h2>
                <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                  Upload a CSV file and map columns to contact fields
                </p>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-all duration-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              {/* Step indicators */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-bold",
                    csvHeaders.length > 0
                      ? "bg-[var(--success)] text-[var(--bg-surface)]"
                      : "bg-[var(--text-primary)] text-[var(--bg-surface)]"
                  )}>
                    {csvHeaders.length > 0 ? '\u2713' : '1'}
                  </span>
                  <span className={cn(
                    "text-[13px] font-medium",
                    csvHeaders.length > 0 ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"
                  )}>
                    Upload
                  </span>
                </div>
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-bold",
                    csvHeaders.length > 0
                      ? "bg-[var(--text-primary)] text-[var(--bg-surface)]"
                      : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
                  )}>
                    2
                  </span>
                  <span className={cn(
                    "text-[13px] font-medium",
                    csvHeaders.length > 0 ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
                  )}>
                    Map Fields
                  </span>
                </div>
              </div>

              {/* File drop zone */}
              <div className={cn(
                "relative rounded-xl p-8 text-center transition-all duration-200 cursor-pointer",
                importFile
                  ? "border-2 border-[var(--success)] border-opacity-40 bg-[var(--success-bg)]"
                  : "border-2 border-dashed border-[var(--border-default)] hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)]"
              )}>
                {importFile ? (
                  <>
                    <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-[var(--success)] bg-opacity-10 mb-3">
                      <Upload className="h-6 w-6 text-[var(--success)]" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-medium text-[var(--text-primary)] mb-0.5">{importFile.name}</p>
                    <p className="text-[12px] text-[var(--text-tertiary)]">
                      {csvHeaders.length} columns detected
                    </p>
                  </>
                ) : (
                  <>
                    <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-[var(--bg-elevated)] mb-3">
                      <Upload className="h-6 w-6 text-[var(--text-primary)]" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-medium text-[var(--text-primary)] mb-0.5">
                      Drop your CSV file here
                    </p>
                    <p className="text-[12px] text-[var(--text-tertiary)]">or click to browse files</p>
                  </>
                )}
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>

              {/* Column mapping */}
              {csvHeaders.length > 0 && (
                <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                  <p className="text-[12px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-1">
                    Column Mapping
                  </p>
                  {csvHeaders.map((header) => (
                    <div
                      key={header}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]"
                    >
                      <span className="w-28 truncate text-[13px] font-medium text-[var(--text-primary)]">
                        {header}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)] flex-shrink-0" />
                      <select
                        className="flex-1 h-8 px-2.5 text-[13px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-default)] focus:shadow-[0_0_0_3px_var(--bg-elevated)] transition-all duration-200 cursor-pointer"
                        value={columnMapping[header] || ''}
                        onChange={(e) => setColumnMapping({ ...columnMapping, [header]: e.target.value })}
                      >
                        <option value="">Skip this column</option>
                        <option value="email">Email</option>
                        <option value="first_name">First Name</option>
                        <option value="last_name">Last Name</option>
                        <option value="company">Company</option>
                        <option value="job_title">Job Title</option>
                        <option value="phone">Phone</option>
                      </select>
                      {columnMapping[header] && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--success-bg)] text-[var(--success)]">
                          Mapped
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  onClick={() => setShowImportModal(false)}
                  className="btn-secondary rounded-lg"
                >
                  Cancel
                </button>
                <button
                  disabled={!importFile || importMutation.isPending}
                  onClick={() => importFile && importMutation.mutate({ file: importFile, mapping: columnMapping })}
                  className="btn-primary rounded-lg"
                >
                  {importMutation.isPending ? (
                    <>
                      <Spinner size="sm" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Import Contacts
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create List Modal */}
      {showListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={closeListModal} />
          <div className="relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-sm shadow-xl animate-slide-up">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  {editingList ? 'Edit List' : 'Create List'}
                </h2>
                <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                  {editingList ? 'Update list details' : 'Organize contacts into a list'}
                </p>
              </div>
              <button
                onClick={closeListModal}
                className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-all duration-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); createListMutation.mutate(listForm); }}
              className="px-6 py-5 space-y-5"
            >
              <div>
                <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                  List Name <span className="text-[var(--error)]">*</span>
                </label>
                <input
                  type="text"
                  value={listForm.name}
                  onChange={(e) => setListForm({ ...listForm, name: e.target.value })}
                  placeholder="e.g. Hot Leads, Enterprise, Q1 Prospects"
                  required
                  className="input-field rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-[var(--border-subtle)]">
                <button type="button" onClick={closeListModal} className="btn-secondary rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={createListMutation.isPending} className="btn-primary rounded-lg">
                  {createListMutation.isPending ? 'Saving...' : editingList ? 'Update List' : 'Create List'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add to List Modal */}
      {showAddToListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddToListModal(false)} />
          <div className="relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-sm shadow-xl animate-slide-up">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Add to List</h2>
                <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                  Add {selectedContacts.size} contact{selectedContacts.size !== 1 ? 's' : ''} to a list
                </p>
              </div>
              <button
                onClick={() => setShowAddToListModal(false)}
                className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-all duration-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4">
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {lists?.map((list) => (
                  <button
                    key={list.id}
                    onClick={() => addToListMutation.mutate({ listId: list.id, contactIds: Array.from(selectedContacts) })}
                    disabled={addToListMutation.isPending}
                    className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl hover:bg-[var(--bg-hover)] transition-all duration-200 disabled:opacity-50 group"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-primary)] group-hover:bg-[var(--text-primary)] group-hover:text-[var(--bg-surface)] transition-all duration-200">
                      <FolderOpen className="h-4 w-4" />
                    </div>
                    <span className="flex-1 text-left text-sm font-medium text-[var(--text-primary)]">
                      {list.name}
                    </span>
                    <span className="text-[12px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full">
                      {list.contact_count}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setShowAddToListModal(false); setShowListModal(true); }}
                className="w-full flex items-center justify-center gap-2 mt-4 py-2.5 border-2 border-dashed border-[var(--border-default)] rounded-xl text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)] transition-all duration-200"
              >
                <Plus className="h-4 w-4" />
                Create new list
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── List folder modal ──────────────────────────────────────────── */

function ListFolderModal({ initial, onClose }: { initial: ListFolder | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || FOLDER_COLORS[0]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (initial) return listFoldersApi.update(initial.id, { name: name.trim(), color });
      return listFoldersApi.create({ name: name.trim(), color });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['list-folders'] }); toast.success(initial ? 'Folder updated' : 'Folder created'); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const deleteMut = useMutation({
    mutationFn: () => listFoldersApi.delete(initial!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['list-folders'] }); qc.invalidateQueries({ queryKey: ['lists'] }); toast.success('Folder deleted'); onClose(); },
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
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 Prospects" className="input-field" autoFocus />
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
            <button onClick={() => { if (confirm(`Delete folder "${initial.name}"? Lists inside will not be deleted.`)) deleteMut.mutate(); }} className="text-xs text-red-500 hover:underline">Delete folder</button>
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
