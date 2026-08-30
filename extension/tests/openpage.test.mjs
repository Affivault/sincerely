/**
 * The contract of openExtensionPage, checked without a browser.
 *
 * The bug this helper exists for is a CI-only race: the extension's install
 * handler opens the options page, and a suite that creates its first tab in
 * that window has its own navigation taken out from under it. It reproduces
 * roughly once in a hundred runs on CI and not at all on a fast machine, so
 * "run the browser suite and see" is not a test of anything.
 *
 * What is testable is the helper's behaviour given each outcome, which is what
 * these do: a stub context hands back exactly the failure being guarded
 * against, and the helper has to recover from it, tolerate the quieter variant
 * of it, and — the part that matters most — still let every other failure
 * through untouched.
 */
const URL_POPUP = 'chrome-extension://abc/popup/popup.html';

let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
};

/**
 * A page whose goto follows a script: each entry is either an Error to throw
 * or the URL the page ends up on.
 */
function stubContext(script) {
  const calls = [];
  let url = 'about:blank';
  const page = {
    gotos: 0,
    url: () => url,
    async goto(target) {
      const step = script[Math.min(page.gotos, script.length - 1)];
      page.gotos += 1;
      calls.push(target);
      if (step instanceof Error) throw step;
      url = step;
    },
    async waitForLoadState() {},
    async waitForTimeout() {},
    on() {},
  };
  return { context: { newPage: async () => page }, page, calls };
}

const interrupted = () =>
  new Error(
    `page.goto: Navigation to "${URL_POPUP}" is interrupted by another navigation to ` +
      '"chrome-extension://abc/options/options.html"'
  );

const { openExtensionPage } = await import('./chromium.mjs');

/* ---- the CI failure itself: goto throws, then succeeds ---- */
{
  const { context, page } = stubContext([interrupted(), URL_POPUP]);
  let error = null;
  const result = await openExtensionPage(context, URL_POPUP).catch((e) => {
    error = e;
    return null;
  });
  check('an interrupted navigation is retried, not surfaced', error === null, error?.message);
  check('and the page ends up where it was asked to go', result?.url() === URL_POPUP, result?.url());
  check('it took exactly one retry', page.gotos === 2, `${page.gotos} gotos`);
}

/* ---- the quieter variant: goto succeeds, the tab is stolen after ---- */
{
  const { context, page } = stubContext([
    'chrome-extension://abc/options/options.html',
    URL_POPUP,
  ]);
  const result = await openExtensionPage(context, URL_POPUP);
  check(
    'a navigation that lands and is then replaced is retried too',
    result.url() === URL_POPUP,
    result.url()
  );
  check('which also took one retry', page.gotos === 2, `${page.gotos} gotos`);
}

/* ---- the case that must NOT be swallowed ---- */
{
  const real = new Error('page.goto: net::ERR_CONNECTION_REFUSED');
  const { context, page } = stubContext([real]);
  let error = null;
  await openExtensionPage(context, URL_POPUP).catch((e) => {
    error = e;
  });
  check(
    'any other navigation failure is raised, not retried away',
    error === real,
    error?.message
  );
  check('and it is not retried at all', page.gotos === 1, `${page.gotos} gotos`);
}

/* ---- a collision that never clears must fail loudly, not hang ---- */
{
  const { context, page } = stubContext([interrupted()]);
  let error = null;
  await openExtensionPage(context, URL_POPUP, { attempts: 3 }).catch((e) => {
    error = e;
  });
  check(
    'a permanent collision gives up with a message naming the page',
    error !== null && error.message.includes(URL_POPUP),
    error?.message
  );
  check('after the number of attempts it was given', page.gotos === 3, `${page.gotos} gotos`);
}

/* ---- init has to run before the navigation, or listeners miss the load ---- */
{
  const { context } = stubContext([URL_POPUP]);
  const order = [];
  const original = context.newPage;
  context.newPage = async () => {
    order.push('newPage');
    const p = await original();
    const goto = p.goto.bind(p);
    p.goto = async (u) => {
      order.push('goto');
      return goto(u);
    };
    return p;
  };
  await openExtensionPage(context, URL_POPUP, {
    init: async () => {
      order.push('init');
    },
  });
  check(
    'init runs after the tab exists and before it is navigated',
    order.join(',') === 'newPage,init,goto',
    order.join(',')
  );
}

console.log(failed ? '\nopen extension page: FAILURES' : '\nopen extension page: all checks passed');
process.exit(failed ? 1 : 0);
