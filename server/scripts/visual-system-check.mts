/* ═══════════════════════════════════════════════════════════════════════
   The visual system: one value per decision.

   Same disease the type scale had, in three more places. Nobody chose any
   of this; it accumulated.

   COLOUR. 101 hardcoded hex values in app chrome, against 6,090 uses of a
   token. That would be a tidiness complaint except that the tokens CHANGE
   WITH THE THEME:

       :root { --indigo: #5B5BF5 }      .dark { --indigo: #6366F1 }

   So `bg-[#5B5BF5]` is the light indigo, frozen - and in dark mode it sat
   beside tokenised elements rendering #6366F1. Two slightly different
   indigos, side by side, in one theme only. `bg-[#6366F1]` x12 and
   `bg-[#4F46E5]` x10 were the same mistake pointing the other way: the
   DARK values frozen, wrong in light mode.

   It is invisible to whoever writes it, because they are working in one
   theme, and it is the kind of thing that makes an interface read as
   cheap without anyone being able to say why.

   RADIUS. Sixteen distinct corner radii: 3, 4, 5, 6, 7, 8, 9, 10, 14 and
   16px alongside the named steps. Forty-nine of those were a named step
   written out by hand - `rounded-[4px]` IS `rounded` - and the rest sat
   between steps. 5px and 6px are not two decisions.

   SHADOW. The focus ring was written inline 27 times in TWO colours, half
   with the light indigo and half with the dark one. Whichever theme you
   were not looking at had a focus ring that did not match the thing it
   was focusing.

   Run: npx tsx scripts/visual-system-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '../../client');

/** Comments must never satisfy or trip a rule about code. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(join(CLIENT, 'src')).map((f) => ({
  path: relative(CLIENT, f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}));
const css = readFileSync(join(CLIENT, 'src/index.css'), 'utf8');

/*
 * Surfaces whose colours are RIGHT to be fixed, each with a reason.
 *
 * Getting this list wrong in the other direction is the expensive
 * mistake: sweeping an email preview onto app tokens would make it
 * follow the SENDER's theme, which is the one thing it must never do.
 */
const EXEMPT_FILES: Record<string, string> = {
  'src/pages/templates/TemplatesPage.tsx':
    'previews the email as the RECIPIENT will see it - their mail client '
    + 'renders it, not this app, so it must not follow this app\'s theme',
  'src/components/shared/EmailBody.tsx':
    'styles email HTML, for the same reason',
  'src/pages/assets/AssetBuilderPage.tsx':
    'the hex values are asset CONTENT - the fill of a shape being drawn',
  'src/components/shared/Avatar.tsx':
    'an identity palette: eight gradients chosen to be distinct and assigned '
    + 'by hashing a name. A semantic token here would make an avatar mean '
    + '"error", and let two people collide when the theme changed',
};

/** Colours that belong to somebody else and never change. */
const EXEMPT_COLOURS: Record<string, string> = {
  '#0a66c2': "LinkedIn's brand blue - a brand mark is one colour in both themes",
  '#ff5f57': 'macOS window chrome, mocked deliberately in a preview',
  '#febc2e': 'macOS window chrome, mocked deliberately in a preview',
  '#28c840': 'macOS window chrome, mocked deliberately in a preview',
};

/** Arrays of colours picked to be distinguishable. Data, not chrome. */
const PALETTE = /(FOLDER_COLORS|PIE_COLORS|GRADIENTS|PALETTE)\s*[:=]/;

const appFiles = files.filter((f) => !/[Ll]anding|StatusPage/.test(f.path));

/* ── Colour ───────────────────────────────────────────────────────────── */

console.log('\nthe tokens really do change with the theme');
{
  /*
   * The premise of the whole colour rule. If the tokens were the same in
   * both themes then a hardcoded hex would be untidy and nothing worse,
   * and every assertion below would be enforcing a preference rather than
   * fixing a defect.
   */
  const light = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'));
  const dark = css.slice(css.indexOf('.dark {'));
  const pick = (block: string, name: string) =>
    (block.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1]?.trim();

  is('--indigo differs between light and dark',
     !!pick(light, '--indigo') && pick(light, '--indigo') !== pick(dark, '--indigo'),
     `${pick(light, '--indigo')} vs ${pick(dark, '--indigo')}`);

  is('and so does the focus ring',
     !!pick(light, '--ring-focus') && pick(light, '--ring-focus') !== pick(dark, '--ring-focus'),
     `${pick(light, '--ring-focus')} vs ${pick(dark, '--ring-focus')}`);
}

console.log('\nno app chrome freezes a colour to one theme');
{
  const offenders: string[] = [];
  for (const f of appFiles) {
    if (EXEMPT_FILES[f.path]) continue;
    const lines = code(f.text).split('\n');
    lines.forEach((line, i) => {
      if (PALETTE.test(line)) return;
      for (const m of line.matchAll(/\b(bg|text|border|from|to|via|ring|fill|stroke)-\[(#[0-9A-Fa-f]{3,8})\]/g)) {
        if (EXEMPT_COLOURS[m[2].toLowerCase()]) continue;
        offenders.push(`${f.path}:${i + 1}  ${m[0]}`);
      }
    });
  }
  is('every colour in app chrome is a token', offenders.length === 0,
     offenders.slice(0, 12).join('\n         '));

  // Exemptions print every run. One nobody can see is just a hole.
  for (const [p, why] of Object.entries(EXEMPT_FILES)) console.log(`       (exempt) ${p} - ${why}`);
  for (const [c, why] of Object.entries(EXEMPT_COLOURS)) console.log(`       (exempt) ${c} - ${why}`);

  /*
   * And an exemption that no longer matches anything would quietly excuse
   * the next file written in the same shape.
   */
  const staleFiles = Object.keys(EXEMPT_FILES).filter((p) => !files.some((f) => f.path === p));
  is('and no exempted file has been deleted', staleFiles.length === 0, staleFiles.join(', '));

  const all = files.map((f) => f.text).join('\n').toLowerCase();
  const staleColours = Object.keys(EXEMPT_COLOURS).filter((c) => !all.includes(c));
  is('and no exempted colour is gone', staleColours.length === 0, staleColours.join(', '));
}

/* ── Radius ───────────────────────────────────────────────────────────── */

console.log('\nthere is one radius scale, and it is named');
{
  const arbitrary: string[] = [];
  for (const f of appFiles) {
    for (const m of code(f.text).matchAll(/rounded(?:-[trbl][lr]?)?-\[[0-9.]+px\]/g)) {
      arbitrary.push(`${f.path}: ${m[0]}`);
    }
  }
  is('no component invents a corner radius', arbitrary.length === 0,
     arbitrary.slice(0, 10).join('\n         '));

  /*
   * The scale has to stay small. Forty-nine of the arbitrary values were
   * a named step written the long way, and 5px next to 6px is the
   * half-pixel problem the type scale had.
   */
  const used = new Set<string>();
  for (const f of files) {
    for (const m of code(f.text).matchAll(/\brounded(-(?:none|sm|md|lg|xl|2xl|3xl|full))?(?![\w[-])/g)) {
      used.add(m[1] || '-DEFAULT');
    }
  }
  is('and the scale is small enough to hold in your head', used.size <= 8,
     `${used.size} steps: ${[...used].sort().join(' ')}`);
}

/* ── Shadow ───────────────────────────────────────────────────────────── */

console.log('\nthe focus ring is one ring');
{
  const inlineRing = appFiles.filter((f) => /shadow-\[0_0_0_3px_rgba/.test(code(f.text)));
  is('nothing writes a focus ring inline', inlineRing.length === 0,
     inlineRing.map((f) => f.path).join('\n         '));

  const inlineGlow = appFiles.filter((f) => /shadow-\[0_1px_3px_rgba\((?:91|99)/.test(code(f.text)));
  is('nor the primary button glow', inlineGlow.length === 0,
     inlineGlow.map((f) => f.path).join('\n         '));

  is('and the tokens are actually used',
     appFiles.filter((f) => /var\(--ring-focus\)/.test(f.text)).length >= 5,
     'the tokens exist and nothing references them');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} visual system check(s) failed`);
