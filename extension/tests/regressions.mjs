/**
 * Regressions for six bugs that shipped and were found by reading the code
 * rather than by any test failing. Each one had a plausible-looking
 * implementation, which is why none of them were noticed.
 *
 * Needs `mock-api.mjs` on :3001 and the LinkedIn stub. `run.mjs` starts both.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCert } from './tls.mjs';
import { TEST_API_KEY } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(here, '..');
const LINKEDIN_STUB_PORT = 3443;
const ADDRESS = 'priya.raman@northwind.example.org';

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

const { spki } = await ensureCert();
const stub = spawn('node', [join(here, 'linkedin-stub.mjs')], {
  stdio: 'ignore',
  env: { ...process.env, LINKEDIN_STUB_PORT: String(LINKEDIN_STUB_PORT) },
});
process.on('exit', () => stub.kill());
await new Promise((r) => setTimeout(r, 900));

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'sincerely-reg-')), {
  executablePath: '/opt/pw-browsers/chromium',
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    `--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:${LINKEDIN_STUB_PORT}`,
    `--ignore-certificate-errors-spki-list=${spki}`,
    '--no-proxy-server',
  ],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.locator('details.manual > summary').click();
  await options.click('#use-local');
  await options.fill('#api-key', TEST_API_KEY);
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Connected'),
    null,
    { timeout: 25000 }
  );

  /* ================================================================ */
  /* 1. Navigating during a deep read must not lose the next profile  */
  /* ================================================================ */

  /*
   * The old `deepen()` bailed out whenever a deep read was already running.
   * Navigate mid-read and the new profile's call returned instantly, and
   * nothing re-triggered it once the old one finished — so the second profile
   * never got an address at all.
   */
  const profile = await context.newPage();
  await profile.goto('https://www.linkedin.com/in/priya-raman/');
  await profile.waitForLoadState('domcontentloaded');

  // Wait for the panel to exist, so the first profile's deep read has started.
  await profile.waitForFunction(
    () => document.getElementById('sincerely-panel-host')?.shadowRoot?.querySelector('.panel'),
    null,
    { timeout: 20000 }
  );

  /*
   * Now move to another profile the way LinkedIn does — pushState and a DOM
   * swap, with no document reload. That distinction is the whole test: a full
   * navigation tears down the content script and takes the in-flight state with
   * it, so the bug cannot reproduce. Only an SPA navigation leaves the previous
   * profile's deep read running while the next one asks for its own.
   */
  await profile.evaluate(() => {
    history.pushState({}, '', '/in/quiet-profile/');
    const main = document.querySelector('main');
    main.querySelector('h1').textContent = 'Quiet Profile';
    main.querySelector('#ci').setAttribute('href', '/in/quiet-profile/overlay/contact-info/');
  });

  const found = await profile.waitForFunction(
    () => {
      const text = document.getElementById('sincerely-panel-host')?.shadowRoot?.querySelector('.panel')?.textContent || '';
      return text.includes('@') ? text : null;
    },
    null,
    { timeout: 25000 }
  ).then((h) => h.jsonValue()).catch(() => null);

  check(
    'a profile opened during another profile’s deep read still gets its address',
    typeof found === 'string' && found.includes(ADDRESS),
    String(found).slice(0, 120)
  );
  await profile.close();

  /* ================================================================ */
  /* 2. A page of results costs a handful of requests, not hundreds   */
  /* ================================================================ */

  /*
   * CHECK_KNOWN used to spend two requests per person — getContactLists plus
   * isSuppressed — so 60 people came to 145 requests against a 100/minute key,
   * and the rows that hit the limit quietly reported "not known" for people
   * who were on three lists.
   */
  await fetch('http://localhost:3001/__reset');
  const before = await (await fetch('http://localhost:3001/__call-count')).json();

  const people = Array.from({ length: 40 }, (_, i) => ({
    first_name: 'Jane',
    last_name: 'Doe',
    company: 'Acme Ltd',
    linkedin_url: `https://www.linkedin.com/in/person-${i}/`,
  }));

  const known = await options.evaluate(
    (payload) => chrome.runtime.sendMessage({ type: 'CHECK_KNOWN', payload }),
    { people }
  );
  const after = await (await fetch('http://localhost:3001/__call-count')).json();
  const spent = after.total - before.total;

  check('CHECK_KNOWN answers for 40 people', known?.ok === true, JSON.stringify(known?.error));
  check(
    'and does it in far fewer than 40 requests',
    spent < 25,
    `${spent} requests for 40 people`
  );
  check(
    'while still reporting the memberships correctly',
    known?.data?.byProfile?.['https://www.linkedin.com/in/person-0/']?.onLists === 1,
    JSON.stringify(known?.data?.byProfile?.['https://www.linkedin.com/in/person-0/'])
  );

  /* ================================================================ */
  /* 3. Suppression survives the bulk read                            */
  /* ================================================================ */

  await options.evaluate(
    (payload) => chrome.runtime.sendMessage({ type: 'SUPPRESS_PERSON', payload }),
    { email: 'jane.doe@acme.com', contactId: 'k1', removeFromActive: true }
  );

  const afterSuppress = await options.evaluate(
    (payload) => chrome.runtime.sendMessage({ type: 'CHECK_KNOWN', payload }),
    { people: people.slice(0, 5) }
  );
  check(
    'a suppressed contact is still reported as suppressed by the bulk path',
    afterSuppress?.data?.byProfile?.['https://www.linkedin.com/in/person-0/']?.suppressed === true,
    JSON.stringify(afterSuppress?.data?.byProfile?.['https://www.linkedin.com/in/person-0/'])
  );

  /* ================================================================ */
  /* 4 + 5. Arming cannot be redirected at a different target         */
  /* ================================================================ */

  await fetch('http://localhost:3001/__reset');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });
  await popup.waitForFunction(() => document.querySelectorAll('.campaign-option').length > 0, null, {
    timeout: 15000,
  });

  // Suppress: arm on one address, retype, and the arming must be gone —
  // immediately, not 450ms later once the debounce catches up.
  await popup.fill('#email', 'jane.doe@acme.com');
  await popup.waitForTimeout(700);
  await popup.click('#suppress');
  check(
    'suppress arms and says so',
    /Click again to confirm/.test(await popup.textContent('#suppress')),
    await popup.textContent('#suppress')
  );

  await popup.fill('#email', 'someone.else@acme.com');
  check(
    'editing the address disarms suppress at once, not after the debounce',
    !/Click again to confirm/.test(await popup.textContent('#suppress')),
    await popup.textContent('#suppress')
  );

  /*
   * Now actually press it again, inside the old debounce window. On the broken
   * build this fired the armed action straight at the address that had just
   * been typed — one nobody was warned about. It must re-arm and name the new
   * address instead.
   */
  await popup.click('#suppress');
  check(
    'the next click re-arms against the new address rather than firing',
    /Click again to confirm/.test(await popup.textContent('#suppress')) &&
      /someone\.else@acme\.com/.test(await popup.textContent('#status')),
    await popup.textContent('#status')
  );

  await popup.waitForTimeout(900);
  const suppressedNow = await popup.evaluate(() =>
    fetch('http://localhost:3001/api/v1/suppression?limit=100')
      .then((r) => r.json())
      .catch(() => ({ data: [] }))
  );
  check(
    'and nobody has been suppressed yet',
    (suppressedNow.data || []).length === 0,
    JSON.stringify(suppressedNow.data)
  );
  await popup.close();
} catch (err) {
  failures.push(`harness threw: ${err.message}`);
  console.log(`\n  HARNESS ERROR: ${err.message}\n${err.stack}`);
} finally {
  await context.close();
  stub.kill();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
