/* ═══════════════════════════════════════════════════════════════════════
   Which moments may be offered to a stranger.

   The two failures that matter here are both silent and both expensive.
   Offer a slot that is already taken and you are double-booked, and nobody
   finds out until two people dial into the same call. Offer one in the
   wrong hour and somebody sits in an empty room a week on Tuesday.

   The second is the one nearly every hand-rolled scheduler gets wrong, and
   it only shows up twice a year: working hours are wall-clock statements,
   so "nine to five" is a different instant in March and in July. Converting
   a week's windows once and adding 24 hours per day is the bug, and it is
   invisible unless a test deliberately crosses a clock change. Several
   below do.

   Run: npx tsx scripts/availability-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import {
  computeSlots, isSlotBookable, mergeBusy, overlaps, groupSlotsByDay,
  localDaysBetween, minuteLabel, parseMinuteLabel, describeWeek,
  DEFAULT_SCHEDULING_PREFS, DEFAULT_WORKING_WEEK,
  partsInTimezone,
  type SchedulingPrefs, type AvailabilityWindow, type BusyInterval,
} from '@lemlist/shared';

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

const prefs = (over: Partial<SchedulingPrefs> = {}): SchedulingPrefs => ({
  ...DEFAULT_SCHEDULING_PREFS,
  // Notice off unless a test is about notice, so it does not silently eat
  // the very slots another test is asserting on.
  minimum_notice_minutes: 0,
  ...over,
});

/** Monday 9-5 only, to keep expectations small. */
const MON_9_5: AvailabilityWindow[] = [{ weekday: 1, start_minute: 540, end_minute: 1020 }];

const utc = (s: string) => new Date(s);
/** How a slot reads in a given zone, for legible assertions. */
const at = (d: Date, tz: string) => {
  const p = partsInTimezone(d, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

console.log('a plain day, in UTC');
{
  const slots = computeSlots({
    // Monday 5 October 2026.
    from: utc('2026-10-05T00:00:00Z'),
    to: utc('2026-10-06T00:00:00Z'),
    durationMinutes: 60,
    windows: MON_9_5,
    prefs: prefs({ slot_interval_minutes: 60 }),
    busy: [],
    now: utc('2026-10-01T00:00:00Z'),
  });
  is('nine to five at hourly steps is eight slots', slots.length === 8, String(slots.length));
  is('the first is 09:00', at(slots[0].start, 'UTC') === '2026-10-05 09:00', at(slots[0].start, 'UTC'));
  is('the last starts at 16:00, so it ends at 17:00',
     at(slots[slots.length - 1].start, 'UTC') === '2026-10-05 16:00', at(slots[slots.length - 1].start, 'UTC'));
  is('and nothing runs past the end of the window',
     slots.every((s) => at(s.end, 'UTC') <= '2026-10-05 17:00'));

  const quarterly = computeSlots({
    from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-06T00:00:00Z'),
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ slot_interval_minutes: 15 }), busy: [],
    now: utc('2026-10-01T00:00:00Z'),
  });
  // 09:00 to 16:00 inclusive, every 15 minutes.
  is('a finer interval offers more starts, still ending by five',
     quarterly.length === 29, String(quarterly.length));
}

console.log('\ndays you do not work are not offered');
{
  const slots = computeSlots({
    from: utc('2026-10-03T00:00:00Z'),   // Saturday
    to: utc('2026-10-05T00:00:00Z'),     // Monday 00:00
    durationMinutes: 30, windows: MON_9_5, prefs: prefs(), busy: [],
    now: utc('2026-10-01T00:00:00Z'),
  });
  is('a weekend with Monday-only hours offers nothing', slots.length === 0, String(slots.length));

  const noHours = computeSlots({
    from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-12T00:00:00Z'),
    durationMinutes: 30, windows: [], prefs: prefs(), busy: [],
    now: utc('2026-10-01T00:00:00Z'),
  });
  is('no hours at all offers nothing rather than everything', noHours.length === 0);
}

console.log('\nwhat is already in the diary');
{
  const base = {
    from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-06T00:00:00Z'),
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ slot_interval_minutes: 60 }),
    now: utc('2026-10-01T00:00:00Z'),
  };
  const busy: BusyInterval[] = [
    { start: utc('2026-10-05T11:00:00Z'), end: utc('2026-10-05T12:00:00Z') },
  ];
  const slots = computeSlots({ ...base, busy });
  is('a booked hour is not offered again',
     !slots.some((s) => at(s.start, 'UTC') === '2026-10-05 11:00'),
     slots.map((s) => at(s.start, 'UTC')).join(' '));
  is('and the rest of the day still is', slots.length === 7, String(slots.length));

  /*
   * Touching is not overlapping. A meeting ending at 12:00 and a slot
   * starting at 12:00 are back to back; treating that as a clash throws
   * away a slot next to every meeting in the diary.
   */
  is('the slot immediately after it is still offered',
     slots.some((s) => at(s.start, 'UTC') === '2026-10-05 12:00'));
  is('and the one immediately before',
     slots.some((s) => at(s.start, 'UTC') === '2026-10-05 10:00'));

  // A meeting that only clips the edge of a candidate still blocks it.
  const clipping = computeSlots({
    ...base,
    busy: [{ start: utc('2026-10-05T11:30:00Z'), end: utc('2026-10-05T11:45:00Z') }],
  });
  is('a short meeting in the middle of an hour blocks that hour',
     !clipping.some((s) => at(s.start, 'UTC') === '2026-10-05 11:00'),
     clipping.map((s) => at(s.start, 'UTC')).join(' '));
}

console.log('\nbuffers belong to the organiser');
{
  const slots = computeSlots({
    from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-06T00:00:00Z'),
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ slot_interval_minutes: 60, buffer_before_minutes: 15, buffer_after_minutes: 15 }),
    busy: [{ start: utc('2026-10-05T11:00:00Z'), end: utc('2026-10-05T12:00:00Z') }],
    now: utc('2026-10-01T00:00:00Z'),
  });
  /*
   * With fifteen minutes either side, the 10:00-11:00 slot needs the room
   * free until 11:15 and the 12:00 slot needs it free from 11:45. Both
   * collide. A scheduler that checks only the bare meeting books them, and
   * the buffers it promised do not exist.
   */
  is('the slot ending when a meeting starts is refused',
     !slots.some((s) => at(s.start, 'UTC') === '2026-10-05 10:00'),
     slots.map((s) => at(s.start, 'UTC')).join(' '));
  is('and the one starting when it ends',
     !slots.some((s) => at(s.start, 'UTC') === '2026-10-05 12:00'));
  is('while a slot a clear hour away survives',
     slots.some((s) => at(s.start, 'UTC') === '2026-10-05 09:00'));
}

console.log('\nhow soon is too soon');
{
  const now = utc('2026-10-05T09:00:00Z'); // Monday morning
  const slots = computeSlots({
    from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-06T00:00:00Z'),
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ slot_interval_minutes: 60, minimum_notice_minutes: 240 }),
    busy: [], now,
  });
  is('nothing inside the notice period is offered',
     slots.every((s) => s.start.getTime() >= now.getTime() + 240 * 60_000),
     slots.map((s) => at(s.start, 'UTC')).join(' '));
  is('the first offered is 13:00', at(slots[0].start, 'UTC') === '2026-10-05 13:00', at(slots[0]?.start, 'UTC'));
  is('times earlier today are gone, not merely reordered',
     !slots.some((s) => at(s.start, 'UTC') === '2026-10-05 09:00'));
}

console.log('\na day can be full without being solid');
{
  const busy: BusyInterval[] = [
    { start: utc('2026-10-05T09:00:00Z'), end: utc('2026-10-05T09:30:00Z') },
    { start: utc('2026-10-05T14:00:00Z'), end: utc('2026-10-05T14:30:00Z') },
  ];
  const capped = computeSlots({
    from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-06T00:00:00Z'),
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ slot_interval_minutes: 60, max_bookings_per_day: 2 }),
    busy, now: utc('2026-10-01T00:00:00Z'),
  });
  is('two bookings against a cap of two closes the day',
     capped.length === 0, String(capped.length));

  const under = computeSlots({
    from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-06T00:00:00Z'),
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ slot_interval_minutes: 60, max_bookings_per_day: 3 }),
    busy, now: utc('2026-10-01T00:00:00Z'),
  });
  is('one under the cap and the day is open again', under.length > 0, String(under.length));
}

console.log('\nsplit days');
{
  const split: AvailabilityWindow[] = [
    { weekday: 1, start_minute: 540, end_minute: 720 },   // 09:00-12:00
    { weekday: 1, start_minute: 780, end_minute: 1020 },  // 13:00-17:00
  ];
  const slots = computeSlots({
    from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-06T00:00:00Z'),
    durationMinutes: 60, windows: split,
    prefs: prefs({ slot_interval_minutes: 60 }), busy: [],
    now: utc('2026-10-01T00:00:00Z'),
  });
  is('the lunch hour is not bookable',
     !slots.some((s) => at(s.start, 'UTC') === '2026-10-05 12:00'),
     slots.map((s) => at(s.start, 'UTC')).join(' '));
  is('the morning and the afternoon both are',
     slots.some((s) => at(s.start, 'UTC') === '2026-10-05 09:00')
     && slots.some((s) => at(s.start, 'UTC') === '2026-10-05 13:00'));
  is('and the count is three plus four', slots.length === 7, String(slots.length));
}

console.log('\na meeting must fit inside its window');
{
  const slots = computeSlots({
    from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-06T00:00:00Z'),
    durationMinutes: 90, windows: MON_9_5,
    prefs: prefs({ slot_interval_minutes: 60 }), busy: [],
    now: utc('2026-10-01T00:00:00Z'),
  });
  is('a 90-minute meeting cannot start at 16:00',
     !slots.some((s) => at(s.start, 'UTC') === '2026-10-05 16:00'),
     slots.map((s) => at(s.start, 'UTC')).join(' '));
  is('the last start that fits is 15:30 or earlier',
     at(slots[slots.length - 1].start, 'UTC') <= '2026-10-05 15:30',
     at(slots[slots.length - 1].start, 'UTC'));

  const tooLong = computeSlots({
    from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-06T00:00:00Z'),
    durationMinutes: 600, windows: MON_9_5, prefs: prefs(), busy: [],
    now: utc('2026-10-01T00:00:00Z'),
  });
  is('a meeting longer than the working day offers nothing',
     tooLong.length === 0, String(tooLong.length));
}

console.log('\nnine to five means nine to five, whatever the clocks have done');
{
  /*
   * The bug this exists to catch. British clocks go back on Sunday 25
   * October 2026. Convert the week's windows once and add 24 hours per day
   * and every slot from Monday the 26th is an hour out — and stays an hour
   * out for five months.
   */
  const tz = 'Europe/London';
  const before = computeSlots({
    from: utc('2026-10-19T00:00:00Z'), to: utc('2026-10-20T00:00:00Z'), // Mon 19th, BST
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ timezone: tz, slot_interval_minutes: 60 }), busy: [],
    now: utc('2026-10-01T00:00:00Z'),
  });
  const after = computeSlots({
    from: utc('2026-10-26T00:00:00Z'), to: utc('2026-10-27T00:00:00Z'), // Mon 26th, GMT
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ timezone: tz, slot_interval_minutes: 60 }), busy: [],
    now: utc('2026-10-01T00:00:00Z'),
  });

  is('the Monday before the clocks change starts at 09:00 local',
     at(before[0].start, tz) === '2026-10-19 09:00', at(before[0]?.start, tz));

  /*
   * The assertion that actually catches it.
   *
   * Two separate one-day calls both come out right even when the code
   * converts a window once and adds 24 hours per day, because with one day
   * in range there is nothing to add. The bug only appears when a SINGLE
   * call spans the change - which is exactly what a booking page does when
   * it asks for the next fortnight. Asked that way, the broken version puts
   * every Monday after the 25th an hour out.
   */
  const spanning = computeSlots({
    from: utc('2026-10-19T00:00:00Z'), to: utc('2026-10-27T00:00:00Z'),
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ timezone: tz, slot_interval_minutes: 60 }), busy: [],
    now: utc('2026-10-01T00:00:00Z'),
  });
  /*
   * The FIRST slot of each day, not merely "a 09:00 exists somewhere".
   * Shifting the window an hour early still leaves a 09:00 in it, so the
   * looser assertion passes against the broken version - it was written
   * that way first and caught nothing.
   */
  const firstPerDay = groupSlotsByDay(spanning, tz).map((g) => at(g.slots[0].start, tz));
  is('one range spanning the clock change starts every Monday at 09:00 local',
     firstPerDay.length === 2
     && firstPerDay[0] === '2026-10-19 09:00'
     && firstPerDay[1] === '2026-10-26 09:00',
     JSON.stringify(firstPerDay));
  is('and no slot in that range falls outside working hours',
     spanning.every((s) => {
       const h = partsInTimezone(s.start, tz).hour;
       return h >= 9 && h < 17;
     }),
     JSON.stringify(spanning.map((s) => at(s.start, tz)).slice(0, 4)));
  is('and the Monday after also starts at 09:00 local',
     at(after[0].start, tz) === '2026-10-26 09:00', at(after[0]?.start, tz));
  is('which are different instants in UTC, as they must be',
     before[0].start.toISOString().slice(11, 16) === '08:00'
     && after[0].start.toISOString().slice(11, 16) === '09:00',
     `${before[0]?.start.toISOString()} vs ${after[0]?.start.toISOString()}`);

  // And the other direction, for a zone that springs forward.
  const ny = 'America/New_York';
  const nyBefore = computeSlots({
    from: utc('2026-03-02T00:00:00Z'), to: utc('2026-03-03T00:00:00Z'),
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ timezone: ny, slot_interval_minutes: 60 }), busy: [],
    now: utc('2026-02-01T00:00:00Z'),
  });
  const nyAfter = computeSlots({
    from: utc('2026-03-09T00:00:00Z'), to: utc('2026-03-10T00:00:00Z'),
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ timezone: ny, slot_interval_minutes: 60 }), busy: [],
    now: utc('2026-02-01T00:00:00Z'),
  });
  is('New York keeps its nine o\'clock across the spring change',
     at(nyBefore[0].start, ny) === '2026-03-02 09:00' && at(nyAfter[0].start, ny) === '2026-03-09 09:00',
     `${at(nyBefore[0]?.start, ny)} / ${at(nyAfter[0]?.start, ny)}`);
}

console.log('\nthe day boundary is the account\'s, not UTC\'s');
{
  /*
   * In Auckland (+13 in February) Monday begins at 11:00 the previous day
   * in UTC. Enumerating days in UTC offers Sunday's hours on Monday and
   * misses the end of Monday entirely.
   */
  const tz = 'Pacific/Auckland';
  const slots = computeSlots({
    from: utc('2026-02-01T00:00:00Z'), to: utc('2026-02-10T00:00:00Z'),
    durationMinutes: 60, windows: MON_9_5,
    prefs: prefs({ timezone: tz, slot_interval_minutes: 60 }), busy: [],
    now: utc('2026-01-01T00:00:00Z'),
  });
  is('every slot lands on a Monday in Auckland',
     slots.every((s) => partsInTimezone(s.start, tz).weekday === 1),
     slots.slice(0, 3).map((s) => `${at(s.start, tz)} (wd ${partsInTimezone(s.start, tz).weekday})`).join(' '));
  is('and every one at nine in the morning there',
     slots.every((s) => partsInTimezone(s.start, tz).hour >= 9 && partsInTimezone(s.start, tz).hour < 17));
}

console.log('\nnobody may reach past the horizon');
{
  const slots = computeSlots({
    from: utc('2026-10-05T00:00:00Z'),
    to: utc('2099-01-01T00:00:00Z'),   // a crawler asking for everything
    durationMinutes: 60, windows: DEFAULT_WORKING_WEEK,
    prefs: prefs({ booking_horizon_days: 14, slot_interval_minutes: 60 }),
    busy: [], now: utc('2026-10-05T00:00:00Z'),
  });
  const last = slots[slots.length - 1];
  is('the range is clamped to the horizon',
     last.start.getTime() <= utc('2026-10-19T00:00:00Z').getTime(),
     at(last?.start, 'UTC'));
  is('and the answer stays a sane size', slots.length < 200, String(slots.length));
}

console.log('\nbooking never trusts the list it was offered');
{
  const base = {
    durationMinutes: 60,
    windows: MON_9_5,
    prefs: prefs({ slot_interval_minutes: 60 }),
    now: utc('2026-10-01T00:00:00Z'),
  };
  is('a slot that is genuinely free is bookable',
     isSlotBookable(utc('2026-10-05T10:00:00Z'), { ...base, busy: [] }));
  /*
   * The race a booking page has to survive: the list was computed when the
   * page loaded, and somebody else took the slot while the form was open.
   */
  is('the same slot is refused once somebody else has taken it',
     !isSlotBookable(utc('2026-10-05T10:00:00Z'), {
       ...base,
       busy: [{ start: utc('2026-10-05T10:00:00Z'), end: utc('2026-10-05T11:00:00Z') }],
     }));
  is('a slot outside working hours is refused',
     !isSlotBookable(utc('2026-10-05T21:00:00Z'), { ...base, busy: [] }));
  is('a slot on a day off is refused',
     !isSlotBookable(utc('2026-10-04T10:00:00Z'), { ...base, busy: [] }));
  is('and one that does not sit on the interval is refused',
     !isSlotBookable(utc('2026-10-05T10:07:00Z'), { ...base, busy: [] }));
}

console.log('\nmerging what is already booked');
{
  const merged = mergeBusy([
    { start: utc('2026-10-05T09:00:00Z'), end: utc('2026-10-05T10:00:00Z') },
    { start: utc('2026-10-05T09:30:00Z'), end: utc('2026-10-05T11:00:00Z') },
    { start: utc('2026-10-05T14:00:00Z'), end: utc('2026-10-05T15:00:00Z') },
  ]);
  is('overlapping meetings become one span', merged.length === 2, String(merged.length));
  is('and the span covers both', merged[0].end.toISOString() === '2026-10-05T11:00:00.000Z',
     merged[0]?.end.toISOString());
  is('touching spans merge too',
     mergeBusy([
       { start: utc('2026-10-05T09:00:00Z'), end: utc('2026-10-05T10:00:00Z') },
       { start: utc('2026-10-05T10:00:00Z'), end: utc('2026-10-05T11:00:00Z') },
     ]).length === 1);
  is('a zero-length meeting is dropped rather than blocking a slot',
     mergeBusy([{ start: utc('2026-10-05T09:00:00Z'), end: utc('2026-10-05T09:00:00Z') }]).length === 0);
  is('nothing in, nothing out', mergeBusy([]).length === 0);
}

console.log('\nsmall pieces');
{
  is('overlap is exclusive at the edges',
     !overlaps(utc('2026-01-01T09:00:00Z'), utc('2026-01-01T10:00:00Z'),
               utc('2026-01-01T10:00:00Z'), utc('2026-01-01T11:00:00Z')));
  is('and true when they genuinely cross',
     overlaps(utc('2026-01-01T09:00:00Z'), utc('2026-01-01T10:00:00Z'),
              utc('2026-01-01T09:59:00Z'), utc('2026-01-01T11:00:00Z')));

  is('minutes read as a clock', minuteLabel(540) === '09:00' && minuteLabel(1020) === '17:00');
  is('and parse back', parseMinuteLabel('09:00') === 540 && parseMinuteLabel('9') === 540);
  is('rubbish does not parse', parseMinuteLabel('lunchtime') === null && parseMinuteLabel('25:00') === null);

  is('a day list covers the range', localDaysBetween(utc('2026-10-05T00:00:00Z'), utc('2026-10-07T00:00:00Z'), 'UTC').length >= 3);

  const grouped = groupSlotsByDay(
    computeSlots({
      from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-20T00:00:00Z'),
      durationMinutes: 60, windows: MON_9_5,
      prefs: prefs({ slot_interval_minutes: 60 }), busy: [],
      now: utc('2026-10-01T00:00:00Z'),
    }),
    'UTC',
  );
  // Three Mondays fall between the 5th and the 20th: the 5th, 12th and 19th.
  is('slots group into days a booking page can render',
     grouped.length === 3 && grouped[0].date === '2026-10-05', JSON.stringify(grouped.map((g) => g.date)));
  is('each day carries its own slots, in order',
     grouped.every((g) => g.slots.length === 8)
     && grouped[0].slots[0].start.getTime() < grouped[0].slots[1].start.getTime(),
     JSON.stringify(grouped.map((g) => g.slots.length)));

  is('the week describes itself', /Mon/.test(describeWeek(DEFAULT_WORKING_WEEK))
     && /40 bookable hours/.test(describeWeek(DEFAULT_WORKING_WEEK)), describeWeek(DEFAULT_WORKING_WEEK));
  is('and says so plainly when there are none',
     /nobody can book you/.test(describeWeek([])), describeWeek([]));
}

console.log('\nrefusals rather than nonsense');
{
  is('a zero-length meeting offers nothing',
     computeSlots({
       from: utc('2026-10-05T00:00:00Z'), to: utc('2026-10-06T00:00:00Z'),
       durationMinutes: 0, windows: MON_9_5, prefs: prefs(), busy: [],
       now: utc('2026-10-01T00:00:00Z'),
     }).length === 0);
  is('a backwards range offers nothing',
     computeSlots({
       from: utc('2026-10-06T00:00:00Z'), to: utc('2026-10-05T00:00:00Z'),
       durationMinutes: 60, windows: MON_9_5, prefs: prefs(), busy: [],
       now: utc('2026-10-01T00:00:00Z'),
     }).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
