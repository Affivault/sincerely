import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptsShortcut } from '../lib/keyboard';

/* ═══════════════════════════════════════════════════════════════════════
   Moving through a table without the mouse.

   A grid this dense is a working surface, not a form: people go down a list
   of a few hundred, open some, tag others, and reaching for the mouse on
   every row is what makes a tool feel slow no matter how fast it renders.

   The bindings are the ones this class of app has settled on — j/k or the
   arrows to move, x to select, Enter to open, / to search, Escape to let go
   — so nobody has to learn ours specifically.

   Everything is guarded by `acceptsShortcut`: none of it fires while
   somebody is typing, or behind a dialog. Without that, `x` would land in a
   search box as a letter and as a selection at the same time.
   ═══════════════════════════════════════════════════════════════════════ */

interface Options {
  /** How many rows are on screen right now. */
  count: number;
  /** Open the record at this index — the row's primary action. */
  onOpen?: (index: number) => void;
  /** Toggle selection for one row. */
  onToggleSelect?: (index: number) => void;
  /** Select or clear every row. */
  onSelectAll?: () => void;
  /** Escape with nothing focused: drop the selection. */
  onEscape?: () => void;
  /** Focused when `/` is pressed. */
  searchRef?: React.RefObject<HTMLInputElement | null>;
  /** Off while the table is loading or empty. */
  enabled?: boolean;
}

export function useGridKeys({
  count,
  onOpen,
  onToggleSelect,
  onSelectAll,
  onEscape,
  searchRef,
  enabled = true,
}: Options) {
  /** -1 means nothing is focused, which is where every page starts. */
  const [focusIndex, setFocusIndexState] = useState(-1);

  /*
   * The current index, readable synchronously from the key handler.
   *
   * Reading it by calling setState with an updater and firing the action
   * inside looks tempting and is wrong: an updater must be pure, and React
   * double-invokes it in development — so `x` toggled the selection on and
   * straight back off, and selecting by keyboard did nothing at all.
   */
  const focusRef = useRef(-1);
  const setFocusIndex = useCallback((next: number) => {
    focusRef.current = next;
    setFocusIndexState(next);
  }, []);

  /*
   * The handler reads these through refs rather than closing over them.
   * Re-binding a window listener on every keystroke of the search box (which
   * changes `count` as results narrow) drops keys pressed in the gap.
   */
  const state = useRef({ count, onOpen, onToggleSelect, onSelectAll, onEscape, searchRef, enabled });
  state.current = { count, onOpen, onToggleSelect, onSelectAll, onEscape, searchRef, enabled };

  // A row that scrolls out of view is a row you have lost track of.
  const reveal = useCallback((index: number) => {
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-row-index="${index}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = state.current;
      if (!s.enabled) return;

      // `/` reaches for the search box, so it is the one key allowed to fire
      // with focus outside the grid — but still never while typing.
      if (e.key === '/' && acceptsShortcut(e.target)) {
        if (s.searchRef?.current) {
          e.preventDefault();
          s.searchRef.current.focus();
          s.searchRef.current.select();
          return;
        }
      }

      // Escape works from inside the search box too: it is how you get out.
      if (e.key === 'Escape') {
        const el = s.searchRef?.current;
        if (el && document.activeElement === el) { el.blur(); return; }
        if (!acceptsShortcut(e.target)) return;
        setFocusIndex(-1);
        s.onEscape?.();
        return;
      }

      if (!acceptsShortcut(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (s.count === 0) return;

      const move = (delta: number) => {
        e.preventDefault();
        const i = focusRef.current;
        // From nothing, down goes to the first row and up to the last — so a
        // single keypress always lands somewhere.
        const next = i < 0
          ? (delta > 0 ? 0 : s.count - 1)
          : Math.min(s.count - 1, Math.max(0, i + delta));
        setFocusIndex(next);
        reveal(next);
      };

      switch (e.key) {
        case 'j': case 'ArrowDown': return move(1);
        case 'k': case 'ArrowUp': return move(-1);
        case 'Enter':
          if (focusRef.current >= 0) s.onOpen?.(focusRef.current);
          return;
        case 'x':
          e.preventDefault();
          if (focusRef.current >= 0) s.onToggleSelect?.(focusRef.current);
          return;
        case 'a':
          if (e.shiftKey) { e.preventDefault(); s.onSelectAll?.(); }
          return;
        default:
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reveal, setFocusIndex]);

  // A shorter list must not leave focus pointing past the end of it.
  useEffect(() => {
    if (focusRef.current >= count) setFocusIndex(count - 1);
  }, [count, setFocusIndex]);

  return { focusIndex, setFocusIndex };
}
