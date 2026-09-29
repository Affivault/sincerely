import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { isOverlayRequested, markOverlayRequested } from '../lib/keyboard';

interface CommandPaletteContextType {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
}

let typedAhead = '';
/**
 * Letters typed after Cmd+K and before the search box took focus.
 *
 * Read, not consumed: an effect that reads it can run twice (React's
 * development mode does exactly that), and a consuming read hands the
 * second run nothing. The buffer is emptied when the palette closes.
 */
export function takeTypedAhead(): string {
  return typedAhead;
}

const CommandPaletteContext = createContext<CommandPaletteContextType | undefined>(undefined);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // Marked synchronously, before React renders: see markOverlayRequested.
  const openPalette = useCallback(() => { markOverlayRequested(true); setOpen(true); }, []);
  const closePalette = useCallback(() => { markOverlayRequested(false); setOpen(false); }, []);
  const togglePalette = useCallback(() => setOpen((o) => { markOverlayRequested(!o); return !o; }), []);
  useEffect(() => { markOverlayRequested(open); }, [open]);

  /*
   * Keep what is typed before the palette is on screen.
   *
   * The palette's code loads on demand. Pressing Cmd+K and typing a name
   * straight away is the whole point of it, and those first letters used to
   * land nowhere. Until the search box has focus, printable keys collect
   * here and the palette starts with them (takeTypedAhead).
   */
  // Attached once, not when `open` changes: keys pressed straight after
  // Cmd+K arrive before React has rendered anything, and a listener added
  // on that render would already have missed them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isOverlayRequested()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // On screen but not yet focused: move focus there and let the key
      // land in it, rather than holding it back.
      const input = document.querySelector<HTMLInputElement>('[data-palette-input]');
      if (input) { input.focus(); return; }
      if (e.key.length === 1) { typedAhead += e.key; e.preventDefault(); }
      else if (e.key === 'Backspace') { typedAhead = typedAhead.slice(0, -1); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => { if (!open) typedAhead = ''; }, [open]);

  return (
    <CommandPaletteContext.Provider value={{ open, openPalette, closePalette, togglePalette }}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (ctx === undefined) {
    throw new Error('useCommandPalette must be used within a CommandPaletteProvider');
  }
  return ctx;
}
