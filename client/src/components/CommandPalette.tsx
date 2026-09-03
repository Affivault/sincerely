import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Users, Megaphone, Inbox, BarChart3, Settings,
  FileText, Webhook, Send, Globe, ShieldOff, ShieldCheck, UserPlus,
  CalendarClock, Wrench, Plus, Search, Sun, Moon, LogOut, CornerDownLeft, Blocks,
  ArrowUp, ArrowDown, Handshake, ListTodo, CalendarDays, Phone, Mail,
  CheckSquare, Loader2, Building2, Radar, Linkedin, Sparkles, type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDebounce } from '../hooks/useDebounce';
import { searchApi } from '../api/search.api';
import { openModals } from './ui/Modal';
import { getRecentItems, addRecentItem, type RecentItem } from '../lib/recentItems';
import { usePeek } from './peek/usePeek';
import { crmApi } from '../api/crm.api';
import toast from 'react-hot-toast';
import {
  parseQuickAdd, SEARCH_TYPE_LABEL,
  type SearchHit, type SearchHitType, type QuickAddKind,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Command palette.

   Search is meant to be the primary navigation, not a shortcut to the nav.
   So this looks across every object the user owns — people, deals, emails,
   lists, activities, meetings, templates — and can create work outright
   when what you typed reads like an instruction ("call ada tomorrow 3pm").
   ═══════════════════════════════════════════════════════════════════════ */

interface CommandItem {
  id: string;
  label: string;
  /** Second line, for record hits. */
  sublabel?: string | null;
  /** Right-aligned hint. */
  meta?: string | null;
  icon: LucideIcon;
  group: string;
  keywords?: string;
  href?: string;
  run?: () => void;
  /** Set on record hits that can open in the peek drawer. */
  peek?: { type: 'contact' | 'deal' | 'company'; id: string };
}

const HIT_ICON: Record<SearchHitType, LucideIcon> = {
  contact: Users,
  company: Building2,
  deal: Handshake,
  campaign: Megaphone,
  list: Users,
  activity: ListTodo,
  meeting: CalendarDays,
  template: FileText,
  message: Inbox,
};

const QUICK_ADD_ICON: Record<QuickAddKind, LucideIcon> = {
  call: Phone,
  meeting: CalendarDays,
  email: Mail,
  todo: CheckSquare,
  deal: Handshake,
};

const QUICK_ADD_VERB: Record<QuickAddKind, string> = {
  call: 'Log a call',
  meeting: 'Book a meeting',
  email: 'Schedule an email',
  todo: 'Add a to-do',
  deal: 'Create a deal',
};

/** Record groups come first — you searched for a thing, not a page. */
const GROUP_ORDER = [
  'Recent',
  'Create',
  ...Object.values(SEARCH_TYPE_LABEL),
  'Navigate',
  'Actions',
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { openPeek } = usePeek();
  const { theme, toggleTheme } = useTheme();
  const { signOut } = useAuth();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const identity = useRef({});

  const staticItems = useMemo<CommandItem[]>(() => [
    // Navigate
    { id: 'nav-dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Navigate', href: '/dashboard', keywords: 'home overview performance stats numbers' },
    { id: 'nav-inbox', label: 'Unibox', icon: Inbox, group: 'Navigate', href: '/inbox', keywords: 'messages replies email' },
    { id: 'nav-deals', label: 'Deals', icon: Handshake, group: 'Navigate', href: '/deals', keywords: 'pipeline crm opportunities' },
    { id: 'nav-calendar', label: 'Calendar', icon: CalendarDays, group: 'Navigate', href: '/calendar', keywords: 'meetings schedule diary' },
    { id: 'nav-tasks', label: 'Activities', icon: ListTodo, group: 'Navigate', href: '/tasks', keywords: 'tasks todo follow-ups calls' },
    { id: 'nav-campaigns', label: 'Campaigns', icon: Megaphone, group: 'Navigate', href: '/campaigns', keywords: 'sequences outreach' },
    { id: 'nav-analytics', label: 'Analytics', icon: BarChart3, group: 'Navigate', href: '/analytics', keywords: 'stats reports metrics' },
    { id: 'nav-templates', label: 'Templates', icon: FileText, group: 'Navigate', href: '/templates', keywords: 'emails snippets' },
    { id: 'nav-schedules', label: 'Schedules', icon: CalendarClock, group: 'Navigate', href: '/schedules', keywords: 'sending times' },
    { id: 'nav-leads', label: 'Lead lists', icon: Users, group: 'Navigate', href: '/leads', keywords: 'leads prospects outreach audience lists cold' },
    { id: 'nav-leads-inbox', label: 'Leads inbox', icon: Sparkles, group: 'Navigate', href: '/leads/inbox', keywords: 'triage interested reply queue decisions' },
    { id: 'nav-contacts', label: 'Contacts', icon: Users, group: 'Navigate', href: '/contacts', keywords: 'contacts crm customers relationships people lists' },
    { id: 'nav-companies', label: 'Companies', icon: Building2, group: 'Navigate', href: '/companies', keywords: 'accounts organisations organizations firms' },
    { id: 'nav-prospector', label: 'Prospector', icon: Radar, group: 'Navigate', href: '/prospector', keywords: 'find leads search database discover' },
    { id: 'nav-smtp', label: 'Email accounts', icon: Send, group: 'Navigate', href: '/email-accounts', keywords: 'mailbox sender smtp' },
    { id: 'nav-domains', label: 'Domains & DNS', icon: Globe, group: 'Navigate', href: '/email-accounts', keywords: 'dns spf dkim deliverability authentication' },
    { id: 'nav-verification', label: 'Verification', icon: ShieldCheck, group: 'Navigate', href: '/verification', keywords: 'validate dcs score' },
    { id: 'nav-suppression', label: 'Suppression', icon: ShieldOff, group: 'Navigate', href: '/suppression', keywords: 'blocklist unsubscribe' },
    { id: 'nav-linkedin', label: 'LinkedIn', icon: Linkedin, group: 'Navigate', href: '/linkedin', keywords: 'connect invite outreach social extension agent' },
    { id: 'nav-integrations', label: 'Integrations', icon: Blocks, group: 'Navigate', href: '/integrations', keywords: 'slack discord telegram zapier make hubspot pipedrive connect apps' },
    { id: 'nav-webhooks', label: 'Webhooks', icon: Webhook, group: 'Navigate', href: '/developer', keywords: 'api developer events' },
    { id: 'nav-toolkit', label: 'Toolkit', icon: Wrench, group: 'Navigate', href: '/toolkit', keywords: 'tools utilities' },
    { id: 'nav-team', label: 'Team', icon: UserPlus, group: 'Navigate', href: '/team', keywords: 'members invite seats' },
    { id: 'nav-settings', label: 'Settings', icon: Settings, group: 'Navigate', href: '/settings', keywords: 'preferences account' },
    // Create
    { id: 'new-campaign', label: 'New campaign', icon: Plus, group: 'Create', href: '/campaigns/new', keywords: 'create sequence add' },
    { id: 'import-contacts', label: 'Import contacts', icon: Users, group: 'Create', href: '/contacts/import', keywords: 'upload csv add leads' },
    { id: 'new-deal', label: 'New deal', icon: Handshake, group: 'Create', href: '/deals', keywords: 'opportunity pipeline add' },
    // Actions
    {
      id: 'toggle-theme',
      label: theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode',
      icon: theme === 'light' ? Moon : Sun,
      group: 'Actions',
      keywords: 'theme appearance dark light toggle',
      run: () => { toggleTheme(); onClose(); },
    },
    { id: 'sign-out', label: 'Sign out', icon: LogOut, group: 'Actions', keywords: 'logout exit leave', run: () => { signOut(); onClose(); } },
  ], [theme, toggleTheme, signOut, onClose]);

  const debouncedQuery = useDebounce(query, 180);
  const trimmed = debouncedQuery.trim();

  const { data: results, isFetching } = useQuery({
    queryKey: ['search', trimmed],
    queryFn: () => searchApi.query(trimmed),
    enabled: open && trimmed.length >= 2,
    staleTime: 15_000,
  });

  /* ── Quick add ──────────────────────────────────────────────────────
     Parsed off the raw query, not the debounced one, so the offer appears
     as you type rather than a beat behind. */
  const quickAdd = useMemo(() => parseQuickAdd(query), [query]);

  const createQuick = useMutation({
    mutationFn: async () => {
      if (!quickAdd) return null;
      if (quickAdd.kind === 'deal') {
        return crmApi.createDeal({ title: quickAdd.subject });
      }
      if (quickAdd.kind === 'meeting') {
        return crmApi.createEvent({
          title: quickAdd.subject,
          type: 'meeting',
          starts_at: quickAdd.when || new Date().toISOString(),
        });
      }
      return crmApi.createTask({
        title: quickAdd.subject,
        type: quickAdd.kind === 'call' ? 'call' : quickAdd.kind === 'email' ? 'email' : 'todo',
        due_date: quickAdd.when,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success(quickAdd?.kind === 'deal' ? 'Deal created' : quickAdd?.kind === 'meeting' ? 'Meeting booked' : 'Activity scheduled');
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not create that'),
  });

  const hitItems = useMemo<CommandItem[]>(() => {
    if (trimmed.length < 2) return [];
    return (results?.hits ?? []).map((h: SearchHit) => ({
      id: `${h.type}-${h.id}`,
      label: h.title,
      sublabel: h.subtitle,
      meta: h.meta,
      icon: HIT_ICON[h.type] || Search,
      group: SEARCH_TYPE_LABEL[h.type],
      href: h.href,
      // People and deals open over the page you're on. Everything else is a
      // destination, so it still navigates.
      peek: h.type === 'contact' || h.type === 'deal' || h.type === 'company'
        ? { type: h.type, id: h.id }
        : undefined,
    }));
  }, [results, trimmed]);

  const quickItem = useMemo<CommandItem[]>(() => {
    if (!quickAdd) return [];
    return [{
      id: 'quick-add',
      label: `${QUICK_ADD_VERB[quickAdd.kind]}: ${quickAdd.subject}`,
      sublabel: quickAdd.whenLabel ? `Scheduled for ${quickAdd.whenLabel}` : 'No date — add one later',
      icon: QUICK_ADD_ICON[quickAdd.kind],
      group: 'Create',
      run: () => createQuick.mutate(),
    }];
  }, [quickAdd, createQuick]);

  // Re-read on every open, not just once — a peek opened elsewhere since the
  // palette last opened should still show up.
  const [recents, setRecents] = useState<RecentItem[]>([]);
  useEffect(() => { if (open) setRecents(getRecentItems()); }, [open]);

  const recentItems = useMemo<CommandItem[]>(() => recents.map((r) => ({
    id: `recent-${r.type}-${r.id}`,
    label: r.label,
    sublabel: r.sublabel,
    icon: HIT_ICON[r.type] || Search,
    group: 'Recent',
    peek: { type: r.type, id: r.id },
  })), [recents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...recentItems, ...staticItems];
    const staticMatches = staticItems.filter((it) =>
      `${it.label} ${it.group} ${it.keywords ?? ''}`.toLowerCase().includes(q)
    );
    return [...quickItem, ...hitItems, ...staticMatches];
  }, [staticItems, hitItems, quickItem, recentItems, query]);

  // Group, keeping the flat order the keyboard walks through.
  const groups = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const it of filtered) {
      const arr = map.get(it.group) ?? [];
      arr.push(it);
      map.set(it.group, arr);
    }
    return [...map.entries()].sort(
      (a, b) => (GROUP_ORDER.indexOf(a[0]) + 1 || 99) - (GROUP_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [filtered]);

  /** Keyboard order must match render order, or Enter picks the wrong row. */
  const flatItems = useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Re-anchor whenever the result set changes shape, so a highlighted row
  // can't silently become a different record once search resolves under it.
  useEffect(() => { setActive(0); }, [flatItems]);

  const runItem = (item: CommandItem) => {
    if (item.run) { item.run(); return; }
    if (item.peek) {
      addRecentItem({ type: item.peek.type, id: item.peek.id, label: item.label, sublabel: item.sublabel });
      openPeek(item.peek.type, item.peek.id);
      onClose();
      return;
    }
    if (item.href) { navigate(item.href); onClose(); }
  };

  // Join the shared modal stack so Escape only closes us when we're the
  // topmost overlay — otherwise dismissing a Modal opened from a command
  // (e.g. a confirm dialog) also closed the palette underneath it.
  useEffect(() => {
    if (!open) return;
    const self = identity.current;
    openModals.push(self);
    return () => {
      const at = openModals.lastIndexOf(self);
      if (at !== -1) openModals.splice(at, 1);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const self = identity.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (openModals[openModals.length - 1] !== self) return;
        e.preventDefault(); onClose();
      }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flatItems.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); const it = flatItems[active]; if (it) runItem(it); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, flatItems, active]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  const searching = isFetching && trimmed.length >= 2;
  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[3px] animate-fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-[600px] overflow-hidden rounded-[14px] glass shadow-[var(--shadow-xl)]"
        style={{ animation: 'cmdkIn 200ms var(--ease-out) both' }}
      >
        {/* Search row */}
        <div className="flex items-center gap-2.5 px-4 h-[52px] border-b border-[var(--border-subtle)]">
          {searching
            ? <Loader2 className="h-4 w-4 text-[var(--indigo)] flex-shrink-0 animate-spin" />
            : <Search className="h-4 w-4 text-[var(--text-tertiary)] flex-shrink-0" strokeWidth={2} />}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people, deals, emails… or type “call ada tomorrow 3pm”"
            className="flex-1 bg-transparent text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          />
          <kbd className="kbd flex-shrink-0">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[min(60vh,460px)] overflow-y-auto py-2">
          {flatItems.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[13px] text-[var(--text-secondary)]">
                {searching ? 'Searching…' : `No results for “${query}”`}
              </p>
              <p className="text-[12px] text-[var(--text-tertiary)] mt-1">
                Try a name, a company, an email subject — or start with “call”, “meet” or “deal” to create something.
              </p>
            </div>
          ) : (
            groups.map(([group, groupItems]) => (
              <div key={group} className="px-2 mb-1 last:mb-0">
                <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  {group}
                </div>
                {groupItems.map((item) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  const isActive = index === active;
                  const Icon = item.icon;
                  const busy = item.id === 'quick-add' && createQuick.isPending;
                  return (
                    <button
                      key={item.id}
                      data-index={index}
                      onClick={() => runItem(item)}
                      onMouseMove={() => setActive(index)}
                      className={cn(
                        'group/cmd w-full flex items-center gap-3 px-2 py-1.5 rounded-[8px] text-left transition-colors duration-100',
                        isActive ? 'bg-[var(--indigo-subtle)]' : 'hover:bg-[var(--bg-hover)]'
                      )}
                    >
                      <span className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0 transition-colors',
                        isActive ? 'bg-[var(--indigo)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                      )}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" strokeWidth={2} />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className={cn(
                          'block text-[13px] truncate',
                          isActive ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'
                        )}>
                          {item.label}
                        </span>
                        {item.sublabel && (
                          <span className="block text-[11px] text-[var(--text-tertiary)] truncate">{item.sublabel}</span>
                        )}
                      </span>
                      {item.meta && (
                        <span className="hidden sm:block text-[11px] text-[var(--text-tertiary)] truncate max-w-[34%] flex-shrink-0">
                          {item.meta}
                        </span>
                      )}
                      {isActive && (
                        <CornerDownLeft className="h-3.5 w-3.5 text-[var(--indigo)] flex-shrink-0" strokeWidth={2} />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 h-9 border-t border-[var(--border-subtle)] bg-[var(--bg-muted)]/60 text-[11px] text-[var(--text-tertiary)]">
          <span className="flex items-center gap-1.5">
            <kbd className="kbd"><ArrowUp className="h-2.5 w-2.5" /></kbd>
            <kbd className="kbd"><ArrowDown className="h-2.5 w-2.5" /></kbd>
            to navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd"><CornerDownLeft className="h-2.5 w-2.5" /></kbd>
            to select
          </span>
          {results && trimmed.length >= 2 && (
            <span className="ml-auto tabular">
              {results.hits.length} result{results.hits.length === 1 ? '' : 's'} · {results.took_ms}ms
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
