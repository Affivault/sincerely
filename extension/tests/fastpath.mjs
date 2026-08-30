/**
 * Two things, both reported as "the extension feels broken":
 *
 *  1. Connect sends people to the app's Webhooks tab, not the API keys tab.
 *  2. On LinkedIn the whole page stalls while the extension hunts for an
 *     address — it opens the Contact info dialog, LinkedIn locks body scroll,
 *     and nothing is usable or drawn for several seconds.
 *
 * Both are timing and wiring faults that only show up against the real extension
 * in a real browser, so this drives the unpacked extension against a stub served
 * on linkedin.com through Chromium's resolver.
 *
 * Needs `mock-api.mjs` on :3001 and `linkedin-stub.mjs` on :3443. `run.mjs`
 * starts both.
 */
import { chromium } from 'playwright';
import { CHROMIUM, openExtensionPage } from './chromium.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCert } from './tls.mjs';
import { TEST_API_KEY } from './fixtures.mjs';
const KEY = TEST_API_KEY;

const here = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(here, '..');
const API = 'http://localhost:3001/api/v1';
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
await new Promise((resolve) => setTimeout(resolve, 900));

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-fast-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    /*
     * linkedin.com is served locally and reached through the resolver, not
     * through Playwright's request interception: a route-fulfilled response does
     * not get content scripts injected, so the LinkedIn adapter would never run.
     * Mapping the hostname keeps everything real — same origin, same manifest
     * match, same injection.
     */
    `--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:${LINKEDIN_STUB_PORT}, MAP localhost:5173 127.0.0.1:3001`,
    // Pinned to this one cert. Blanket --ignore-certificate-errors would mark
    // the page insecure, and Chrome refuses to inject content scripts there.
    `--ignore-certificate-errors-spki-list=${spki}`,
    // CI and dev containers often set an HTTPS proxy, which would tunnel
    // linkedin.com outward and defeat the resolver rule. Everything here is local.
    '--no-proxy-server',
  ],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  /* ================================================================ */
  /* Fix 1 — connect lands on the API keys tab                        */
  /* ================================================================ */

  const options = await openExtensionPage(context, `chrome-extension://${extensionId}/options/options.html`);
  await options.waitForLoadState('domcontentloaded');

  // Configure through the real UI, the same way a person would.
  await options.locator('details.manual > summary').click();
  await options.click('#use-local');
  await options.fill('#api-key', KEY);
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Connected'),
    null,
    { timeout: 25000 }
  );

  const opened = context.waitForEvent('page', { timeout: 10000 });
  await options.click('#open-app');
  const appTab = await opened;
  const appUrl = appTab.url();

  check('Open Sincerely goes to the developer page', /\/developer/.test(appUrl), appUrl);
  check('and asks for the API keys tab, not Webhooks', /[?&]tab=api-keys\b/.test(appUrl), appUrl);
  check(
    'the instructions no longer tell people to hunt for the tab',
    !/Webhooks in the sidebar/i.test(await options.textContent('#result')),
    await options.textContent('#result')
  );
  await appTab.close().catch(() => {});
  await options.close();

  /* ================================================================ */
  /* Fix 2 — LinkedIn answers fast, then deepens                      */
  /* ================================================================ */

  const profile = await context.newPage();
  const pageErrors = [];
  profile.on('pageerror', (err) => pageErrors.push(err.message));
  await profile.goto('https://www.linkedin.com/in/priya-raman/');
  await profile.waitForLoadState('domcontentloaded');

  /*
   * Everything below goes through the extension's own message path, from the
   * service worker, because that is the production path and because content
   * scripts live in an isolated world that page.evaluate cannot reach. What the
   * *page* can see — dialogs opening, scroll locking — is read from the main
   * world. That split is the point: the extension's answer on one side, the
   * user's experience of their own page on the other.
   */
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || '').includes('linkedin.com'))?.id ?? null;
  });
  check('the LinkedIn tab is visible to the extension', typeof tabId === 'number', String(tabId));

  /** Ask the page, the way the popup and the badge do. */
  const ask = (type) =>
    worker.evaluate(
      async ([id, messageType]) => {
        const started = Date.now();
        try {
          return { person: await chrome.tabs.sendMessage(id, { type: messageType }), ms: Date.now() - started };
        } catch (err) {
          return { error: err.message };
        }
      },
      [tabId, type]
    );

  const pageState = () =>
    profile.evaluate(() => ({
      dialogOpens: window.__dialogOpens,
      locked: getComputedStyle(document.body).overflowY === 'hidden',
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      leftoverStyles: document.querySelectorAll('style[data-sincerely]').length,
    }));

  // Wait for the declarative content scripts to be listening.
  let ready = null;
  for (let i = 0; i < 30 && !ready?.person; i += 1) {
    ready = await ask('SINCERELY_SCRAPE');
    if (!ready?.person) await profile.waitForTimeout(500);
  }
  check('the content script answers on a LinkedIn profile', Boolean(ready?.person), JSON.stringify(ready));

  /* ---- the fast scrape is genuinely fast ---- */

  const fast = await ask('SINCERELY_SCRAPE');
  const afterFast = await pageState();

  check('the fast scrape answers in well under a second', fast.ms < 800, `${fast.ms}ms`);
  check('and identifies the person', fast.person?.full_name === 'Priya Raman', fast.person?.full_name);
  check('and their title', fast.person?.job_title === 'Head of Partnerships', fast.person?.job_title);
  check('and their company', fast.person?.company === 'Northwind Capital', fast.person?.company);
  check('and it has no address yet', !fast.person?.email, fast.person?.email || '');
  check(
    'it says an address may still be coming, rather than claiming there is none',
    fast.person?.contact_info_pending === true,
    JSON.stringify(fast.person?.contact_info_pending)
  );
  check('and the page is not locked while it answers', !afterFast.locked);

  /* ---- the deep scrape finds it, and leaves the page usable ---- */

  // Sample the page's own scroll lock throughout: if it is ever locked, the page
  // is frozen under the user. That is the reported "buffer".
  await profile.evaluate(() => {
    window.__lockedDuringDeep = false;
    window.__lockSampler = setInterval(() => {
      if (getComputedStyle(document.body).overflowY === 'hidden') window.__lockedDuringDeep = true;
    }, 25);
  });

  const deep = await ask('SINCERELY_SCRAPE_DEEP');

  const lockedDuringDeep = await profile.evaluate(() => {
    clearInterval(window.__lockSampler);
    return window.__lockedDuringDeep;
  });
  const afterDeep = await pageState();

  check('the deep scrape finds the address behind Contact info', deep.person?.email === ADDRESS, deep.person?.email || 'none');
  check('the page is never scroll-locked while it works', lockedDuringDeep === false);
  check('and is not left locked afterwards', !afterDeep.locked);
  check('it opened the dialog exactly once', afterDeep.dialogOpens === 1, String(afterDeep.dialogOpens));
  check('and closed it again', afterDeep.dialogs === 0, String(afterDeep.dialogs));
  check('leaving none of its own stylesheet behind', afterDeep.leftoverStyles === 0, String(afterDeep.leftoverStyles));
  check('the deep pass stays within a few seconds', deep.ms < 6000, `${deep.ms}ms`);

  /* ---- a later fast scrape already knows, without reopening ---- */

  const afterwards = await ask('SINCERELY_SCRAPE');
  const afterAgain = await pageState();

  check('a later fast scrape reports the address it already found', afterwards.person?.email === ADDRESS, afterwards.person?.email || 'none');
  check('immediately', afterwards.ms < 800, `${afterwards.ms}ms`);
  check(
    'and no longer says it is still looking',
    afterwards.person?.contact_info_pending === false,
    JSON.stringify(afterwards.person?.contact_info_pending)
  );
  check('without reopening the dialog', afterAgain.dialogOpens === 1, String(afterAgain.dialogOpens));

  /* ---- the badge path never makes the page do work ---- */

  /*
   * Measured as a delta once everything else has settled, because the in-page
   * panel legitimately opens the dialog once on mount — that is a surface the
   * user is looking at. The toolbar badge is not: it runs on every tab update,
   * for somebody who has not asked for anything, and must never open a dialog on
   * a profile. Ten fast scrapes, zero new dialogs.
   */
  const beforeBadge = (await pageState()).dialogOpens;
  for (let i = 0; i < 10; i += 1) await ask('SINCERELY_SCRAPE');
  await profile.waitForTimeout(600);
  const afterBadge = await pageState();

  check('ten fast scrapes open no dialog at all', afterBadge.dialogOpens === beforeBadge, `${beforeBadge} -> ${afterBadge.dialogOpens}`);
  check('and leave the page unlocked', !afterBadge.locked);

  check(
    'nobody else’s contact-info link was ever clicked',
    afterAgain.dialogOpens === 1 && afterAgain.dialogs === 0
  );
  check('the profile raised no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await profile.close();

  /* ================================================================ */
  /* The quiet route: when LinkedIn answers, never touch the page     */
  /* ================================================================ */

  /*
   * The whole reordering rests on this. The network routes now run first and in
   * parallel, so on a profile where LinkedIn's own endpoint answers, the
   * extension gets the address without opening anything — no modal, no scroll
   * lock, nothing the user can see. Previously the UI-driving route went first
   * and this profile would have been driven anyway, for nothing.
   */
  const quiet = await context.newPage();
  await quiet.goto('https://www.linkedin.com/in/quiet-profile/');
  await quiet.waitForLoadState('domcontentloaded');

  const quietTabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || '').includes('quiet-profile'))?.id ?? null;
  });

  let quietDeep = null;
  for (let i = 0; i < 20 && !quietDeep?.person; i += 1) {
    quietDeep = await worker.evaluate(
      async (id) => {
        try {
          return { person: await chrome.tabs.sendMessage(id, { type: 'SINCERELY_SCRAPE_DEEP' }) };
        } catch {
          return null;
        }
      },
      quietTabId
    );
    if (!quietDeep?.person) await quiet.waitForTimeout(500);
  }

  await quiet.waitForTimeout(800);
  const quietState = await quiet.evaluate(() => ({
    dialogOpens: window.__dialogOpens,
    locked: getComputedStyle(document.body).overflowY === 'hidden',
  }));

  check('when LinkedIn answers directly, the address still arrives', quietDeep?.person?.email === ADDRESS, quietDeep?.person?.email || 'none');
  check('and nothing is ever clicked on the page to get it', quietState.dialogOpens === 0, String(quietState.dialogOpens));
  check('leaving the page untouched and unlocked', !quietState.locked);
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
