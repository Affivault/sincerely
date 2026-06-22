import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { contactsApi, listsApi, tagsApi } from '../../api/contacts.api';
import { listFoldersApi, type ListFolder } from '../../api/list-folders.api';
import { verificationApi } from '../../api/verification.api';
import { settingsApi } from '../../api/settings.api';
import { Spinner } from '../../components/ui/Spinner';
import { Skeleton } from '../../components/ui/Skeleton';
import { Checkbox } from '../../components/ui/Checkbox';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { EmptyState } from '../../components/shared/EmptyState';
import { Avatar } from '../../components/shared/Avatar';
import { formatDate, formatRelativeTime, cn } from '../../lib/utils';
import {
  Plus,
  Upload,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
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
  Copy,
  Check,
  ExternalLink,
  Columns3,
  Linkedin,
  Loader2,
  Tag as TagIcon,
  ArrowRightLeft,
  GripVertical,
  Eye,
  EyeOff,
} from 'lucide-react';

type ContactSortKey = 'first_name' | 'email' | 'company' | 'dcs_score' | 'created_at';
type StatusFilter = '' | 'valid' | 'risky' | 'invalid' | 'not_found' | 'unverified';

function SortableHeader({
  label,
  colKey,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  colKey: ContactSortKey;
  sortBy: ContactSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: ContactSortKey) => void;
}) {
  const active = sortBy === colKey;
  return (
    <button
      onClick={() => onSort(colKey)}
      className={`flex items-center gap-1 group/sort transition-colors ${active ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
    >
      <span className="font-data text-[10px] font-medium uppercase tracking-[0.08em]">{label}</span>
      {active
        ? (sortDir === 'asc'
            ? <ChevronUp className="h-3 w-3 flex-shrink-0" />
            : <ChevronDown className="h-3 w-3 flex-shrink-0" />)
        : <ChevronsUpDown className="h-3 w-3 flex-shrink-0 opacity-0 group-hover/sort:opacity-60" />}
    </button>
  );
}
import toast from 'react-hot-toast';
import type { CreateContactInput, ContactWithTags, ContactList, Tag } from '@lemlist/shared';
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

/* Deterministic tint for a company monogram so the same company always
   gets the same colour — adds quiet visual texture to the table. */
const MONO_TINTS = [
  'var(--c-indigo)', 'var(--c-violet)', 'var(--c-cyan)', 'var(--c-blue)',
  'var(--c-emerald)', 'var(--c-amber)', 'var(--c-rose)', 'var(--c-fuchsia)',
];
function tintFor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return MONO_TINTS[h % MONO_TINTS.length];
}

function CompanyCell({ company }: { company?: string | null }) {
  if (!company) return <span className="text-[12px] text-[var(--text-muted)]">—</span>;
  const tint = tintFor(company);
  const initials = company.trim().slice(0, 2).toUpperCase();
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <span
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[5px] text-[9px] font-bold leading-none"
        style={{ color: tint, background: `color-mix(in srgb, ${tint} 14%, transparent)` }}
      >
        {initials}
      </span>
      <span className="text-[12.5px] text-[var(--text-secondary)] truncate">{company}</span>
    </span>
  );
}

function CopyableEmail({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="group/email inline-flex items-center gap-1.5 min-w-0">
      <span className="text-[12.5px] text-[var(--text-secondary)] truncate font-data">{email}</span>
      <button
        type="button"
        title="Copy email"
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(email).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }).catch(() => {});
        }}
        className="flex-shrink-0 p-1 rounded-md text-[var(--text-tertiary)] opacity-0 group-hover/email:opacity-100 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] transition-all"
      >
        {copied ? <Check className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

function HealthCell({ c }: { c: any }) {
  if (c.is_bounced) return (
    <span className="inline-flex items-center gap-1 px-1.5 h-[20px] rounded-md text-[10.5px] font-semibold text-rose-700 dark:text-rose-400 bg-rose-500/10">
      <ShieldX className="h-3 w-3" />Bounced
    </span>
  );
  if (c.is_unsubscribed) return (
    <span className="inline-flex items-center gap-1 px-1.5 h-[20px] rounded-md text-[10.5px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10">
      <ShieldX className="h-3 w-3" />Opted out
    </span>
  );
  if (c.dcs_score !== null && c.dcs_score !== undefined) return (
    <span title={`Deliverability confidence: ${c.dcs_score}/100`} className={cn(
      'inline-flex items-center gap-1 px-1.5 h-[20px] rounded-md text-[10.5px] font-semibold tabular',
      c.dcs_score >= 80 ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
        : c.dcs_score >= 50 ? 'text-amber-700 dark:text-amber-400 bg-amber-500/10'
        : 'text-rose-700 dark:text-rose-400 bg-rose-500/10'
    )}>
      {c.dcs_score >= 80 ? <ShieldCheck className="h-3 w-3" /> : c.dcs_score >= 50 ? <Shield className="h-3 w-3" /> : <ShieldX className="h-3 w-3" />}
      {c.dcs_score}
    </span>
  );
  return <span className="text-[11px] text-[var(--text-muted)]">—</span>;
}

const TextCell = ({ v, mono }: { v?: string | null; mono?: boolean }) =>
  v ? <span className={cn('text-[12.5px] text-[var(--text-secondary)] truncate', mono && 'font-data')}>{v}</span>
    : <span className="text-[12px] text-[var(--text-muted)]">—</span>;

const LinkCell = ({ href, label }: { href?: string | null; label?: string | null }) => {
  if (!href) return <span className="text-[12px] text-[var(--text-muted)]">—</span>;
  const url = href.startsWith('http') ? href : `https://${href}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-[12.5px] text-[var(--indigo)] hover:underline truncate font-data">
      {(label || href).replace(/^https?:\/\//, '')}
      <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
    </a>
  );
};

/* ── Email verification status ─────────────────────────────────────
   Derives a snov.io-style 4-state signal from our existing DCS fields
   (syntax / domain / SMTP-mailbox checks + score), so a glance tells you
   whether an address is good, risky, bad, or not yet checked. */
type EmailState = 'valid' | 'risky' | 'invalid' | 'not_found' | 'unverified';
function emailStatus(c: any): { state: EmailState; label: string; tip: string } {
  if (c.is_bounced) return { state: 'invalid', label: 'Bounced', tip: 'This address previously bounced' };
  const verified = !!c.dcs_verified_at || c.dcs_score != null;
  if (!verified) return { state: 'unverified', label: 'Unverified', tip: 'Not checked yet — click to verify' };
  if (c.dcs_syntax_ok === false) return { state: 'invalid', label: 'Invalid', tip: 'Malformed email address' };
  if (c.dcs_domain_ok === false) return { state: 'not_found', label: 'Not found', tip: c.dcs_fail_reason || 'No mail server (MX) for this domain — mailbox not found' };
  const score = c.dcs_score ?? 0;
  if (c.dcs_smtp_ok === true || score >= 80) return { state: 'valid', label: 'Valid', tip: c.dcs_fail_reason || 'Mailbox exists and accepts mail' };
  if (score >= 50) return { state: 'risky', label: 'Risky', tip: c.dcs_fail_reason || 'Catch-all or unverifiable mailbox — send with caution' };
  return { state: 'invalid', label: 'Undeliverable', tip: c.dcs_fail_reason || 'Mailbox likely rejects mail' };
}
const STATE_STYLE: Record<EmailState, { dot: string; badge: string }> = {
  valid:      { dot: 'bg-emerald-500',                 badge: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10' },
  risky:      { dot: 'bg-amber-500',                   badge: 'text-amber-700 dark:text-amber-400 bg-amber-500/10' },
  invalid:    { dot: 'bg-rose-500',                    badge: 'text-rose-700 dark:text-rose-400 bg-rose-500/10' },
  not_found:  { dot: 'bg-slate-400 dark:bg-slate-500', badge: 'text-slate-600 dark:text-slate-300 bg-slate-500/12' },
  unverified: { dot: 'bg-slate-300 dark:bg-slate-600', badge: 'text-[var(--text-tertiary)] bg-[var(--bg-elevated)]' },
};

function EmailStatusDot({ c }: { c: any }) {
  const s = emailStatus(c);
  return (
    <span className="relative flex-shrink-0" title={`${s.label} — ${s.tip}`}>
      <span className={cn('block h-2 w-2 rounded-full', STATE_STYLE[s.state].dot)} />
      {s.state === 'unverified' && <span className="absolute inset-0 rounded-full ring-1 ring-[var(--border-strong)]" />}
    </span>
  );
}

function VerificationBadge({ c }: { c: any }) {
  const s = emailStatus(c);
  return (
    <span title={s.tip} className={cn('inline-flex items-center gap-1.5 px-1.5 h-[20px] rounded-md text-[10.5px] font-semibold', STATE_STYLE[s.state].badge)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', STATE_STYLE[s.state].dot)} />
      {s.label}
    </span>
  );
}

/* LinkedIn presence — blue glyph when we have a profile URL, muted when not. */
function LinkedInGlyph({ url }: { url?: string | null }) {
  const has = !!url;
  const inner = (
    <span
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded-[3px] flex-shrink-0 transition-colors',
        has ? 'bg-[#0A66C2] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
      )}
      title={has ? 'Has a LinkedIn profile' : 'No LinkedIn profile on file'}
    >
      <Linkedin className="h-2.5 w-2.5" strokeWidth={2.5} />
    </span>
  );
  if (!has) return inner;
  const href = url!.startsWith('http') ? url! : `https://${url}`;
  return <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{inner}</a>;
}

/* Verification summary pill — count + colour dot, doubles as a filter. */
function StatusPill({ label, count, dot, active, onClick }: {
  label: string; count: number; dot: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 h-7 pl-2.5 pr-2.5 rounded-full text-[12px] font-medium border transition-colors',
        active
          ? 'bg-[var(--indigo-subtle)] border-[var(--indigo)] text-[var(--indigo)]'
          : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {label}
      <span className={cn('text-[10.5px] font-semibold tabular', active ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')}>
        {count.toLocaleString()}
      </span>
    </button>
  );
}

/* Configurable table columns, mapped to our contact fields (the same set
   surfaced during CSV import). The Contact identity column is always shown;
   these are the optional middle columns the user can toggle + reorder-by-default. */
type ColumnId = 'email' | 'status' | 'company' | 'job_title' | 'phone' | 'website' | 'linkedin_url' | 'added' | 'health';
interface ColumnDef {
  id: ColumnId;
  label: string;
  sortKey?: ContactSortKey;
  tdClass?: string;
  render: (c: any) => React.ReactNode;
}
const ALL_COLUMNS: ColumnDef[] = [
  { id: 'email',       label: 'Email',     sortKey: 'email',      tdClass: 'max-w-[280px]', render: (c) => (
    <span className="flex items-center gap-2 min-w-0"><EmailStatusDot c={c} /><CopyableEmail email={c.email} /></span>
  ) },
  { id: 'status',      label: 'Status',    sortKey: 'dcs_score',  render: (c) => <VerificationBadge c={c} /> },
  { id: 'company',     label: 'Company',   sortKey: 'company',    tdClass: 'max-w-[200px]', render: (c) => <CompanyCell company={c.company} /> },
  { id: 'job_title',   label: 'Job title',                        tdClass: 'max-w-[180px]', render: (c) => <TextCell v={c.job_title} /> },
  { id: 'phone',       label: 'Phone',                            render: (c) => <TextCell v={c.phone} mono /> },
  { id: 'website',     label: 'Website',                          tdClass: 'max-w-[180px]', render: (c) => <LinkCell href={c.website} /> },
  { id: 'linkedin_url',label: 'LinkedIn',                         tdClass: 'max-w-[180px]', render: (c) => <LinkCell href={c.linkedin_url} label={c.linkedin_url ? 'Profile' : null} /> },
  { id: 'added',       label: 'Added',     sortKey: 'created_at', render: (c) => <span className="text-[11.5px] text-[var(--text-tertiary)] font-data" title={formatDate(c.created_at)}>{formatRelativeTime(c.created_at)}</span> },
  { id: 'health',      label: 'Health',    sortKey: 'dcs_score',  render: (c) => <HealthCell c={c} /> },
];
const DEFAULT_COLUMNS: ColumnId[] = ['email', 'status', 'company', 'added'];


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
  const [sortBy, setSortBy] = useState<ContactSortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');

  const handleSort = (key: ContactSortKey) => {
    if (key === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'first_name' || key === 'email' || key === 'company' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const activeListId = searchParams.get('list') || null;

  // Reset to page 1 and clear the status filter whenever the active list
  // changes so stale state doesn't cause empty results on smaller lists.
  useEffect(() => {
    setPage(1);
    setStatusFilter('');
  }, [activeListId]);

  // Auto-verify preference — drives the live "verifying…" affordance
  const { data: userSettings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const autoVerifyOn = userSettings?.auto_verify_contacts ?? true;

  // Verification-status breakdown for the summary pills (scoped to the list)
  const { data: breakdown } = useQuery({
    queryKey: ['verification-breakdown', activeListId],
    queryFn: () => contactsApi.verificationBreakdown(activeListId || undefined),
    refetchInterval: (q) => {
      const d = q.state.data as any;
      return autoVerifyOn && d && d.unverified > 0 ? 12000 : false;
    },
  });

  const { data: contactsData, isLoading } = useQuery({
    queryKey: ['contacts', page, search, activeListId, sortBy, sortDir, statusFilter],
    queryFn: () => contactsApi.list({
      page,
      limit: DEFAULT_PAGE_SIZE,
      search: search || undefined,
      list_id: activeListId || undefined,
      sort_by: sortBy,
      sort_order: sortDir,
      verification_status: statusFilter || undefined,
    }),
    // While auto-verify is on and some visible contacts are still pending,
    // poll so their status flips live as the background worker processes them.
    refetchInterval: (query) => {
      if (!autoVerifyOn) return false;
      const rows = ((query.state.data as any)?.data || []) as any[];
      return rows.some((r) => !r.dcs_verified_at && !r.is_bounced) ? 12000 : false;
    },
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

  // Bulk tag + move state
  const [showTagModal, setShowTagModal] = useState(false);
  const [tagMode, setTagMode] = useState<'add' | 'remove'>('add');
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [tagSel, setTagSel] = useState<Set<string>>(new Set());
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');

  const { data: tags = [] } = useQuery({ queryKey: ['tags'], queryFn: tagsApi.list });

  const bulkTagMutation = useMutation({
    mutationFn: (tagIds: string[]) => contactsApi.bulkTag(Array.from(selectedContacts), tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Tags added');
      setShowTagModal(false); setTagSel(new Set()); setSelectedContacts(new Set());
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to add tags'),
  });

  const bulkUntagMutation = useMutation({
    mutationFn: (tagIds: string[]) => contactsApi.bulkUntag(Array.from(selectedContacts), tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Tags removed');
      setShowTagModal(false); setTagSel(new Set()); setSelectedContacts(new Set());
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to remove tags'),
  });

  // Tags actually present on the current selection — used for the remove view
  const selectionTags = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const c of (contactsData?.data || []) as any[]) {
      if (!selectedContacts.has(c.id)) continue;
      for (const t of (c.tags || []) as Tag[]) map.set(t.id, t);
    }
    return [...map.values()];
  }, [contactsData, selectedContacts]);

  const createTagMutation = useMutation({
    mutationFn: (name: string) => tagsApi.create({ name }),
    onSuccess: (tag: Tag) => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setTagSel((prev) => new Set(prev).add(tag.id));
      setNewTagName('');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create tag'),
  });

  const bulkMoveMutation = useMutation({
    mutationFn: async (toListId: string) => {
      const ids = Array.from(selectedContacts);
      if (activeListId) await listsApi.removeContacts(activeListId, ids);
      await listsApi.addContacts(toListId, ids);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      queryClient.invalidateQueries({ queryKey: ['verification-breakdown'] });
      toast.success('Contacts moved');
      setShowMoveModal(false); setMoveTargetId(null); setSelectedContacts(new Set());
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to move contacts'),
  });

  // Email verification — reuses the existing DCS pipeline (syntax + MX + SMTP)
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const verifyMutation = useMutation({
    mutationFn: (id: string) => verificationApi.verifyContact(id),
    onMutate: (id: string) => setVerifyingIds((prev) => new Set(prev).add(id)),
    onSettled: (_d, _e, id) => setVerifyingIds((prev) => { const n = new Set(prev); n.delete(id as string); return n; }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Verification failed'),
  });
  const batchVerifyMutation = useMutation({
    mutationFn: (ids: string[]) => verificationApi.batchVerify(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
      toast.success('Verification complete');
      setSelectedContacts(new Set());
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Verification failed'),
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
  const pendingOnPage = (contacts as any[]).filter((c) => !c.dcs_verified_at && !c.is_bounced).length;

  const currentListName = activeListId && lists
    ? lists.find((l) => l.id === activeListId)?.name || 'List'
    : 'All Contacts';

  // Collapsible folders (persisted) + drag-and-drop of lists into folders
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem('contacts.collapsedFolders'); return new Set(s ? JSON.parse(s) : []); }
    catch { return new Set(); }
  });
  const toggleFolder = (key: string) => setCollapsedFolders((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { localStorage.setItem('contacts.collapsedFolders', JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });
  const [draggingListId, setDraggingListId] = useState<string | null>(null);
  const [dropFolderKey, setDropFolderKey] = useState<string | null>(null);

  // Configurable table columns (persisted), mapped to our contact fields.
  // Standard column ids come from ALL_COLUMNS; custom fields use a `cf:<key>` id.
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try { const s = localStorage.getItem('contacts.columns'); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return DEFAULT_COLUMNS;
  });
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [colDragIndex, setColDragIndex] = useState<number | null>(null);
  const persistColumns = (next: string[]) => {
    setVisibleColumns(next);
    try { localStorage.setItem('contacts.columns', JSON.stringify(next)); } catch { /* ignore */ }
  };
  const toggleColumn = (id: string) =>
    persistColumns(visibleColumns.includes(id) ? visibleColumns.filter((c) => c !== id) : [...visibleColumns, id]);
  const moveColumn = (from: number, to: number) => {
    if (from === to || to < 0 || to >= visibleColumns.length) return;
    const next = [...visibleColumns];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    persistColumns(next);
  };

  // Discover custom-field keys present on the loaded contacts so they can be
  // surfaced as optional columns (parity with our import field mapping).
  const customFieldKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of (contactsData?.data || []) as any[]) {
      const cf = c?.custom_fields;
      if (cf && typeof cf === 'object') for (const k of Object.keys(cf)) set.add(k);
    }
    return [...set].sort();
  }, [contactsData]);

  // Resolve a column id (standard or `cf:<key>`) to a renderable definition.
  const resolveColumn = (id: string): { id: string; label: string; sortKey?: ContactSortKey; render: (c: any) => React.ReactNode; tdClass?: string } | null => {
    if (id.startsWith('cf:')) {
      const key = id.slice(3);
      return {
        id, label: key, tdClass: 'max-w-[220px]',
        render: (c: any) => c.custom_fields?.[key]
          ? <span className="text-[12.5px] text-[var(--text-secondary)] truncate inline-block max-w-full align-bottom">{c.custom_fields[key]}</span>
          : <span className="text-[12px] text-[var(--text-muted)]">—</span>,
      };
    }
    return ALL_COLUMNS.find((c) => c.id === id) || null;
  };
  // Columns to render, in the user's saved order (standard + custom unified).
  const activeColumns = visibleColumns.map(resolveColumn).filter(Boolean) as { id: string; label: string; sortKey?: ContactSortKey; render: (c: any) => React.ReactNode; tdClass?: string }[];
  // Everything available to add, with a friendly label, minus what's shown.
  const availableColumns = [
    ...ALL_COLUMNS.map((c) => ({ id: c.id as string, label: c.label })),
    ...customFieldKeys.map((k) => ({ id: `cf:${k}`, label: k })),
  ];
  const hiddenColumns = availableColumns.filter((c) => !visibleColumns.includes(c.id));

  return (
    <div>
      {/* Full-width page header */}
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(99,102,241,0.18)]">
            <Users className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title={currentListName}
        description={totalContacts === 0
          ? 'No contacts yet — start building your audience'
          : `${totalContacts.toLocaleString()} contact${totalContacts !== 1 ? 's' : ''} in your database`
        }
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/contacts/import')} className="btn-secondary">
              <Upload className="h-3.5 w-3.5" />
              Import CSV
            </button>
            <button onClick={handleExport} className="btn-secondary">
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
            <button onClick={() => setShowCreateModal(true)} className="btn-primary">
              <Plus className="h-3.5 w-3.5" />
              Add contact
            </button>
          </div>
        }
      />

      {/* Lead-lists rail + contacts table */}
      <div className="flex gap-4 items-start" onClick={() => setListContextMenu(null)}>
        {/* Lead lists rail */}
        <aside className="w-56 flex-shrink-0">
          <div className="sticky top-[60px] panel-inset p-1.5 space-y-0.5">
          {/* All Contacts */}
          <button
            onClick={() => setSearchParams({})}
            className={cn(
              "w-full flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[13px] font-medium transition-all",
              !activeListId
                ? "bg-[var(--indigo-subtle)] text-[var(--indigo)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            )}
          >
            <Users className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 text-left">All Contacts</span>
            <span className={cn(
              "text-[10px] font-semibold tabular px-1.5 rounded",
              !activeListId ? "text-[var(--indigo)]" : "text-[var(--text-tertiary)]"
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
              {groupedLists.map((group) => {
                const isFolder = !!group.folder;
                const folderKey = isFolder ? group.folder!.id : 'uncat';
                const targetFolderId = isFolder ? group.folder!.id : null;
                const collapsed = collapsedFolders.has(folderKey);
                const isDrop = dropFolderKey === folderKey && !!draggingListId;
                const showHeader = isFolder || (group.lists.length > 0 && groupedLists.length > 1);
                return (
                  <div key={folderKey}>
                    {showHeader && (
                      <div
                        onClick={() => toggleFolder(folderKey)}
                        onDragOver={(e) => { if (draggingListId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropFolderKey(folderKey); } }}
                        onDragLeave={() => setDropFolderKey((k) => (k === folderKey ? null : k))}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = e.dataTransfer.getData('text/plain') || draggingListId;
                          if (id) folderMoveMut.mutate({ listId: id, folderId: targetFolderId });
                          setDropFolderKey(null); setDraggingListId(null);
                        }}
                        className={cn(
                          'group/folder flex items-center gap-1.5 px-1.5 h-7 rounded-md cursor-pointer select-none transition-colors',
                          isDrop ? 'bg-[var(--indigo-subtle)] ring-1 ring-[var(--indigo)]/40' : 'hover:bg-[var(--bg-hover)]'
                        )}
                      >
                        <ChevronRight className={cn('h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-150', !collapsed && 'rotate-90')} />
                        <Folder className="h-3 w-3 flex-shrink-0" style={isFolder ? { color: group.folder!.color } : { color: 'var(--text-tertiary)' }} />
                        <span className="flex-1 truncate text-[10.5px] font-semibold uppercase tracking-wider" style={isFolder ? { color: group.folder!.color } : { color: 'var(--text-tertiary)' }}>
                          {isFolder ? group.folder!.name : 'Uncategorised'}
                        </span>
                        {isFolder && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingFolder(group.folder!); setFolderModalOpen(true); }}
                            className="p-0.5 rounded hover:bg-[var(--bg-active)] opacity-0 group-hover/folder:opacity-100 transition-opacity"
                            title="Edit folder"
                          >
                            <Pencil className="h-2.5 w-2.5 text-[var(--text-tertiary)]" />
                          </button>
                        )}
                        <span className="text-[10px] font-semibold tabular text-[var(--text-tertiary)]">{group.lists.length}</span>
                      </div>
                    )}

                    {!collapsed && (
                      <div className={cn('space-y-0.5 mt-0.5', showHeader && 'ml-[11px] pl-1.5 border-l border-[var(--border-subtle)]')}>
                        {group.lists.map((list: any) => (
                          <div
                            key={list.id}
                            className="relative group/list"
                            draggable={renamingListId !== list.id}
                            onDragStart={(e) => { e.dataTransfer.setData('text/plain', list.id); e.dataTransfer.effectAllowed = 'move'; setDraggingListId(list.id); }}
                            onDragEnd={() => { setDraggingListId(null); setDropFolderKey(null); }}
                          >
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
                                  className="w-full px-2 py-1 text-[12px] rounded border border-[var(--indigo)] bg-[var(--bg-elevated)] outline-none"
                                />
                              </form>
                            ) : (
                              <button
                                onClick={() => setSearchParams({ list: list.id })}
                                onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); setListContextMenu({ listId: list.id, x: e.clientX, y: e.clientY }); }}
                                className={cn(
                                  'w-full flex items-center gap-2 h-8 px-2.5 rounded-md text-[12px] font-medium transition-all cursor-grab active:cursor-grabbing',
                                  draggingListId === list.id && 'opacity-50',
                                  activeListId === list.id
                                    ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                                )}
                              >
                                <FolderOpen className="h-3 w-3 flex-shrink-0" />
                                <span className="flex-1 text-left truncate">{list.name}</span>
                                <span className={cn(
                                  'text-[10px] font-semibold tabular',
                                  activeListId === list.id ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]'
                                )}>
                                  {list.contact_count || 0}
                                </span>
                              </button>
                            )}
                          </div>
                        ))}
                        {isFolder && group.lists.length === 0 && (
                          <p className="px-2 py-1 text-[10.5px] text-[var(--text-muted)] italic">
                            {isDrop ? 'Drop to add here' : 'Empty folder'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

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
              className="w-full flex items-center gap-2 h-8 px-2.5 rounded-md text-[12px] font-medium text-[var(--text-secondary)] hover:text-rose-500 hover:bg-rose-500/10 transition-all"
            >
              <ShieldOff className="h-3 w-3 flex-shrink-0" />
              <span className="flex-1 text-left">Do not email</span>
            </Link>
          </div>
        </div>
      </aside>

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
      <div className="flex-1 min-w-0 space-y-4">
        {/* KPI strip */}
        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total contacts" value={stats.total.toLocaleString()} icon={Users} accent="indigo" />
            <StatCard label="Verified" value={(stats.verified ?? 0).toLocaleString()} icon={ShieldCheck} accent="emerald" hint={stats.total > 0 ? `${Math.round((stats.verified / stats.total) * 100)}% of total` : undefined} />
            <StatCard label="Lists" value={lists?.length ?? 0} icon={FolderOpen} accent="violet" />
          </div>
        )}

        {/* Verification summary pills — counts per deliverability state, click to filter */}
        {breakdown && (
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill label="All"        count={breakdown.total}      dot="bg-[var(--text-tertiary)]"            active={statusFilter === ''}           onClick={() => { setStatusFilter(''); setPage(1); }} />
            <StatusPill label="Valid"      count={breakdown.valid}      dot="bg-emerald-500"                       active={statusFilter === 'valid'}      onClick={() => { setStatusFilter((s) => s === 'valid' ? '' : 'valid'); setPage(1); }} />
            <StatusPill label="Risky"      count={breakdown.risky}      dot="bg-amber-500"                         active={statusFilter === 'risky'}      onClick={() => { setStatusFilter((s) => s === 'risky' ? '' : 'risky'); setPage(1); }} />
            <StatusPill label="Invalid"    count={breakdown.invalid}    dot="bg-rose-500"                          active={statusFilter === 'invalid'}    onClick={() => { setStatusFilter((s) => s === 'invalid' ? '' : 'invalid'); setPage(1); }} />
            <StatusPill label="Not found"  count={breakdown.not_found}  dot="bg-slate-400 dark:bg-slate-500"       active={statusFilter === 'not_found'}  onClick={() => { setStatusFilter((s) => s === 'not_found' ? '' : 'not_found'); setPage(1); }} />
            <StatusPill label="Unverified" count={breakdown.unverified} dot="bg-slate-300 dark:bg-slate-600"       active={statusFilter === 'unverified'} onClick={() => { setStatusFilter((s) => s === 'unverified' ? '' : 'unverified'); setPage(1); }} />
            <span className="ml-auto inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-medium bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)]" title="Contacts with a LinkedIn profile on file">
              <Linkedin className="h-3 w-3 text-[#0A66C2]" />
              {breakdown.with_linkedin.toLocaleString()} on LinkedIn
            </span>
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
              className="w-full h-8 pl-8 pr-4 text-[12px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo-subtle)] transition-all"
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

          {/* Live auto-verification indicator */}
          {autoVerifyOn && pendingOnPage > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--indigo)] bg-[var(--indigo-subtle)] px-2.5 h-7 rounded-lg" title="Contacts are being verified in the background">
              <Loader2 className="h-3 w-3 animate-spin" />
              Verifying {pendingOnPage} on this page…
            </span>
          )}

          {/* Column picker — choose which contact fields show in the table */}
          <div className="relative ml-auto">
            <button
              onClick={() => setColumnMenuOpen((o) => !o)}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] font-medium transition-colors',
                columnMenuOpen
                  ? 'border-[var(--indigo)] text-[var(--indigo)] bg-[var(--indigo-subtle)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              )}
              title="Choose columns"
            >
              <Columns3 className="h-3.5 w-3.5" />
              Columns
              <span className="text-[10px] tabular text-[var(--text-tertiary)]">{activeColumns.length}</span>
            </button>
            {columnMenuOpen && (() => {
              const q = columnSearch.trim().toLowerCase();
              const shown = visibleColumns
                .map((id, i) => ({ id, i, label: resolveColumn(id)?.label || id }))
                .filter((c) => !q || c.label.toLowerCase().includes(q));
              const hidden = hiddenColumns.filter((c) => !q || c.label.toLowerCase().includes(q));
              return (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setColumnMenuOpen(false); setColumnSearch(''); }} />
                  <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-xl glass shadow-[var(--shadow-xl)] animate-slide-in overflow-hidden">
                    <div className="p-2 border-b border-[var(--border-subtle)]">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                        <input
                          value={columnSearch}
                          onChange={(e) => setColumnSearch(e.target.value)}
                          placeholder="Search columns…"
                          className="w-full h-8 pl-8 pr-3 text-[12.5px] rounded-md bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--indigo)]"
                        />
                      </div>
                    </div>

                    <div className="max-h-[320px] overflow-y-auto p-1.5">
                      {/* Shown — drag to reorder, eye to hide */}
                      <p className="flex items-center justify-between px-1.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                        Shown
                        {!q && <span className="font-data normal-case tracking-normal text-[var(--text-muted)]">drag to reorder</span>}
                      </p>
                      {shown.length === 0 && <p className="px-2 py-1.5 text-[12px] text-[var(--text-tertiary)]">No matching columns.</p>}
                      {shown.map(({ id, i, label }) => (
                        <div
                          key={id}
                          draggable={!q}
                          onDragStart={() => setColDragIndex(i)}
                          onDragOver={(e) => { if (colDragIndex !== null) e.preventDefault(); }}
                          onDrop={(e) => { e.preventDefault(); if (colDragIndex !== null) moveColumn(colDragIndex, i); setColDragIndex(null); }}
                          onDragEnd={() => setColDragIndex(null)}
                          className={cn(
                            'group/col flex items-center gap-1.5 px-1.5 h-8 rounded-lg transition-colors',
                            colDragIndex === i ? 'opacity-50' : 'hover:bg-[var(--bg-hover)]'
                          )}
                        >
                          {!q && <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-muted)] cursor-grab active:cursor-grabbing" />}
                          <span className="flex-1 text-[12.5px] text-[var(--text-primary)] truncate">{label}</span>
                          <button onClick={() => toggleColumn(id)} title="Hide column" className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)]">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}

                      {hidden.length > 0 && (
                        <>
                          <p className="px-1.5 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Add columns</p>
                          {hidden.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => toggleColumn(c.id)}
                              className="w-full flex items-center gap-1.5 px-1.5 h-8 rounded-lg text-left hover:bg-[var(--bg-hover)] transition-colors"
                            >
                              <EyeOff className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-muted)]" />
                              <span className="flex-1 text-[12.5px] text-[var(--text-secondary)] truncate">{c.label}</span>
                              <Plus className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                            </button>
                          ))}
                        </>
                      )}
                    </div>

                    <div className="border-t border-[var(--border-subtle)] p-1.5">
                      <button
                        onClick={() => { persistColumns(DEFAULT_COLUMNS); setColumnSearch(''); }}
                        className="w-full flex items-center gap-2 px-1.5 h-8 rounded-lg text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset to default
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* Bulk actions bar */}
        {someSelected && (
          <div className="flex items-center gap-4 mb-5 px-4 py-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)] animate-fade-in">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-[var(--indigo)] text-white text-[11px] font-bold">
                {selectedContacts.size}
              </span>
              <span className="text-sm font-medium text-[var(--text-primary)]">
                contact{selectedContacts.size !== 1 ? 's' : ''} selected
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => batchVerifyMutation.mutate(Array.from(selectedContacts))}
                disabled={batchVerifyMutation.isPending}
                className="btn-secondary text-sm h-8 rounded-lg disabled:opacity-50"
              >
                {batchVerifyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Verify emails
              </button>
              <button onClick={() => { setTagMode('add'); setTagSel(new Set()); setShowTagModal(true); }} className="btn-secondary text-sm h-8 rounded-lg">
                <TagIcon className="h-3.5 w-3.5" />
                Add tags
              </button>
              <button onClick={() => { setTagMode('remove'); setTagSel(new Set()); setShowTagModal(true); }} className="btn-secondary text-sm h-8 rounded-lg">
                <TagIcon className="h-3.5 w-3.5" />
                Remove tags
              </button>
              <button onClick={() => setShowAddToListModal(true)} className="btn-secondary text-sm h-8 rounded-lg">
                <FolderOpen className="h-3.5 w-3.5" />
                Add to list
              </button>
              {activeListId && (
                <button onClick={() => { setMoveTargetId(null); setShowMoveModal(true); }} className="btn-secondary text-sm h-8 rounded-lg">
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Move
                </button>
              )}
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
          <div className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-1/4" />
                  <Skeleton className="h-2.5 w-2/5" />
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        ) : contacts.length === 0 ? (
          /* Empty state */
          <div className="panel">
            <EmptyState
              icon={Users}
              title="No contacts yet"
              description="Get started by adding your first contact manually or importing a CSV file with your existing data."
              actionLabel="Add contact"
              onAction={() => setShowCreateModal(true)}
              secondaryActionLabel="Import CSV"
              onSecondaryAction={() => navigate('/contacts/import')}
            />
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-[3] bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] w-[44px] pl-4 pr-2 py-2">
                      <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected && !allSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all contacts"
                      />
                    </th>
                    <th className="sticky left-[44px] z-[3] bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] min-w-[240px] px-3 py-2 shadow-[inset_-1px_0_0_var(--border-subtle)]">
                      <SortableHeader label="Contact" colKey="first_name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    {activeColumns.map((col) => (
                      <th key={col.id} className="bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] px-4 py-2 whitespace-nowrap min-w-[150px]">
                        {col.sortKey
                          ? <SortableHeader label={col.label} colKey={col.sortKey} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                          : <span className="font-data text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{col.label}</span>}
                      </th>
                    ))}
                    <th className="sticky right-0 z-[3] bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] w-[112px] px-2 py-2 shadow-[inset_1px_0_0_var(--border-subtle)]" />
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact: any) => {
                    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
                    const isSelected = selectedContacts.has(contact.id);
                    // Frozen cells need an opaque bg so scrolled content can't show through.
                    const frozenBg = isSelected
                      ? 'bg-[var(--bg-active)]'
                      : 'bg-[var(--bg-surface)] group-hover:bg-[var(--bg-hover)]';
                    return (
                      <tr
                        key={contact.id}
                        onClick={() => navigate(`/contacts/${contact.id}`)}
                        className={cn(
                          'group cursor-pointer transition-colors duration-150',
                          isSelected ? 'bg-[var(--indigo-subtle)]' : 'hover:bg-[var(--bg-hover)]'
                        )}
                      >
                        <td className={cn('sticky left-0 z-[1] w-[44px] pl-4 pr-2 py-2 relative border-b border-[var(--border-subtle)]', frozenBg)}>
                          {isSelected && <span className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-[var(--indigo)]" />}
                          <Checkbox
                            checked={isSelected}
                            onChange={() => toggleSelectContact(contact.id)}
                            aria-label={`Select ${fullName || contact.email}`}
                          />
                        </td>
                        <td className={cn('sticky left-[44px] z-[1] min-w-[240px] px-3 py-2 border-b border-[var(--border-subtle)] shadow-[inset_-1px_0_0_var(--border-subtle)]', frozenBg)}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={fullName || contact.email} email={contact.email} size="sm" />
                            <div className="min-w-0">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="block text-[12.5px] font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--indigo)] transition-colors">
                                  {fullName || 'Unnamed contact'}
                                </span>
                                <LinkedInGlyph url={contact.linkedin_url} />
                              </span>
                              <p className="text-[11px] text-[var(--text-tertiary)] truncate leading-tight">
                                {contact.job_title || 'No title'}
                              </p>
                            </div>
                          </div>
                        </td>
                        {activeColumns.map((col) => (
                          <td key={col.id} className={cn('px-4 py-2 whitespace-nowrap border-b border-[var(--border-subtle)] min-w-[150px]', col.tdClass)}>
                            {col.render(contact)}
                          </td>
                        ))}
                        <td className={cn('sticky right-0 z-[1] w-[112px] px-2 py-2 border-b border-[var(--border-subtle)] shadow-[inset_1px_0_0_var(--border-subtle)]', frozenBg)} onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              onClick={() => verifyMutation.mutate(contact.id)}
                              disabled={verifyingIds.has(contact.id)}
                              className="icon-btn hover:text-[var(--indigo)] hover:bg-[var(--indigo-subtle)]"
                              title="Verify email"
                            >
                              {verifyingIds.has(contact.id)
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <ShieldCheck className="h-3.5 w-3.5" />}
                            </button>
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
      </div>

      {/* Create/Edit Contact Modal */}
      {showCreateModal && (() => {
        const previewName = [form.first_name, form.last_name].filter(Boolean).join(' ');
        const previewSub = [form.job_title, form.company].filter(Boolean).join(' · ');
        return (
          <Modal
            isOpen={showCreateModal}
            onClose={closeCreateModal}
            title={editId ? 'Edit contact' : 'Add contact'}
            description={editId ? 'Update this contact’s details.' : 'Create a new contact in your database.'}
            size="lg"
            footer={
              <>
                <Button variant="secondary" size="md" onClick={closeCreateModal}>Cancel</Button>
                <Button
                  type="submit"
                  form="contact-form"
                  size="md"
                  disabled={createMutation.isPending || !form.email.trim()}
                >
                  {createMutation.isPending ? 'Saving…' : editId ? 'Save changes' : 'Add contact'}
                </Button>
              </>
            }
          >
            <form
              id="contact-form"
              onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }}
              className="space-y-4"
            >
              {/* Live identity preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                <Avatar name={previewName || form.email || 'New'} email={form.email} size="lg" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                    {previewName || 'New contact'}
                  </p>
                  <p className="text-[12px] text-[var(--text-tertiary)] truncate">
                    {previewSub || form.email || 'Fill in the details below'}
                  </p>
                </div>
              </div>

              <Input
                label="Email address"
                type="email"
                required
                autoFocus
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="contact@company.com"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input label="First name" value={form.first_name || ''} onChange={(e) => setForm({ ...form, first_name: e.target.value })} placeholder="John" />
                <Input label="Last name" value={form.last_name || ''} onChange={(e) => setForm({ ...form, last_name: e.target.value })} placeholder="Doe" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Company" value={form.company || ''} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Inc." />
                <Input label="Job title" value={form.job_title || ''} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Head of Growth" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 1234" />
                <Input label="Website" value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="company.com" />
              </div>
              <Input label="LinkedIn URL" value={form.linkedin_url || ''} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} placeholder="linkedin.com/in/…" />
            </form>
          </Modal>
        );
      })()}

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
        <Modal
          isOpen={showListModal}
          onClose={closeListModal}
          title={editingList ? 'Edit list' : 'Create list'}
          description={editingList ? 'Update this list’s details.' : 'Organise contacts into a list.'}
          size="sm"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={closeListModal}>Cancel</Button>
              <Button type="submit" form="list-form" size="md" disabled={createListMutation.isPending || !listForm.name.trim()}>
                {createListMutation.isPending ? 'Saving…' : editingList ? 'Save changes' : 'Create list'}
              </Button>
            </>
          }
        >
          <form id="list-form" onSubmit={(e) => { e.preventDefault(); createListMutation.mutate(listForm); }}>
            <Input
              label="List name"
              required
              autoFocus
              value={listForm.name}
              onChange={(e) => setListForm({ ...listForm, name: e.target.value })}
              placeholder="e.g. Hot Leads, Enterprise, Q1 Prospects"
            />
          </form>
        </Modal>
      )}

      {/* Add to List Modal */}
      {showAddToListModal && (
        <Modal
          isOpen={showAddToListModal}
          onClose={() => setShowAddToListModal(false)}
          title="Add to list"
          description={`Add ${selectedContacts.size} contact${selectedContacts.size !== 1 ? 's' : ''} to a list.`}
          size="sm"
        >
          <div className="space-y-1.5 max-h-64 overflow-y-auto -mx-1 px-1">
            {(lists || []).length === 0 && (
              <p className="text-[12.5px] text-[var(--text-tertiary)] text-center py-4">No lists yet — create one below.</p>
            )}
            {lists?.map((list) => (
              <button
                key={list.id}
                onClick={() => addToListMutation.mutate({ listId: list.id, contactIds: Array.from(selectedContacts) })}
                disabled={addToListMutation.isPending}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 group"
              >
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)] group-hover:bg-[var(--indigo-subtle)] group-hover:text-[var(--indigo)] transition-colors">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <span className="flex-1 text-left text-[13px] font-medium text-[var(--text-primary)] truncate">
                  {list.name}
                </span>
                <span className="text-[11.5px] font-semibold tabular text-[var(--text-tertiary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full">
                  {list.contact_count}
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={() => { setShowAddToListModal(false); setShowListModal(true); }}
            className="w-full flex items-center justify-center gap-2 mt-3 py-2.5 border border-dashed border-[var(--border-default)] rounded-xl text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)] hover:bg-[var(--indigo-subtle)] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create new list
          </button>
        </Modal>
      )}

      {/* Add / Remove Tags Modal */}
      {showTagModal && (() => {
        const removing = tagMode === 'remove';
        const choices = removing ? selectionTags : tags;
        return (
          <Modal
            isOpen={showTagModal}
            onClose={() => setShowTagModal(false)}
            title={removing ? 'Remove tags' : 'Add tags'}
            description={`${removing ? 'Remove tags from' : 'Tag'} ${selectedContacts.size} contact${selectedContacts.size !== 1 ? 's' : ''}.`}
            size="sm"
            footer={
              <>
                <Button variant="secondary" size="md" onClick={() => setShowTagModal(false)}>Cancel</Button>
                <Button
                  size="md"
                  variant={removing ? 'danger' : 'primary'}
                  disabled={tagSel.size === 0 || bulkTagMutation.isPending || bulkUntagMutation.isPending}
                  onClick={() => (removing ? bulkUntagMutation : bulkTagMutation).mutate(Array.from(tagSel))}
                >
                  {(removing ? bulkUntagMutation.isPending : bulkTagMutation.isPending)
                    ? (removing ? 'Removing…' : 'Applying…')
                    : `${removing ? 'Remove' : 'Apply'} ${tagSel.size || ''} tag${tagSel.size !== 1 ? 's' : ''}`.replace('  ', ' ').trim()}
                </Button>
              </>
            }
          >
            {!removing && (
              <form
                onSubmit={(e) => { e.preventDefault(); if (newTagName.trim()) createTagMutation.mutate(newTagName.trim()); }}
                className="flex gap-2 mb-3"
              >
                <Input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Create a new tag…" className="flex-1" />
                <Button type="submit" variant="secondary" size="md" disabled={!newTagName.trim() || createTagMutation.isPending}>Add</Button>
              </form>
            )}
            <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
              {choices.length === 0 && (
                <p className="text-[12.5px] text-[var(--text-tertiary)] py-2">
                  {removing ? 'The selected contacts have no tags to remove.' : 'No tags yet — create one above.'}
                </p>
              )}
              {choices.map((tag) => {
                const on = tagSel.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setTagSel((prev) => { const n = new Set(prev); n.has(tag.id) ? n.delete(tag.id) : n.add(tag.id); return n; })}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-medium border transition-colors',
                      on
                        ? (removing
                            ? 'bg-rose-500/10 border-rose-500 text-rose-600 dark:text-rose-400'
                            : 'bg-[var(--indigo-subtle)] border-[var(--indigo)] text-[var(--indigo)]')
                        : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)]'
                    )}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: (tag as any).color || 'var(--text-tertiary)' }} />
                    {tag.name}
                    {on && <Check className="h-3 w-3" />}
                  </button>
                );
              })}
            </div>
          </Modal>
        );
      })()}

      {/* Move to List Modal (moves selected out of the current list into another) */}
      {showMoveModal && (
        <Modal
          isOpen={showMoveModal}
          onClose={() => setShowMoveModal(false)}
          title="Move to list"
          description={`Move ${selectedContacts.size} contact${selectedContacts.size !== 1 ? 's' : ''} to another list. Lists drive campaign membership.`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setShowMoveModal(false)}>Cancel</Button>
              <Button size="md" disabled={!moveTargetId || bulkMoveMutation.isPending} onClick={() => moveTargetId && bulkMoveMutation.mutate(moveTargetId)}>
                {bulkMoveMutation.isPending ? 'Moving…' : 'Move'}
              </Button>
            </>
          }
        >
          <div className="space-y-1.5 max-h-64 overflow-y-auto -mx-1 px-1">
            {(lists || []).filter((l) => l.id !== activeListId).length === 0 && (
              <p className="text-[12.5px] text-[var(--text-tertiary)] text-center py-4">No other lists to move to.</p>
            )}
            {(lists || []).filter((l) => l.id !== activeListId).map((list) => (
              <button
                key={list.id}
                onClick={() => setMoveTargetId(list.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors border',
                  moveTargetId === list.id ? 'bg-[var(--indigo-subtle)] border-[var(--indigo)]/30' : 'hover:bg-[var(--bg-hover)] border-transparent'
                )}
              >
                <FolderOpen className={cn('h-4 w-4', moveTargetId === list.id ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')} />
                <span className="flex-1 text-left text-[13px] font-medium text-[var(--text-primary)] truncate">{list.name}</span>
                {moveTargetId === list.id && <Check className="h-4 w-4 text-[var(--indigo)]" />}
              </button>
            ))}
          </div>
        </Modal>
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
    <Modal
      isOpen
      onClose={onClose}
      title={initial ? 'Edit folder' : 'New folder'}
      description={initial ? 'Rename or recolour this folder.' : 'Group related lead lists together.'}
      size="sm"
      footer={
        <div className="flex items-center justify-between w-full">
          {initial ? (
            <button
              onClick={() => { if (confirm(`Delete folder "${initial.name}"? Lists inside will not be deleted.`)) deleteMut.mutate(); }}
              className="text-[12px] font-medium text-[var(--error)] hover:underline"
            >
              Delete folder
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="folder-form" size="md" disabled={!name.trim() || saveMut.isPending}>
              {saveMut.isPending ? 'Saving…' : (initial ? 'Save changes' : 'Create folder')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="folder-form" onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-4">
        <Input label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 Prospects" />
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
