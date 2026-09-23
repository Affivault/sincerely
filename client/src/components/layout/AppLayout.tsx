import { useTrackLastSeen } from '../flow/AwayCard';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ErrorBoundary } from '../ErrorBoundary';
import { UpgradeNag } from '../UpgradeNag';
import { CommandPalette, PeekDrawer, ShortcutsOverlay, warmOverlays } from './Overlays';
import { ConfirmProvider } from '../ui/ConfirmDialog';
import { OverflowTooltip } from '../ui/OverflowTooltip';
import { UndoProvider } from '../ui/UndoBar';
import { ThemeProvider } from '../../context/ThemeContext';
import { SidebarProvider, useSidebar } from '../../context/SidebarContext';
import { CommandPaletteProvider, useCommandPalette } from '../../context/CommandPaletteContext';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { listenForRouteIntent } from '../../lib/prefetch';
import { holdKeySequence, isModalOpen, isTypingTarget, releaseKeySequence } from '../../lib/keyboard';
import { warmRichTextEditor } from '../ui/RichTextEditor';
import { cn } from '../../lib/utils';

/* Route → page name, used for document titles (wayfinding) */
const PAGE_TITLES: [prefix: string, name: string][] = [
  ['/dashboard', 'Dashboard'],
  ['/campaigns', 'Campaigns'],
  ['/inbox', 'Unibox'],
  ['/deals', 'Deals'],
  ['/companies', 'Companies'],
  ['/calendar', 'Calendar'],
  ['/tasks', 'Activities'],
  ['/crm', 'Deals'],
  ['/analytics', 'Analytics'],
  ['/templates', 'Templates'],
  ['/schedules', 'Schedules'],
  ['/leads/inbox', 'Leads inbox'],
  ['/leads', 'Lead lists'],
  ['/contacts', 'Contacts'],
  ['/email-accounts', 'Email accounts'],
  ['/suppression', 'Suppression'],
  ['/verification', 'Verification'],
  ['/team', 'Team'],
  ['/developer', 'Webhooks'],
  ['/linkedin', 'LinkedIn'],
  ['/integrations', 'Integrations'],
  ['/toolkit', 'Toolkit'],
  ['/settings', 'Settings'],
];

/* `g` then key → destination (Linear-style two-stroke navigation) */
const GO_MAP: Record<string, string> = {
  d: '/dashboard',
  c: '/campaigns',
  i: '/inbox',
  a: '/analytics',
  l: '/leads',
  t: '/templates',
  s: '/settings',
};

/**
 * How long the app waits for the second stroke of a `g`.
 *
 * Long enough to be a sequence and not a race, short enough that an
 * abandoned `g` does not sit there swallowing the next real key.
 */
const SEQUENCE_MS = 1400;

/*
 * The guards come from lib/keyboard, which exists precisely to be the one
 * copy of them - its own header says they were written out three times,
 * "once in AppLayout". That copy was still here, character for character,
 * with nothing to keep the two in step.
 *
 * Note this handler uses the two guards directly rather than
 * `acceptsShortcut`: that one also refuses a key while a sequence is
 * pending, and this is the handler that owns the sequence.
 */

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

  /*
   * Two things that make the app feel quicker, both of which only make
   * sense once somebody is signed in - which is exactly when this shell
   * mounts, and why they live here rather than in main.tsx.
   *
   * The first watches for a pointer or a focus ring arriving on a link and
   * starts that route's chunk downloading, so the click that follows has
   * nothing left to wait for.
   *
   * The other two fetch, during the first idle frame, the things that used
   * to be loaded before anything appeared: the rich text editor (366 kB)
   * and the three overlays mounted over every page (105 kB). Taking weight
   * off the critical path is only half the job - the other half is making
   * sure it has arrived before anyone reaches for it, so that pressing
   * Reply or Cmd+K still costs nothing.
   *
   * None of it runs on the landing page, the login page or a public
   * booking link, none of which have an editor, a palette or a sidebar.
   */
  useEffect(() => {
    const stop = listenForRouteIntent();
    warmRichTextEditor();
    warmOverlays();
    return stop;
  }, []);

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
        /*
         * Released on the NEXT TICK, not on this line.
         *
         * Every page-level shortcut is its own window listener, so they are
         * all still to be called for this very keypress. Clearing the hold
         * here would hand them the second stroke of the sequence and defeat
         * the whole mechanism - which is the bug as it stands: `g` then `e`
         * in the Unibox archives the open conversation, because this
         * handler finds no `e` in the map, gives up, and the page takes the
         * same keypress as its own.
         *
         * A timeout of zero runs once this keydown has finished being
         * dispatched to everybody, and not before.
         */
        window.setTimeout(releaseKeySequence, 0);
        const to = GO_MAP[e.key.toLowerCase()];
        if (to) { e.preventDefault(); navigate(to); }
        return;
      }

      if (e.key === 'g' || e.key === 'G') {
        holdKeySequence(SEQUENCE_MS);
        goPending.current = window.setTimeout(() => {
          goPending.current = null;
          releaseKeySequence();
        }, SEQUENCE_MS);
        return;
      }
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen((o) => !o); return; }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); navigate('/campaigns/new'); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (goPending.current !== null) {
        window.clearTimeout(goPending.current);
        goPending.current = null;
      }
    };
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
      {/* Any page can open a record over itself; state lives in the URL. */}
      <PeekDrawer />
      {/* Reads out any value the layout had to cut off. One listener for
          the 241 places that were clipping text with no way to see it. */}
      <OverflowTooltip />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

export function AppLayout() {
  useTrackLastSeen();
  return (
    <ThemeProvider>
      <SidebarProvider>
        <CommandPaletteProvider>
          <ConfirmProvider>
            {/* Outside the router's own content so a pending delete is not
                cancelled by the route that started it unmounting. */}
            <UndoProvider>
              <AppContent />
            </UndoProvider>
          </ConfirmProvider>
        </CommandPaletteProvider>
      </SidebarProvider>
    </ThemeProvider>
  );
}
