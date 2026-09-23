/* ═══════════════════════════════════════════════════════════════════════
   A calendar you can drive, and trust.

   MEASURED BEFORE THIS LANDED:

   NO KEYS AT ALL. Every other list in this app takes j and k; the
   calendar, which is the one screen where the whole activity IS navigation
   - forward a week, back a week, back to today, show me the month, dozens
   of times in a sitting - had none. Changing week meant finding a
   32-pixel chevron. Changing view meant crossing the header to a segmented
   control. Getting back to today meant a third button somewhere else.

   NO WAY BACK. A drag is the easiest gesture in the app to do by accident
   - a meeting nudged on the way to clicking it - and the only remedy was
   to notice, work out where it had come from, and drag it there.

   NO IDEA WHEN YOU WERE BOOKABLE. The two halves of the scheduler were two
   unrelated screens: the calendar knew nothing about the availability the
   booking page was offering on your behalf, so a week that looked wide
   open could be closed to everybody, and a Saturday you had opened up
   looked exactly like a Saturday you had not.

   NO WAY TO CALL A MEETING OFF. The column, the CHECK constraint and the
   strikethrough the grid draws for a cancelled meeting have all existed
   since migration 062 - whose own comment says why: "Deleting them loses
   the fact that the slot was ever taken, which is the thing you are
   looking for when you ask why a week went nowhere." Nothing in the app
   could set it. Delete was the only way out.

   AND A LIVE BUG IN A DIFFERENT PAGE, found by adding keys here: `g` then
   `e` in the Unibox ARCHIVED THE OPEN CONVERSATION. The go-to sequence is
   handled in AppLayout and every page shortcut is its own window listener,
   so both hear the second stroke - AppLayout finds no `e` in its map and
   gives up, and the page takes the same keypress as its own.

   Run: npx tsx scripts/calendar-control-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../..');

/** Comments must never satisfy or trip a rule about code. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const read = (p: string) => code(readFileSync(join(REPO, p), 'utf8'));

const page = read('client/src/pages/crm/CalendarPage.tsx');
const grid = read('client/src/components/calendar/TimeGrid.tsx');
const hook = read('client/src/hooks/useCalendarKeys.ts');
const keyboard = read('client/src/lib/keyboard.ts');
const layout = read('client/src/components/layout/AppLayout.tsx');
const inbox = read('client/src/pages/inbox/InboxPage.tsx');
const overlay = read('client/src/components/ShortcutsOverlay.tsx');
const undoable = read('client/src/hooks/useUndoable.tsx');
const modal = read('client/src/components/crm/CrmPrimitives.tsx');

/* ── The bindings, run rather than read ───────────────────────────────── */

const keys: typeof import('../../shared/src/calendar-keys.js') =
  await import(pathToFileURL(join(REPO, 'shared/src/calendar-keys.ts')).href);

console.log('\nthe calendar answers to the keys people already know');
{
  /*
   * Google Calendar's bindings, on purpose and not as flattery. Anybody who
   * has used a calendar in fifteen years has d/w/m and t in their fingers,
   * and a product that invents its own is asking to be learned for nothing.
   */
  is('t goes back to today', keys.calendarCommandFor('t') === 'today');
  is('d, w and m pick the views',
     keys.calendarCommandFor('d') === 'view:day'
     && keys.calendarCommandFor('w') === 'view:week'
     && keys.calendarCommandFor('m') === 'view:month');
  is('a is the agenda', keys.calendarCommandFor('a') === 'view:agenda');
  is('c books a meeting', keys.calendarCommandFor('c') === 'create');

  is('j and k move, the way every other list here does',
     keys.calendarCommandFor('j') === 'next' && keys.calendarCommandFor('k') === 'prev');

  /*
   * And the arrows, for somebody who has never seen a shortcuts sheet and
   * is simply trying the obvious thing.
   */
  is('and so do the arrow keys',
     keys.calendarCommandFor('ArrowRight') === 'next'
     && keys.calendarCommandFor('ArrowLeft') === 'prev');

  /*
   * A shortcut that stops working with caps lock on is a shortcut that
   * stops working for a reason nobody will ever guess.
   */
  is('caps lock does not turn them off',
     keys.calendarCommandFor('T') === 'today' && keys.calendarCommandFor('W') === 'view:week');

  is('an unbound key means nothing', keys.calendarCommandFor('z') === null);

  /*
   * A page that quietly takes a key the whole app already uses is worse
   * than a page with no keys, because the one it breaks is the one people
   * have already learned.
   */
  for (const taken of ['n', 'g', '?']) {
    is(`${taken} is left to the app it belongs to`,
       keys.calendarCommandFor(taken) === null,
       `${taken} is a global shortcut - ${keys.calendarCommandFor(taken)}`);
  }

  is('view commands resolve to a view',
     keys.viewFromCommand('view:month') === 'month' && keys.viewFromCommand('today') === null);

  /*
   * The sheet that TEACHES the keys is built from the table that BINDS
   * them. Two hand-kept lists drift invisibly, and the only person who
   * finds out is somebody who trusted the sheet.
   */
  is('every binding is on the shortcuts sheet',
     /items: CALENDAR_SHORTCUTS\.map/.test(overlay),
     'the sheet would be a second hand-kept list of the same keys');

  is('and every one of them is reachable',
     keys.CALENDAR_SHORTCUTS.every((s) => s.match.length > 0 && s.keys.length > 0));

  // A table with a duplicate in it binds one key to two commands, and which
  // one wins is the order they happen to be written in.
  const seen = new Set<string>();
  const dupes = keys.CALENDAR_SHORTCUTS.flatMap((s) => s.match)
    .filter((m) => (seen.has(m) ? true : (seen.add(m), false)));
  is('and no key means two things', dupes.length === 0, dupes.join(', '));
}

console.log('\nand they never fire when they should not');
{
  is('the page binds the shared table', /useCalendarKeys\(\(command: CalendarCommand\)/.test(page),
     'the calendar would have no keys, or its own copy of them');

  is('a modified key is left to the browser',
     /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey\) return;/.test(hook),
     'ctrl+d would stop bookmarking and cmd+left would stop going Back');

  is('and nothing fires while typing or behind a dialog',
     /if \(!acceptsShortcut\(e\.target\)\) return;/.test(hook),
     'typing a title with the letter w in it would change the view');

  /*
   * preventDefault only once a key is KNOWN to mean something, or the
   * arrows the page still needs for scrolling get swallowed.
   */
  /*
   * Checked by POSITION AND COUNT, not by matching the good sequence.
   *
   * A regex that merely finds `if (!command) return;` followed by
   * `preventDefault` goes on matching perfectly happily when a SECOND,
   * earlier `preventDefault` is added above it - which is the whole
   * regression: the key is swallowed before anyone has asked whether it
   * means anything here.
   */
  const guardAt = hook.indexOf('if (!command) return;');
  const defaults = [...hook.matchAll(/e\.preventDefault\(\)/g)].map((m) => m.index ?? -1);
  is('and an unbound key keeps its normal behaviour',
     guardAt > 0 && defaults.length === 1 && defaults[0] > guardAt,
     `${defaults.length} preventDefault call(s); the arrows would stop scrolling the page`);

  /*
   * Re-binding on every render tears the listener down and rebuilds it many
   * times a second while a drag is in flight, and a keypress landing in
   * that gap is simply lost.
   */
  is('the listener is bound once and reads the latest handler',
     /runRef\.current = run;/.test(hook) && /\}, \[enabled\]\);/.test(hook),
     'the listener would be rebuilt on every render and drop keys');
}

console.log('\nand a g sequence no longer leaks into the page behind it');
{
  /*
   * NOT HYPOTHETICAL, AND NOT ONLY ABOUT THE CALENDAR. `g` then `e` in the
   * Unibox archived the open conversation: AppLayout found no `e` in its
   * go-to map, gave up, and InboxPage took the same keypress as its own
   * archive key. Adding `d` for Day view here would have done the same to
   * `g d`.
   */
  is('the shared guard knows about a pending sequence',
     /return !isTypingTarget\(target\) && !isModalOpen\(\) && !isKeySequencePending\(\);/.test(keyboard),
     'every page shortcut would keep taking the second stroke of a sequence');

  /*
   * A deadline rather than a boolean. A flag left standing by an unmounted
   * component or a lost keyup would deafen the whole app to every shortcut
   * it has, with nothing on screen to explain it; the worst a stale
   * deadline can do is expire.
   */
  is('and it expires on its own rather than latching',
     /return Date\.now\(\) < sequenceUntil;/.test(keyboard),
     'one stuck flag would silently disable every shortcut in the app');

  is('pressing g holds the sequence', /holdKeySequence\(SEQUENCE_MS\);/.test(layout));

  /*
   * THE PART THAT IS EASY TO GET BACKWARDS. Every page shortcut is its own
   * window listener, so they are all still to be called for this very
   * keypress. Clearing the hold on the spot hands them the second stroke
   * and the mechanism does nothing at all.
   */
  is('and the hold outlives the keypress that resolves it',
     /window\.setTimeout\(releaseKeySequence, 0\);/.test(layout),
     'releasing inline would hand the second stroke straight to the page');

  is('and an abandoned sequence releases too',
     /goPending\.current = null;\s*releaseKeySequence\(\);/.test(layout),
     'a g nobody followed up would keep swallowing keys until a reload');

  is('the Unibox uses the shared guard now',
     (inbox.match(/acceptsShortcut\(e\.target\)/g) || []).length >= 2,
     'g then e would still archive the open conversation');

  is('and AppLayout has stopped keeping its own copy of the guards',
     !/function isTypingTarget\(/.test(layout) && !/function isModalOpen\(/.test(layout),
     'two definitions of "is the user typing" is two chances for one to drift');
}

/* ── A way back ───────────────────────────────────────────────────────── */

console.log('\nevery calendar change offers a way back');
{
  is('there is a mechanism for a change already saved',
     /export function useUndoLastChange\(\)/.test(undoable),
     'undo would mean deferring the save, and a drag held six seconds is a '
     + 'drag lost to a closed tab');

  /*
   * useUndoable above holds a `busy` flag that makes a second call a no-op.
   * Right for a bulk button, catastrophic for a drag: dragging two meetings
   * quickly would drop the second one on the floor.
   */
  is('and it does not run the action, so a second drag is never dropped',
     !/busy\.current/.test(undoable.split('useUndoLastChange')[1] || ''),
     'the second of two quick drags would silently do nothing');

  /*
   * Two ways back on screen at once, each pointing at a different change,
   * is a thing nobody can read and nobody can aim at.
   */
  is('and a second change replaces the offer rather than stacking one',
     /id: 'calendar-undo'/.test(undoable),
     'two undo bars would sit on top of each other');

  is('moving a block on the grid offers it', /undoEvent\(e as unknown as CrmEvent, `Moved to/.test(page));
  is('resizing one offers it', /undoEvent\(e as unknown as CrmEvent,\s*`Now \$\{durationLabel/.test(page));
  is('and dropping one on another day in the month view offers it',
     /undoEvent\(item\.event, `Moved to \$\{formatWeekdayDate\(next\)\}`\);/.test(page));
  is('and so does rescheduling an activity',
     /offerUndo\(`Moved to \$\{formatWeekdayDate\(next\)\}`,/.test(page));

  /*
   * THE DETAIL THAT MAKES IT AN UNDO RATHER THAN AN APPROXIMATION. A
   * meeting that had no end must get none back. `undefined` is dropped from
   * the payload, so the end it picked up on the way would silently stand
   * and the "undo" would leave it a different length than it found it.
   */
  is('and putting it back restores an absent end as absent',
     /ends_at: e\.ends_at \?\? null,/.test(page),
     'undo would leave a meeting the length the drag made it');

  /*
   * The month view was left rubber-banding when the week view stopped. One
   * calendar behaving two ways depending on the view is worse than either
   * behaviour on its own.
   */
  is('and the month view is as immediate as the week view',
     /const rescheduleTask = useMutation\(\{[\s\S]{0,200}?useOptimisticRow/.test(page),
     'a chip dropped on another day would snap back for the round trip');

  is('a drag that moves nothing does nothing',
     /if \(next\.getTime\(\) === original\.getTime\(\)\) return;/.test(page),
     'dropping a chip back where it came from would write, and offer an undo');

  /*
   * A drag released anywhere but a day cell left `dragging` set for good -
   * no drop, no dragleave, nothing to clear it - so the page went on
   * believing a drag was in progress.
   */
  is('and a drag released off the grid ends',
     /onDragEnd=\{\(\) => \{ setDragging\(null\); setDropDay\(null\); \}\}/.test(page),
     'the next cell crossed would light up as a drop target for a dead drag');
}

/* ── The hours you are bookable ───────────────────────────────────────── */

console.log('\nthe grid shows when people may book you');
{
  is('the grid takes the working week', /workingHours\?: AvailabilityWindow\[\]/.test(grid),
     'the calendar and the booking page would stay two unrelated screens');

  is('and the page hands it over', /workingHours=\{availability\?\.windows \|\| \[\]\}/.test(page));

  /*
   * Shading what is OUTSIDE the hours rather than what is inside. The
   * working day is the subject of the grid and should be the plain
   * surface; tinting it instead colours in the part you look at all day.
   */
  is('what is shaded is the time outside them',
     /if \(b\.startMinute > at\) closed\.push/.test(grid),
     'the working day itself would be the tinted band');

  is('and the ends of the day are shaded too',
     /if \(at < DAY_MINUTES\) closed\.push/.test(grid),
     'the evening after the last window would look bookable');

  is('the shading never takes a pointer event',
     /className="pointer-events-none absolute inset-0" data-working-hours/.test(grid),
     'it would sit over the grid and swallow every click and drag on it');

  /*
   * Shading is context, not content. A calendar that will not draw because
   * a secondary request failed has failed at its actual job.
   */
  is('and a calendar with no availability still draws',
     /meta: \{ silentError: true \}/.test(page) && /workingHours = \[\]/.test(grid),
     'one failed request would take the whole calendar down with it');

  is('a day with no hours set is not shaded into a solid block',
     /workingBands\(workingHours, day\)\.length > 0 &&/.test(grid),
     'an account that has never set hours would see every day greyed out');
}

/* ── Calling a meeting off ────────────────────────────────────────────── */

console.log('\nand a meeting can be called off instead of deleted');
{
  is('there is a control for it', /data-cancel-meeting/.test(modal),
     'the status column, its CHECK constraint and the strikethrough the grid '
     + 'draws would all stay unreachable');

  is('and it is reversible', /setStatus\.mutate\(cancelled \? 'confirmed' : 'cancelled'\)/.test(modal),
     'calling one off by mistake would be as final as deleting it');

  /*
   * "Cancelled" and "deleted" are the same word to most people and only one
   * of them can be taken back.
   */
  is('and it says what it did NOT do',
     /It stays on the calendar, struck through\./.test(modal),
     'people would read it as having deleted the meeting');

  is('delete says what it costs',
     /Call it off instead to keep the record that the slot was taken\./.test(modal),
     'the destructive option would look like the ordinary one');

  /*
   * The grid struck it through and dimmed it; the month and the agenda drew
   * it exactly like a meeting that was still happening, so the same week
   * read two ways depending on the view.
   */
  is('a called-off meeting reads that way in the month view',
     /const off = e\.status === 'cancelled';/.test(page));
  is('and in the agenda',
     /item\.kind === 'event' && item\.event\.status === 'cancelled' && 'line-through opacity-60'/.test(page));
  is('and still does on the grid', /cancelled && 'line-through'/.test(grid));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} calendar control check(s) failed`);
