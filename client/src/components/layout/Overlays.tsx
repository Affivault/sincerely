import { lazy, Suspense } from 'react';
import { usePeek } from '../peek/usePeek';

/* ═══════════════════════════════════════════════════════════════════════
   The three things mounted over everything, none of which draw anything
   until you open them.

   Same shape of problem as the rich text editor, one size down. The app
   shell mounts the peek drawer, the command palette and the shortcuts
   sheet on every page so that every page gets them for free. All three
   return null until opened - so they cost nothing to RENDER, which is why
   nobody noticed they cost 105 kB to LOAD, on the login page, before
   anything appeared.

       ContactHistory   35.4 kB     CommandPalette   17.3 kB
       PeekDrawer       29.1 kB     ShortcutsOverlay  5.7 kB
       CrmPrimitives    26.6 kB     QuickCompose      7.2 kB

   "Renders nothing" and "weighs nothing" are not the same claim, and the
   gap between them is invisible in the component and obvious in the
   waterfall.

   Each is now fetched on the first idle frame after the shell mounts (see
   warmOverlays, called from AppLayout) - so pressing Cmd+K a second after
   login opens the palette from cache, exactly as before, and a visitor who
   never signs in never fetches any of it.
   ═══════════════════════════════════════════════════════════════════════ */

const loadPeek = () => import('../peek/PeekDrawer');
const loadPalette = () => import('../CommandPalette');
const loadShortcuts = () => import('../ShortcutsOverlay');

const PeekDrawerImpl = lazy(() => loadPeek().then((m) => ({ default: m.PeekDrawer })));
const CommandPaletteImpl = lazy(() => loadPalette().then((m) => ({ default: m.CommandPalette })));
const ShortcutsOverlayImpl = lazy(() => loadShortcuts().then((m) => ({ default: m.ShortcutsOverlay })));

let warmed = false;

/**
 * Pull all three down during idle time, once.
 *
 * Called from the app shell, so it only ever runs for a signed-in session.
 * Failures are ignored: each boundary below will ask again when something
 * actually opens, and that is the request whose failure is worth showing.
 */
export function warmOverlays(): void {
  if (warmed || typeof window === 'undefined') return;
  warmed = true;
  const go = () => {
    void loadPeek().catch(() => {});
    void loadPalette().catch(() => {});
    void loadShortcuts().catch(() => {});
  };
  const idle = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => void)
    | undefined;
  if (idle) idle(go, { timeout: 4000 });
  else window.setTimeout(go, 1500);
}

/**
 * The peek drawer, gated on there being something to peek at.
 *
 * The gate reads the same URL parameter the drawer itself reads, and the
 * drawer's first act is `if (!target) return null` - so moving that test
 * out here changes nothing about what is on screen. Its one effect is
 * already guarded on the same condition, which is what makes this safe:
 * nothing inside runs when there is no target, whether it is mounted or
 * not.
 */
export function PeekDrawer() {
  const { target } = usePeek();
  if (!target) return null;
  // No fallback. A drawer that slides in a quarter of a second late is
  // better than a grey rectangle that slides in on time - and after the
  // idle warm-up this branch is reached with the chunk already in memory.
  return (
    <Suspense fallback={null}>
      <PeekDrawerImpl />
    </Suspense>
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <CommandPaletteImpl open={open} onClose={onClose} />
    </Suspense>
  );
}

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ShortcutsOverlayImpl open={open} onClose={onClose} />
    </Suspense>
  );
}
