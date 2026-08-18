/**
 * The site scan's restraint.
 *
 * Scanning a company site means this extension fetching somebody else's
 * server, unattended, from a user's browser. Everything that stops that being
 * rude is in handleScanSite and fetchPage: a page cap, a pool of three, an
 * eight-second timeout, a two-megabyte ceiling and an HTML-only filter.
 *
 * All of it existed. None of it was ever exercised — harvest.test.mjs covers
 * the parser, scan.mjs covers a four-page site that trips no limit at all. So
 * the crawl could have been hammering a site flat and every test would still
 * have passed.
 *
 * The fixture site here has forty linked pages, a PDF, a page declaring nine
 * megabytes, one that never answers, and an off-origin link.
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

/** Mirrors SCAN_PAGE_LIMIT / SCAN_CONCURRENCY in service-worker.js. */
const PAGE_LIMIT = 14;
const CONCURRENCY = 3;

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

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-scan-'));
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

  const driver = await context.newPage();
  await driver.goto(`chrome-extension://${extensionId}/options/options.html`);
  await driver.waitForLoadState('domcontentloaded');
  await driver.evaluate(
    ([key, api]) =>
      chrome.storage.local.set({ apiKey: key, apiBaseUrl: api, agentPaused: true }),
    [KEY, API],
  );

  const started = Date.now();
  const scan = await driver.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'SCAN_SITE', payload: { url: 'http://localhost:3001/big/' } }),
  );
  const elapsed = Date.now() - started;

  check('the scan completes', scan?.ok === true, JSON.stringify(scan?.error));

  const stats = await (await fetch(`${MOCK}/__crawl-stats`)).json();

  /* ---------------- it stops ---------------- */

  check(
    'it stops at the page cap rather than crawling all forty',
    scan?.data?.pagesScanned <= PAGE_LIMIT,
    `${scan?.data?.pagesScanned} pages scanned`,
  );
  check(
    'and the server saw no more than that either',
    stats.fetched.length <= PAGE_LIMIT + 2,
    `${stats.fetched.length} fetched: ${stats.fetched.join(' ')}`,
  );

  /* ---------------- it is gentle ---------------- */

  check(
    'never more than three requests in flight at once',
    stats.peak <= CONCURRENCY,
    `peak ${stats.peak} concurrent`,
  );

  /* ---------------- one dead page does not sink it ---------------- */

  check(
    'a page that never answers does not hang the whole scan',
    elapsed < 60000,
    `${Math.round(elapsed / 1000)}s`,
  );

  /* ---------------- it reads only what it should ---------------- */

  const emails = (scan?.data?.results || []).map((r) => r.email);
  check(
    'addresses from the pages it did read are returned',
    emails.some((e) => /^person\d+@northwind\.example\.org$/.test(e)),
    JSON.stringify(emails).slice(0, 200),
  );
  check(
    'a PDF is not parsed for addresses',
    !emails.includes('pretend@northwind.example.org'),
    JSON.stringify(emails).slice(0, 200),
  );
  check(
    'a page declaring nine megabytes is skipped rather than downloaded',
    !emails.includes('huge@northwind.example.org'),
    JSON.stringify(emails).slice(0, 200),
  );
  check(
    'and nothing off-origin was fetched',
    stats.fetched.every((path) => path.startsWith('/big')),
    stats.fetched.join(' '),
  );
  check(
    'the forty pages that do not look like they hold people are left alone',
    !stats.fetched.some((path) => /^\/big\/p\d+$/.test(path)),
    stats.fetched.join(' '),
  );
  check(
    'while the ones that do are followed',
    stats.fetched.some((path) => path.startsWith('/big/team-')),
    stats.fetched.join(' '),
  );
} finally {
  await context.close();
}

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  - ${failures.join('\n  - ')}`
    : `\nscan-limits: all ${passed} checks passed`,
);
process.exit(failures.length ? 1 : 0);
