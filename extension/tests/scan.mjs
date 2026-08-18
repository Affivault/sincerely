/**
 * End-to-end test of the site harvester: the worker really fetches a
 * multi-page site, decodes the obfuscations, annotates what we already hold,
 * and the results go onto a lead list carrying their names.
 */
import { chromium } from 'playwright';
import { CHROMIUM } from './chromium.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_API_KEY, TEST_AUTH } from './fixtures.mjs';
const KEY = TEST_API_KEY;

await fetch('http://localhost:3001/__reset');

const EXT_PATH = fileURLToPath(new URL('..', import.meta.url));

const failures = [];
const passes = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    passes.push(name);
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'scan-')), {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  // Manual key entry is the fallback path now, collapsed behind a <details>.
  await options.locator('details.manual > summary').click();
  await options.click('#use-local');
  await options.fill('#api-key', KEY);
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Connected'),
    null,
    { timeout: 20000 }
  );

  /* ---------------- the crawl ---------------- */

  const scan = await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'SCAN_SITE', payload: { url: 'http://localhost:3001/' } })
  );

  check('the scan succeeds', scan?.ok === true, JSON.stringify(scan?.error));
  const results = scan?.data?.results || [];
  const emails = results.map((r) => r.email);

  check('it reads more than the page it started on', scan.data.pagesScanned > 1, String(scan.data.pagesScanned));
  check(
    'it finds a plain mailto on the contact page',
    emails.includes('info@northwind.example.org'),
    JSON.stringify(emails)
  );
  check(
    'it decodes an entity-encoded address',
    emails.includes('press@northwind.example.org'),
    JSON.stringify(emails)
  );
  check(
    'it decodes a Cloudflare-protected address',
    emails.includes('ana.silva@northwind.example.org'),
    JSON.stringify(emails)
  );
  check(
    'it decodes an (at)/(dot) address',
    emails.includes('ben.oyelaran@northwind.example.org'),
    JSON.stringify(emails)
  );
  check(
    'it finds the team page by following a link, not just guessing paths',
    emails.includes('cara.dunne@northwind.example.org'),
    JSON.stringify(emails)
  );
  check('no duplicates across pages', new Set(emails).size === emails.length);

  /* ---------------- attribution and ranking ---------------- */

  const ana = results.find((r) => r.email === 'ana.silva@northwind.example.org');
  check('a decoded address still gets a name', ana?.first_name === 'Ana' && ana?.last_name === 'Silva', JSON.stringify(ana));
  check(
    'a job title beside the name is not taken as the name',
    ana?.last_name !== 'Managing',
    JSON.stringify(ana)
  );
  check('named people come first', results[0]?.kind === 'person', results[0]?.email);
  // press@ and no-reply@ are both role accounts, so which of the two lands
  // last is just alphabetical — what matters is that every role sits below
  // every person and every shared inbox.
  const lastPerson = results.map((r) => r.kind).lastIndexOf('person');
  const firstRole = results.map((r) => r.kind).indexOf('role');
  check(
    'role accounts are kept but sink below everyone else',
    firstRole > lastPerson && results[results.length - 1]?.kind === 'role',
    JSON.stringify(results.map((r) => [r.email, r.kind]))
  );
  check(
    'a shared inbox is labelled rather than dropped',
    results.find((r) => r.email === 'info@northwind.example.org')?.kind === 'generic'
  );
  check('every result records the page it came from', results.every((r) => r.source_url));

  /* ---------------- knows what we already hold ---------------- */

  check(
    'nothing is flagged as a contact yet',
    results.every((r) => r.alreadyAContact === false),
    JSON.stringify(results.map((r) => [r.email, r.alreadyAContact]))
  );

  /* ---------------- straight onto a lead list ---------------- */

  const people = results.filter((r) => r.kind === 'person');
  const added = await options.evaluate(
    (rows) => chrome.runtime.sendMessage({ type: 'BULK_ADD', payload: { listId: 'L2', people: rows } }),
    people
  );

  check('the selection is added in one action', added?.ok === true, JSON.stringify(added?.error));
  check(
    'everyone selected is created',
    added?.data?.created === people.length,
    JSON.stringify(added?.data)
  );
  check('everyone selected lands on the list', added?.data?.added === people.length, JSON.stringify(added?.data));

  // The names the harvester worked out must survive into the contact records,
  // or merge tags on the list would render empty.
  const stored = await options.evaluate(
    (auth) =>
      fetch('http://localhost:3001/api/v1/contacts?search=@northwind.example.org&limit=100', { headers: { Authorization: auth } }).then((r) => r.json()),
    TEST_AUTH
  );
  const ben = (stored.data || []).find((c) => c.email === 'ben.oyelaran@northwind.example.org');
  check(
    'harvested names are carried into the contact record',
    ben?.first_name === 'Ben' && ben?.last_name === 'Oyelaran',
    JSON.stringify(ben)
  );

  /* ---------------- a second scan knows what changed ---------------- */

  const rescan = await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'SCAN_SITE', payload: { url: 'http://localhost:3001/' } })
  );
  const rescanned = rescan?.data?.results || [];
  check(
    'a repeat scan marks the ones we now hold',
    rescanned.find((r) => r.email === 'ben.oyelaran@northwind.example.org')?.alreadyAContact === true,
    JSON.stringify(rescanned.map((r) => [r.email, r.alreadyAContact]))
  );
  check(
    'and still shows the ones we never added',
    rescanned.find((r) => r.email === 'no-reply@northwind.example.org')?.alreadyAContact === false
  );

  /* ---------------- refuses what it cannot read ---------------- */

  const badUrl = await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'SCAN_SITE', payload: { url: 'chrome://settings' } })
  );
  check(
    'a chrome:// page is refused with an explanation',
    badUrl?.ok === false && /open the company's website/i.test(badUrl.error.message),
    JSON.stringify(badUrl?.error)
  );

  const noPermission = await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'SCAN_SITE', payload: { url: 'https://not-granted.example.com/' } })
  );
  check(
    'a site without a host grant is refused rather than fetched',
    noPermission?.ok === false && noPermission.error.code === 'NEEDS_PERMISSION',
    JSON.stringify(noPermission?.error)
  );
} catch (err) {
  failures.push(`harness threw: ${err.message}`);
  console.log(`\n  HARNESS ERROR: ${err.stack}`);
} finally {
  await context.close();
}

console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
