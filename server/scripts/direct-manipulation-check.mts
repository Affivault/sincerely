/* ═══════════════════════════════════════════════════════════════════════
   Time is dragged out, not typed in.

   MEASURED BEFORE THIS LANDED:

   THE CALENDAR could move a block and resize a block, and that was the
   whole of it. Saying "I am busy two until four" meant clicking empty
   space - which booked a default-length meeting at two - and then dragging
   its bottom edge down to four. Two gestures for the commonest thing
   anybody does to a calendar, on a surface built for one.

   AVAILABILITY was worse. The hours people may book you were set with a
   pair of `<input type="time">` per window and a Plus button per day: to
   say "Tuesdays, nine to twelve and two to six" you pressed Plus, typed
   four times, pressed Plus, typed four more - and nothing on screen ever
   showed the shape of what you had made.

   AND THREE BUGS FOUND WHILE READING THE GRID THAT DRAGGING ALREADY HAD:

     1. Dragging a meeting to another day did nothing. Pointer capture
        sends every subsequent move to the element pressed, so the handler's
        `day` was forever the column the block started in. It followed the
        cursor to Friday, and landed back on Tuesday at the new time.

     2. Resizing anything that had run over midnight SHORTENED IT. The new
        end was built from the event's own start - yesterday - so a
        two-hour meeting drawn on today's column became fifteen minutes
        yesterday evening, and the server had no reason to refuse it.

     3. A cancelled pointer left the draft standing forever. The draft is
        what suppresses opening an event on click, so one stray gesture and
        no meeting on the grid could be opened again.

   Run: npx tsx scripts/direct-manipulation-check.mts
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
const CLIENT = join(REPO, 'client');

/** Comments must never satisfy or trip a rule about code. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const read = (p: string) => code(readFileSync(join(CLIENT, p), 'utf8'));

const grid = read('src/components/calendar/TimeGrid.tsx');
const painter = read('src/components/calendar/WeekPainter.tsx');
const availability = read('src/pages/crm/AvailabilityPage.tsx');
const calendarPage = read('src/pages/crm/CalendarPage.tsx');

/* ── The arithmetic, run rather than read ─────────────────────────────── */

const drag: typeof import('../../shared/src/time-drag.js') =
  await import(pathToFileURL(join(REPO, 'shared/src/time-drag.ts')).href);
const cal: typeof import('../../shared/src/calendar.types.js') =
  await import(pathToFileURL(join(REPO, 'shared/src/calendar.types.ts')).href);

const shape = (r: { startMinute: number; endMinute: number }) => `${r.startMinute}-${r.endMinute}`;
const shapes = (rs: readonly { startMinute: number; endMinute: number }[]) => rs.map(shape).join(' ');

console.log('\nboth ends of the day are reachable');
{
  /*
   * THE WHOLE REASON THERE ARE TWO SNAP FUNCTIONS. `snapMinutes` answers
   * "where does a meeting START", and clamps to 23:45 because a meeting
   * starting at midnight-at-the-far-end is not a thing. Sharing it with the
   * other end meant a block's bottom edge dragged to the bottom of the grid
   * stopped at 23:45 - the one time of day the gesture most obviously means,
   * and one the grid visibly has room for.
   */
  is('a start still cannot be midnight at the far end',
     cal.snapMinutes(1439) === 1425, `${cal.snapMinutes(1439)}`);

  is('but an end can be', drag.snapToStep(1439) === 1440, `${drag.snapToStep(1439)}`);

  is('and neither runs past the day',
     drag.snapToStep(99_999) === 1440 && drag.snapToStep(-99_999) === 0);

  is('and nonsense lands at the top rather than NaN',
     drag.snapToStep(Number.NaN) === 0);
}

console.log('\na drag describes the same range in both directions');
{
  is('dragging down gives press-to-release',
     shape(drag.dragRange(540, 720)) === '540-720', shape(drag.dragRange(540, 720)));

  /*
   * People drag UPWARDS as often as down - it is how you select the hour
   * before the thing you are looking at. A version that assumed the press
   * came first would return a backwards range, and a backwards range is a
   * block with negative height: invisible, and committed as a meeting that
   * ends before it starts.
   */
  is('and dragging up gives release-to-press, not a backwards range',
     shape(drag.dragRange(720, 540)) === '540-720', shape(drag.dragRange(720, 540)));

  is('a press that never moves is still one step tall',
     shape(drag.dragRange(600, 600)) === '600-615', shape(drag.dragRange(600, 600)));

  is('and so is one that wobbles inside its own cell',
     shape(drag.dragRange(600, 603)) === '600-615', shape(drag.dragRange(600, 603)));

  /*
   * Slide, do not squash. Dragging off the bottom of the grid should give
   * the last quarter hour of the day, not a zero-height range pinned to the
   * boundary.
   */
  is('dragging off the bottom keeps its length',
     shape(drag.dragRange(1440, 1440)) === '1425-1440', shape(drag.dragRange(1440, 1440)));

  is('and off the top does too',
     shape(drag.dragRange(0, -500, 15, 30)) === '0-30', shape(drag.dragRange(0, -500, 15, 30)));

  is('a longer minimum is honoured in the direction of travel',
     shape(drag.dragRange(600, 605, 15, 60)) === '600-660', shape(drag.dragRange(600, 605, 15, 60)));
}

console.log('\npainting over something that exists merges with it');
{
  /*
   * NOT TIDINESS. `replaceWindows` refuses a day whose windows overlap - it
   * has to, or the same slot is offered twice - so a painting gesture that
   * does not merge is a painting gesture that 400s. Every second stroke on
   * the grid would have ended in a red toast some seconds later, with
   * nothing on screen to say which day was at fault.
   */
  is('an overlapping stroke becomes one window',
     shapes(drag.addRange([{ startMinute: 540, endMinute: 720 }], { startMinute: 600, endMinute: 780 }))
       === '540-780');

  is('and a touching one does too',
     shapes(drag.addRange([{ startMinute: 540, endMinute: 720 }], { startMinute: 720, endMinute: 1020 }))
       === '540-1020');

  is('a stroke with a gap either side stays separate',
     shapes(drag.addRange([{ startMinute: 540, endMinute: 660 }], { startMinute: 720, endMinute: 780 }))
       === '540-660 720-780');

  /*
   * Transitive, like the calendar's own layout: a stroke laid across two
   * windows joins all three, not the first one it touches.
   */
  is('and a stroke that bridges two joins all three',
     shapes(drag.addRange(
       [{ startMinute: 540, endMinute: 600 }, { startMinute: 900, endMinute: 1020 }],
       { startMinute: 580, endMinute: 920 },
     )) === '540-1020');

  is('a zero-length stroke changes nothing',
     shapes(drag.addRange([{ startMinute: 540, endMinute: 720 }], { startMinute: 600, endMinute: 600 }))
       === '540-720');
}

console.log('\nand cutting one in half leaves two');
{
  /*
   * How somebody takes their lunch hour out of nine-to-five. A version that
   * only trimmed the edges would silently refuse, and the day either keeps
   * the hour or loses the whole afternoon.
   */
  is('a cut through the middle splits the window',
     shapes(drag.removeRange([{ startMinute: 540, endMinute: 1020 }], { startMinute: 720, endMinute: 780 }))
       === '540-720 780-1020');

  is('a cut off one end trims it',
     shapes(drag.removeRange([{ startMinute: 540, endMinute: 1020 }], { startMinute: 900, endMinute: 1200 }))
       === '540-900');

  is('a cut over the whole thing removes it',
     shapes(drag.removeRange([{ startMinute: 540, endMinute: 1020 }], { startMinute: 0, endMinute: 1440 }))
       === '');

  is('and a cut that misses leaves it alone',
     shapes(drag.removeRange([{ startMinute: 540, endMinute: 1020 }], { startMinute: 1100, endMinute: 1200 }))
       === '540-1020');
}

console.log('\nmoving keeps the length, resizing keeps the other edge');
{
  is('a moved window is the same length',
     shape(drag.moveRange({ startMinute: 540, endMinute: 660 }, 780)) === '780-900');

  /*
   * Clamping the START alone would let a two-hour window dragged to 23:00
   * run to 01:00 the next morning, which is not something a weekday window
   * can express - and the server would take it, because it only checks that
   * the end is inside the day.
   */
  is('and one dragged off the bottom stops whole',
     shape(drag.moveRange({ startMinute: 1200, endMinute: 1320 }, 1400)) === '1320-1440');

  is('resizing the end leaves the start alone',
     shape(drag.resizeRange({ startMinute: 540, endMinute: 720 }, 'end', 900)) === '540-900');

  /*
   * Pulling the bottom edge up past the top must not turn the range inside
   * out. The floor goes on the edge being dragged, away from the one being
   * kept.
   */
  is('and pulling it above the start gives the shortest block, not a backwards one',
     shape(drag.resizeRange({ startMinute: 540, endMinute: 720 }, 'end', 300)) === '540-555');

  is('resizing the start leaves the end alone',
     shape(drag.resizeRange({ startMinute: 540, endMinute: 720 }, 'start', 600)) === '600-720');

  is('and pushing it below the end gives the shortest block',
     shape(drag.resizeRange({ startMinute: 540, endMinute: 720 }, 'start', 900)) === '705-720');
}

console.log('\nand what the server would refuse is said here first');
{
  is('a backwards window is named',
     drag.rangeProblem([{ startMinute: 1020, endMinute: 540 }], 'Tuesday')
       === 'Tuesday has a window that ends before it starts.');

  is('an overlap is named',
     drag.rangeProblem([{ startMinute: 540, endMinute: 720 }, { startMinute: 600, endMinute: 780 }], 'Tuesday')
       === 'Two windows overlap on Tuesday.');

  is('back-to-back windows are not an overlap',
     drag.rangeProblem([{ startMinute: 540, endMinute: 720 }, { startMinute: 720, endMinute: 1020 }], 'Tuesday')
       === null);

  is('and a good day has nothing to say',
     drag.rangeProblem([{ startMinute: 540, endMinute: 1020 }], 'Tuesday') === null);

  is('an empty day has nothing to say either',
     drag.rangeProblem([], 'Sunday') === null);
}

/* ── The calendar grid ────────────────────────────────────────────────── */

console.log('\nthe calendar can be drawn on');
{
  is('the grid offers a range, not only a moment',
     /onCreateRange: \(start: Date, end: Date\) => void/.test(grid),
     'a drag would have nowhere to go but onBookAt, which takes one instant');

  is('and a drag on empty space starts one',
     /onPointerDown=\{beginCreate\(day\)\}/.test(grid),
     'the empty grid would take clicks and nothing else - which is what it did');

  is('and on release it commits the range it drew',
     /onCreateRange\(at\(d\.day, d\.startMinute\), at\(d\.day, d\.endMinute\)\)/.test(grid),
     'the block would be drawn and then thrown away');

  /*
   * A click is a drag of no length and must not mean something different.
   * Losing this turns every stray press on the grid into a booking.
   */
  is('but a press that never moved is still a click',
     /if \(!d\.moved\) return;/.test(grid),
     'a bare click would book a range instead of a moment, or both would fire');

  is('and the click that follows a real drag is swallowed',
     /swallowClick\.current = true;/.test(grid)
     && /if \(swallowClick\.current\) \{ swallowClick\.current = false; return; \}/.test(grid),
     'releasing a drag would commit the range AND book at the release point');

  /*
   * A flag set by a gesture whose click never arrives - pointer left the
   * window, gesture cancelled - would stand there and eat somebody's next
   * perfectly ordinary click.
   */
  is('and the flag is cleared when the next gesture starts',
     /swallowClick\.current = false;[\s\S]{0,200}?if \(e\.target !== e\.currentTarget\) return;/.test(grid),
     'one orphaned drag would swallow the next real click on the grid');

  /*
   * The grid lives inside a vertical scroller. Capturing a touch on press
   * is how a calendar becomes a thing you cannot scroll past.
   */
  is('and touch is left to scroll',
     /if \(e\.pointerType === 'touch'\) return;/.test(grid),
     'the week view would stop scrolling on a phone');

  is('and the page turns the range into a meeting of exactly that length',
     /onCreateRange=\{\(start, end\) => setEventModal\([\s\S]{0,200}?ends_at: end\.toISOString\(\)/.test(calendarPage),
     'the length drawn would be dropped and the default used instead');
}

console.log('\nand dragging across days lands on the day you dragged to');
{
  /*
   * BUG 1. Pointer capture routes every move to the element pressed, so a
   * handler closed over its own column never sees another one. You could
   * drag a meeting to Friday, watch it follow, let go, and see it back on
   * Tuesday at the new time - which reads as the save having failed.
   */
  is('the day comes from where the pointer is',
     /const dayFromPointer = useCallback\(\(clientX: number\)/.test(grid),
     'the day would be whichever column the drag started in, always');

  is('and a move in progress asks it',
     /const day = dayFromPointer\(e\.clientX\) \?\? d\.day;/.test(grid),
     'the draft would carry the starting column forward unchanged');

  is('and the new start is built on that day',
     /onMove\(event, at\(d\.day, d\.startMinute\)\);/.test(grid),
     'the time would move and the date would not');

  is('the columns are measured rather than guessed at',
     /columns\.current\.set\(keyOf\(day\), el\)/.test(grid),
     'equal-width arithmetic would drift by the width of the borders');

  // And what it looks like mid-drag, which is the only way to know it works
  // before letting go.
  is('a block dragged to another column is drawn there',
     /data-provisional/.test(grid),
     'it would follow the cursor in its old column and appear to do nothing');

  is('and what it leaves behind is faded, not doubled',
     /elsewhere && 'opacity-25'/.test(grid),
     'two solid copies of one meeting is a rendering bug, not a preview');
}

console.log('\nand resizing something that ran over midnight lengthens it');
{
  /*
   * BUG 2, and the expensive one: it corrupted data and the server had no
   * reason to refuse. An event starting 23:00 yesterday is drawn on today's
   * column too. Its new end was built from its own start - yesterday - so
   * dragging the bottom edge DOWN produced an end fifteen minutes after
   * yesterday's start, silently turning a two-hour meeting into a
   * quarter-hour one on the wrong day.
   */
  is('a block knows where its own top is on THIS column',
     /function drawnStartMinute\(event: TimedEvent, day: Date\)/.test(grid)
     && /start\.getTime\(\) <= dayBegin \? 0 : minutesIntoDay\(start\)/.test(grid),
     'a start from another day would be used as an offset into this one');

  is('the resize floor is that top, not a time from another day',
     /setDraft\(\{ \.\.\.d, endMinute: Math\.max\(d\.startMinute \+ DEFAULT_STEP, minute\) \}\);/.test(grid),
     'dragging down on a spilled block would jump it to the end of yesterday');

  is('and the new end is built on the column it was drawn in',
     /onResize\(event, at\(d\.day, d\.endMinute\)\);/.test(grid),
     'the end would land on the day the event STARTED, which may not be this one');

  is('and the grab offset is measured from the drawn top too',
     /grabOffset: minuteFromPointer\(e\.clientY, column\) - top,/.test(grid),
     'grabbing a spilled block would fling it a day');

  /*
   * And the trap the other way round. "Has this moved" compared the
   * committed instant against the event's own start, which LOOKS equivalent
   * and is not for anything drawn clipped: a meeting that began at 23:00
   * yesterday is drawn on today's column from the top, so a plain click on
   * it - a drag of no distance at all - produced a "new" start of today at
   * midnight. Opening it would have moved it.
   */
  is('and a click on a block that began yesterday evening does not move it',
     /if \(d\.startMinute === d\.from && sameDate\(d\.day, d\.fromDay\)\) return;/.test(grid),
     'clicking a spilled meeting to open it would drag it to midnight today');

  is('nor does one on its resize handle reshape it',
     /if \(d\.endMinute === d\.from\) return;/.test(grid),
     'a press on the handle with no drag would commit an end it never moved to');
}

console.log('\nand a cancelled gesture does not jam the grid');
{
  /*
   * BUG 3. The draft is what suppresses opening an event on click. Left
   * standing by a cancelled pointer - a system gesture, a context menu,
   * capture lost - no meeting on the grid could be opened again until
   * another full drag had been completed, and nothing on screen explained
   * why clicking had stopped working.
   */
  const cancels = (grid.match(/onPointerCancel=\{cancelDrag\}/g) || []).length;
  is('every surface that starts a drag can have it taken away', cancels >= 3,
     `${cancels} - the column, the block and the resize handle each need one`);

  is('and cancelling clears the draft', /const cancelDrag = \(\) => setDraft\(null\);/.test(grid),
     'the draft would stand forever and clicks would stop opening anything');

  is('a draft still suppresses the click that follows a drag',
     /if \(!draftRef\.current\) onOpen\(event\)/.test(grid),
     'letting go of a drag would also open the thing just dragged');
}

/* ── The availability week ────────────────────────────────────────────── */

console.log('\nthe working week is drawn');
{
  is('the page mounts the grid', /<WeekPainter windows=\{windows\} onChange=\{edit\}/.test(availability),
     'the week would still be eight time fields and a Plus button');

  is('and every stroke merges rather than stacking',
     (painter.match(/addRange\(/g) || []).length >= 4,
     'create, move, resize and the keyboard each commit through it, or the '
     + 'server refuses the week for overlapping');

  /*
   * The window being dragged has to come OUT before its new position goes
   * in. Merging it against its own old self makes every move grow the
   * window to cover where it came from as well - so a nine-to-five dragged
   * down an hour becomes nine to six.
   */
  is('and a dragged window is taken out before it is put back',
     /const rest = rangesFor\(d\.weekday\)\.filter\(\(_, i\) => i !== d\.index\);/.test(painter),
     'moving a window would stretch it to cover where it came from');

  is('the same on the keyboard',
     /const rest = rangesFor\(weekday\)\.filter\(\(_, i\) => i !== index\);/.test(painter),
     'one arrow press would lengthen the window instead of moving it');

  /*
   * A grid you can only paint on is a grid some of the people who need this
   * page cannot use at all.
   */
  is('windows take the keyboard', /tabIndex=\{index >= 0 \? 0 : -1\}/.test(painter),
     'the only way to set working hours would be a mouse');

  is('and arrows move them', /const delta = \(e\.key === 'ArrowUp' \? -1 : 1\) \* DEFAULT_STEP;/.test(painter));

  is('and shift-arrows stretch them',
     /e\.shiftKey[\s\S]{0,80}?resizeRange\(range, 'end', range\.endMinute \+ delta\)/.test(painter));

  is('and Delete closes the time again',
     /e\.key === 'Delete' \|\| e\.key === 'Backspace'/.test(painter));

  /*
   * Keying on the minutes remounts the element on every nudge, and a
   * remounted element does not have focus - so one arrow press moved the
   * window and threw the keyboard out of the grid entirely.
   */
  is('and a nudged window keeps the focus it was nudged with',
     /key=\{index\}/.test(painter),
     'keying on the times would remount on every press and drop focus');

  is('and each says what it is and what can be done to it',
     /Arrow keys move it, shift and arrow keys change its end, delete removes it\./.test(painter),
     'a focusable rectangle announcing nothing is not keyboard support');

  /*
   * The column underneath runs the same two handlers. Without this its copy
   * of `end` reads the draft ref before React has cleared it and commits
   * the very same gesture a second time.
   */
  is('a window swallows its own pointer events',
     /onPointerUp=\{\(e\) => \{ e\.stopPropagation\(\); end\(\); \}\}/.test(painter),
     'every drag on a window would be committed twice');

  is('and touch keeps its tap and its scroll',
     (painter.match(/e\.pointerType === 'touch'/g) || []).length >= 2,
     'the availability grid would stop scrolling on a phone');

  is('a plain click opens an hour', /endMinute: Math\.min\(start \+ 60, DAY_MINUTES\)/.test(painter),
     'a click would do nothing, on the one surface where a tap is all touch has');
}

console.log('\nand a week that cannot be saved says so before you save it');
{
  is('the page knows what is wrong with the week',
     /const problem = weekProblem\(windows\);/.test(availability),
     'the first word on it would be a 400 naming a weekday');

  is('and the save button carries the reason',
     /blockedProps<HTMLButtonElement>\(cannotSave, \(\) => saveWindows\.mutate\(windows\)\)/.test(availability),
     'it would look pressable, fail, and toast something from the server');

  is('and the grid says it where the mistake is',
     /data-week-problem/.test(painter),
     'the reason would only exist on a button at the top of the page');

  is('but a save in flight is merely busy, not blocked',
     /disabled=\{saveWindows\.isPending\}/.test(availability),
     'a spinner with an explanation attached is an explanation nobody needs');
}

console.log('\nand a window is still identified by which one it is');
{
  /*
   * (weekday, start_minute) is unique only until somebody types a start
   * another window on the same day already has. From that keystroke on,
   * editing either one edited both - and the second field to be typed into
   * put the first one back.
   */
  is('the typed fields edit a position, not a time',
     /const changeWindow = \(index: number, field: 'start_minute' \| 'end_minute', value: string\)/.test(availability),
     'two windows sharing a start would be edited as one');

  is('and so does removing one',
     /const removeWindow = \(index: number\) => edit\(windows\.filter\(\(_, i\) => i !== index\)\);/.test(availability),
     'removing one of a colliding pair would remove both');

  is('and the day list carries the position through',
     /windows\.forEach\(\(window, index\) => m\.get\(window\.weekday\)\?\.push\(\{ window, index \}\)\)/.test(availability),
     'the fields would have nothing but times to identify a window by');

  /*
   * The fields are uncontrolled, so only a remount can put a discarded edit
   * back to the saved value - and that only happens if the key moves with
   * whichever end was typed into.
   */
  is('but the fields still remount when an edit is discarded',
     /key=\{`\$\{weekday\}-\$\{w\.start_minute\}-\$\{w\.end_minute\}`\}/.test(availability),
     'Discard would leave the typed value sitting in the box');

  is('and typing exact times is still possible',
     /data-typed-hours/.test(availability),
     'the grid rounds to the quarter hour, and 09:05 is not a mistake');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} direct manipulation check(s) failed`);
