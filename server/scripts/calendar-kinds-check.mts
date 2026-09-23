/* ═══════════════════════════════════════════════════════════════════════
   A kind of meeting means something.

   MEASURED BEFORE THIS LANDED: `event_type_id` appeared in the calendar's
   READ path eleven times and in its WRITE path exactly once - on a booking
   link. MeetingModal, which is how every meeting anybody books by hand is
   made, had no field for it and sent no such key.

   So the whole feature was decorative for anything you booked yourself. You
   could invent a Demo, give it green and sixty minutes, watch it appear as
   a chip on the filter bar, and then book a demo that came out indigo,
   assumed to be thirty minutes, and impossible to filter out - because it
   had no kind, and there was no way to give it one.

   AND FOUR MORE FOUND AROUND IT:

     1. Retiring a kind broke the promise in its own confirmation. "The N
        meetings already booked keep it" - but `listTypes` excludes archived
        rows, and the grid looks a meeting's colour and length up in that
        list. Retiring the Demo colour recoloured and reshaped every demo in
        the past, back to indigo and thirty minutes.

     2. The kind filter applied to the week and the day and to nothing else.
        The month and the agenda were built from the unfiltered list, and
        the bar carrying the filter was not rendered in either - so hiding a
        kind and switching view silently un-hid it, with nothing on screen
        to explain.

     3. Nothing checked that a meeting ends after it starts. Not the form,
        not the API. The bad value went into the database and the grid hid
        it, because resolveEnd ignores an end that is not after the start
        and falls back to the type's usual length.

     4. "Book meeting" asked for `getHours() + 1`. For twenty-three hours of
        the day that is "in an hour"; at 23:20 it is hour 24, which Date
        normalises to TOMORROW AT MIDNIGHT.

   Run: npx tsx scripts/calendar-kinds-check.mts
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

const modal = read('client/src/components/crm/CrmPrimitives.tsx');
const page = read('client/src/pages/crm/CalendarPage.tsx');
const bar = read('client/src/components/calendar/EventTypeBar.tsx');
const today = read('client/src/components/dashboard/TodayPanel.tsx');
const api = read('client/src/api/calendar.api.ts');
const calService = read('server/src/services/calendar.service.ts');
const calController = read('server/src/controllers/calendar.controller.ts');
const crmService = read('server/src/services/crm.service.ts');

/* ── The rule, run rather than read ───────────────────────────────────── */

const cal: typeof import('../../shared/src/calendar.types.js') =
  await import(pathToFileURL(join(REPO, 'shared/src/calendar.types.ts')).href);

console.log('\na meeting has to end after it starts');
{
  const A = '2026-03-04T10:00:00.000Z';
  const B = '2026-03-04T11:00:00.000Z';

  is('a forward meeting is fine', cal.eventTimeProblem(A, B) === null);

  is('a backwards one is not',
     cal.eventTimeProblem(B, A) === 'A meeting has to end after it starts.',
     String(cal.eventTimeProblem(B, A)));

  /*
   * Equal is refused as well as backwards. A meeting of zero length draws
   * as nothing and cannot be clicked, so it would be invisible and
   * unopenable - indistinguishable from having been lost.
   */
  is('and nor is one of no length at all',
     cal.eventTimeProblem(A, A) === 'A meeting has to end after it starts.');

  /*
   * No end is the COMMON case, not an error: most rows have none and the
   * length is derived from the kind. A check that refused it would reject
   * almost every booking in the app.
   */
  is('no end at all is not a problem', cal.eventTimeProblem(A, null) === null);
  is('nor is an absent one', cal.eventTimeProblem(A, undefined) === null);
  is('nor an empty string, which is what an empty form field sends',
     cal.eventTimeProblem(A, '') === null);

  /*
   * These used to reach Postgres, which refuses them in its own words - so
   * a bad request came back as a 500 and read as the server falling over.
   */
  is('an unparseable start is named as the start',
     cal.eventTimeProblem('next tuesday', B) === 'The start time is not a date.');
  is('and an unparseable end as the end',
     cal.eventTimeProblem(A, 'half four') === 'The end time is not a date.');

  /*
   * The server compares a submitted end against the STORED start, which
   * arrives as a string from the database rather than a Date.
   */
  is('and it works on the strings the database returns',
     cal.eventTimeProblem('2026-03-04 10:00:00+00', '2026-03-04 09:00:00+00')
       === 'A meeting has to end after it starts.');
}

console.log('\nand the API is where that is enforced');
{
  is('booking one checks it', /assertRunsForwards\(input\.starts_at, input\.ends_at\);/.test(crmService),
     'a backwards meeting would be stored exactly as sent');

  /*
   * THE PART A NAIVE VERSION GETS WRONG. Dragging a block's bottom edge
   * sends `ends_at` and nothing else, so checking only what arrived checks
   * nothing at all - which is precisely how the bad rows got in.
   */
  is('and changing one checks the new end against the STORED start',
     /input\.starts_at !== undefined \? input\.starts_at : current\.starts_at/.test(crmService)
     && /input\.ends_at !== undefined \? input\.ends_at : current\.ends_at/.test(crmService),
     'a patch carrying one end would be compared against nothing');

  is('and it reads that row before deciding',
     /\.select\('starts_at, ends_at'\)/.test(crmService),
     'there would be nothing to compare against');

  /*
   * Matched on the CALL, not on the name. `eventTimeProblem` also appears
   * in each file's import line, so testing for the identifier alone would
   * pass just as happily with the form's own hand-rolled comparison put
   * back and the import left behind - which is exactly the shape this rule
   * exists to forbid.
   */
  is('the server states the rule by calling the shared one',
     /const problem = eventTimeProblem\(startRaw, endRaw\);/.test(crmService),
     'the API would carry its own copy of a rule the form also has');

  is('and so does the form, on the same two fields',
     /eventTimeProblem\(fromLocalInput\(form\.starts_at\), fromLocalInput\(form\.ends_at\)\)/.test(modal),
     'two copies agree until one of them is edited');

  is('the form says it before the round trip',
     /data-time-problem/.test(modal),
     'you would fill in the whole form to be told by a 400');

  is('and the button carries the reason rather than going grey',
     /blockedBy=\{cannotSave\}/.test(modal),
     'a grey rectangle for something the person can act on');
}

/* ── The kind, finally writable ───────────────────────────────────────── */

console.log('\na meeting can be given a kind');
{
  is('the form has a field for it', /<FieldLabel>Kind<\/FieldLabel>/.test(modal),
     'kinds of meeting would remain readable everywhere and writable nowhere');

  is('and the payload actually carries it',
     /event_type_id: form\.event_type_id \|\| null,/.test(modal),
     'the picker would change nothing that was saved');

  is('and the form seeds from an existing one when editing',
     /event_type_id: seed\.event_type_id \|\| '',/.test(modal),
     'opening a meeting to edit it would clear its kind');

  /*
   * Live kinds only in the picker. Filing something new under a kind that
   * has been retired is exactly what retiring it was meant to stop.
   */
  is('the picker offers only kinds still in use',
     /queryKey: \['calendar', 'types'\],[\s\S]{0,120}?calendarApi\.listTypes\(\)/.test(modal),
     'a retired kind would still be offered for new meetings');

  is('and "no kind" stays an option',
     /<option value="">No particular kind<\/option>/.test(modal),
     'plenty of what lands on a calendar is not one of the kinds you sell');

  /*
   * A range dragged out on the grid is a decision about how long this runs.
   * Picking a kind afterwards must not overwrite it with the kind's usual
   * length - which is the whole point of having dragged it.
   */
  is('picking a kind fills an EMPTY length, never an existing one',
     /ends_at: f\.ends_at \|\| \(kind && !f\.all_day \? endAfter\(f\.starts_at, kind\.duration_minutes\) : f\.ends_at\)/.test(modal),
     'a range dragged on the grid would be silently replaced by a default');

  /*
   * Defaulting while EDITING would file a meeting that has never had a kind
   * under one the moment somebody saved an unrelated change to its agenda.
   */
  is('a new meeting starts as the default kind',
     /const fallback = kinds\.find\(\(k\) => k\.is_default\) \|\| kinds\[0\];/.test(modal),
     'every meeting would need the picker touched to mean anything');

  is('but editing one never assigns a kind behind your back',
     /if \(editing \|\| kindTouched\.current \|\| kinds\.length === 0\) return;/.test(modal),
     'saving a change to the agenda would quietly file it under a kind');
}

console.log('\nand retiring a kind keeps the meetings booked under it');
{
  is('the service can be asked for the retired ones too',
     /async listTypes\(userId: string, includeArchived = false\)/.test(calService),
     'a retired kind would be unfindable, and its meetings would lose it');

  is('and the filtering is what the flag controls',
     /if \(!includeArchived\) query = query\.is\('archived_at', null\);/.test(calService),
     'the flag would be accepted and ignored');

  /*
   * An account whose every kind is retired still needs something to book
   * with, so the seed decision is about LIVE kinds however the list was
   * asked for.
   */
  is('and an account with only retired kinds is still seeded',
     /if \(data\.some\(\(t\) => !t\.archived_at\)\) return data;/.test(calService),
     'asking for all types would count retired ones as "has types" and seed nothing');

  is('the endpoint exposes it', /req\.query\.include_archived === '1'/.test(calController));
  is('and the client can ask for it',
     /opts\?\.includeArchived \? '\/calendar\/types\?include_archived=1' : '\/calendar\/types'/.test(api));

  /*
   * The two surfaces that LOOK A KIND UP rather than offer one to choose
   * from. Both drew the colour and the length of meetings booked months ago.
   */
  is('the calendar looks kinds up in the full list',
     /queryKey: \['calendar', 'types', 'all'\],[\s\S]{0,120}?includeArchived: true/.test(page),
     'every demo in the past would go indigo the day Demo was retired');

  is('and so does the dashboard',
     /queryKey: \['calendar', 'types', 'all'\],[\s\S]{0,120}?includeArchived: true/.test(today),
     'today\'s panel would disagree with the calendar about the same meeting');

  is('but the bar only offers the ones still in use',
     /types=\{liveTypes\}/.test(page) && /types\.filter\(\(t\) => !t\.archived_at\)/.test(page),
     'retired kinds would come back as chips you could file new meetings under');

  /*
   * React Query matches by key PREFIX, so ['calendar','types'] invalidates
   * ['calendar','types','all'] as well. If it did not, editing a colour
   * would repaint the bar and leave the grid on the old one.
   */
  is('and editing a kind still repaints both lists',
     /queryKey: \['calendar', 'types'\] \}\)/.test(bar),
     'the prefix is what makes one invalidation reach the "all" query too');
}

console.log('\nand the filter means the same thing in every view');
{
  is('there is one test for whether an event is showing',
     /const isVisible = \(e: CrmEvent\) => !hidden\.has\(e\.event_type_id \|\| NO_KIND\);/.test(page),
     'the week would filter and the month would not');

  is('the grid uses it', /events\.filter\(isVisible\)/.test(page));

  is('and so does everything keyed by day - the month and the agenda',
     /if \(!isVisible\(e\)\) continue;/.test(page),
     'switching from week to month would silently un-hide what you hid');

  is('and hidden is in the dependencies of the thing it filters',
     /\[events, tasks, hidden\]\);/.test(page),
     'the filter would apply once and then never change again');

  is('the bar is shown in every view, not two of them',
     /\{liveTypes\.length > 0 && \(\s*<EventTypeBar/.test(page),
     'a filter you cannot see the state of is how a month looks emptier than it is');

  /*
   * Without a chip for it, turning every kind off left a handful of grey
   * blocks on the grid with nothing switched on to explain them - which
   * reads as the filter being broken.
   */
  is('and meetings with no kind get a chip of their own',
     /showUnsorted=\{hasUnsorted\}/.test(page) && /onToggle\('none'\)/.test(bar),
     'hiding everything would leave unexplained blocks and no way to hide them');

  is('offered only when there is something unsorted to hide',
     /events\.some\(\(e\) => !e\.event_type_id\)/.test(page),
     'a permanent chip for a category nobody has anything in');
}

/* ── The rest ─────────────────────────────────────────────────────────── */

console.log('\nand the small ones');
{
  /*
   * `getHours() + 1` is "in an hour" for twenty-three hours of the day. At
   * 23:20 it asks for hour 24, which Date normalises to the next day at
   * midnight - so the button offered a meeting at midnight exactly when
   * somebody was most likely to be tidying up their evening.
   */
  is('"Book meeting" late at night does not offer midnight',
     /if \(at\.getDate\(\) !== today\) at\.setHours\(9, 0, 0, 0\);/.test(page),
     'at 23:20 the button booked tomorrow at 00:00');

  is('and it is the next whole hour the rest of the time',
     /at\.setMinutes\(0, 0, 0\);\s*at\.setHours\(at\.getHours\(\) \+ 1\);/.test(page),
     'it would offer a meeting at 14:37');

  /*
   * The all-day toggle clears the clock time for a stated reason - a stale
   * hour skews the day buckets and the reschedule - and then editing the
   * date put an hour straight back in.
   */
  is('an all-day meeting keeps local midnight when its date is edited',
     /form\.all_day \? `\$\{e\.target\.value\}T00:00` : e\.target\.value/.test(modal),
     'the toggle cleared the time and the very next edit put 09:00 back');

  /*
   * A disabled input says "not now" and nothing else: it cannot be hovered
   * for a title and cannot be focused to be asked. It just sat there
   * looking broken.
   */
  is('and the end field is replaced by the reason, not greyed out',
     /data-no-end/.test(modal) && !/disabled=\{form\.all_day\}/.test(modal),
     'a dead control explaining nothing');

  /*
   * TimeGrid clears its draft the instant the pointer lifts, so without
   * this the block snapped back to where it came from, sat there for the
   * round trip, and then jumped to where it was dropped.
   */
  is('a dragged block stays where it was dropped',
     /\.\.\.optimisticEvent,/.test(page),
     'every drag would rubber-band and read as the save having failed');

  is('and it patches every cache the meeting is in, not one',
     /scope: \['crm'\],/.test(page),
     'it would be instant on the calendar and late on the dashboard');

  is('and the rollback is not replaced by a later onError',
     !/\.\.\.optimisticEvent,\s*onError/.test(page),
     'a failed move would leave the block showing a change that never happened');

  /*
   * This was the one dialog in the app Escape did not close, that Tab
   * walked straight out of, and that never joined the modal stack.
   */
  is('the kind editor is a real dialog',
     /<Modal/.test(bar) && !/fixed inset-0 z-50/.test(bar),
     'a hand-rolled overlay with no Escape, no focus trap and no scroll lock');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} calendar kinds check(s) failed`);
