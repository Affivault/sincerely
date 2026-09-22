/* ═══════════════════════════════════════════════════════════════════════
   Four things that made this app harder to use than it needed to be.

   None of them is a missing feature. All four are the same shape: a
   decision nobody made, that accumulated.

   1. FOCUS. Modal.tsx contained no focus handling at all, across forty
      dialogs. Open one and the cursor was still on the button behind it;
      Tab walked into the page BEHIND the backdrop, through links that
      could not be seen or clicked; closing dropped focus onto <body>, so
      the next Tab started again from the top of the document. Somebody
      had thought carefully about layering - openModals exists so Escape
      closes the topmost dialog - so this was not carelessness. Focus is
      simply invisible until you work without a mouse.

   2. TRUNCATION. 246 elements clipped their text with `truncate` or
      `line-clamp`. FIVE carried a title. In an outreach CRM the clipped
      string is the record - the address, the company, the subject line -
      and the only way to read one was to open the thing it belonged to.

   3. DATES. 57 formatting calls in 21 spellings, including the same
      format written both locale-locked and locale-aware:
        toLocaleDateString('en-US',   { month: 'short', day: 'numeric' })
        toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      "Jan 5" and "5 Jan", on adjacent screens, for the same kind of value.

   4. DRAFTS. useDraftRecovery existed and one form used it. The template
      editor - the longest thing anybody writes here - did not.

   Run: npx tsx scripts/interaction-check.mts
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
const REPO = resolve(here, '../..');
const CLIENT = join(REPO, 'client');

/** Comments must never satisfy or trip a rule about code. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(join(CLIENT, 'src')).map((f) => ({
  path: relative(CLIENT, f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}));

const read = (p: string) => code(readFileSync(join(CLIENT, p), 'utf8'));

/* ── 1. Focus ─────────────────────────────────────────────────────────── */

const trap = read('src/hooks/useFocusTrap.ts');

console.log('\nevery dialog holds the cursor, and gives it back');
{
  /*
   * Derived, not listed. A new overlay that renders its own
   * role="dialog" is a new place for focus to escape, and a hand-kept
   * list would not know about it.
   */
  /*
   * A JSX attribute, not a selector string. The first version of this
   * counted AppLayout and lib/keyboard as dialogs because both contain
   * `querySelector('[role="dialog"]')` - they LOOK for dialogs, they do
   * not render one, and demanding a focus trap of them is nonsense.
   */
  const dialogs = files.filter((f) => /^\s*role="dialog"/m.test(code(f.text)));
  is('there are dialogs to check', dialogs.length >= 5,
     `${dialogs.length} - the role="dialog" scan is broken`);

  /*
   * PROVEN VACUOUS ONCE, AND THIS IS THE REPAIR.
   *
   * This used to grep the file for `useFocusTrap`, which the IMPORT line
   * satisfies just as well as the call. Deleting the call and leaving the
   * import - which is exactly what a careless edit looks like - scored 32
   * passed, 0 failed. It has to see the hook invoked.
   */
  const untrapped = dialogs.filter((f) => !/useFocusTrap\(/.test(code(f.text)));
  is('every one of them traps focus', untrapped.length === 0,
     untrapped.map((f) => `${f.path} renders a dialog and Tab can walk out of it`)
       .join('\n         '));

  /*
   * A dialog with no fields of its own still needs somewhere for the
   * cursor to land, and tabIndex={-1} is what makes the panel itself
   * focusable by script without joining the Tab cycle.
   */
  const noLanding = dialogs.filter((f) => !/tabIndex=\{-1\}/.test(code(f.text)));
  is('and offers the panel as a landing place', noLanding.length === 0,
     noLanding.map((f) => f.path).join('\n         '));
}

console.log('\nand the trap itself does the three things that matter');
{
  is('it remembers where focus came from',
     /const returnTo = document\.activeElement/.test(trap),
     'closing would drop the cursor on <body> and lose the reader their place');

  is('and gives it back only if that element still exists',
     /document\.contains\(returnTo\)/.test(trap),
     'focusing a removed node silently does nothing - and the row a dialog '
     + 'deletes is exactly the row that opened it');

  is('it leaves an already-focused field alone',
     /!root\.contains\(document\.activeElement\)/.test(trap),
     'it would override the autoFocus the careful dialogs already set');

  /*
   * Dialogs stack. A confirmation opened from inside an editor sits over
   * it, and if the editor kept trapping focus it would pull the cursor
   * straight back out of the confirmation - worse than no trap at all.
   */
  is('and defers to whatever is stacked on top of it',
     /if \(topmost && !topmost\(\)\) return;/.test(trap),
     'the dialog underneath would fight the one on top for the keyboard');

  is('Tab wraps rather than escaping',
     /at === last[\s\S]{0,120}?first\.focus/.test(trap),
     'Tab off the last control would land in the page behind the backdrop');

  is('and focus that has escaped is pulled back',
     /!root\.contains\(at\)/.test(trap),
     'after a dialog removes the focused element, Tab would resume in the page behind');

  // The two stacking overlays must both pass a topmost check, or the rule
  // above is decoration.
  for (const p of ['src/components/ui/Modal.tsx', 'src/components/peek/PeekDrawer.tsx']) {
    is(`${p.split('/').pop()} declares itself part of the stack`,
       /topmost:\s*isTopmost/.test(read(p)),
       'it would trap focus even while a dialog sits on top of it');
  }
}

/* ── 2. Truncation ────────────────────────────────────────────────────── */

const tooltip = read('src/components/ui/OverflowTooltip.tsx');

console.log('\na value that is cut off can still be read');
{
  const clipped = files.reduce((n, f) =>
    n + (code(f.text).match(/\btruncate\b|\bline-clamp-\d\b/g) || []).length, 0);
  is('there is still plenty of clipped text to cover', clipped >= 200,
     `${clipped} clipped elements`);

  is('the tooltip is mounted once at the shell',
     /<OverflowTooltip \/>/.test(read('src/components/layout/AppLayout.tsx')),
     'nothing would ever show the full value');

  /*
   * THE RULE THAT MAKES THIS USABLE RATHER THAN NOISE.
   *
   * `truncate` means "clip IF too long". Most of those 246 elements fit
   * most of the time, and a tooltip on text that is plainly readable is
   * noise - and noise gets ignored, including on the ones that matter.
   */
  is('and it only speaks when the text is genuinely clipped',
     /scrollWidth > el\.clientWidth/.test(tooltip),
     'every short label in the app would sprout a tooltip');

  is('with a tolerance for sub-pixel layout',
     /clientWidth \+ 1/.test(tooltip),
     'fractional layout reports a fitting element as overflowing, so a third '
     + 'of the app would get tooltips it does not need');

  is('keyboard focus gets it too, which a title attribute never does',
     /addEventListener\('focusin'/.test(tooltip),
     'this would help nobody navigating without a mouse');

  is('and anything that already explains itself is left alone',
     /hasAttribute\('title'\)/.test(tooltip),
     'the five elements that already had a title would get two tooltips');

  // Anchored to a rect, so it has to go when the rect moves.
  /*
   * PROVEN VACUOUS ONCE. The teardown's removeEventListener carries the
   * same two arguments, so grepping for them matched a file that had
   * stopped listening entirely. The third rule in this file to be caught
   * matching its own second occurrence.
   */
  is('it closes on scroll', /addEventListener\('scroll', cancel/.test(tooltip),
     'a tooltip pinned to a stale rectangle floats over unrelated content');
  is('and never swallows a click', /pointer-events-none/.test(tooltip),
     'it would sit between the pointer and the row underneath');
}

/* ── 3. Dates ─────────────────────────────────────────────────────────── */

const dateFmt = code(readFileSync(join(REPO, 'shared/src/format-date.ts'), 'utf8'));

console.log('\nthere is one way to write a date down');
{
  /*
   * The whole point. Every call site went through toLocaleDateString by
   * hand, in 21 spellings; now exactly one file does.
   */
  const callers = files.filter((f) => /toLocale(Date|Time)String\(/.test(code(f.text)));
  const offenders = callers.filter((f) => !/timeZone/.test(code(f.text)));
  is('no screen formats a date by hand', offenders.length === 0,
     offenders.map((f) => `${f.path} calls toLocaleDateString directly`).join('\n         '));

  /*
   * The exception, and it is a real one: a booking page shows times in
   * the INVITEE's timezone, not the reader's. Formatting those with the
   * shared helpers would quietly show everybody their own clock, which is
   * a worse bug than any inconsistency this change fixes.
   */
  const tz = callers.filter((f) => /timeZone/.test(code(f.text)));
  for (const f of tz) console.log(`       (exempt) ${f.path} - pins an explicit timeZone, so it must not use the reader's`);
  is('and the timezone-pinned screens are still doing that on purpose',
     tz.length > 0 && tz.every((f) => /timeZone/.test(code(f.text))),
     'the booking pages have stopped pinning a zone and now show the reader their own clock');

  is('the shared module never hardcodes a locale',
     !/'en-[A-Z]{2}'/.test(dateFmt),
     'a hardcoded locale is not consistency, it is being consistently wrong '
     + 'for everybody outside one country');

  /*
   * A hardcoded locale is wrong for DISPLAY and necessary for PARSING.
   *
   * timezone.ts and SchedulesPage pin 'en-US' and then read the result
   * back with formatToParts - one slices a weekday to "mon", the other
   * matches /GMT([+-])(\d{1,2})/ - so the locale is what makes the parse
   * deterministic. Sweeping those to the reader's locale would not have
   * looked inconsistent; it would simply have stopped working, in a way
   * that only shows up in another country.
   */
  const parses = (t: string) => /formatToParts/.test(t);
  const displayLocale = files.filter((f) => {
    const t = code(f.text);
    return /'en-US'|'en-GB'/.test(t) && !parses(t);
  });
  is('and nothing else in the app pins one for display', displayLocale.length === 0,
     displayLocale.map((f) => f.path).join(', '));

  const computes = files.filter((f) => /'en-US'/.test(code(f.text)) && parses(code(f.text)));
  for (const f of computes) console.log(`       (exempt) ${f.path} - pins a locale to PARSE its own output, not to show it`);
  is('and the ones that parse still do', computes.length >= 2,
     `${computes.length} - if this hits zero the rule above has widened and a '
     + 'display locale could hide behind a formatToParts call somewhere else`);

  is('every helper passes explicit options',
     !/toLocaleDateString\(undefined\)|toLocaleTimeString\(undefined\)/.test(dateFmt),
     'no options means the raw browser default, seconds and all');

  /*
   * A missing date is common - a nullable column, an API that returned ''
   * - and `new Date(null)` is 1970 rather than an error. Printing 1970 is
   * worse than printing nothing, because it looks like data.
   */
  is('a missing or malformed date yields a dash, not 1970',
     /Number\.isNaN\(d\.getTime\(\)\)/.test(dateFmt) && /NOTHING = '\\u2014'/.test(dateFmt),
     'an empty timestamp would render as 1 January 1970');

  is('and money follows the reader too',
     /export function formatMoney/.test(dateFmt) && /currency: currency \|\| 'USD'/.test(dateFmt),
     'five local copies of the same currency helper, all locked to en-US');
}

/* ── 4. Drafts ────────────────────────────────────────────────────────── */

console.log('\nthe long forms keep what you typed');
{
  const templates = read('src/pages/templates/TemplatesPage.tsx');
  /*
   * The CALL, not the import - the same way the focus rule above had to
   * be repaired. An import left behind by a careless edit satisfied it.
   */
  is('the template editor keeps a draft', /useDraftRecovery\(\{/.test(templates),
     'the longest thing anybody writes here was the least protected');
  is('and offers it back', /data-draft-offer/.test(templates),
     'a draft nobody is told about is a draft nobody uses');
  is('and lets go of it once the work is really saved', /draft\.clear\(\)/.test(templates),
     'the draft would be offered back over the saved version, forever');

  /*
   * AND THE FORM THAT MUST NOT DO THIS.
   *
   * SmtpAccountModal holds a mailbox password. Autosaving it to
   * localStorage to protect against losing a few fields would be a
   * straight trade of a small annoyance for a credential at rest in the
   * browser, which is not a trade worth making.
   */
  is('the credentials form deliberately does NOT',
     !/useDraftRecovery\(/.test(read('src/pages/smtp/SmtpAccountModal.tsx')),
     'a mailbox password would be written to localStorage');
  is('and it is still the form that holds a password',
     /smtp_pass/.test(read('src/pages/smtp/SmtpAccountModal.tsx')),
     'the exemption above now points at a form with no credentials in it, '
     + 'so it is excusing nothing and would excuse the wrong thing later');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} interaction check(s) failed`);
