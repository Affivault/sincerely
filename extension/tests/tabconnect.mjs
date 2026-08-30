/**
 * "Connect using this tab": the extension sets itself up from a signed-in app
 * tab, with no key to paste and no domain baked into the manifest.
 *
 * The stand-in app is served from http://127.0.0.1:5999 — an origin that appears
 * nowhere in manifest.json's connect matches or the extension's defaults (the
 * test asserts that rather than assuming it). If this passes, the flow works on
 * whatever domain a real deployment happens to use.
 *
 * The page never sets window.__SINCERELY_API_URL either, so discovery has to
 * come from the page's own network history — the case that has to work before
 * the app is redeployed with the hint.
 */
import { chromium } from 'playwright';
import { CHROMIUM, openExtensionPage } from './chromium.mjs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_API_KEY, TEST_JWT } from './fixtures.mjs';
const KEY = TEST_API_KEY;

const EXT_PATH = fileURLToPath(new URL('..', import.meta.url));
const JWT = TEST_JWT;
const API = 'http://127.0.0.1:3001/api/v1';
const APP = 'http://127.0.0.1:5999';

await fetch('http://127.0.0.1:3001/__reset');

const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Stands in for the app: a Supabase session in localStorage, and a call to its
 * own API on load so the API address lands in the resource timeline — which is
 * exactly how a signed-in app page looks.
 *
 * Served by a real HTTP server rather than route interception: an intercepted
 * page's own cross-origin fetches never complete, so the timeline would be
 * empty and the thing under test would never happen.
 */
function appPage(withSession) {
  return `<!doctype html><html><head><title>Sincerely</title></head><body>
    <h1>Dashboard</h1>
    <p id="loaded">no</p>
    <script>
      ${
        withSession
          ? `localStorage.setItem('sb-abcdefghij-auth-token', JSON.stringify({ access_token: ${JSON.stringify(
              JWT
            )}, token_type: 'bearer' }));`
          : 'localStorage.clear();'
      }
      fetch('${API}/campaigns?limit=1', { headers: { Authorization: 'Bearer ' + ${JSON.stringify(
        KEY
      )} } })
        .catch(() => {})
        .finally(() => { document.getElementById('loaded').textContent = 'yes'; });
    </script>
  </body></html>`;
}

/**
 * Signed in, but has never called the API — so the resource timeline holds
 * nothing to discover, and the API lives on a host that cannot be derived from
 * this origin. The only way through is the address already in settings.
 */
function quietPage() {
  return `<!doctype html><html><head><title>Sincerely</title></head><body>
    <h1>Dashboard</h1>
    <script>
      localStorage.setItem('sb-abcdefghij-auth-token', JSON.stringify({ access_token: ${JSON.stringify(
        JWT
      )} }));
    </script>
  </body></html>`;
}

const appServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  if (req.url.startsWith('/quiet')) return res.end(quietPage());
  return res.end(appPage(!req.url.startsWith('/anon')));
});
await new Promise((resolve) => appServer.listen(5999, '127.0.0.1', resolve));

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-tabconnect-'));

/*
 * In production the grant comes from activeTab: clicking the toolbar icon gives
 * the extension access to that one tab, which is what lets this work on a domain
 * the manifest has never heard of. Playwright cannot click a real toolbar icon,
 * so stand in for that grant by adding this test origin to a throwaway copy of
 * the extension. Everything else — discovery, minting, storage, the popup — is
 * the shipped code.
 */
const extDir = mkdtempSync(join(tmpdir(), 'sincerely-ext-copy-'));
cpSync(EXT_PATH, extDir, { recursive: true });
const manifestPath = join(extDir, 'manifest.json');
const patchedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
patchedManifest.host_permissions.push(`${APP}/*`);
writeFileSync(manifestPath, JSON.stringify(patchedManifest, null, 2));

const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

/**
 * Run the connect against the tab showing `url`, sent from an extension page.
 *
 * The message has to come from a page, not from worker.evaluate: a service
 * worker's own runtime.sendMessage is not delivered to its own onMessage
 * listener, so driving it from the worker would silently never reply. The popup
 * is what does this for real, so use a popup page here too.
 */
async function connectFromTab(worker, extensionPage, url) {
  const tabId = await worker.evaluate(
    (tabUrl) =>
      new Promise((resolve) => {
        chrome.tabs.query({}, (tabs) => resolve(tabs.find((t) => t.url === tabUrl)?.id));
      }),
    url
  );
  return extensionPage.evaluate(
    (id) => chrome.runtime.sendMessage({ type: 'CONNECT_FROM_TAB', payload: { tabId: id } }),
    tabId
  );
}

try {
  /*
   * Wait for the extension's worker specifically, and for chrome.* to exist in
   * it: the serviceworker event fires the moment the worker object appears,
   * which is before the extension APIs are attached, and a page worker (the
   * stand-in app could register one) never gets them at all.
   */
  let worker = null;
  for (let attempt = 0; attempt < 40 && !worker; attempt += 1) {
    const candidate = context
      .serviceWorkers()
      .find((w) => w.url().startsWith('chrome-extension://'));
    if (candidate) {
      const ready = await candidate.evaluate(() => typeof chrome).catch(() => 'undefined');
      if (ready === 'object') worker = candidate;
    }
    if (!worker) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!worker) throw new Error('the extension service worker never became ready');
  const extensionId = new URL(worker.url()).host;

  const workerErrors = [];
  context.on('weberror', (e) => workerErrors.push(e.error().message));

  // A long-lived extension page to send messages from, standing in for the popup.
  const driver = await openExtensionPage(context, `chrome-extension://${extensionId}/popup/popup.html`);
  await driver.waitForLoadState('domcontentloaded');

  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  const connectMatches = manifest.content_scripts.flatMap((entry) => entry.matches);
  check(
    'the app origin is in none of the connect matches — the case that used to fail silently',
    !connectMatches.some((pattern) => pattern.includes('5999')),
    connectMatches.join(' ')
  );

  /* -------- signed out is named, not left as a network error -------- */

  const anon = await context.newPage();
  await anon.goto(`${APP}/anon`);
  await anon.waitForFunction(() => document.getElementById('loaded')?.textContent === 'yes');

  let response = await connectFromTab(worker, driver, `${APP}/anon`);
  check(
    'a signed-out page is reported as not signed in',
    response?.ok === false && /not signed in/i.test(response.error.message),
    JSON.stringify(response)
  );
  const afterAnon = await worker.evaluate(() => chrome.storage.local.get('apiKey'));
  check('and nothing was stored', !afterAnon.apiKey, JSON.stringify(afterAnon));
  await anon.close();

  /* -------- the real thing, from a domain nothing knows about -------- */

  const app = await context.newPage();
  await app.goto(`${APP}/dashboard`);
  await app.waitForFunction(() => document.getElementById('loaded')?.textContent === 'yes');
  // Resource-timing entries are added to the timeline asynchronously, a moment
  // after the fetch resolves. A real user clicks Connect long after the app has
  // settled; wait for the same state rather than racing it.
  await app.waitForFunction(
    () => performance.getEntriesByType('resource').some((e) => e.name.includes('/api/v1')),
    null,
    { timeout: 10000 }
  );

  response = await connectFromTab(worker, driver, `${APP}/dashboard`);

  check('connecting from the tab succeeds', response?.ok === true, JSON.stringify(response));
  check(
    'the API address was discovered from the page, not guessed',
    response?.data?.apiBaseUrl === API,
    JSON.stringify(response?.data)
  );
  check(
    'and the key was verified, not just stored',
    response?.data?.canWrite === true && typeof response?.data?.listCount === 'number',
    JSON.stringify(response?.data)
  );

  const stored = await worker.evaluate(() =>
    chrome.storage.local.get(['apiKey', 'apiBaseUrl', 'appUrl'])
  );
  check('a real key was stored', stored.apiKey === KEY, String(stored.apiKey).slice(0, 16));
  check('the discovered API address was stored', stored.apiBaseUrl === API, stored.apiBaseUrl);
  check('the app origin was remembered', stored.appUrl === APP, stored.appUrl);

  const minted = await fetch('http://127.0.0.1:3001/__minted-keys').then((r) => r.json());
  check('exactly one key was minted', minted.keys.length === 1, JSON.stringify(minted));
  check(
    'and it is named so it can be found and revoked later',
    /^Chrome extension \(/.test(minted.keys[0]?.name || ''),
    minted.keys[0]?.name
  );
  check('with the rate limit the extension needs', minted.keys[0]?.rate_limit === 100);

  const sync = await worker.evaluate(() => chrome.storage.sync.get(null));
  check('nothing went to storage.sync', Object.keys(sync).length === 0, JSON.stringify(sync));

  const dump = JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(null)));
  check(
    'the session token was used and discarded, never stored',
    !dump.includes('stand-in-session'),
    dump.slice(0, 160)
  );

  /* -------- the popup is past setup, with no key ever typed -------- */

  const popupErrors = [];
  const popup = await openExtensionPage(context, `chrome-extension://${extensionId}/popup/popup.html`, {
    init: (p) => p.on('pageerror', (err) => popupErrors.push(err.message)),
  });
  await popup.waitForTimeout(1500);
  check(
    'the popup goes straight to the main UI',
    await popup.locator('#setup').evaluate((node) => node.classList.contains('hidden'))
  );
  check('the popup raised no JS errors', popupErrors.length === 0, popupErrors.join(' | '));
  await popup.close();

  /* -------- the setup screen leads with the tab route -------- */

  await worker.evaluate(() => chrome.storage.local.remove('apiKey'));
  const fresh = await openExtensionPage(context, `chrome-extension://${extensionId}/popup/popup.html`);
  await fresh.waitForTimeout(900);
  check(
    'an unconnected popup shows the setup screen',
    !(await fresh.locator('#setup').evaluate((node) => node.classList.contains('hidden')))
  );
  check(
    'connecting from the tab is the primary action',
    await fresh.locator('#setup-connect-tab').isVisible()
  );
  check(
    'and pasting a key is demoted to a link',
    (await fresh.locator('#setup-open-options').textContent())?.includes('paste a key by hand')
  );
  await fresh.close();

  /* -------- an app that hasn't called its API yet still connects -------- */

  await fetch('http://127.0.0.1:3001/__reset');
  await worker.evaluate(
    (base) => chrome.storage.local.set({ apiBaseUrl: base, apiKey: '' }),
    API
  );

  const quiet = await context.newPage();
  await quiet.goto(`${APP}/quiet`);
  await quiet.waitForSelector('h1');
  const quietEntries = await quiet.evaluate(() =>
    performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/')).length
  );
  check('the quiet page really has nothing to discover', quietEntries === 0, String(quietEntries));

  response = await connectFromTab(worker, driver, `${APP}/quiet`);
  check(
    'it falls back to the configured API address rather than giving up',
    response?.ok === true && response.data.apiBaseUrl === API,
    JSON.stringify(response)
  );
  const quietMinted = await fetch('http://127.0.0.1:3001/__minted-keys').then((r) => r.json());
  check('and mints exactly one key doing it', quietMinted.keys.length === 1, JSON.stringify(quietMinted));
  await quiet.close();

  /* -------- a page Chrome will not read is explained -------- */

  const blank = await context.newPage();
  await blank.goto('about:blank');
  response = await connectFromTab(worker, driver, 'about:blank');
  check(
    'a page Chrome will not let us read is explained, not a raw failure',
    response?.ok === false && /Open your Sincerely app/i.test(response.error.message),
    JSON.stringify(response)
  );

  check('no uncaught worker errors', workerErrors.length === 0, workerErrors.join(' | '));
} finally {
  await context.close();
  appServer.close();
}

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  - ${failures.join('\n  - ')}`
    : '\ntab connect: all checks passed'
);
process.exit(failures.length ? 1 : 0);
