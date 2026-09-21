/* ═══════════════════════════════════════════════════════════════════════
   Undo instead of "This cannot be undone."

   Thirty-seven places opened a confirmation dialog, and the default body
   text was literally that sentence. For deleting a note, a template or a
   saved view it is a toll rather than a safeguard: a modal between you and
   something you meant to do, every time, which after the fourth one you
   stop reading. A prompt nobody reads is a click, not a protection.

   Moving the pause to AFTER the action costs nothing when you were right
   and still saves you when you were not - but only if the timer is exactly
   right, and a timer is the easiest thing in a UI to get subtly wrong.
   Three ways, all of which lose data:

     - cancelled by the page that started it unmounting, so the delete
       silently never happens and the row is back when you return, having
       already been reported gone;
     - fired twice, once by the timer and once by a flush, so a second
       DELETE lands on an id that no longer exists and surfaces as an
       error on an action that worked;
     - committed and then failed, leaving the screen disagreeing with the
       database until somebody refreshes.

   Driven against a fake clock so each of those can be reproduced on
   purpose rather than waited for.

   Run: npx tsx scripts/undo-check.mts
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
const { UndoQueue, undoSecondsLeft, UNDO_WINDOW_MS } = await import('@lemlist/shared');

/** A clock and a scheduler we drive by hand. */
function harness(windowMs = UNDO_WINDOW_MS) {
  let now = 1_000_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const changes: Array<string | null> = [];
  const errors: Array<{ id: string; error: unknown }> = [];

  const queue = new UndoQueue({
    windowMs,
    now: () => now,
    schedule: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    cancel: (h) => { timers.delete(h as number); },
    onChange: (p) => changes.push(p ? p.id : null),
    onError: (entry, error) => errors.push({ id: entry.id, error }),
  });

  /** Move time forward and fire anything that has come due. */
  const advance = async (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= now) { timers.delete(id); t.fn(); }
    }
    // Let the commit promises settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  return { queue, advance, changes, errors, timers, at: () => now };
}

/** Records what happened to one action. */
function action(id: string, opts: { fails?: boolean } = {}) {
  const log = { commits: 0, reverts: 0 };
  return {
    log,
    entry: {
      id,
      label: `${id} deleted`,
      commit: async () => {
        log.commits++;
        if (opts.fails) throw new Error(`${id} could not be deleted`);
      },
      revert: () => { log.reverts++; },
    },
  };
}

console.log('\nthe action happens, just not yet');
{
  const h = harness();
  const a = action('a');
  h.queue.push(a.entry);

  is('nothing is sent while the offer stands', a.log.commits === 0);
  is('and the offer is visible', h.queue.pending?.id === 'a');

  await h.advance(UNDO_WINDOW_MS - 1);
  is('still nothing, a millisecond before the window closes', a.log.commits === 0);

  await h.advance(2);
  is('and then it is sent', a.log.commits === 1);
  is('exactly once', a.log.commits === 1);
  is('without reverting anything', a.log.reverts === 0);
  is('and the offer is withdrawn', h.queue.pending === null);
}

console.log('\ntaking it back');
{
  const h = harness();
  const a = action('a');
  h.queue.push(a.entry);

  is('undo reports that it caught it', h.queue.undo('a') === true);
  is('the row is put back', a.log.reverts === 1);

  await h.advance(UNDO_WINDOW_MS * 2);
  is('and the request is never sent', a.log.commits === 0,
     'the timer survived the undo and deleted it anyway');
}

console.log('\nand the moment after it is too late');
{
  const h = harness();
  const a = action('a');
  h.queue.push(a.entry);
  await h.advance(UNDO_WINDOW_MS + 1);

  is('undo says it was too late', h.queue.undo('a') === false);
  /*
   * The important half. Reverting here would put a row back on screen that
   * the server has already deleted - the screen would then disagree with
   * the database, and the next refresh would "lose" it a second time.
   */
  is('and nothing is put back, because it is genuinely gone', a.log.reverts === 0);
  is('undoing something that was never offered is harmless',
     h.queue.undo('never-existed') === false);
}

console.log('\na second delete does not cancel the first');
{
  /*
   * The obvious wrong implementations: replace the pending entry (the
   * first delete is silently lost, having been reported done), or keep
   * both (two bars fighting over one slot, neither aimable).
   */
  const h = harness();
  const a = action('a');
  const b = action('b');

  h.queue.push(a.entry);
  h.queue.push(b.entry);

  is('the first is sent immediately rather than dropped', a.log.commits === 1,
     'a delete the user was told had happened never reached the server');
  is('and not reverted', a.log.reverts === 0);
  is('the second is the one on offer', h.queue.pending?.id === 'b');
  is('and has not been sent yet', b.log.commits === 0);

  is('undoing now takes back the second, not the first', h.queue.undo() === true);
  is('the first stays deleted', a.log.commits === 1 && a.log.reverts === 0);
  is('and the second is restored', b.log.reverts === 1);
}

console.log('\nthe request goes out exactly once, whatever races');
{
  /*
   * flush() and the timer both aim at the same entry. A second commit is a
   * DELETE against an id that no longer exists, which comes back as an
   * error on an action that worked perfectly - and there is no way for the
   * user to tell that apart from a real failure.
   */
  const h = harness();
  const a = action('a');
  h.queue.push(a.entry);

  const flushing = h.queue.flush();
  await h.advance(UNDO_WINDOW_MS + 1);
  await flushing;

  is('a flush racing the timer still sends one request', a.log.commits === 1,
     `sent ${a.log.commits} times`);

  // Two flushes in a row, the second with nothing left to do. pagehide and
  // beforeunload both fire on a closing tab, so this is the normal case.
  const h2 = harness();
  const b = action('b');
  h2.queue.push(b.entry);
  await h2.queue.flush();
  await h2.queue.flush();
  is('and flushing twice does too', b.log.commits === 1, `sent ${b.log.commits} times`);
  is('flushing an empty queue is a no-op', (await h2.queue.flush()) === undefined);

  /*
   * The genuine race, forced.
   *
   * An earlier version of this section only ever reached `run` once - flush
   * cancels the timer, so the timer could never arrive behind it - which
   * meant the guard inside `run` was never exercised and deleting it
   * changed nothing. Here cancellation is deliberately broken, so the
   * flushed entry's timer fires afterwards and both paths reach `run` with
   * the same entry. That is what the guard is for.
   */
  const stubborn = (() => {
    let now = 1_000_000;
    const due: Array<() => void> = [];
    const q = new UndoQueue({
      now: () => now,
      // Fires whatever happens: a timer that outlives its cancellation.
      schedule: (fn) => { due.push(fn); return due.length; },
      cancel: () => {},
    });
    return { q, fire: () => { const all = [...due]; due.length = 0; for (const fn of all) fn(); } };
  })();
  const c = action('c');
  stubborn.q.push(c.entry);
  await stubborn.q.flush();
  stubborn.fire();
  await Promise.resolve();
  await Promise.resolve();
  is('a timer that outlives its own cancellation sends nothing extra',
     c.log.commits === 1, `sent ${c.log.commits} times`);
  is('and does not revert an action that succeeded', c.log.reverts === 0);
}

console.log('\na request that fails puts the row back');
{
  const h = harness();
  const a = action('a', { fails: true });
  h.queue.push(a.entry);
  await h.advance(UNDO_WINDOW_MS + 1);

  is('it was attempted', a.log.commits === 1);
  is('the row comes back', a.log.reverts === 1,
     'the screen would keep showing a row the database still has');
  is('and the failure is reported', h.errors.length === 1 && h.errors[0].id === 'a',
     JSON.stringify(h.errors));
  is('a thrown commit does not wedge the queue', h.queue.pending === null);

  // And the queue still works afterwards.
  const b = action('b');
  h.queue.push(b.entry);
  await h.advance(UNDO_WINDOW_MS + 1);
  is('the next action is unaffected', b.log.commits === 1 && b.log.reverts === 0);
}

console.log('\nthe offer is withdrawn at the right moments');
{
  const h = harness();
  h.queue.push(action('a').entry);
  await h.advance(UNDO_WINDOW_MS + 1);
  const shown = (c: Array<string | null>) => c.map((x) => x ?? 'none').join(',');
  is('pushed, then cleared when it commits', shown(h.changes) === 'a,none', shown(h.changes));

  const h2 = harness();
  h2.queue.push(action('b').entry);
  h2.queue.undo('b');
  is('and cleared when it is taken back', shown(h2.changes) === 'b,none', shown(h2.changes));
}

console.log('\nreset abandons without doing either thing');
{
  const h = harness();
  const a = action('a');
  h.queue.push(a.entry);
  h.queue.reset();
  await h.advance(UNDO_WINDOW_MS * 2);
  is('nothing is sent', a.log.commits === 0);
  is('and nothing is put back', a.log.reverts === 0);
  is('the timer is gone with it', h.timers.size === 0);
}

console.log('\nthe countdown never lies');
{
  const h = harness();
  h.queue.push(action('a').entry);
  const p = h.queue.pending!;
  is('a fresh offer shows the whole window', undoSecondsLeft(p, h.at()) === 6);
  is('and rounds up, so 5.2s left reads as 6', undoSecondsLeft(p, h.at() + 800) === 6);
  is('one second in reads as 5', undoSecondsLeft(p, h.at() + 1000) === 5);
  // It must never show a negative or a zero that sits there.
  is('never goes negative', undoSecondsLeft(p, h.at() + UNDO_WINDOW_MS * 3) === 0);
  is('and nothing pending is nothing left', undoSecondsLeft(null, h.at()) === 0);
}

console.log('\nthe bar is mounted where a route change cannot kill it');
{
  const layout = readFileSync(join(here, '../../client/src/components/layout/AppLayout.tsx'), 'utf8');
  const bar = readFileSync(join(here, '../../client/src/components/ui/UndoBar.tsx'), 'utf8');

  /*
   * The failure this prevents: delete a contact, click away before the
   * window closes, and the component owning the timer unmounts. The
   * request is never sent and the contact is back - after being reported
   * gone. Mounting above the routed content is what stops that.
   */
  is('the provider wraps the whole app', /<UndoProvider>/.test(layout),
     'a pending delete would be cancelled by the route that started it');
  is('and it is outside the routed content',
     layout.indexOf('<UndoProvider>') < layout.indexOf('<AppContent />'),
     'the provider is inside the thing that unmounts');

  /*
   * The queue is built once, in a ref. Rebuilding it on a re-render would
   * drop the timer of a delete already in flight.
   */
  is('the queue is built once and kept', /queueRef\.current = new UndoQueue\(/.test(bar));
  is('not rebuilt on every render', /if \(!queueRef\.current\)/.test(bar));

  // A tab closing two seconds into a six-second window.
  is('a closing tab flushes rather than losing the request',
     /pagehide[\s\S]{0,200}queue\.flush\(\)|queue\.flush\(\)[\s\S]{0,200}pagehide/.test(bar)
     || (/const onHide = \(\) => \{ void queue\.flush\(\); \};/.test(bar) && /'pagehide'/.test(bar)),
     'closing the tab mid-window would silently cancel the delete');
  is('and so does a reload', /'beforeunload'/.test(bar));

  is('the offer says how long is left', /data-undo-action/.test(bar) && /secondsLeft/.test(bar));

  /*
   * With no provider - a component rendered outside the app shell - the
   * action must still happen. Dropping it would be a delete button that
   * does nothing.
   */
  is('without a provider the action still runs',
     /if \(ctx\) \{ ctx\.offer\(entry\); return; \}\s*void entry\.commit\(\);/.test(bar),
     'a delete outside the app shell would do nothing at all');

  /*
   * Two undo mechanisms exist on purpose - one defers the action, the
   * other runs it and offers a reversing call - and for a while both hooks
   * were called useUndoable with different signatures. Importing the wrong
   * one either deletes something twice or never.
   */
  const hook = readFileSync(join(here, '../../client/src/hooks/useUndoable.tsx'), 'utf8');
  is('the two mechanisms do not share a name',
     /export function useDeferredAction/.test(bar) && !/export function useUndoable/.test(bar),
     'two hooks named useUndoable with different contracts');
  is('and the same gesture draws the same bar',
     /<UndoBarShell/.test(bar) && /<UndoBarShell/.test(hook),
     'one undo appears as a toast and the other as a bar');
  is('with one window constant each, named and justified',
     /UNDO_REVERSE_WINDOW_MS/.test(hook) && !/const UNDO_WINDOW_MS = /.test(hook),
     'the reversal window is redeclared locally and will drift');
}

console.log('\nrows on their way out are hidden by the page that owns them');
{
  const bar = readFileSync(join(here, '../../client/src/components/ui/UndoBar.tsx'), 'utf8');
  const hook = bar.slice(bar.indexOf('export function usePendingRemoval'));

  /*
   * Writing into the React Query cache was the alternative, and every list
   * in this app stores its rows differently - a wrong guess at the shape
   * corrupts a cache entry silently. A set of ids the page owns cannot.
   */
  is('the row is hidden the moment it is deleted',
     /ctx\?\.hide\(id\);/.test(hook),
     'the row would sit there for six seconds after being deleted');

  /*
   * The set is the provider's, not the page's. Deleting an activity from
   * its own modal has to take the row out of the history behind it, and a
   * set owned by that modal is gone the instant the modal closes.
   */
  is('the hidden set outlives the component that deleted the row',
     /hidden: ReadonlySet<string>;/.test(bar) && /const \[hidden, setHidden\]/.test(
       bar.slice(bar.indexOf('export function UndoProvider'), bar.indexOf('export function useUndoable'))),
     'a delete from inside a dialog would leave the row on the list behind it');

  /*
   * The id stays in the set after a successful delete. Clearing it would
   * un-hide the row for the gap between the request resolving and the list
   * refetching, so a deleted row flashes back into view.
   */
  is('a successful delete keeps the row hidden',
     !/commit: async[\s\S]{0,200}finally[\s\S]{0,80}unhide/.test(hook),
     'the deleted row would flash back before the list refetches');
  is('undo and a failed request both put it back',
     /revert: \(\) => \{ ctx\?\.unhide\(id\); \}/.test(hook));
}

console.log('\nthe dialog is kept where a pause is the point');
{
  const read = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

  /*
   * Undo is right for a note or a template. It is wrong where the damage
   * lands outside this app before anybody could take it back, or where
   * stopping to think IS the safeguard:
   *
   *   - an API key revoked breaks a customer's integration at once;
   *   - a tracking domain removed breaks every link already in an inbox;
   *   - a mailbox removed stops campaigns mid-flight;
   *   - taking an address OFF the suppression list means mailing somebody
   *     who asked not to be mailed, which is a legal matter, not a UI one.
   *
   * Asserted so a later sweep does not "finish the job" by converting them.
   */
  for (const [what, file] of [
    ['revoking an API key', 'pages/developer/DeveloperPage.tsx'],
    ['removing a tracking domain', 'components/domains/TrackingDomainPanel.tsx'],
    ['removing a mailbox', 'pages/smtp/EmailAccountsPage.tsx'],
    ['un-suppressing an address', 'pages/suppression/SuppressionPage.tsx'],
    ['removing a teammate', 'pages/team/TeamPage.tsx'],
  ] as const) {
    is(`${what} still stops and asks`, /confirm\(/.test(read(file)), `${file} no longer confirms`);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} undo check(s) failed`);
