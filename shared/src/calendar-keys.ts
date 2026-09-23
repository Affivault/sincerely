/* ═══════════════════════════════════════════════════════════════════════
   Driving the calendar without the mouse.

   MEASURED BEFORE THIS LANDED: the calendar had no keys at all. Changing
   week meant finding a 32-pixel chevron; changing view meant crossing the
   whole header to a segmented control; getting back to today meant a third
   button somewhere else again. Every other list in this app takes j and k.

   A calendar is the surface where this matters most, because the thing
   people do on one is not "an action" but NAVIGATION - forward a week,
   back a week, back to today, show me the month - dozens of times in a
   sitting, each one a deliberate trip across the screen.

   The bindings are Google Calendar's, on purpose and not as flattery.
   Anybody who has used a calendar in the last fifteen years already has
   d/w/m for the views and t for today in their fingers, and a product that
   invents its own is asking to be learned for no benefit.

   The table lives in shared because the overlay that TEACHES the keys and
   the hook that BINDS them must not be able to disagree. They were two
   hand-kept lists everywhere else in this app, and the drift is invisible:
   the sheet says one key, the page answers to another, and the only person
   who finds out is somebody who trusted the sheet.
   ═══════════════════════════════════════════════════════════════════════ */

export type CalendarCommand =
  | 'today'
  | 'prev'
  | 'next'
  | 'view:day'
  | 'view:week'
  | 'view:month'
  | 'view:agenda'
  | 'create';

export interface CalendarShortcut {
  /** How it is drawn on the shortcuts sheet. */
  keys: string[];
  /** Every `KeyboardEvent.key` that fires it, lower case. */
  match: string[];
  command: CalendarCommand;
  label: string;
}

/**
 * Deliberately NOT bound: `n`, `g` and `?`.
 *
 * `n` is the app's global "new campaign" and `g` opens the go-to sequence.
 * A page that quietly takes a key the whole app already uses is worse than
 * a page with no keys, because the one it breaks is the one people have
 * already learned.
 */
export const CALENDAR_SHORTCUTS: readonly CalendarShortcut[] = [
  { keys: ['T'], match: ['t'], command: 'today', label: 'Back to today' },
  // Arrows as well as j/k: j/k is what every other list here takes, and
  // arrows are what somebody who has never seen a shortcut sheet will try.
  { keys: ['J'], match: ['j', 'arrowright'], command: 'next', label: 'Next week / month' },
  { keys: ['K'], match: ['k', 'arrowleft'], command: 'prev', label: 'Previous week / month' },
  { keys: ['D'], match: ['d'], command: 'view:day', label: 'Day view' },
  { keys: ['W'], match: ['w'], command: 'view:week', label: 'Week view' },
  { keys: ['M'], match: ['m'], command: 'view:month', label: 'Month view' },
  { keys: ['A'], match: ['a'], command: 'view:agenda', label: 'Agenda view' },
  { keys: ['C'], match: ['c'], command: 'create', label: 'Book a meeting' },
];

/**
 * The command a keystroke means, or null.
 *
 * Case-folded, because a shortcut that stops working with caps lock on is
 * a shortcut that stops working for reasons nobody will ever guess.
 */
export function calendarCommandFor(key: string): CalendarCommand | null {
  const k = String(key).toLowerCase();
  for (const s of CALENDAR_SHORTCUTS) {
    if (s.match.includes(k)) return s.command;
  }
  return null;
}

/** The view a command selects, or null when it is not about views. */
export function viewFromCommand(command: CalendarCommand): 'day' | 'week' | 'month' | 'agenda' | null {
  return command.startsWith('view:')
    ? (command.slice(5) as 'day' | 'week' | 'month' | 'agenda')
    : null;
}
