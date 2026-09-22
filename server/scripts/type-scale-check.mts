/* ═══════════════════════════════════════════════════════════════════════
   Eight type sizes, not thirty-one.

   MEASURED BEFORE THIS LANDED: twenty-five arbitrary bracket sizes plus
   six Tailwind defaults, in one app. NINE of them lived between 9px and
   13.5px and every one was used hundreds of times:

       text-[11px]     356      text-[11.5px]   358
       text-[12px]     352      text-[12.5px]   335
       text-[13px]     228      text-[13.5px]    28
       text-[10px]     151      text-[10.5px]   236
       text-sm         177      text-xs         148

   11px, 11.5px, 12px and 12.5px are not four sizes. They are one size
   that nobody agreed on - and half a pixel is invisible on its own and
   obvious in aggregate, which is exactly why this is the kind of thing
   that never gets fixed and never stops being felt. It is why things in
   this app looked almost aligned and never quite settled.

   Eight steps now, named by role. Every value chosen was already one of
   the dominant sizes in the codebase, so collapsing onto them moved
   almost nothing visually - it just stopped the drift.

   This file is the fence. A scale is only a scale while nothing is
   allowed outside it, and "please use the tokens" in a document is not a
   mechanism.

   Run: npx tsx scripts/type-scale-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '../../client');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(join(CLIENT, 'src')).map((f) => ({
  path: relative(CLIENT, f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}));

/** Comments must never satisfy or trip a rule about code. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const config = readFileSync(join(CLIENT, 'tailwind.config.ts'), 'utf8');

const STEPS = ['micro', 'caption', 'body', 'strong', 'heading', 'title', 'display', 'hero'];

console.log('\nthe scale exists, and it is small');
{
  is('there is a fontSize scale in the theme', /fontSize: \{/.test(config),
     'sizes would go back to being invented per component');

  /*
   * ONE fontSize KEY, AND THIS ASSERTION IS THE WHOLE REASON THE SCALE
   * WAS DEAD FOR TWO RELEASES.
   *
   * The config carried a SECOND `fontSize:` further down, left over from
   * an older scale. In a JavaScript object literal the later key wins
   * silently, so none of micro/caption/body/strong/title/hero existed as
   * a utility at all - 2,448 call sites emitted no font-size - and
   * text-heading and text-display resolved to 24px and 48px instead of
   * 15px and 22px.
   *
   * This file did not catch it because it sliced from the FIRST
   * `fontSize: {` to `fontFamily:`, which is exactly the block that was
   * being overridden. It validated the dead one, in detail, and passed.
   */
  const declarations = (config.match(/^\s*fontSize:\s*\{/gm) || []).length;
  is('and only one of them', declarations === 1,
     `${declarations} fontSize keys - the last one silently wins and the others emit nothing`);

  // Read the LAST one, because that is the one Tailwind will use.
  const from = config.lastIndexOf('fontSize: {');
  const block = config.slice(from, config.indexOf('},', from));
  for (const step of STEPS) {
    is(`${step} is defined`, new RegExp(`${step}:\\s*\\[`).test(block), block.slice(0, 200));
  }

  const defined = (block.match(/^\s+(\w+):\s*\[/gm) || []).length;
  is('and there are exactly eight steps', defined === STEPS.length,
     `${defined} steps - a ninth is how nine sizes happened the first time`);

  /*
   * Font size only. `text-[12px]` set font-size and left line-height to
   * inherit; attaching a line-height to these tokens would silently
   * change the leading of two and a half thousand places at once, which
   * is a different change from this one and should be made deliberately
   * if it is made at all.
   */
  is('the steps carry a size and nothing else',
     !/lineHeight|letterSpacing/.test(block),
     'the leading of 2,533 places would change silently');
}

console.log('\nand nothing is outside it');
{
  /*
   * The whole point. A scale is only a scale while nothing is allowed
   * outside it, and the twenty-five bracket sizes are how the last one
   * stopped being one.
   */
  const arbitrary = files
    .map((f) => ({ path: f.path, hits: code(f.text).match(/text-\[[0-9.]+px\]/g) || [] }))
    .filter((f) => f.hits.length > 0);
  is('no component sets an arbitrary pixel size',
     arbitrary.length === 0,
     arbitrary.map((f) => `${f.path}: ${[...new Set(f.hits)].join(', ')}`).join('\n         '));

  /*
   * Tailwind's own defaults were the seventh and eighth dialect: text-sm
   * is 14px and text-xs is 12px, which overlap the bracket sizes at
   * different values, so a text-sm paragraph next to a text-[12px] one
   * was a mismatch nobody could name.
   */
  const defaults = files
    .map((f) => ({
      path: f.path,
      hits: code(f.text).match(/(?<![\w-])text-(xs|sm|base|lg|xl|2xl|3xl|4xl)(?![\w-])/g) || [],
    }))
    .filter((f) => f.hits.length > 0);
  is('nor uses a Tailwind default size',
     defaults.length === 0,
     defaults.map((f) => `${f.path}: ${[...new Set(f.hits)].join(', ')}`).join('\n         '));
}

console.log('\nthe scale is actually what the app is written in');
{
  const used = new Map<string, number>();
  for (const f of files) {
    for (const m of code(f.text).matchAll(/(?<![\w-])text-(micro|caption|body|strong|heading|title|display|hero)(?![\w-])/g)) {
      used.set(m[1], (used.get(m[1]) || 0) + 1);
    }
  }

  const total = [...used.values()].reduce((a, b) => a + b, 0);
  is('the tokens are used throughout, not just declared',
     total > 1500, `${total} uses`);

  /*
   * Every step earns its place. A step nothing uses is a step somebody
   * will eventually use for the wrong thing, and a scale with a spare
   * rung is how you get back to nine sizes.
   */
  const unused = STEPS.filter((s) => !used.has(s));
  is('and every step is used by something', unused.length === 0,
     `unused: ${unused.join(', ')}`);

  /*
   * The shape of the distribution is the evidence that the roles are
   * right: body text should dominate, and the display sizes should be
   * rare. If `hero` were the most common step, the names would be lying.
   */
  const ordered = [...used.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  is('body text dominates, as it should',
     ['body', 'caption'].includes(ordered[0]), ordered.join(' > '));
  is('and the display sizes are rare',
     (used.get('hero') || 0) < (used.get('body') || 0) / 10,
     `hero: ${used.get('hero')}, body: ${used.get('body')}`);
}

console.log('\nthe steps are the sizes the app already used most');
{
  /*
   * Chosen rather than invented. A scale of pleasing round numbers would
   * have moved every one of two and a half thousand call sites by a pixel
   * or two; these were already the dominant values, so the collapse was
   * almost invisible - which is the point. This change was about removing
   * the near-duplicates, not about redesigning the typography.
   */
  const from = config.lastIndexOf('fontSize: {');
  const block = config.slice(from, config.indexOf('},', from));
  const sizes = [...block.matchAll(/(\w+):\s*\['(\d+)px'\]/g)].map((m) => [m[1], Number(m[2])] as const);

  is('each step is a whole number of pixels',
     sizes.every(([, px]) => Number.isInteger(px)),
     'half-pixel steps are the thing being removed');
  is('and they ascend', sizes.every(([, px], i) => i === 0 || px > sizes[i - 1][1]),
     sizes.map(([n, px]) => `${n}:${px}`).join(' '));

  /*
   * The band that had nine sizes in it now has four, and they are a
   * pixel apart rather than half a pixel. A pixel is a decision; half a
   * pixel is an accident.
   */
  const small = sizes.filter(([, px]) => px <= 13);
  is('the 10-13px band has four steps, not nine', small.length === 4,
     small.map(([n, px]) => `${n}:${px}`).join(' '));
  is('and they are a whole pixel apart',
     small.every(([, px], i) => i === 0 || px - small[i - 1][1] === 1),
     small.map(([n, px]) => `${n}:${px}`).join(' '));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} type scale check(s) failed`);
