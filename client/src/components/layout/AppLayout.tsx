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
  ['/crm', 'CRM'],
  ['/analytics', 'Analytics'],
  ['/templates', 'Templates'],
  ['/schedules', 'Schedules'],
  ['/contacts', 'Lead Lists'],
  ['/email-accounts', 'Email accounts'],
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

// Global shortcuts (like `n` for "new campaign") must not fire while a modal
// is open — e.g. focus resting on a button inside a template editor — or
// they silently navigate away and discard whatever the modal held.
function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null;
}

function AppContent() {
  const { collapsed } = useSidebar();
  const { open, closePalette, togglePalette } = useCommandPalette();
  const unreadCount = useUnreadCount();
  const location = useLocation();
  const navigate = useNavigate();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const goPending = useRef<number | null>(null);
  const prevUnreadRef = useRef<number>(0);
  const originalFaviconHrefRef = useRef<string | null>(null);

  // Wayfinding — document title tracks the current page
  useEffect(() => {
    const page = PAGE_TITLES.find(([prefix]) => location.pathname.startsWith(prefix))?.[1];
    const badge = unreadCount > 0 ? ` (${unreadCount})` : '';
    document.title = `${page ? `${page} · ` : ''}Sincerely${badge}`;
    return () => { document.title = 'Sincerely'; };
  }, [unreadCount, location.pathname]);

  // Favicon badge — a red dot on the tab icon so unread mail is visible
  // even when Sincerely is a background tab (title text alone is easy to
  // miss). Drawn on a canvas over the existing favicon and swapped in via
  // the <link rel="icon"> element; reverted to the plain icon at 0.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    // Captured once so re-badging on subsequent unreadCount changes never
    // reads back an already-badged data URL as the "clean" icon.
    if (originalFaviconHrefRef.current === null) {
      originalFaviconHrefRef.current = link.getAttribute('href') || '/favicon.png';
    }
    const originalHref = originalFaviconHrefRef.current;

    if (unreadCount <= 0) {
      link.href = originalHref;
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.src = originalHref;
    img.onload = () => {
      if (cancelled) return;
      const size = img.width || 40;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const r = size * 0.16;
      ctx.beginPath();
      ctx.arc(size - r, r, r, 0, Math.PI * 2);
      ctx.fillStyle = '#EF4444';
      ctx.strokeStyle = 'white';
      ctx.lineWidth = size * 0.03;
      ctx.fill();
      ctx.stroke();
      link.href = canvas.toDataURL('image/png');
    };

    return () => { cancelled = true; };
  }, [unreadCount]);

  // Desktop notification for new mail — lives here (the single top-level
  // subscriber) rather than inside useUnreadCount, since that hook is called
  // from both Sidebar and AppLayout and would otherwise fire twice.
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (unreadCount > prevUnreadRef.current && prevUnreadRef.current > 0) {
      const diff = unreadCount - prevUnreadRef.current;
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Sincerely Inbox', {
          body: `You have ${diff} new message${diff !== 1 ? 's' : ''}`,
          icon: '/favicon.png',
        });
      }
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

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
      if (isTypingTarget(e.target) || isModalOpen()) return;

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
        collapsed ? 'pl-[52px]' : 'pl-[240px]'
      )}>
        {/* Generous workspace width — effectively full-bleed on laptops so data
            tables breathe, while capping ultrawide so forms stay readable.
            The Unibox is a full-viewport app surface: no padding, no max-width,
            no promo banner — it owns every pixel below the header. */}
        <main className={cn(
          location.pathname.startsWith('/inbox')
            ? 'max-w-none p-0'
            : 'px-8 py-7 max-w-[1760px] mx-auto'
        )}>
          {!location.pathname.startsWith('/inbox') && <UpgradeNag />}
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
