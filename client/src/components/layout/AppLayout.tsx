import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ErrorBoundary } from '../ErrorBoundary';
import { UpgradeNag } from '../UpgradeNag';
import { CommandPalette } from '../CommandPalette';
import { ShortcutsOverlay } from '../ShortcutsOverlay';
import { ThemeProvider } from '../../context/ThemeContext';
import { SidebarProvider, useSidebar } from '../../context/SidebarContext';
import { CommandPaletteProvider, useCommandPalette } from '../../context/CommandPaletteContext';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { cn } from '../../lib/utils';

/* Route → page name, used for document titles (wayfinding) */
const PAGE_TITLES: [prefix: string, name: string][] = [
  ['/dashboard', 'Dashboard'],
  ['/campaigns', 'Campaigns'],
  ['/inbox', 'Unibox'],
  ['/analytics', 'Analytics'],
  ['/templates', 'Templates'],
  ['/schedules', 'Schedules'],
  ['/contacts', 'Lead Lists'],
  ['/smtp-accounts', 'SMTP'],
  ['/domains', 'Domains'],
  ['/suppression', 'Suppression'],
  ['/verification', 'Verification'],
  ['/team', 'Team'],
  ['/developer', 'Webhooks'],
  ['/toolkit', 'Toolkit'],
  ['/settings', 'Settings'],
];

/* `g` then key → destination (Linear-style two-stroke navigation) */
const GO_MAP: Record<string, string> = {
  d: '/dashboard',
  c: '/campaigns',
  i: '/inbox',
  a: '/analytics',
  l: '/contacts',
  t: '/templates',
  s: '/settings',
};

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

function AppContent() {
  const { collapsed } = useSidebar();
  const { open, closePalette, togglePalette } = useCommandPalette();
  const unreadCount = useUnreadCount();
  const location = useLocation();
  const navigate = useNavigate();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const goPending = useRef<number | null>(null);

  // Wayfinding — document title tracks the current page
  useEffect(() => {
    const page = PAGE_TITLES.find(([prefix]) => location.pathname.startsWith(prefix))?.[1];
    const badge = unreadCount > 0 ? ` (${unreadCount})` : '';
    document.title = `${page ? `${page} · ` : ''}Sincerely${badge}`;
    return () => { document.title = 'Sincerely'; };
  }, [unreadCount, location.pathname]);

  // Global ⌘K / Ctrl+K to summon the command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePalette]);

  // Keyboard-first navigation: `g` then a key to jump, `n` to create, `?` for help
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      // Second stroke of a pending `g` sequence
      if (goPending.current !== null) {
        window.clearTimeout(goPending.current);
        goPending.current = null;
        const to = GO_MAP[e.key.toLowerCase()];
        if (to) { e.preventDefault(); navigate(to); }
        return;
      }

      if (e.key === 'g' || e.key === 'G') {
        goPending.current = window.setTimeout(() => { goPending.current = null; }, 1400);
        return;
      }
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen((o) => !o); return; }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); navigate('/campaigns/new'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div
      className="min-h-screen bg-[var(--bg-app)]"
      style={{ backgroundImage: 'var(--noise), var(--gradient-page)' }}
    >
      {/* Full-width top bar — holds the logo + sidebar toggle, never collapses */}
      <Header />
      <Sidebar />
      <div className={cn(
        'transition-[padding] duration-200 pt-[56px]',
        collapsed ? 'pl-[60px]' : 'pl-[244px]'
      )}>
        {/* Generous workspace width — effectively full-bleed on laptops so data
            tables breathe, while capping ultrawide so forms stay readable. */}
        <main className="px-8 py-7 max-w-[1760px] mx-auto">
          <UpgradeNag />
          {/* key on pathname so the fade-up replays on every route change */}
          <div key={location.pathname} className="route-fade">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <CommandPalette open={open} onClose={closePalette} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

export function AppLayout() {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <CommandPaletteProvider>
          <AppContent />
        </CommandPaletteProvider>
      </SidebarProvider>
    </ThemeProvider>
  );
}
