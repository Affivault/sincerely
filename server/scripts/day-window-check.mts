/* ═══════════════════════════════════════════════════════════════════════
   `?days=`, and the three ways it used to be quietly wrong.

   Four endpoints read this parameter and each parsed it slightly
   differently. None of the failures threw, which is what makes them worth a
   check: a report that is confidently wrong is worse than one that refuses,
   because nobody goes looking.

   Run: npx tsx scripts/day-window-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { parseDayWindow } from '../src/utils/day-window.js';

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — got ${detail}` : ''}`); }
}

console.log('the ordinary cases');
is('a normal window survives untouched', parseDayWindow('30') === 30);
is('a number works as well as a string', parseDayWindow(90) === 90);
is('nothing asked for means the caller\'s default', parseDayWindow(undefined, 30) === 30);
is('nothing asked for and no default means all time', parseDayWindow(undefined) === undefined);
is('an empty string is the same as absent', parseDayWindow('', 14) === 14);

console.log('\nthe three that failed silently');
/*
 * NaN is falsy, so the service skipped its date filter entirely and answered
 * with all-time figures for a request that asked for a window.
 */
is('junk falls back instead of silently reporting all time',
   parseDayWindow('abc', 30) === 30, String(parseDayWindow('abc', 30)));
is('junk with no default stays undefined rather than becoming NaN',
   parseDayWindow('abc') === undefined, String(parseDayWindow('abc')));
/*
 * The worst of the three. days=-5 made the cutoff five days in the FUTURE,
 * so every count came back zero and the dashboard read as "nothing has
 * happened here" — indistinguishable from a genuinely quiet account.
 */
is('a negative window no longer makes a cutoff in the future',
   parseDayWindow('-5', 30) === 30, String(parseDayWindow('-5', 30)));
is('zero is not treated as all time',
   parseDayWindow('0', 30) === 30, String(parseDayWindow('0', 30)));

console.log('\nand the edges');
is('a fraction is floored to whole days', parseDayWindow('7.9') === 7, String(parseDayWindow('7.9')));
is('Infinity is junk, not a very long window',
   parseDayWindow('Infinity', 30) === 30, String(parseDayWindow('Infinity', 30)));
is('an absurd window is clamped rather than scanning the table',
   parseDayWindow('999999') === 3650, String(parseDayWindow('999999')));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
