import { useEffect, type RefObject } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   Where the cursor is while a dialog is open, and where it goes back to.

   MEASURED BEFORE THIS LANDED: Modal.tsx contained no focus handling at
   all. Forty dialogs in the app, and none of them:

     - put the cursor anywhere. You open a dialog and focus is still on
       the button behind it.
     - held on to it. Tab from inside a dialog walks into the page
       BEHIND it - through links you cannot see and cannot reach with a
       mouse, because the backdrop is over them.
     - gave it back. Closing dropped focus onto <body>, so the next Tab
       started again from the top of the document and a keyboard user
       lost their place entirely.

   Somebody had thought carefully about layering - openModals exists so
   Escape closes the topmost dialog and not the one behind it - so this is
   not carelessness. Focus is simply invisible until you try to work
   without a mouse, and then it is the whole experience.

   It is also the thing that makes an app feel not-quite-finished to
   people who could not tell you why.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Things a person can actually Tab to.
 *
 * `[tabindex="-1"]` is deliberately excluded: it means "focusable by
 * script, not by Tab", and the dialog panel itself carries one so it can
 * be a landing place without joining the cycle.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    // An element inside a closed <details>, a hidden panel or a
    // display:none branch matches the selector and cannot be focused, and
    // Tab landing on nothing is worse than Tab landing somewhere dull.
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export interface FocusTrapOptions {
  /**
   * Whether this dialog currently owns the keyboard.
   *
   * Dialogs stack - a confirmation opened from inside an editor sits over
   * it - and only the top one may hold Tab. Without this the editor
   * underneath would keep pulling focus back out of the confirmation,
   * which is worse than no trap at all.
   *
   * Omitted for overlays that cannot stack.
   */
  topmost?: () => boolean;
  /**
   * Skip moving focus on open.
   *
   * For an overlay that is purely to be read - the shortcuts sheet - where
   * grabbing the cursor gains nothing.
   */
  noInitialFocus?: boolean;
}

/**
 * Trap the cursor inside `ref` while `active`, and give it back after.
 *
 *     const panelRef = useRef<HTMLDivElement>(null);
 *     useFocusTrap(panelRef, isOpen, { topmost: () => isTop(self) });
 *     ...
 *     <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1}>
 *
 * The panel needs `tabIndex={-1}` so it can be focused as a fallback when
 * it has no fields of its own.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  { topmost, noInitialFocus }: FocusTrapOptions = {},
) {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    /*
     * Who to give it back to.
     *
     * Captured before anything moves, because React may have already
     * focused something inside via autoFocus by the time this runs.
     */
    const returnTo = document.activeElement as HTMLElement | null;

    /*
     * Where to put it now.
     *
     * If something inside is already focused - an input with autoFocus,
     * which several dialogs use - leave it alone. Overriding that would
     * quietly break the one thing those dialogs already got right.
     */
    if (!noInitialFocus && !root.contains(document.activeElement)) {
      const first = root.querySelector<HTMLElement>('[data-autofocus]')
        ?? focusableWithin(root)[0]
        ?? root;
      // preventScroll because a dialog taller than the viewport would
      // otherwise jump to its first field the moment it opens.
      first.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (topmost && !topmost()) return;

      const items = focusableWithin(root);
      if (items.length === 0) {
        // Nothing to move between, so Tab must not escape to the page
        // behind the backdrop.
        e.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement as HTMLElement | null;

      /*
       * Focus can be outside the dialog entirely - the browser puts it on
       * <body> after the focused element is removed, which happens
       * whenever a dialog deletes the row it is about. Pull it back rather
       * than letting the next Tab walk into the obscured page.
       */
      if (!at || !root.contains(at)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
        return;
      }

      if (e.shiftKey && at === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);

      /*
       * Give it back, but only if there is still something to give it to.
       *
       * The element that opened a dialog is often gone by the time it
       * closes - the row you deleted, the card you archived. Focusing a
       * detached node silently does nothing and leaves the cursor on
       * <body>, so check first and fall back to nothing rather than
       * pretending.
       */
      if (returnTo && document.contains(returnTo) && typeof returnTo.focus === 'function') {
        returnTo.focus({ preventScroll: true });
      }
    };
  }, [active, ref, topmost, noInitialFocus]);
}

/** Exported for the harness, which asserts the selector is not a no-op. */
export const __FOCUSABLE = FOCUSABLE;
