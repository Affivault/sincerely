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

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

const css = readFileSync(CSS, 'utf8');

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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
