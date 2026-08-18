/**
 * "It says rate limit reached."
 *
 * API keys are limited per minute, and this extension's ordinary work is
 * bursty: one add is up to seven requests, checking a page of search results
 * is dozens. So the limit gets reached during entirely normal use, and that
 * was never really the problem.
 *
 * The problem was that nothing did anything about it. lib/api.js has always
 * parsed `Retry-After` off the 429 and hung it on the error — and nothing
 * ever read it again. The extension knew exactly how long to wait and gave
 * up instead, reporting a hard failure for work that would have succeeded a
 * few seconds later.
 *
 * So this drives the real service worker against a mock that genuinely says
 * no, and asserts recovery rather than a message.
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

await fetch('http://localhost:3001/__reset');

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

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-rate-'));
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

  // Driven from an extension page rather than the worker: a Playwright
  // ServiceWorker context does not reliably expose chrome.*, and every other
  // suite here connects the same way the user would.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.locator('details.manual > summary').click();
  await options.click('#use-local');
  await options.fill('#api-key', KEY);
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Connected'),
    null,
    { timeout: 20000 },
  );

  /** Ask for something real, through the whole client. */
  const listLists = () =>
    options.evaluate(() => chrome.runtime.sendMessage({ type: 'LIST_LISTS', payload: {} }));

  /* ---------------- a 429 is waited out, not reported ---------------- */

  // Reject the next two requests outright. LIST_LISTS makes more than one call
  // (the lists, then which campaigns draw from them), so this covers both the
  // first request being refused and a later one being refused mid-flight.
  await fetch('http://localhost:3001/__arm-rate-limit?reject=2');

  const started = Date.now();
  const reply = await listLists();
  const elapsed = Date.now() - started;

  const stats = await (await fetch('http://localhost:3001/__rate-limit-stats')).json();
  check('the mock really did refuse', stats.rejections >= 1, JSON.stringify(stats));

  check(
    'the call succeeds anyway, instead of surfacing "rate limit reached"',
    reply?.ok === true,
    JSON.stringify(reply),
  );
  check(
    'and it came back with the actual lists',
    Array.isArray(reply?.data?.lists) && reply.data.lists.length > 0,
    JSON.stringify(reply?.data)?.slice(0, 200),
  );
  check(
    'it waited roughly the interval the server asked for, rather than hammering',
    elapsed >= 1000,
    `${elapsed}ms — a retry that does not wait is just a second failure`,
  );

  /* ---------------- a thin budget is spread, not spent ---------------- */

  await fetch('http://localhost:3001/__reset');
  // Three requests left in a window with 6 seconds to run. The client should
  // space them out rather than firing them off and hitting the wall.
  await fetch('http://localhost:3001/__arm-rate-limit?remaining=3&resetSeconds=6');

  // One call to pick the headers up, then time the next.
  await listLists();
  const pacedStart = Date.now();
  const paced = await listLists();
  const pacedElapsed = Date.now() - pacedStart;

  check('the paced call still succeeds', paced?.ok === true, JSON.stringify(paced));
  check(
    'and it was deliberately slowed once the budget got thin',
    pacedElapsed >= 400,
    `${pacedElapsed}ms — the client is not pacing against X-RateLimit-Remaining`,
  );

  /* ---------------- a full budget is not slowed at all ---------------- */

  await fetch('http://localhost:3001/__reset');
  await listLists();
  const fastStart = Date.now();
  await listLists();
  const fastElapsed = Date.now() - fastStart;
  check(
    'a healthy budget costs nothing — pacing must not tax the normal case',
    fastElapsed < 400,
    `${fastElapsed}ms`,
  );

  /* ---------------- a wall that does not lift is still an error ------- */

  await fetch('http://localhost:3001/__reset');
  // More refusals than the single retry can absorb: the user has to be told,
  // rather than the extension silently retrying forever.
  await fetch('http://localhost:3001/__arm-rate-limit?reject=40');
  const refused = await listLists();
  check(
    'a limit that will not lift is reported, not retried forever',
    refused?.ok === false && /rate limit/i.test(refused?.error?.message || ''),
    JSON.stringify(refused),
  );
} finally {
  await context.close();
}

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  - ${failures.join('\n  - ')}`
    : `\nratelimit: all ${passed} checks passed`,
);
process.exit(failures.length ? 1 : 0);
