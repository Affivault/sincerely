/* ═══════════════════════════════════════════════════════════════════════
   A button that refuses says why.

   MEASURED BEFORE THIS LANDED: the app stopped you doing things by
   setting `disabled`, and Button.tsx added `disabled:pointer-events-none`
   on top of it. Several gates were conjunctions of four or five
   conditions sharing one grey rectangle:

       disabled={sendingTest || !testEmailTo || !effectiveSmtp
                 || !steps[editingStep].subject || !hasBody}

   THE PART THAT MAKES THIS MORE THAN AN OVERSIGHT:

   Three of those call sites had ALREADY written the explanation out - a
   nested ternary of four reasons on the send-test button, a title on the
   import button, and a launch button whose onClick fell back to
   toast.error('Resolve all issues before launching').

   None of it could ever run. A disabled control dispatches no pointer
   events, so browsers do not show its title and never fire its click.
   Somebody did the thoughtful thing three times and the platform threw it
   away silently, three times.

   So the rule is not "add a title". It is: `disabled` is for something
   briefly busy, where the label already says "Saving..." and there is
   nothing to explain. Anything the person could act on uses aria-disabled
   and stays reachable.

   Run: npx tsx scripts/blocked-action-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/* ── The chooser, run rather than read ────────────────────────────────── */

console.log('\nthe reason picked is the useful one');
{
  /*
   * Run, not grepped. A firstBlocker that always returned null would
   * leave every gate silent and every structural assertion below would
   * still pass - the only symptom being that nothing ever explains
   * itself, which is the thing this exists to fix.
   */
  const mod: {
    firstBlocker: (c: readonly (readonly [boolean, string])[]) => string | null;
    allBlockers: (c: readonly (readonly [boolean, string])[]) => string[];
  } = await import(pathToFileURL(join(REPO, 'shared/src/blocked.ts')).href);

  is('nothing unmet means nothing to say',
     mod.firstBlocker([[false, 'a'], [false, 'b']]) === null);

  is('one unmet condition gives its reason',
     mod.firstBlocker([[false, 'a'], [true, 'b']]) === 'b');

  /*
   * FIRST, not last and not all. People fill a form roughly in order, so
   * the first gap is nearly always the one they are about to fix -
   * answering with the last one sends them to the bottom of the form for
   * no reason.
   */
  is('and the FIRST of several, not the last',
     mod.firstBlocker([[true, 'earliest'], [true, 'later']]) === 'earliest');

  is('an empty list blocks nothing', mod.firstBlocker([]) === null);

  is('and allBlockers keeps the order for a checklist',
     JSON.stringify(mod.allBlockers([[true, 'a'], [false, 'b'], [true, 'c']])) === '["a","c"]');
}

/* ── The mechanism ────────────────────────────────────────────────────── */

const gate = read('src/lib/blockedAction.ts');

console.log('\na blocked control stays reachable');
{
  /*
   * THE WHOLE POINT, AND THE EASIEST THING TO UNDO BY ACCIDENT.
   *
   * Returning `disabled` here would restore exactly the behaviour this
   * replaced - and it would look like a tidy-up, because `disabled` is
   * what a blocked button "obviously" wants.
   */
  is('the helper never returns the disabled attribute',
     !/\bdisabled:/.test(gate),
     'disabled makes it unhoverable, unfocusable and unable to answer - '
     + 'which is the bug');

  is('and its styling adds no pointer-events-none',
     !/pointer-events-none/.test(gate),
     'the class would do the same damage the attribute does');

  is('assistive technology is told it is unavailable',
     /'aria-disabled': blocked \|\| undefined/.test(gate),
     'it would look unavailable and read as available');

  is('hovering says why', /title: reason \|\| undefined/.test(gate),
     'the reason would exist and never be shown');

  is('and clicking says why', /toast\.error\(reason!\)/.test(gate),
     'clicking a blocked button would do nothing at all, which is what it '
     + 'did before');

  /*
   * A type="submit" button inside a form submits on click unless the
   * default is prevented - so swallowing the handler alone would refuse
   * the action and perform it at the same time.
   */
  is('and a blocked submit does not submit anyway',
     /e\.preventDefault\(\)/.test(gate),
     'the form would post while the button was refusing to');
}

console.log('\nand there is one definition of what blocked means');
{
  const button = read('src/components/ui/Button.tsx');
  is('Button takes a reason', /blockedBy\?: string \| null/.test(button),
     'every call site would hand-roll this');
  is('and routes through the shared helper', /blockedProps\(blockedBy, onClick\)/.test(button),
     'a second copy agrees until one of them is edited');
  is('and the reason wins over a caller-supplied title',
     /\{\.\.\.gate\}[\s\S]{0,120}?title=\{blockedBy \?\? props\.title\}/.test(button),
     'a spread after the gate would let a decorative title hide the reason');

  const rolled = files.filter((f) =>
    /aria-disabled=\{/.test(code(f.text)) && !/blockedProps/.test(code(f.text)));
  is('nothing hand-rolls aria-disabled', rolled.length === 0,
     rolled.map((f) => f.path).join('\n         '));
}

/* ── The gates that were unguessable ──────────────────────────────────── */

console.log('\nthe multi-condition gates each name their reasons');
{
  /*
   * These three are the ones that had four or five conditions behind one
   * rectangle. Named explicitly because they are the measurement this
   * change was made from - if one of them goes back to a bare
   * conjunction, that is the regression.
   */
  const GATED: Array<[string, number]> = [
    ['src/pages/campaigns/CampaignCreatePage.tsx', 2],
    ['src/pages/contacts/BulkImportPage.tsx', 1],
  ];
  for (const [p, count] of GATED) {
    const n = (read(p).match(/blockedProps\(firstBlocker\(\[/g) || []).length;
    is(`${p.split('/').pop()} explains ${count} gate${count === 1 ? '' : 's'}`, n >= count,
       `${n} found - a gate has gone back to a bare conjunction`);
  }

  /*
   * And the dead explanations are gone rather than merely bypassed. The
   * launch button's onClick fell back to a toast it could never reach;
   * leaving that in place would be a second, silent answer to the same
   * question.
   */
  const campaign = read('src/pages/campaigns/CampaignCreatePage.tsx');
  is('and the unreachable fallback toast is gone',
     !/Resolve all issues before launching/.test(campaign),
     'a branch that cannot run is a second answer nobody will ever see');

  /*
   * `disabled` keeps its real job. If it disappeared entirely that would
   * mean in-flight buttons had become clickable, which is a different bug
   * in the opposite direction.
   */
  const stillBusy = files.filter((f) => /disabled=\{\w*(?:isPending|launching|saving|sendingTest|busy)\w*\}/i.test(code(f.text)));
  is('and disabled still guards what is merely busy', stillBusy.length >= 5,
     `${stillBusy.length} - in-flight buttons should stay disabled, not blocked`);
}

/* ── Fields say which one is wrong ────────────────────────────────────── */

console.log('\nand a field at fault is marked as one');
{
  const input = read('src/components/ui/Input.tsx');
  is('an errored input is marked invalid', /aria-invalid=\{error \? true : undefined\}/.test(input),
     'aria-invalid appeared zero times in this app: the field looked wrong '
     + 'and read as correct');
  is('and its message is tied to it', /aria-describedby=/.test(input),
     'the message underneath would be loose text near a field rather than '
     + 'the field\'s own error');
  is('and announced when it appears', /role="alert"/.test(input),
     'an error that arrives after submit would be silent');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} blocked action check(s) failed`);
