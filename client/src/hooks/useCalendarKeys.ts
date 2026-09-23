import { useEffect, useRef } from 'react';
import { calendarCommandFor, type CalendarCommand } from '@lemlist/shared';
import { acceptsShortcut } from '../lib/keyboard';

/* ═══════════════════════════════════════════════════════════════════════
   The calendar's keys.

   The bindings themselves live in shared/calendar-keys so the sheet that
   teaches them and this, which binds them, cannot disagree - the drift is
   invisible until somebody trusts the sheet and the page answers to a
   different key.

   Everything goes through `acceptsShortcut`, which refuses a bare letter
   while somebody is typing, while a dialog is up, and while the app is
   waiting for the second stroke of a `g` sequence. That last one is not
   hypothetical: `d` is Day view here and `g d` is Dashboard, so without it
   going to the dashboard would flip the calendar's view on the way out.
   ═══════════════════════════════════════════════════════════════════════ */

export function useCalendarKeys(run: (command: CalendarCommand) => void, enabled = true) {
  /*
   * The handler is bound once and reads the latest callback through a ref.
   * Re-binding on every render would tear the listener down and rebuild it
   * many times a second while a drag is in flight, and a keypress that
   * lands in that gap is simply lost.
   */
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // A modified key belongs to the browser: ctrl+d is a bookmark, and
      // cmd+left is Back.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!acceptsShortcut(e.target)) return;

      const command = calendarCommandFor(e.key);
      if (!command) return;
      /*
       * Only once a key is known to mean something. Calling it up front
       * would swallow the arrow keys the page still needs for scrolling
       * and for moving between focusable things.
       */
      e.preventDefault();
      runRef.current(command);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
