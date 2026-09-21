/* ═══════════════════════════════════════════════════════════════════════
   One language for "this screen has nothing to show yet".

   Loading, empty and failed are the same problem wearing three hats, and
   this app improvised all three, per page, fifty-nine times.

   MEASURED BEFORE THIS LANDED:

     Six loading idioms in live use at once - shimmer blocks, the Spinner
     component, a bare spinning Loader2, the Skeleton component, the
     literal words "Loading...", and a route-level spinner in
     `border-primary-600`, a colour with no definition anywhere in the
     theme. So every screen resolved differently and one of them resolved
     in the browser's default grey.

     An EmptyState component existed. Nine files used it; twenty-four
     wrote their own. Twenty-four tones of voice at the exact moment a new
     account has nothing on screen and most needs telling what to do.

     Two hundred and fifty-two toast.error calls. So the normal experience
     of a failed request was a message that vanished after four seconds
     over a blank area, with no way to try again and nothing left on
     screen to say what had happened - and a react-query error is
     returned rather than thrown, so the route's error boundary never saw
     it and never could.

   The fix is not a style guide, because a style guide is a document
   nobody reads at 2am. It is making the improvised version harder to
   write than the shared one, and then failing the build when somebody
   writes it anyway. That is what this file is.

   Run: npx tsx scripts/state-language-check.mts
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
const CLIENT = join(here, '../../client/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const files = walk(CLIENT).map((f) => ({
  path: relative(CLIENT, f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}));

/** Strip comments, so prose explaining a banned pattern is not the pattern. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const pages = files.filter((f) => f.path.startsWith('pages/'));
/** The shared primitives are allowed to contain the shapes they define. */
const PRIMITIVES = [
  'components/ui/Skeleton.tsx',
  'components/ui/Spinner.tsx',
  'components/ui/AsyncPanel.tsx',
  'components/shared/EmptyState.tsx',
  'components/ErrorBoundary.tsx',
];
const isPrimitive = (p: string) => PRIMITIVES.includes(p);

const { describeFailure, failureToast, shouldAutoRetry } = await import('@lemlist/shared');

console.log('\na failure is described once, and the same way everywhere');
{
  const offline = describeFailure({ message: 'Network Error' });
  is('no response at all is a connection problem', offline.kind === 'offline', offline.kind);
  is('and it is worth retrying', offline.retryable === true);

  const timeout = describeFailure({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' });
  is('a timeout is told apart from being offline', timeout.kind === 'timeout', timeout.kind);
  is('because they read completely differently on a train',
     timeout.detail !== offline.detail);

  /*
   * The load-bearing rule of the whole module. A retry button on
   * something that fails identically every time is a lie, and one button
   * that does nothing is enough for somebody to stop trusting every
   * other button on the page.
   */
  const missing = describeFailure({ response: { status: 404 } });
  is('a deleted record is not retryable', missing.retryable === false,
     'a retry button would be offered on something that can never succeed');
  is('and says it may have been deleted', /deleted/.test(missing.detail), missing.detail);

  is('a rejected request is not retryable',
     describeFailure({ response: { status: 400 } }).retryable === false);
  is('nor is a permission failure',
     describeFailure({ response: { status: 403 } }).retryable === false);
  is('nor an expired session',
     describeFailure({ response: { status: 401 } }).retryable === false);

  is('but rate limiting is', describeFailure({ response: { status: 429 } }).retryable === true);
  is('and so is a server fault', describeFailure({ response: { status: 500 } }).retryable === true);

  /*
   * The server's own words beat anything invented here. An API that says
   * "This list is used by two running campaigns" has explained the
   * problem far better than "Something went wrong" ever will.
   */
  const withMessage = describeFailure({
    response: { status: 409, data: { error: 'This list is used by two running campaigns' } },
  });
  is('the server’s own message is preferred',
     withMessage.detail === 'This list is used by two running campaigns', withMessage.detail);

  // But not a stack trace or an HTML error page.
  const stack = describeFailure({ response: { status: 500, data: { error: 'Error: TypeError: x'.padEnd(400, '!') } } });
  is('a stack trace is not shown to a person', !/!!!!/.test(stack.detail), stack.detail);

  is('anything at all produces a description, never nothing',
     !!describeFailure(undefined).title && !!describeFailure(undefined).detail);
  is('and a string throw does not crash it', !!describeFailure('boom').detail);
}

console.log('\nthe toast and the panel say the same thing');
{
  /*
   * This used to reach past the error for a server message and fall back
   * to error.message - so somebody offline got "Network Error" in a toast
   * and "Could not reach the server" in a panel, for one event, and had
   * to work out whether they were the same thing.
   */
  const clientText = readFileSync(join(CLIENT, 'lib/queryClient.ts'), 'utf8');

  /*
   * Scoped to each cache's own block. An earlier version grepped the whole
   * file, so breaking the query cache still passed on the mutation
   * cache's call - an assertion satisfied by the code it was not about,
   * which is the same vacuity as a comment satisfying a code rule.
   */
  const queryBlock = clientText.slice(
    clientText.indexOf('queryCache:'), clientText.indexOf('mutationCache:'));
  const mutationBlock = clientText.slice(
    clientText.indexOf('mutationCache:'), clientText.indexOf('defaultOptions:'));

  is('the query cache block was found', queryBlock.length > 40 && mutationBlock.length > 40,
     'the two assertions below would be checking nothing');
  is('the query cache uses the shared description',
     /toast\.error\(failureToast\(error/.test(queryBlock),
     'a failure would read one way in a toast and another in a panel');
  is('and so does the mutation cache',
     /toast\.error\(failureToast\(error/.test(mutationBlock));

  is('the toast is the short form of the same answer',
     failureToast({ response: { status: 404 } }).length > 0);
  is('and prefers the server’s words when there are any',
     failureToast({ response: { status: 409, data: { error: 'Nope' } } }) === 'Nope');
}

console.log('\nreact-query stops retrying what cannot succeed');
{
  /*
   * A flat `retry: 1` retried a 404 exactly as eagerly as a dropped
   * connection - a round trip to be told the same thing, and the person
   * finds out later than they needed to.
   */
  is('a 404 is not retried', shouldAutoRetry(0, { response: { status: 404 } }) === false);
  is('a 500 is', shouldAutoRetry(0, { response: { status: 500 } }) === true);
  is('but not forever', shouldAutoRetry(2, { response: { status: 500 } }, 2) === false);

  const client = readFileSync(join(CLIENT, 'lib/queryClient.ts'), 'utf8');
  is('and the client is wired to it',
     /retry: \(failureCount, error\) => shouldAutoRetry\(/.test(client),
     'the flat retry policy is still in place');
}

console.log('\nno page invents its own loading state');
{
  /*
   * The six idioms. A page may use Skeleton, SkeletonList, Spinner or
   * AsyncPanel; it may not hand-build a shimmering block, because that is
   * how six of them appeared in the first place.
   */
  const homemade = pages.filter((f) =>
    /className="[^"]*animate-pulse[^"]*"/.test(code(f.text))
    && /(bg-\[var\(--bg-elevated\)\][^"]*animate-pulse|animate-pulse[^"]*bg-\[var\(--bg-elevated\)\])/.test(code(f.text)));
  is('no page hand-builds a shimmering placeholder',
     homemade.length === 0,
     homemade.map((f) => f.path).join(', '));

  const wordy = pages.filter((f) => /Loading\.\.\.|Loading…/.test(code(f.text)));
  is('and none of them just says "Loading"', wordy.length === 0,
     wordy.map((f) => f.path).join(', '));

  /*
   * A spinner built out of border utilities rather than the Spinner
   * component. One of these was in `border-primary-600`, a colour with no
   * definition anywhere - so it rendered in the browser's default grey
   * and nobody noticed, because a spinner is only on screen for a moment.
   */
  const bespokeSpinners = files.filter((f) =>
    !isPrimitive(f.path) && /animate-spin rounded-full border-[24]/.test(code(f.text)));
  is('nobody rolls their own spinner out of borders',
     bespokeSpinners.length === 0,
     bespokeSpinners.map((f) => f.path).join(', '));

  is('and the undefined colour is gone for good',
     !files.some((f) => /border-primary-600/.test(code(f.text))),
     'a spinner would render in the browser default again');
}

console.log('\nthe route placeholder holds the shape of a page');
{
  const app = readFileSync(join(CLIENT, 'App.tsx'), 'utf8');
  is('the lazy-route fallback is a skeleton, not a spinner',
     /data-route-loading/.test(app) && /<SkeletonList/.test(app),
     'the page would jump when the chunk lands');
}

console.log('\nthere are exactly two sanctioned empty shapes');
{
  const empty = readFileSync(join(CLIENT, 'components/shared/EmptyState.tsx'), 'utf8');
  is('the page-level one exists', /export function EmptyState/.test(empty));
  /*
   * And a small one. EmptyState is a 48px icon, a heading, a paragraph
   * and a button, which is absurd inside a 200px dashboard card - so
   * every small panel wrote its own one-liner, which is how twenty-four
   * different empty messages happened.
   */
  is('and a small one, for a panel that cannot carry it',
     /export function InlineEmpty/.test(empty),
     'small panels have nowhere to go and will improvise again');

  const adopted = files.filter((f) => /<EmptyState|<InlineEmpty/.test(f.text)).length;
  is('and they are actually used', adopted >= 12, `${adopted} files`);

  /*
   * The specific improvised shapes that were in the codebase. Named
   * rather than pattern-matched, because a broad "no centred div" rule
   * would fail on every legitimate centred thing in the app.
   */
  const devPage = readFileSync(join(CLIENT, 'pages/developer/DeveloperPage.tsx'), 'utf8');
  is('the developer page no longer has three of its own',
     !/<h3 className="font-medium text-\[var\(--text-primary\)\] mb-1">/.test(devPage),
     'three improvised empty states, each with its own typography');
  is('nor its own error panel',
     /<InlineError error=\{keysError\}/.test(devPage),
     'a hand-rolled failure panel with a retry that may not be able to work');

  const dash = files.filter((f) =>
    !isPrimitive(f.path) && /border-dashed[^"]*bg-\[var\(--bg-surface\)\][^"]*py-1[0-9] text-center/.test(f.text));
  is('and the dashed improvised empties are gone', dash.length === 0,
     dash.map((f) => f.path).join(', '));
}

console.log('\none component owns all four states');
{
  const panel = readFileSync(join(CLIENT, 'components/ui/AsyncPanel.tsx'), 'utf8');

  /*
   * Failure is checked before loading, and that order is load-bearing.
   * react-query keeps isLoading true while refetching after a failure, so
   * checking loading first replaces a visible error with a skeleton every
   * time the retry button is pressed - the error flashes away and comes
   * back, which reads as the button having worked.
   */
  is('failure is checked before loading',
     panel.indexOf('query.isError') < panel.indexOf('query.isLoading'),
     'pressing retry would flash the error away and back');

  is('a retry is offered only where it could work',
     /d\.retryable && onRetry/.test(panel),
     'a retry button on a 404 is a lie');

  /*
   * Guessing at somebody's response shape is how a screen shows an empty
   * state over real data. An array or a null is unambiguous; anything
   * else has to say so.
   */
  is('what counts as empty is never guessed at for an object',
     /if \(Array\.isArray\(data\)\) return data\.length === 0;\s*return false;/.test(panel),
     'a paginated response would be reported as empty');

  is('and it is used by the pages built on it',
     files.filter((f) => /<AsyncPanel/.test(f.text)).length >= 4,
     'the component exists and nothing uses it');
}

console.log('\nthe route boundary resets when you navigate away');
{
  const layout = readFileSync(join(CLIENT, 'components/layout/AppLayout.tsx'), 'utf8');
  /*
   * A boundary that does not remount is a boundary you are stuck behind:
   * it catches once, and every route you visit afterwards shows the same
   * error page. Keying the wrapper on the pathname is what makes it
   * recoverable by walking away.
   */
  const block = layout.slice(layout.indexOf('key={location.pathname}'), layout.indexOf('</main>'));
  is('the boundary is inside the pathname-keyed wrapper',
     block.includes('<ErrorBoundary>'),
     'one render crash would follow you to every other route');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} state language check(s) failed`);
