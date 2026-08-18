/**
 * One-click connect: the app hands the extension a key over postMessage.
 *
 * Drives a stand-in for the app's Webhooks → API keys page, served at
 * http://localhost:5173 (a declared match in the manifest, so content/connect.js
 * really runs) via route interception. Checks the relay both ways, the shape
 * guard, the source guard, and that the options page notices the arrival.
 */
import { chromium } from 'playwright';
import { CHROMIUM } from './chromium.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOSTILE_API_KEY, TEST_API_KEY } from './fixtures.mjs';
const KEY = TEST_API_KEY;

await fetch('http://localhost:3001/__reset');

const EXT_PATH = fileURLToPath(new URL('..', import.meta.url));
const API = 'http://localhost:3001/api/v1';
const APP = 'http://localhost:5173';

const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Stands in for DeveloperPage's API keys tab: it pings for the extension,
 * shows the button only if something answered, and records every reply.
 */
const APP_PAGE = `<!doctype html><html><head><title>Sincerely — Webhooks</title></head><body>
  <h1>API keys</h1>
  <div id="present">absent</div>
  <button id="connect">Connect extension</button>
  <pre id="log"></pre>
  <script>
    window.__replies = [];
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'SINCERELY_EXTENSION_HERE') {
        document.getElementById('present').textContent = 'present ' + event.data.version;
      }
      if (event.data.type === 'SINCERELY_EXTENSION_CONNECTED') {
        window.__replies.push(event.data);
        document.getElementById('log').textContent = JSON.stringify(event.data);
      }
    });
    window.postMessage({ type: 'SINCERELY_EXTENSION_PING' }, window.location.origin);
    document.getElementById('connect').addEventListener('click', () => {
      window.postMessage(
        { type: 'SINCERELY_EXTENSION_CONNECT', apiKey: window.__key, apiBaseUrl: ${JSON.stringify(API)} },
        window.location.origin
      );
    });
  </script>
</body></html>`;

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-connect-'));

const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});

// Serve the stand-in app from the origin the manifest declares, so the content
// script is injected exactly as it would be in production.
await context.route(`${APP}/**`, (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: APP_PAGE })
);

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  const workerErrors = [];
  context.on('weberror', (e) => workerErrors.push(e.error().message));

  /* ---------------- presence ---------------- */

  const app = await context.newPage();
  const appErrors = [];
  app.on('pageerror', (err) => appErrors.push(err.message));
  await app.goto(`${APP}/developer`);
  await app.waitForFunction(() => document.getElementById('present')?.textContent !== 'absent', null, {
    timeout: 10000,
  });
  check(
    'the extension announces itself, so the app can show the button',
    /^present \d/.test(await app.textContent('#present')),
    await app.textContent('#present')
  );
  check('the app page raised no JS errors', appErrors.length === 0, appErrors.join(' | '));

  /* ---------------- a bad key is refused, with a reason ---------------- */

  await app.evaluate(() => {
    window.__key = 'sk_live_1234abcd••••••••';
  });
  await app.click('#connect');
  await app.waitForFunction(() => window.__replies.length === 1, null, { timeout: 10000 });
  let reply = await app.evaluate(() => window.__replies.at(-1));
  check('a masked key is refused rather than stored', reply.ok === false, JSON.stringify(reply));
  check('and the refusal says what is wrong', /shape/.test(reply.error || ''), reply.error);

  const afterBad = await worker.evaluate(() => chrome.storage.local.get('apiKey'));
  check('nothing was written for the bad key', !afterBad.apiKey, JSON.stringify(afterBad));

  /* ---------------- another window cannot inject a key ---------------- */

  await app.evaluate(
    (key) =>
      new Promise((resolve) => {
        const frame = document.createElement('iframe');
        frame.srcdoc = `<script>parent.postMessage({type:'SINCERELY_EXTENSION_CONNECT',apiKey:${JSON.stringify(
          key
        )}},'*')<\/script>`;
        frame.onload = () => setTimeout(resolve, 500);
        document.body.appendChild(frame);
      }),
    HOSTILE_API_KEY
  );
  const afterFrame = await worker.evaluate(() => chrome.storage.local.get('apiKey'));
  check(
    'a key posted from an iframe is ignored',
    !afterFrame.apiKey,
    JSON.stringify(afterFrame)
  );

  /* ---------------- the real thing ---------------- */

  // Open the options page first: it should react to the key arriving in another
  // tab, which is the whole point of doing this from the app.
  const options = await context.newPage();
  const optionsErrors = [];
  options.on('pageerror', (err) => optionsErrors.push(err.message));
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.waitForLoadState('domcontentloaded');

  await app.bringToFront();
  await app.evaluate((key) => {
    window.__key = key;
  }, KEY);
  await app.click('#connect');
  await app.waitForFunction(() => window.__replies.length === 2, null, { timeout: 30000 });
  reply = await app.evaluate(() => window.__replies.at(-1));

  check('the key is accepted', reply.ok === true, JSON.stringify(reply));
  check('the extension reports it saved the key', reply.saved === true, JSON.stringify(reply));
  check(
    'and reports what the key can actually do, not just "sent"',
    reply.canWrite === true && typeof reply.listCount === 'number',
    JSON.stringify(reply)
  );

  const stored = await worker.evaluate(() =>
    chrome.storage.local.get(['apiKey', 'apiBaseUrl', 'appUrl'])
  );
  check('the key is stored', stored.apiKey === KEY);
  check('the API URL came across with it', stored.apiBaseUrl === API, stored.apiBaseUrl);
  check('the app URL is remembered for deep links', stored.appUrl === APP, stored.appUrl);

  const sync = await worker.evaluate(() => chrome.storage.sync.get(null));
  check('nothing was written to storage.sync', Object.keys(sync).length === 0, JSON.stringify(sync));

  /* ---------------- the options page notices ---------------- */

  await options.bringToFront();
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Connected'),
    null,
    { timeout: 30000 }
  );
  const result = await options.textContent('#result');
  check('the options page confirms without being touched', /Connected\./.test(result), result);
  check(
    'and says there is nothing left to do',
    /Nothing else to do/.test(result),
    result
  );
  check(
    'the result reads as success, not a warning',
    (await options.locator('#result').getAttribute('class')).includes('success')
  );
  check('the saved key is shown as saved, never rendered back', await options.evaluate(() => {
    const field = document.getElementById('api-key');
    return field.value === '' && field.placeholder.includes('(saved)');
  }));
  check('the options page raised no JS errors', optionsErrors.length === 0, optionsErrors.join(' | '));

  /* ---------------- the popup is past setup now ---------------- */

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(1200);
  check(
    'the popup no longer asks for setup',
    await popup.locator('#setup').evaluate((node) => node.classList.contains('hidden'))
  );

  /* ---------------- an API proxied under the app's own origin ---------------- */

  /*
   * The deployment shape that broke this. VITE_API_URL is legitimately
   * relative when the API is served under the app's own origin, so the app
   * published "/api/v1" — which the extension could make no sense of, dropped
   * without a word, and replaced with the host baked into its own defaults.
   * The handshake still reported success, because the key really was minted;
   * every request after it went to a server the account does not exist on.
   */
  // Serve the mock API under the app's origin, the way a rewrite would.
  await context.route(`${APP}/api/v1/**`, async (route) => {
    const request = route.request();
    const headers = request.headers();
    const upstream = await fetch(request.url().replace(APP, 'http://localhost:3001'), {
      method: request.method(),
      // Only the headers the API actually reads — forwarding Host/Origin
      // wholesale is rejected by undici.
      headers: {
        ...(headers.authorization ? { Authorization: headers.authorization } : {}),
        'Content-Type': 'application/json',
      },
      body: ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postData() ?? undefined,
    });
    await route.fulfill({
      status: upstream.status,
      contentType: upstream.headers.get('content-type') || 'application/json',
      body: await upstream.text(),
    });
  });

  await app.bringToFront();
  // Posted straight rather than through the button, which already carries a
  // listener sending the absolute URL — one click would fire both.
  await app.evaluate((key) => {
    window.postMessage(
      { type: 'SINCERELY_EXTENSION_CONNECT', apiKey: key, apiBaseUrl: '/api/v1' },
      window.location.origin,
    );
  }, KEY);
  await app.waitForFunction(() => window.__replies.length === 3, null, { timeout: 30000 });
  const relative = await app.evaluate(() => window.__replies.at(-1));
  const afterRelative = await worker.evaluate(() => chrome.storage.local.get('apiBaseUrl'));

  check(
    'a relative API URL resolves against the app, not the extension default',
    afterRelative.apiBaseUrl === `${APP}/api/v1`,
    afterRelative.apiBaseUrl,
  );
  check(
    'and the connection genuinely works from there',
    relative.ok === true && typeof relative.listCount === 'number',
    JSON.stringify(relative),
  );

  check('no uncaught worker errors', workerErrors.length === 0, workerErrors.join(' | '));
} finally {
  await context.close();
}

console.log(
  failures.length ? `\n${failures.length} failed:\n  - ${failures.join('\n  - ')}` : '\nconnect: all checks passed'
);
process.exit(failures.length ? 1 : 0);
