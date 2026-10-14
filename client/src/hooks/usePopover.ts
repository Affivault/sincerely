import { useCallback, useEffect, useId, useRef, type MutableRefObject, type RefObject } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   Keyboard behaviour for the small ad-hoc dropdowns and context menus.

   Each of these was a button, a state flag, a transparent scrim to catch
   outside clicks, and an absolutely positioned panel. That works for a
   mouse and fails a keyboard in four ways: the button never said it
   opened something, opening it left the cursor on the button behind the
   panel, Escape did nothing (or dropped focus on <body>), and Tab walked
   away from an open panel that then hung around.

   This is the disclosure pattern, the same one ShellMenus uses: the panel
   is a group of ordinary buttons reached with Tab, so the trigger says
   whether it is open and what it controls and promises no arrow-key
   roving it does not have.
   ═══════════════════════════════════════════════════════════════════════ */

/** What the trigger button spreads. */
export interface PopoverTriggerProps {
  ref: (el: HTMLButtonElement | null) => void;
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  'aria-haspopup': 'true';
}

/** What the panel spreads. */
export interface PopoverPanelProps {
  ref: RefObject<HTMLDivElement>;
  id: string;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PopoverApi {
  triggerProps: PopoverTriggerProps;
  panelProps: PopoverPanelProps;
  /**
   * Where focus goes when the panel closes and there is no trigger button
   * to name (a right-click menu). Set it when opening; it is cleared on
   * close. Falls back to whatever had focus when the panel opened.
   */
  returnFocusTo: MutableRefObject<HTMLElement | null>;
}

/**
 * @param open     whether the panel is showing
 * @param onClose  closes it (called for Escape and for Tab leaving the panel)
 */
export function usePopover(open: boolean, onClose: () => void): PopoverApi {
  const panelId = useId();
  const triggerEl = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  // The callbacks change identity every render; the listeners must not.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const setTrigger = useCallback((el: HTMLButtonElement | null) => { triggerEl.current = el; }, []);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const p = panel.current;
    // Last resort, for Safari (a click does not focus a button there): a
    // panel that sits straight after its button in the DOM.
    const sibling = p?.previousElementSibling instanceof HTMLButtonElement ? p.previousElementSibling : null;

    // Opening is a decision to look inside, so the cursor goes with it.
    const first = p?.querySelector<HTMLElement>(FOCUSABLE);
    if (first) first.focus({ preventScroll: true });
    else if (p) { p.tabIndex = -1; p.focus({ preventScroll: true }); }

    // Escape closes this and nothing behind it, and hands the cursor back
    // before the panel unmounts - focus on a removed node drops to <body>,
    // which sends a keyboard user back to the top of the page.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    // Tabbing out of the panel (or the trigger) closes it rather than
    // leaving it hanging over the page.
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panel.current?.contains(t) || triggerEl.current?.contains(t)) return;
      // A trigger the hook was not handed (a picker opened by a button in
      // its parent) still names the panel in aria-controls. Focus landing
      // on it is the start of a click that toggles the panel shut; closing
      // here as well let that click open it again.
      const id = panel.current?.id;
      if (id && t instanceof Element && t.closest(`[aria-controls="${id}"]`)) return;
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
      // Closed by Escape, by choosing an item or by clicking away: if focus
      // was lost with the panel, give it back. If it already moved on
      // (Tab to the next control, a dialog opening) leave it alone.
      const now = document.activeElement;
      if (!now || now === document.body || p?.contains(now)) {
        const target = [triggerEl.current, returnFocusTo.current, opener, sibling].find((el) => el && el.isConnected && el !== document.body);
        target?.focus({ preventScroll: true });
      }
      returnFocusTo.current = null;
    };
  }, [open]);

  return {
    triggerProps: {
      ref: setTrigger,
      'aria-expanded': open,
      'aria-controls': open ? panelId : undefined,
      'aria-haspopup': 'true',
    },
    panelProps: { ref: panel, id: panelId },
    returnFocusTo,
  };
}
