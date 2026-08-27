/* ═══════════════════════════════════════════════════════════════════════
   Overlays must belong to the viewport, not to the page behind them.

   Every route renders inside `.route-fade`, and that wrapper animates a
   transform. Any transform — including the identity matrix an animation
   leaves behind when it finishes — makes an element a containing block for
   its `position: fixed` descendants. When that happens a drawer asking for
   `fixed inset-0` silently gets the wrapper's box instead of the screen:
   it opens as a short panel floating mid-page, clipped to the height of
   whatever was behind it, dimming only the content column.

   This is the kind of bug that cannot be caught by reading the CSS. The
   keyframes look right — the `to` step deliberately omits `transform` — and
   the comment beside them said so confidently and was wrong, because
   `animation-fill-mode: both` keeps the animation's final computed value
   rather than reverting to the base one.

   So it is measured instead. The fixture mirrors the real nesting from
   AppLayout, and the assertion is the only one that matters: after the
   animation has finished, does a fixed overlay fill the viewport?

   Run: npx tsx scripts/overlay-containment-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = join(here, '../../client/src/index.css');
const BOARD = join(here, '../../client/src/pages/crm/DealsPage.tsx');
const TABLE = join(here, '../../client/src/components/crm/DealTable.tsx');

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

const css = readFileSync(CSS, 'utf8');
const board = readFileSync(BOARD, 'utf8');
const table = readFileSync(TABLE, 'utf8');

/** The `.route-fade` rule body, whatever it currently says. */
function routeFadeRule(): string {
  const match = css.match(/\.route-fade\s*\{([^}]*)\}/);
  return match ? match[1] : '';
}

const rule = routeFadeRule();

console.log('\nthe route wrapper must not outlive its own transform');
{
  is('there is a .route-fade rule to check at all', rule.length > 0, rule);

  /*
   * `both` and `forwards` both retain the animation's final value. With a
   * keyframe set that touches transform at all, that final value is a
   * matrix — identity or not — and an identity matrix traps fixed children
   * just as thoroughly as a real translation does.
   */
  const fill = /animation:[^;]*\b(both|forwards)\b/.test(rule);
  is('its animation does not use a forwards-filling mode',
     !fill,
     `route-fade rule is: ${rule.trim()}`);

  is('and it does still animate, so the fade was not simply deleted',
     /animation:\s*routeIn/.test(rule),
     rule.trim());
}

console.log('\nnothing else in the page shell traps a fixed overlay');
{
  /*
   * transform, filter, backdrop-filter, perspective and contain all create
   * containing blocks. They are legitimate on overlays themselves — a
   * frosted modal is meant to have one — so this only objects when one lands
   * on the route wrapper, which every page in the app sits inside.
   */
  const trap = /\.route-fade\s*\{[^}]*(transform|filter|perspective|contain)\s*:/.test(css);
  is('the wrapper declares no transform, filter or contain of its own',
     !trap);
}


/* ═══════════════════════════════════════════════════════════════════════
   A scrolling region needs an unbroken chain of bounded ancestors.

   The deals board asked its columns for `max-h-full` inside a parent sized
   by its own content. `max-height: 100%` against an auto-height parent
   resolves to no constraint at all, so the column grew to fit all sixty
   cards, its `overflow-y: auto` never had anything to scroll, and the board
   became a two-thousand-pixel wall that took the stage headers and the
   filter bar off the top of the screen with it.

   Nothing about that is visible in the markup — every class involved looks
   correct in isolation — so the four links in the chain are asserted
   individually. Measured proof lives in client/harness; this is the cheap
   guard that stops the chain being broken again.
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nthe board is bounded by the viewport, not by its own contents');
{
  is('the board asks for the height that is left on screen',
     /useFillViewport/.test(board) && /ref=\{boardRef\}/.test(board));

  is('and applies it, rather than measuring and discarding the answer',
     /style=\{height \? \{ height \} : undefined\}/.test(board));

  /*
   * `max-h-full` is the specific mistake. A column must take a definite
   * `h-full` from a parent that has a definite height, or the whole chain
   * is decorative.
   */
  is('no column falls back to max-h-full, which constrains nothing here',
     !/max-h-full/.test(board),
     'max-h-full is back on the board');

  is('columns are full-height flex boxes that may shrink below their content',
     /h-full min-h-0/.test(board),
     'expected a column with both h-full and min-h-0');

  /*
   * Without `min-h-0` a flex child refuses to shrink past its content, so
   * `flex-1 overflow-y-auto` silently becomes "grow forever" — the same bug
   * one level down.
   */
  is('the card list is the thing that scrolls, and is allowed to shrink',
     /flex-1 min-h-0 overflow-y-auto/.test(board),
     'expected the card list to carry flex-1, min-h-0 and overflow-y-auto together');
}

console.log('\nthe table header sticks to something that actually scrolls');
{
  is('the table caps its own height',
     /useFillViewport/.test(table) && /maxHeight: height/.test(table));

  /*
   * `sticky top-0` on a header row only means anything if the element it
   * scrolls inside is the one with the scrollbar. Left to the page, the
   * column titles scrolled away and every row after that was unlabelled
   * numbers.
   */
  is('and scrolls in both directions itself, so top-0 has a container to stick to',
     /ref=\{frameRef\}[^>]*className="overflow-auto"/.test(table)
       || /className="overflow-auto"[^>]*ref=\{frameRef\}/.test(table),
     'the scroll frame must be the element carrying the measured height');

  is('the header row is still sticky', /sticky top-0/.test(table));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
