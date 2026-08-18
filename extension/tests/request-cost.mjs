/**
 * What an add actually costs.
 *
 * API keys are limited per minute and this extension's work is bursty, so the
 * number of requests behind one user action is a property worth asserting
 * rather than hoping about. Pacing and retries make the limit survivable; they
 * do not make a wasteful call path cheap, and a handler that answers correctly
 * in twice the requests is still the reason somebody hits the wall.
 *
 * The mock counts every call, so these are exact numbers, not estimates.
 *
 * Needs `mock-api.mjs` on :3001. `run.mjs` starts it.
 */
import { chromium } from 'playwright';
import { CHROMIUM } from './chromium.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_API_KEY } from './fixtures.mjs';

const KEY = TEST_API_KEY;
const here = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(here, '..');
const API = 'http://localhost:3001/api/v1';
const MOCK = 'http://localhost:3001';

await fetch(`${MOCK}/__reset`);

const failures = [];
let passed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const calls = async () => (await (await fetch(`${MOCK}/__call-count`)).json()).total;

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-cost-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  // Settings are written from an extension page: a Playwright ServiceWorker
  // context does not reliably expose chrome.*.
  const driver = await context.newPage();
  await driver.goto(`chrome-extension://${extensionId}/options/options.html`);
  await driver.waitForLoadState('domcontentloaded');
  await driver.evaluate(
    ([key, api]) =>
      chrome.storage.local.set({
        apiKey: key, apiBaseUrl: api, autoTag: true, autoTagName: 'chrome-extension',
        // The LinkedIn agent polls on its own alarm. It is not what is being
        // measured here, and its traffic lands inside the windows below.
        agentPaused: true,
      }),
    [KEY, API],
  );

  const send = (type, payload = {}) =>
    driver.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, payload: p }), [type, payload]);

  // Let the options page's own connection test finish. Its requests would
  // otherwise land inside the first measurement window and be counted against
  // the add.
  await driver.waitForTimeout(2500);

  // The default list in the mock's fixture.
  const listId = 'L1';

  /* ---------------- one add ---------------- */

  await fetch(`${MOCK}/__reset`);
  const beforeFirst = await calls();
  const first = await send('ADD_TO_LIST', {
    listId,
    person: { email: 'cost.one@northwind.example.org', first_name: 'Cost', last_name: 'One' },
  });
  const firstCost = (await calls()) - beforeFirst;
  check('the first add succeeds', first?.ok === true, JSON.stringify(first?.error));
  const firstLog = (await (await fetch(`${MOCK}/__call-log`)).json()).calls;
  check(
    'and costs no more than six requests, including creating the tag',
    firstCost <= 6,
    `${firstCost} requests for one add: ${firstLog.join(' | ')}`,
  );

  /* ---------------- the second add is cheaper ---------------- */

  const beforeSecond = await calls();
  const second = await send('ADD_TO_LIST', {
    listId,
    person: { email: 'cost.two@northwind.example.org', first_name: 'Cost', last_name: 'Two' },
  });
  const secondCost = (await calls()) - beforeSecond;
  check('the second add succeeds', second?.ok === true, JSON.stringify(second?.error));
  check(
    'and every add after it costs four, because the tag is resolved once',
    secondCost <= 4,
    `first ${firstCost}, second ${secondCost} — the tag is still being looked up on every add`,
  );

  /* ---------------- checking a page of people ---------------- */

  const people = Array.from({ length: 20 }, (_, i) => ({
    linkedin_url: `https://www.linkedin.com/in/person-${i}/`,
    first_name: `Person${i}`,
    last_name: `Surname${i}`,
  }));

  await fetch(`${MOCK}/__reset`);
  // The membership cache is per-worker and the reset above only clears the
  // server, so ask twice and compare: the second pass is the one that must be
  // nearly free.
  const beforeScan = await calls();
  const scan = await send('CHECK_KNOWN', { people });
  const scanCost = (await calls()) - beforeScan;
  check('a page of 20 is checked successfully', scan?.ok === true, JSON.stringify(scan?.error));
  check(
    'and costs a fraction over one request per distinct surname, not per person',
    scanCost <= people.length + 6,
    `${scanCost} requests for ${people.length} people`,
  );

  const beforeRescan = await calls();
  await send('CHECK_KNOWN', { people });
  const rescanCost = (await calls()) - beforeRescan;
  check(
    'scrolling the same page again is nearly free',
    rescanCost <= 2,
    `first pass ${scanCost}, second ${rescanCost} — the page is being re-read every scroll`,
  );

  /* ---------------- but a write still invalidates it ---------------- */

  await send('ADD_TO_LIST', {
    listId,
    person: { email: 'cost.three@northwind.example.org', first_name: 'Cost', last_name: 'Three' },
  });
  const beforeAfterWrite = await calls();
  await send('CHECK_KNOWN', { people });
  const afterWriteCost = (await calls()) - beforeAfterWrite;
  check(
    'after a change to a list, memberships are read again rather than served stale',
    afterWriteCost > rescanCost,
    `${afterWriteCost} vs ${rescanCost} — a stale membership count survived a write`,
  );
} finally {
  await context.close();
}

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  - ${failures.join('\n  - ')}`
    : `\nrequest-cost: all ${passed} checks passed`,
);
process.exit(failures.length ? 1 : 0);
