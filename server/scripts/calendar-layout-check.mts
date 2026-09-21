/* ═══════════════════════════════════════════════════════════════════════
   Where each block goes, and what happens when two of them clash.

   This is the arithmetic a calendar is made of, and it is invisible until
   it is wrong - at which point two meetings are drawn on top of each other
   and it reads as a rendering glitch rather than a maths error.

   The case worth caring about is transitive overlap: A overlaps B, B
   overlaps C, but A and C do not touch. The naive answer computes width
   per-pair, gives A and C the same half of the column, and stacks them.
   Every assertion about `width` below exists to catch that.

   Run: npx tsx scripts/calendar-layout-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import {
  layoutDay, resolveEnd, durationMinutes, allDayEvents,
  snapMinutes, durationLabel, minutesIntoDay, isHexColour,
  DEFAULT_EVENT_MINUTES,
} from '@lemlist/shared';

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

const DAY = new Date(2026, 8, 15); // 15 September 2026, local

/** An event at HH:MM running N minutes. */
const at = (id: string, hour: number, minute: number, minutes: number) => ({
  id,
  starts_at: new Date(2026, 8, 15, hour, minute).toISOString(),
  ends_at: new Date(2026, 8, 15, hour, minute + minutes).toISOString(),
});

const byId = (placed: any[], id: string) => placed.find((p) => p.event.id === id);
const DAY_MIN = 24 * 60;
/** Fractions are awkward to assert on; convert back to minutes. */
const topMin = (p: any) => Math.round(p.top * DAY_MIN);
const heightMin = (p: any) => Math.round(p.height * DAY_MIN);

console.log('an event sits where its clock says it does');
{
  const placed = layoutDay([at('a', 9, 0, 60)], DAY);
  is('one event, one placement', placed.length === 1);
  is('9am is nine hours down the day', topMin(placed[0]) === 540, String(topMin(placed[0])));
  is('an hour is an hour tall', heightMin(placed[0]) === 60, String(heightMin(placed[0])));
  is('and it has the column to itself', placed[0].width === 1 && placed[0].left === 0);
  is('with nothing to clash with', placed[0].clashes === 0);
}

console.log('\nthings that do not overlap do not share');
{
  const placed = layoutDay([at('a', 9, 0, 60), at('b', 10, 0, 60)], DAY);
  is('both are full width', placed.every((p) => p.width === 1), JSON.stringify(placed.map((p) => p.width)));
  is('and neither reports a clash', placed.every((p) => p.clashes === 0));

  // Touching exactly at the boundary is not an overlap: a 9-10 and a 10-11
  // are back to back, and drawing them half-width each is wrong.
  const abut = layoutDay([at('a', 9, 0, 60), at('b', 10, 0, 30)], DAY);
  is('back-to-back meetings are not treated as clashing',
     abut.every((p) => p.width === 1), JSON.stringify(abut.map((p) => p.width)));
}

console.log('\ntwo that clash split the column');
{
  const placed = layoutDay([at('a', 9, 0, 60), at('b', 9, 30, 60)], DAY);
  is('each takes half', placed.every((p) => p.width === 0.5), JSON.stringify(placed.map((p) => p.width)));
  is('and they sit side by side, not on top of each other',
     new Set(placed.map((p) => p.left)).size === 2, JSON.stringify(placed.map((p) => p.left)));
  is('each knows it clashes with one other', placed.every((p) => p.clashes === 1));
}

console.log('\na chain of overlaps takes only the width it needs');
{
  /*
   * A 9:00-10:00, B 9:30-10:30, C 10:00-11:00.
   *
   * All three belong to one cluster, because B touches both others. The
   * question is how wide that cluster is, and the answer is how many things
   * are ever running at the same moment - not how many are in the chain.
   *
   *   9:00-9:30   A
   *   9:30-10:00  A B
   *   10:00-10:30 B C
   *   10:30-11:00 C
   *
   * Never more than two at once, so two columns, and C reuses the column A
   * has finished with. Giving all three a third of the width - which is what
   * counting the chain would do - wastes a third of the row on white space
   * for a clash that never happens.
   */
  const placed = layoutDay([at('a', 9, 0, 60), at('b', 9, 30, 60), at('c', 10, 0, 60)], DAY);
  is('the cluster is as wide as its busiest moment, not as long as its chain',
     placed.every((p) => p.width === 0.5),
     JSON.stringify(placed.map((p) => [p.event.id, p.width])));
  is('a freed column is reused rather than widening the cluster',
     byId(placed, 'a').left === byId(placed, 'c').left,
     `a at ${byId(placed, 'a').left}, c at ${byId(placed, 'c').left}`);
  is('and the one that overlaps both gets a column of its own',
     byId(placed, 'b').left !== byId(placed, 'a').left,
     `b at ${byId(placed, 'b').left}`);

  /*
   * The genuinely three-deep case, to prove the width is not simply capped
   * at two: three meetings all running at 9:30.
   */
  const deep = layoutDay([at('x', 9, 0, 60), at('y', 9, 15, 60), at('z', 9, 30, 60)], DAY);
  is('three at once really do take a third each',
     deep.every((p) => Math.abs(p.width - 1 / 3) < 1e-9),
     JSON.stringify(deep.map((p) => [p.event.id, p.width])));
  is('and none of them share a column',
     new Set(deep.map((p) => p.left)).size === 3,
     JSON.stringify(deep.map((p) => p.left)));
}

console.log('\nseparate clusters do not affect each other');
{
  const placed = layoutDay([
    at('a', 9, 0, 60), at('b', 9, 30, 30),   // morning clash
    at('c', 14, 0, 60),                       // alone in the afternoon
  ], DAY);
  is('the morning pair splits', byId(placed, 'a').width === 0.5 && byId(placed, 'b').width === 0.5);
  is('the afternoon one stays full width',
     byId(placed, 'c').width === 1, String(byId(placed, 'c').width));
}

console.log('\nevents that run past the edges of the day');
{
  const overnight = {
    id: 'night',
    starts_at: new Date(2026, 8, 14, 23, 0).toISOString(),
    ends_at: new Date(2026, 8, 15, 1, 0).toISOString(),
  };
  const placed = layoutDay([overnight], DAY);
  is('yesterday evening is clipped to the top of today',
     placed.length === 1 && topMin(placed[0]) === 0, JSON.stringify(placed.map(topMin)));
  is('and only the part inside today is drawn',
     heightMin(placed[0]) === 60, String(heightMin(placed[0])));

  const tomorrow = layoutDay([at('late', 23, 30, 120)], DAY);
  is('a meeting running into tomorrow stops at midnight',
     topMin(tomorrow[0]) + heightMin(tomorrow[0]) === DAY_MIN,
     `${topMin(tomorrow[0])} + ${heightMin(tomorrow[0])}`);

  is('a meeting on another day is not drawn at all',
     layoutDay([at('x', 9, 0, 60)], new Date(2026, 8, 16)).length === 0);
}

console.log('\nall-day events are not on the grid');
{
  const allDay = { id: 'ad', starts_at: new Date(2026, 8, 15, 0, 0).toISOString(), all_day: true };
  is('an all-day event takes no space in the time grid',
     layoutDay([allDay, at('a', 9, 0, 60)], DAY).length === 1);
  is('but it is offered separately for the strip above',
     allDayEvents([allDay, at('a', 9, 0, 60)], DAY).length === 1);
  is('and only for its own day',
     allDayEvents([allDay], new Date(2026, 8, 16)).length === 0);
}

console.log('\na block is always big enough to click');
{
  const placed = layoutDay([at('tiny', 9, 0, 1)], DAY);
  is('a one-minute event is still a target',
     heightMin(placed[0]) >= 15, String(heightMin(placed[0])));
}

console.log('\nhow long something runs, when nobody said');
{
  const noEnd = { id: 'n', starts_at: new Date(2026, 8, 15, 9, 0).toISOString(), ends_at: null };
  is('no end falls back to the default length',
     durationMinutes(noEnd) === DEFAULT_EVENT_MINUTES, String(durationMinutes(noEnd)));
  is('the type\'s own length wins over that default',
     durationMinutes(noEnd, 45) === 45, String(durationMinutes(noEnd, 45)));
  is('an explicit end wins over the type',
     durationMinutes(at('e', 9, 0, 90), 30) === 90, String(durationMinutes(at('e', 9, 0, 90), 30)));

  /*
   * A stored end that is not after the start cannot be trusted - it draws as
   * a zero or negative block - so it is treated as absent.
   */
  const backwards = {
    id: 'b',
    starts_at: new Date(2026, 8, 15, 9, 0).toISOString(),
    ends_at: new Date(2026, 8, 15, 8, 0).toISOString(),
  };
  is('an end before the start is ignored rather than drawn backwards',
     resolveEnd(backwards).getTime() > new Date(backwards.starts_at).getTime());
}

console.log('\nsmall helpers the grid leans on');
{
  is('minutes into the day', minutesIntoDay(new Date(2026, 8, 15, 14, 30)) === 870);
  // 547 is seven minutes past 9:00 and eight short of 9:15, so it rounds
  // down. Snapping is to the *nearest* quarter, not the next one.
  is('a click snaps to the nearest quarter hour', snapMinutes(547) === 540, String(snapMinutes(547)));
  is('and upward when that is nearer', snapMinutes(551) === 555, String(snapMinutes(551)));
  is('and never off the top of the day', snapMinutes(-30) === 0);
  is('nor off the bottom', snapMinutes(24 * 60 + 90) === 24 * 60 - 15, String(snapMinutes(24 * 60 + 90)));
  is('durations read as people say them',
     durationLabel(45) === '45m' && durationLabel(60) === '1h' && durationLabel(90) === '1h 30m');
  is('a colour is a colour', isHexColour('#6366F1') && !isHexColour('#fff') && !isHexColour('red'));
}

console.log('\nordering is stable and sensible');
{
  // Same start: the longer one takes the left column, so the short meeting
  // inside a long block reads as nested rather than hiding it.
  const placed = layoutDay([at('short', 9, 0, 30), at('long', 9, 0, 120)], DAY);
  is('when two start together the longer one is leftmost',
     byId(placed, 'long').left < byId(placed, 'short').left,
     `long ${byId(placed, 'long').left}, short ${byId(placed, 'short').left}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
