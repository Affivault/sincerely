import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Megaphone, Inbox, BarChart3, Settings,
  FileText, Webhook, Send, Globe, ShieldOff, ShieldCheck, UserPlus,
  CalendarClock, Wrench, Plus, Search, Sun, Moon, LogOut, CornerDownLeft,
  ArrowUp, ArrowDown, type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

interface CommandItem {
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
  /** extra search terms */
  keywords?: string;
  /** navigation target */
  href?: string;
  /** custom action — takes precedence over href */
  run?: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { signOut } = useAuth();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<CommandItem[]>(() => [
    // Navigate
    { id: 'nav-dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Navigate', href: '/dashboard', keywords: 'home overview' },
    { id: 'nav-inbox', label: 'Unibox', icon: Inbox, group: 'Navigate', href: '/inbox', keywords: 'messages replies email' },
    { id: 'nav-campaigns', label: 'Campaigns', icon: Megaphone, group: 'Navigate', href: '/campaigns', keywords: 'sequences outreach' },
    { id: 'nav-analytics', label: 'Analytics', icon: BarChart3, group: 'Navigate', href: '/analytics', keywords: 'stats reports metrics' },
    { id: 'nav-templates', label: 'Templates', icon: FileText, group: 'Navigate', href: '/templates', keywords: 'emails snippets' },
    { id: 'nav-schedules', label: 'Schedules', icon: CalendarClock, group: 'Navigate', href: '/schedules', keywords: 'sending times' },
    { id: 'nav-contacts', label: 'Lead Lists', icon: Users, group: 'Navigate', href: '/contacts', keywords: 'leads people audience' },
    { id: 'nav-smtp', label: 'Email accounts', icon: Send, group: 'Navigate', href: '/email-accounts', keywords: 'mailbox sender smtp' },
    { id: 'nav-domains', label: 'Domains & DNS', icon: Globe, group: 'Navigate', href: '/email-accounts', keywords: 'dns spf dkim deliverability authentication' },
    { id: 'nav-verification', label: 'Verification', icon: ShieldCheck, group: 'Navigate', href: '/verification', keywords: 'validate dcs score' },
    { id: 'nav-suppression', label: 'Suppression', icon: ShieldOff, group: 'Navigate', href: '/suppression', keywords: 'blocklist unsubscribe' },
    { id: 'nav-webhooks', label: 'Webhooks', icon: Webhook, group: 'Navigate', href: '/developer', keywords: 'api developer events' },
    { id: 'nav-toolkit', label: 'Toolkit', icon: Wrench, group: 'Navigate', href: '/toolkit', keywords: 'tools utilities' },
    { id: 'nav-team', label: 'Team', icon: UserPlus, group: 'Navigate', href: '/team', keywords: 'members invite seats' },
    { id: 'nav-settings', label: 'Settings', icon: Settings, group: 'Navigate', href: '/settings', keywords: 'preferences account' },
    // Create
    { id: 'new-campaign', label: 'New campaign', icon: Plus, group: 'Create', href: '/campaigns/new', keywords: 'create sequence add' },
    { id: 'import-contacts', label: 'Import contacts', icon: Users, group: 'Create', href: '/contacts/import', keywords: 'upload csv add leads' },
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      `${it.label} ${it.group} ${it.keywords ?? ''}`.toLowerCase().includes(q)
    );
  }, [items, query]);

  // Group while preserving the flat order used for keyboard navigation
  const groups = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const it of filtered) {
      const arr = map.get(it.group) ?? [];
      arr.push(it);
      map.set(it.group, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  // Reset state whenever the palette opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus on next frame so the element is mounted
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  const runItem = (item: CommandItem) => {
    if (item.run) { item.run(); return; }
    if (item.href) { navigate(item.href); onClose(); }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); const it = filtered[active]; if (it) runItem(it); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, filtered, active]);

  // Keep the active row scrolled into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[3px] animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-[560px] overflow-hidden rounded-[14px] glass shadow-[var(--shadow-xl)]"
        style={{ animation: 'cmdkIn 200ms var(--ease-out) both' }}
      >
        {/* Search row */}
        <div className="flex items-center gap-2.5 px-4 h-[52px] border-b border-[var(--border-subtle)]">
          <Search className="h-4 w-4 text-[var(--text-tertiary)] flex-shrink-0" strokeWidth={2} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            className="flex-1 bg-transparent text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          />
          <kbd className="kbd flex-shrink-0">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[min(56vh,420px)] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[13px] text-[var(--text-secondary)]">No results for “{query}”</p>
              <p className="text-[12px] text-[var(--text-tertiary)] mt-1">Try a page name or an action.</p>
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
                  return (
                    <button
                      key={item.id}
                      data-index={index}
                      onClick={() => runItem(item)}
                      onMouseMove={() => setActive(index)}
                      className={cn(
                        'group/cmd w-full flex items-center gap-3 px-2 h-9 rounded-[8px] text-left transition-colors duration-100',
                        isActive ? 'bg-[var(--indigo-subtle)]' : 'hover:bg-[var(--bg-hover)]'
                      )}
                    >
                      <span className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0 transition-colors',
                        isActive ? 'bg-[var(--indigo)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                      )}>
                        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                      </span>
                      <span className={cn(
                        'flex-1 text-[13px] truncate',
                        isActive ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'
                      )}>
                        {item.label}
                      </span>
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
        </div>
      </div>
    </div>
  );
}
