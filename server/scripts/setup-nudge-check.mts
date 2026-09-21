/* ═══════════════════════════════════════════════════════════════════════
   Carrying the next setup step onto the page where you got stuck.

   The checklist already existed, reads real state and retires itself. It
   lives on the dashboard - which is exactly where somebody is not when
   they hit the wall. They follow the sidebar to Campaigns, build a
   sequence, press Launch, and are told there is no mailbox to send from.
   Nothing on that page connects the dead end to the step never done, and
   the checklist explaining it is one navigation away on a screen they have
   left.

   So the step comes with them, in the sidebar, on every page. Which makes
   two things load-bearing, and both are ways to be actively wrong rather
   than merely unhelpful:

     IT MUST VANISH WHEN SETUP IS DONE. A permanent nag at an account that
     finished months ago is worse than no nudge at all.

     IT MUST NOT GUESS WHILE LOADING. Rendering "Step 1 of 5" before the
     answer arrives shows a finished account a checklist it completed long
     ago, every single time the sidebar mounts.

   Run: npx tsx scripts/setup-nudge-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const { setupNudge, nextSetupStep, SETUP_STEP_ORDER } = await import('@lemlist/shared');

const step = (id: string, done: boolean, over: Record<string, unknown> = {}) => ({
  id, label: `Do ${id}`, detail: 'why', done, current: false,
  href: `/${id}`, cta: `Go to ${id}`, progress: null, warning: null, ...over,
}) as any;

const state = (flags: boolean[], over: Record<string, unknown> = {}) => {
  const steps = SETUP_STEP_ORDER.map((id, i) => step(id, flags[i]));
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  if (next) next.current = true;
  return {
    steps, done_count: doneCount,
    complete: doneCount === steps.length,
    fresh: true, ...over,
  } as any;
};

console.log('\nit names the one step that is actually next');
{
  const fresh = setupNudge(state([false, false, false, false, false]));
  is('a brand-new account is pointed at the mailbox',
     fresh?.step.id === 'mailbox', JSON.stringify(fresh?.step.id));
  is('and told where it is', fresh?.position === 'Step 1 of 5', fresh?.position);
  is('with nothing counted as done', fresh?.done_count === 0 && fresh?.percent === 0);

  const partway = setupNudge(state([true, true, false, false, false]));
  is('two steps in, it points at the third',
     partway?.step.id === 'contacts', JSON.stringify(partway?.step.id));
  is('and says so', partway?.position === 'Step 3 of 5', partway?.position);
  is('with the progress it has', partway?.done_count === 2 && partway?.percent === 40,
     JSON.stringify(partway));

  const last = setupNudge(state([true, true, true, true, false]));
  is('one to go points at the last one', last?.step.id === 'launch');
  is('and reads 80%', last?.percent === 80);
}

console.log('\nand it disappears the moment there is nothing to say');
{
  /*
   * The nag that outstays its welcome. `complete` is computed from the
   * account's own rows, so there is nothing to dismiss and nothing that
   * can bring it back.
   */
  is('a finished account gets nothing', setupNudge(state([true, true, true, true, true])) === null);

  /*
   * And `complete` is taken as the last word when the payload disagrees
   * with itself. A server that adds a sixth step, or changes what counts
   * as done, can produce complete: true beside a step still reading false
   * - and the wrong way to resolve that is to start nagging an account
   * that has been sending for months. Silence is the safe answer; the
   * dashboard checklist is there for anybody who wants the detail.
   */
  const disagrees = state([true, true, true, true, false], { complete: true });
  is('a payload claiming to be complete is believed, even if a step says otherwise',
     setupNudge(disagrees) === null, JSON.stringify(setupNudge(disagrees)?.step.id));

  /*
   * The subtler one. While the query is in flight `data` is undefined, and
   * a nudge that renders anything at all then shows "Step 1 of 5" to
   * somebody who finished months ago - on every page load.
   */
  is('nothing is guessed while the answer is loading', setupNudge(undefined) === null,
     'a finished account would be shown step 1 on every page load');
  is('nor when the request failed', setupNudge(null) === null);

  // A malformed payload must not produce "Step 1 of 0" or divide by zero.
  const empty = setupNudge({ steps: [], done_count: 0, complete: false, fresh: true } as any);
  is('an empty step list says nothing rather than nonsense', empty === null, JSON.stringify(empty));
}

console.log('\nthe step comes from the list, not from a flag');
{
  /*
   * `current` is the right thing for the checklist to colour rows with,
   * and it is set by the server. A nudge that FOLLOWS it renders nothing
   * when the flag is absent - and rendering nothing is indistinguishable
   * from being finished, which is the one thing this must never imply.
   */
  const noFlags = state([true, false, false, false, false]);
  for (const s of noFlags.steps) s.current = false;
  is('a payload with no current flag still names the next step',
     setupNudge(noFlags)?.step.id === 'domain',
     'the nudge would vanish and look like a finished account');

  // And a payload that flags the wrong one is not followed off a cliff.
  const wrongFlag = state([true, false, false, false, false]);
  for (const s of wrongFlag.steps) s.current = s.id === 'launch';
  is('a mis-flagged payload is not followed',
     setupNudge(wrongFlag)?.step.id === 'domain',
     'a server quirk would send somebody to launch a campaign with no mailbox');

  is('nextSetupStep agrees with it',
     nextSetupStep(state([true, true, false, false, false]))?.id === 'contacts');
  is('and returns nothing when everything is done',
     nextSetupStep(state([true, true, true, true, true])) === null);
}

console.log('\na step done out of order does not confuse it');
{
  /*
   * Somebody can import contacts before connecting a mailbox - nothing
   * stops them, and the checklist shows it ticked. The next step is still
   * the first one NOT done, which is the mailbox.
   */
  const skipped = setupNudge(state([false, false, true, false, false]));
  is('it still asks for the first thing missing', skipped?.step.id === 'mailbox');
  is('while counting what was done', skipped?.done_count === 1 && skipped?.percent === 20,
     JSON.stringify(skipped));
  is('and the position is the step, not the count', skipped?.position === 'Step 1 of 5',
     skipped?.position);
}

console.log('\nthe sidebar carries it, and the dashboard still has the full list');
{
  const sidebar = readFileSync(join(here, '../../client/src/components/layout/Sidebar.tsx'), 'utf8');
  const nudge = readFileSync(join(here, '../../client/src/components/setup/SetupNudge.tsx'), 'utf8');
  const dash = readFileSync(join(here, '../../client/src/pages/dashboard/DashboardPage.tsx'), 'utf8');

  is('the nudge is in the sidebar, so it is on every page',
     /<SetupNudge collapsed=\{collapsed\} \/>/.test(sidebar),
     'the only pointer to setup is still on the dashboard');
  is('and the full checklist stays where it belongs',
     /<SetupChecklist \/>/.test(dash));

  /*
   * One query key for both. Two keys would let the sidebar say "Step 2 of
   * 5" beside a dashboard checklist showing four ticks, and a user has no
   * way to tell which one is stale.
   */
  is('both read the same cached answer',
     /queryKey: \['setup-state'\]/.test(nudge)
     && /queryKey: \['setup-state'\]/.test(
       readFileSync(join(here, '../../client/src/components/setup/SetupChecklist.tsx'), 'utf8')),
     'the sidebar and the dashboard could disagree about the same account');

  // Doing a step means leaving and coming back.
  is('it re-asks rather than trusting a cache that predates the step',
     /staleTime: 0/.test(nudge) && /refetchOnWindowFocus: true/.test(nudge));

  /*
   * A failed /setup call must not throw a toast on every page in the app.
   * The nudge is an aid, not a feature - it fails silent.
   */
  is('a failed lookup is silent rather than a toast on every page',
     /silentError: true/.test(nudge));

  is('nothing renders until there is something to say',
     /if \(!nudge\) return null;/.test(nudge),
     'a placeholder would flash a finished account a checklist it completed');

  // A collapsed sidebar has no room for a card, but must not simply drop it.
  is('a collapsed sidebar still shows the progress',
     /if \(collapsed\) \{[\s\S]{0,600}data-setup-nudge/.test(nudge),
     'collapsing the sidebar would hide setup entirely');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} setup nudge check(s) failed`);
