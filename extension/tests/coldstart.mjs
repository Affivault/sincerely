/**
 * Cold-start behaviour, the way a spun-down free-tier host actually behaves:
 * the request is answered, but only after a delay longer than the normal
 * timeout.
 *
 * Two paths matter:
 *  A. The options page's connection test, which is given a long budget up
 *     front and should simply wait the server out.
 *  B. Ordinary requests (the popup), which use the short timeout and must
 *     recover via the automatic retry.
 */
import { chromium } from 'playwright';
import { CHROMIUM } from './chromium.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_API_KEY } from './fixtures.mjs';
const KEY = TEST_API_KEY;

// Start from the fixture every run — the mock is stateful.
await fetch('http://localhost:3001/__reset');

const EXT_PATH = fileURLToPath(new URL('..', import.meta.url));
const DELAY_MS = 25000; // > the 20s normal timeout, < the 75s cold-start budget

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'cold-')), {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});

let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
};

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;

  /* ---- A. connection test waits out a slow wake-up ---- */

  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options/options.html`);
  await options.waitForLoadState('domcontentloaded');

  await options.evaluate((ms) => fetch(`http://localhost:3001/__arm-cold-start?delayMs=${ms}`), DELAY_MS);
  // Manual key entry is the fallback path now, collapsed behind a <details>.
  await options.locator('details.manual > summary').click();
  await options.click('#use-local');
  await options.fill('#api-key', KEY);

  const startedA = Date.now();
  await options.click('#save');

  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Contacting'),
    null,
    { timeout: 5000 }
  );
  check('progress message appears immediately, before the wait', true);
  check(
    'progress message warns about the wake-up delay',
    /up to a minute/.test(await options.textContent('#result'))
  );

  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Connected'),
    null,
    { timeout: 90000 }
  );
  const elapsedA = Date.now() - startedA;

  check('connection test survives a 25s cold start', true, `${Math.round(elapsedA / 1000)}s`);
  check(
    'it waited rather than failing at the 20s mark',
    elapsedA > 20000,
    `${Math.round(elapsedA / 1000)}s`
  );
  check(
    'result is success, not an error',
    (await options.locator('#result').getAttribute('class')).includes('success'),
    await options.textContent('#result')
  );

  /* ---- B. ordinary requests recover via the retry ---- */

  await options.evaluate((ms) => fetch(`http://localhost:3001/__arm-cold-start?delayMs=${ms}`), DELAY_MS);

  const popup = await context.newPage();
  const startedB = Date.now();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 20000,
  });

  // The popup's campaign fetch uses the short timeout, so this can only
  // succeed if the automatic retry fired after the first attempt aborted.
  await popup.waitForFunction(
    () => document.querySelectorAll('.campaign-option:not([disabled])').length > 0,
    null,
    { timeout: 90000 }
  );
  const elapsedB = Date.now() - startedB;

  const pickerOk = (await popup.locator('.campaign-option:not([disabled])').count()) > 0;
  check('popup recovers from a cold start via the retry', pickerOk, `${Math.round(elapsedB / 1000)}s`);
  check(
    'recovery took longer than the first 20s attempt',
    elapsedB > 20000,
    `${Math.round(elapsedB / 1000)}s`
  );
  check(
    'no error was shown to the user',
    await popup.locator('#status').isHidden(),
    await popup.textContent('#status')
  );

  const stats = await options.evaluate(() =>
    fetch('http://localhost:3001/__cold-start-stats').then((r) => r.json())
  );
  check('the mock delayed both armed requests', stats.delayed === 2, JSON.stringify(stats));
} catch (err) {
  check('harness completed', false, err.message);
} finally {
  await context.close();
}

process.exit(failed ? 1 : 0);
