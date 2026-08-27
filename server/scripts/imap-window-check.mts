/* ═══════════════════════════════════════════════════════════════════════
   Deciding what to ask an IMAP server for.

   Every bug the old sync had was in the decision, not in the conversation,
   so this tests the decision and touches no socket.

   Two of those bugs are the reason each group below exists.

   SINCE and BEFORE compare dates, not instants (RFC 3501 §6.4.4). The old
   sync handed a full timestamp to SINCE and so re-fetched the whole of the
   current day, every run, then spent a database round trip per message
   finding out it already had each one.

   And UIDs only mean anything within a UIDVALIDITY generation. A server
   that renumbers a mailbox starts again at 1, so a stored "last UID seen"
   of 40,000 would silently skip everything until the mailbox grew past it.

   Run: npx tsx scripts/imap-window-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import {
  advanceCursor,
  BACKFILL_SLICE_DAYS,
  floorToDay,
  planBackfill,
  planForward,
  windowStart,
} from '../src/utils/imap-window.js';

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

const NOW = new Date('2026-08-18T14:32:11.000Z');
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

console.log('\nthe window is calendar months, not thirty-day blocks');
{
  is('one month back', windowStart(1, NOW).toISOString() === day('2026-07-18').toISOString(),
     windowStart(1, NOW).toISOString());
  is('three months back', windowStart(3, NOW).toISOString() === day('2026-05-18').toISOString(),
     windowStart(3, NOW).toISOString());
  is('six months back', windowStart(6, NOW).toISOString() === day('2026-02-18').toISOString(),
     windowStart(6, NOW).toISOString());
  is('and it is floored to a day, because SINCE ignores the time anyway',
     windowStart(1, NOW).getUTCHours() === 0, windowStart(1, NOW).toISOString());
}

console.log('\nnew mail is fetched by UID, which is exact');
{
  const plan = planForward({ uid_validity: 42, last_uid: 1200 }, { uidValidity: 42 }, NOW);
  is('a known mailbox asks for everything above the last UID seen',
     plan.uidRange === '1201:*' && plan.since === null, JSON.stringify(plan));
  is('and nothing is re-read', plan.uidReset === false, JSON.stringify(plan));
}

console.log('\nand by date only when UIDs cannot be trusted');
{
  const first = planForward({ uid_validity: null, last_uid: null }, { uidValidity: 42 }, NOW);
  is('a first connection has no UID to work from',
     first.uidRange === null && first.since !== null, JSON.stringify(first));
  is('and the date it uses is floored to the day',
     first.since?.toISOString() === day('2026-08-18').toISOString(),
     first.since?.toISOString());

  // The trap: the mailbox was renumbered, so every UID we hold is meaningless.
  const renumbered = planForward({ uid_validity: 42, last_uid: 40000 }, { uidValidity: 77 }, NOW);
  is('a renumbered mailbox is re-read rather than skipped',
     renumbered.uidRange === null && renumbered.uidReset === true, JSON.stringify(renumbered));

  const noServerValidity = planForward({ uid_validity: 42, last_uid: 1200 }, { uidValidity: null }, NOW);
  is('a server that will not say its UIDVALIDITY falls back to dates',
     noServerValidity.uidRange === null, JSON.stringify(noServerValidity));
}

console.log('\nhistory is walked backwards in bounded slices');
{
  const first = planBackfill({ backfill_cursor: null, backfill_done: false }, 3, NOW);
  is('the first slice starts from today', first?.before.toISOString() === day('2026-08-18').toISOString(),
     JSON.stringify(first));
  is(`and reaches back ${BACKFILL_SLICE_DAYS} days`,
     first?.since.toISOString() === day('2026-08-04').toISOString(), JSON.stringify(first));
  is('with more to come', first?.final === false, JSON.stringify(first));

  const next = planBackfill({ backfill_cursor: first!.since.toISOString(), backfill_done: false }, 3, NOW);
  is('the next slice carries on from where that one stopped',
     next?.before.toISOString() === day('2026-08-04').toISOString(), JSON.stringify(next));
}

console.log('\nit stops at the window, and stays stopped');
{
  // A cursor already inside the last slice: the floor must be the window, not
  // a fortnight beyond it.
  const last = planBackfill({ backfill_cursor: day('2026-07-25').toISOString(), backfill_done: false }, 1, NOW);
  is('the final slice is clamped to the window, not overshot',
     last?.since.toISOString() === day('2026-07-18').toISOString(), JSON.stringify(last));
  is('and it says so', last?.final === true, JSON.stringify(last));

  const done = advanceCursor(last!);
  is('completing it marks the backfill finished', done.done === true, JSON.stringify(done));

  const after = planBackfill({ backfill_cursor: done.cursor, backfill_done: true }, 1, NOW);
  is('a finished backfill asks for nothing more', after === null, JSON.stringify(after));

  const atFloor = planBackfill({ backfill_cursor: day('2026-07-18').toISOString(), backfill_done: false }, 1, NOW);
  is('a cursor already at the window asks for nothing either',
     atFloor === null, JSON.stringify(atFloor));
}

console.log('\nthe cursor moves by the slice, not by what was in it');
{
  const slice = planBackfill({ backfill_cursor: null, backfill_done: false }, 6, NOW)!;
  const moved = advanceCursor(slice);
  // The trap: moving the cursor to the oldest message found would leave it
  // where it was for a fortnight containing no mail, and the backfill would
  // ask for that same empty fortnight forever.
  is('an empty fortnight still advances the cursor',
     moved.cursor === slice.since.toISOString(), JSON.stringify(moved));
  is('and does not claim to be finished', moved.done === false, JSON.stringify(moved));
}

console.log('\nwidening the window reopens a finished backfill');
{
  // Someone who chose one month and then asks for six: the cursor sits at the
  // one-month floor, which is well inside the six-month window.
  const cursorAtOneMonth = day('2026-07-18').toISOString();
  const reopened = planBackfill({ backfill_cursor: cursorAtOneMonth, backfill_done: false }, 6, NOW);
  is('there is more history to fetch once the window grows',
     reopened !== null && reopened.before.toISOString() === cursorAtOneMonth,
     JSON.stringify(reopened));
}

console.log('\nodd inputs do not produce odd requests');
{
  is('a corrupt cursor is ignored rather than crashing the sync',
     planBackfill({ backfill_cursor: 'not-a-date', backfill_done: false }, 1, NOW) === null);
  is('floorToDay is stable', floorToDay(NOW).toISOString() === day('2026-08-18').toISOString(),
     floorToDay(NOW).toISOString());
  const zeroUid = planForward({ uid_validity: 42, last_uid: 0 }, { uidValidity: 42 }, NOW);
  is('a mailbox with a stored UID of zero is treated as unknown, not as "1:*"',
     zeroUid.uidRange === null, JSON.stringify(zeroUid));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
