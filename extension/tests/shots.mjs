/**
 * Screenshot every surface in the states people actually meet, so the UI can be
 * judged rather than imagined.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCert } from './tls.mjs';
import { TEST_API_KEY } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(here, '..');
const OUT = process.env.SHOT_DIR || '/tmp/ui-shots';
const PORT = 3443;
mkdirSync(OUT, { recursive: true });

await fetch('http://localhost:3001/__reset');
const { spki } = await ensureCert();
const stub = spawn('node', [join(here, 'linkedin-stub.mjs')], {
  stdio: 'ignore',
  env: { ...process.env, LINKEDIN_STUB_PORT: String(PORT) },
});
process.on('exit', () => stub.kill());
await new Promise((r) => setTimeout(r, 900));

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'shot-')), {
  executablePath: '/opt/pw-browsers/chromium',
  channel: 'chromium',
  headless: true,
  deviceScaleFactor: 2,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    `--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:${PORT}`,
    `--ignore-certificate-errors-spki-list=${spki}`,
    '--no-proxy-server',
  ],
});

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
const id = new URL(worker.url()).host;

const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log('shot', name);
};

/* ---- options: before connecting ---- */
const options = await context.newPage();
await options.setViewportSize({ width: 780, height: 900 });
await options.goto(`chrome-extension://${id}/options/options.html`);
await options.waitForLoadState('domcontentloaded');
await options.waitForTimeout(400);
await shot(options, '01-options-fresh');

/* ---- popup: not connected ---- */
const setup = await context.newPage();
await setup.setViewportSize({ width: 400, height: 620 });
await setup.goto(`chrome-extension://${id}/popup/popup.html`);
await setup.waitForTimeout(900);
await shot(setup, '02-popup-setup');
await setup.close();

/* ---- connect ---- */
await options.locator('details.manual > summary').click();
await options.click('#use-local');
await options.fill('#api-key', TEST_API_KEY);
await options.click('#save');
await options.waitForFunction(
  () => document.getElementById('result')?.textContent?.includes('Connected'),
  null,
  { timeout: 25000 }
);
await options.waitForTimeout(300);
await shot(options, '03-options-connected');

/* ---- popup: nobody detected (opened on a blank tab) ---- */
const popup = await context.newPage();
await popup.setViewportSize({ width: 400, height: 700 });
await popup.goto(`chrome-extension://${id}/popup/popup.html`);
await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
  timeout: 15000,
});
await popup.waitForTimeout(1200);
await shot(popup, '04-popup-empty');

/* ---- popup: a known contact ---- */
await popup.fill('#email', 'jane.doe@acme.com');
await popup.waitForTimeout(1800);
await shot(popup, '05-popup-known');

/* ---- popup: an unknown address ---- */
await popup.fill('#email', 'brand.new@northwind.example.org');
await popup.waitForTimeout(1800);
await shot(popup, '06-popup-new');

/* ---- popup: an error ---- */
await popup.evaluate(() =>
  document.getElementById('status') &&
  chrome.runtime.sendMessage({ type: 'ADD_TO_LIST', payload: { listId: 'nope', person: { email: 'x@y.com' } } })
);
await popup.waitForTimeout(1200);
await shot(popup, '07-popup-error');
await popup.close();

/* ---- LinkedIn panel ---- */
const li = await context.newPage();
await li.setViewportSize({ width: 1280, height: 900 });
await li.goto('https://www.linkedin.com/in/priya-raman/');
await li.waitForTimeout(6000);
await shot(li, '08-linkedin-panel');
await li.close();

await context.close();
stub.kill();
console.log('done ->', OUT);
