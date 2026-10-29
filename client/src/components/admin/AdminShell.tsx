import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Activity, CreditCard, LineChart, LayoutDashboard, RefreshCw, Search, Send, Settings2, ShieldCheck, Users, type LucideIcon,
} from 'lucide-react';
import { adminApi } from '../../api/admin.api';
import { Avatar } from '../shared/Avatar';
import { Modal } from '../ui/Modal';
import { isModalOpen, isTypingTarget } from '../../lib/keyboard';
import { cn } from '../../lib/utils';
import { PlanBadge, thisMonth } from './adminFormat';

/*
 * The admin backend's own frame: a rail of its places, a live status with a
 * Refresh that pulls Stripe now, and quick find ("/") to jump to any account
 * by email. On a phone the rail becomes a row of tabs.
 */

interface Place { to: string; label: string; icon: LucideIcon; end?: boolean }

export const ADMIN_PLACES: Place[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/accounts', label: 'Accounts', icon: Users },
  { to: '/admin/insights', label: 'Insights', icon: LineChart },
  { to: '/admin/billing', label: 'Billing', icon: CreditCard },
  { to: '/admin/sending', label: 'Sending', icon: Send },
  { to: '/admin/settings', label: 'Settings', icon: Settings2 },
  { to: '/admin/activity', label: 'Activity', icon: Activity },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const [finding, setFinding] = useState(false);

  // "/" opens quick find anywhere in the admin backend.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || isModalOpen()) return;
      e.preventDefault();
      setFinding(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="lg:grid lg:grid-cols-[212px_minmax(0,1fr)] lg:gap-7 items-start">
      {/* The rail */}
      <aside className="hidden lg:flex flex-col gap-4 sticky top-6">
        <div className="flex items-center gap-2.5 px-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--text-primary)] text-[var(--bg-app)]">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="text-strong font-semibold text-[var(--text-primary)]">Admin</p>
            <p className="text-micro text-[var(--text-tertiary)]">Sincerely control room</p>
          </div>
        </div>

        <button
          onClick={() => setFinding(true)}
          className="flex items-center gap-2 h-9 px-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] text-body text-[var(--text-tertiary)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Find an account</span>
          <kbd className="text-micro font-mono px-1.5 rounded border border-[var(--border-subtle)]">/</kbd>
        </button>

        <nav aria-label="Admin" className="flex flex-col gap-0.5">
          {ADMIN_PLACES.map((p) => (
            <NavLink
              key={p.to}
              to={p.to}
              end={p.end}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-body font-medium transition-colors',
                isActive
                  ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] shadow-[inset_2px_0_0_var(--indigo)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
              )}
            >
              <p.icon className="h-4 w-4 opacity-80" />
              {p.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-[var(--border-subtle)] pt-3 px-1">
          <LiveStatus />
        </div>
      </aside>

      {/* On a phone: tabs, then the status */}
      <div className="lg:hidden mb-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--text-primary)] text-[var(--bg-app)]">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <p className="text-heading font-semibold text-[var(--text-primary)] flex-1">Admin</p>
          <button onClick={() => setFinding(true)} aria-label="Find an account" className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)]">
            <Search className="h-4 w-4" />
          </button>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1">
          {ADMIN_PLACES.map((p) => (
            <NavLink
              key={p.to}
              to={p.to}
              end={p.end}
              className={({ isActive }) => cn(
                'shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-body font-medium',
                isActive ? 'bg-[var(--text-primary)] text-[var(--bg-app)]' : 'text-[var(--text-secondary)] bg-[var(--bg-hover)]',
              )}
            >
              <p.icon className="h-3.5 w-3.5" /> {p.label}
            </NavLink>
          ))}
        </nav>
        <LiveStatus />
      </div>

      <div className="min-w-0">{children}</div>

      <QuickFind open={finding} onClose={() => setFinding(false)} />
    </div>
  );
}

/** A page's title row inside the shell. */
export function AdminHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end gap-3 flex-wrap mb-5">
      <div className="min-w-0 flex-1">
        <h1 className="text-title font-semibold text-[var(--text-primary)] tracking-[-0.015em]">{title}</h1>
        {sub && <p className="mt-0.5 text-body text-[var(--text-tertiary)]">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/** When the numbers on screen were fetched, and a button to pull everything fresh, Stripe included. */
function LiveStatus() {
  const qc = useQueryClient();
  const fetching = useIsFetching({ queryKey: ['admin'] }) > 0;
  const [syncing, setSyncing] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5_000); return () => clearInterval(t); }, []);

  const updated = Math.max(0, ...qc.getQueryCache().findAll({ queryKey: ['admin'] }).map((q) => q.state.dataUpdatedAt));
  const secs = updated ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : null;
  const ago = secs == null ? '' : secs < 10 ? 'just now' : secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;

  const refresh = async () => {
    setSyncing(true);
    try {
      const { synced } = await adminApi.syncAll();
      if (!synced) toast.error('Stripe could not be reached, so payments may be behind.');
    } catch {
      toast.error('Stripe could not be reached, so payments may be behind.');
    } finally {
      await qc.invalidateQueries({ queryKey: ['admin'] });
      setSyncing(false);
    }
  };

  const busy = syncing || fetching;
  return (
    <div className="flex items-center gap-2 text-caption text-[var(--text-tertiary)]" aria-live="polite">
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', busy ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500')} />
      <span className="flex-1">{busy ? 'Updating…' : ago ? `Live · updated ${ago}` : 'Live'}</span>
      <button
        onClick={refresh}
        disabled={syncing}
        aria-label="Refresh everything, Stripe included"
        title="Refresh everything, Stripe included"
        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-60"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} /> Refresh
      </button>
    </div>
  );
}

/** Jump to any account by email or id. */
function QuickFind({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data } = useQuery({ queryKey: ['admin', 'accounts', thisMonth()], queryFn: () => adminApi.accounts(thisMonth()), enabled: open });

  useEffect(() => { if (open) { setQ(''); setAt(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = data?.accounts || [];
    return (needle ? all.filter((a) => a.email.toLowerCase().includes(needle) || a.id.startsWith(needle)) : all).slice(0, 8);
  }, [data, q]);

  const go = (id: string) => { onClose(); navigate(`/admin/accounts?a=${id}`); };

  return (
    <Modal isOpen={open} onClose={onClose} title="Find an account" size="lg">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setAt(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => Math.min(n + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(n - 1, 0)); }
          if (e.key === 'Enter' && hits[at]) { e.preventDefault(); go(hits[at].id); }
        }}
        placeholder="Email or account id"
        aria-label="Email or account id"
        className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-3 text-strong text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)]"
      />
      <ul className="mt-2 -mx-1" role="listbox" aria-label="Accounts">
        {!data && <li className="px-2 py-3 text-body text-[var(--text-tertiary)]">Loading accounts…</li>}
        {data && hits.length === 0 && <li className="px-2 py-3 text-body text-[var(--text-tertiary)]">No account matches.</li>}
        {hits.map((a, i) => (
          <li key={a.id} role="option" aria-selected={i === at}>
            <button
              onMouseEnter={() => setAt(i)}
              onClick={() => go(a.id)}
              className={cn('w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left', i === at && 'bg-[var(--bg-hover)]')}
            >
              <Avatar email={a.email} size="sm" />
              <span className="flex-1 min-w-0 truncate text-body text-[var(--text-primary)]">{a.email}</span>
              <PlanBadge plan={a.plan} status={a.status} suspended={a.suspended} />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
