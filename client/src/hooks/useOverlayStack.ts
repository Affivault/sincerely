import { useCallback, useEffect, useRef } from 'react';
import { openModals } from '../components/ui/Modal';

/* ═══════════════════════════════════════════════════════════════════════
   Stack behaviour for overlays whose layout <Modal> cannot express - a
   docked compose window, a header carrying a brand tile, a full-screen
   deck - so they still behave like the dialogs they are:

     - Escape closes the overlay on top and only that one (the shared
       openModals stack, the same one Modal and PeekDrawer use).
     - The page behind does not scroll.
     - The returned `topmost` is what useFocusTrap needs so that only the
       top dialog holds Tab.

   The focus trap itself is called by the dialog's own file, next to the
   markup (the interaction check looks for the call there). The panel
   must carry role="dialog", aria-modal="true", an accessible name and
   tabIndex={-1}:

       const panelRef = useRef<HTMLDivElement>(null);
       const topmost = useOverlayStack(true, onClose);
       useFocusTrap(panelRef, true, { topmost });
   ═══════════════════════════════════════════════════════════════════════ */
export function useOverlayStack(active: boolean, onClose: () => void): () => boolean {
  const identity = useRef({});
  const isTopmost = useCallback(() => openModals[openModals.length - 1] === identity.current, []);

  // Callers pass inline handlers; routing through a ref keeps the effect
  // below from re-running (and re-stacking this overlay) on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const self = identity.current;
    openModals.push(self);
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openModals[openModals.length - 1] !== self) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = openModals.lastIndexOf(self);
      if (at !== -1) openModals.splice(at, 1);
      if (openModals.length === 0) document.body.style.overflow = original;
    };
  }, [active]);
  return isTopmost;
}
