/**
 * What the popup does when things go wrong.
 *
 * popup.js is the largest file in the extension and the least covered.
 * smoke.mjs walks the path where everything works, which is the path that
 * needed the least help — most of what this file actually contains is the
 * other branches: a key that has been revoked, a scope it does not carry, a
 * lookup that fails halfway, a person who is suppressed, a near-duplicate
 * worth mentioning before an add rather than after.
 *
 * Those branches are what the user meets on a bad day, and none of them could
 * be reached against a mock that always says yes. The mock now arms a failure
 * on any endpoint for a set number of calls, so each one can be walked into
 * deliberately.
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

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-popup-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});

/** The status strip's current text, or '' when it is hidden. */
const statusText = (page) =>
  page.evaluate(() => {
    const node = document.getElementById('status');
    return node && !node.classList.contains('hidden') ? (node.textContent || '').trim() : '';
  });

/** Wait for the status strip to say something matching `pattern`. */
async function waitForStatus(page, pattern, timeout = 15000) {
  try {
    await page.waitForFunction(
      (source) => {
        const node = document.getElementById('status');
        if (!node || node.classList.contains('hidden')) return false;
        return new RegExp(source, 'i').test(node.textContent || '');
      },
      pattern.source,
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  /* ================================================================ */
  /* With no key at all                                               */
  /* ================================================================ */

  const cold = await context.newPage();
  const coldErrors = [];
  cold.on('pageerror', (err) => coldErrors.push(err.message));
  await cold.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await cold.waitForFunction(() => !document.getElementById('setup')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });

  check('with no key, setup is what you get', await cold.locator('#setup').isVisible());
  check('and the working surface is out of the way', await cold.locator('#main').isHidden());
  check('the unconfigured popup raises no JS errors', coldErrors.length === 0, coldErrors.join(' | '));
  await cold.close();

  /* ================================================================ */
  /* Connected, then made to fail in specific ways                    */
  /* ================================================================ */

  await worker.evaluate(
    ([key, api]) => chrome.storage.local.set({ apiKey: key, apiBaseUrl: api }),
    [KEY, API],
  );

  const popup = await context.newPage();
  const popupErrors = [];
  popup.on('pageerror', (err) => popupErrors.push(err.message));
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });

  /* ---------------- a lookup that fails ---------------- */

  await fetch(`${MOCK}/__arm-failure?path=/contacts&method=GET&status=500&times=3`);
  await popup.fill('#email', 'jane.doe@acme.com');
  await popup.locator('#email').blur();

  const sawLookupError = await waitForStatus(popup, /deliberate|failed|error|could ?n.t/i);
  check('a failed lookup is shown, not swallowed', sawLookupError, await statusText(popup));
  check(
    'and the popup is still usable afterwards, not stuck mid-lookup',
    await popup.locator('#email').isEditable(),
  );

  /* ---------------- a key without the write scope ---------------- */

  await fetch(`${MOCK}/__reset`);
  await popup.reload();
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });
  await popup.fill('#email', 'scoped.person@northwind.example.org');
  await popup.locator('#email').blur();
  await popup.waitForTimeout(1200);

  // Refuse the write itself, the way the server does for a read-only key.
  await fetch(`${MOCK}/__arm-failure?path=/contacts&method=POST&status=403&scope=write&times=3`);
  await popup.click('#add');

  const sawScope = await waitForStatus(popup, /scope/i);
  check('a read-only key says so, in the words the server used', sawScope, await statusText(popup));
  check(
    'and it offers a way into settings, because that is where the fix is',
    await popup.locator('#status .status-action').count() > 0,
    await statusText(popup),
  );

  /* ---------------- a revoked key ---------------- */

  await fetch(`${MOCK}/__reset`);
  await popup.reload();
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });
  await fetch(`${MOCK}/__arm-failure?path=/contacts&status=401&message=Invalid or expired API key&times=5`);
  await popup.fill('#email', 'revoked.check@northwind.example.org');
  await popup.locator('#email').blur();

  const sawAuth = await waitForStatus(popup, /invalid|expired/i);
  check('a revoked key is named as an auth problem', sawAuth, await statusText(popup));
  check(
    'which is the case that earns a settings button',
    await popup.locator('#status .status-action').count() > 0,
  );

  /* ---------------- somebody already suppressed ---------------- */

  await fetch(`${MOCK}/__reset`);
  await fetch(`${MOCK}/api/v1/suppression`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ email: 'jane.doe@acme.com', reason: 'manual' }),
  });
  await popup.reload();
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });
  await popup.fill('#email', 'jane.doe@acme.com');
  await popup.locator('#email').blur();

  const suppressedShown = await popup
    .waitForFunction(
      () => document.getElementById('suppress')?.textContent?.includes('Already suppressed'),
      null,
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  check('a suppressed person is labelled as such', suppressedShown, await popup.textContent('#suppress'));
  check(
    'and cannot be suppressed twice',
    await popup.locator('#suppress').isDisabled(),
  );

  /* ---------------- the same human under another address ---------------- */

  await fetch(`${MOCK}/__reset`);
  await popup.reload();
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });
  // Jane Doe is in the fixture as jane.doe@acme.com. Same name, new address:
  // the near-match is worth saying before the second record is created.
  await popup.fill('#email', 'j.doe@acme.com');
  await popup.fill('#first-name', 'Jane');
  await popup.fill('#last-name', 'Doe');
  await popup.locator('#last-name').blur();

  const dupShown = await popup
    .waitForFunction(() => !document.getElementById('duplicate')?.classList.contains('hidden'), null, {
      timeout: 15000,
    })
    .then(() => true)
    .catch(() => false);
  check('a near-match under another address is surfaced', dupShown, await popup.textContent('#duplicate'));
  check(
    'it names the address already held',
    (await popup.textContent('#dup-email'))?.includes('jane.doe@acme.com'),
    await popup.textContent('#dup-email'),
  );
  check(
    'and it is a statement, not a barrier — adding is still available',
    await popup.locator('#add').isEnabled(),
  );

  /* ---------------- an address the form itself rejects ---------------- */

  await popup.fill('#email', 'not-an-address');
  check(
    'a malformed address disables the add rather than sending it',
    await popup.locator('#add').isDisabled(),
    await popup.inputValue('#email'),
  );

  /* ---------------- an add that fails ---------------- */

  await fetch(`${MOCK}/__reset`);
  await popup.reload();
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });
  await popup.fill('#email', 'jane.doe@acme.com');
  await popup.locator('#email').blur();
  await popup.waitForTimeout(1200);

  await fetch(`${MOCK}/__arm-failure?path=/lists/&method=POST&status=500&message=List write failed&times=3`);
  await popup.click('#add');

  const sawAddFailure = await waitForStatus(popup, /list write failed|failed/i);
  check('a failed add says so', sawAddFailure, await statusText(popup));
  check(
    'and the button comes back rather than sticking on "Adding…"',
    await popup.locator('#add').isEnabled()
      && !(await popup.textContent('#add-label'))?.includes('Adding'),
    await popup.textContent('#add-label'),
  );

  /* ---------------- a slow lookup overtaken by a newer one ---------------- */

  await fetch(`${MOCK}/__reset`);
  await popup.reload();
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });

  // Hold the first lookup open, then type a different address over the top.
  // The slow answer must not land on a form that has moved on — a stale reply
  // winning would put one person's history against another's address, which is
  // the worst thing this panel can get wrong.
  await fetch(`${MOCK}/__arm-cold-start?delayMs=2500`);
  await popup.fill('#email', 'jane.doe@acme.com');
  await popup.locator('#email').blur();
  await popup.waitForTimeout(200);
  await popup.fill('#email', 'nobody.at.all@northwind.example.org');
  await popup.locator('#email').blur();
  await popup.waitForTimeout(4000);

  const strandedName = await popup.textContent('#person-name');
  check(
    'a stale lookup does not overwrite the address that replaced it',
    !String(strandedName || '').includes('Jane'),
    `panel shows "${strandedName}" for nobody.at.all@…`,
  );
  check(
    'and the field still holds what was typed last',
    (await popup.inputValue('#email')) === 'nobody.at.all@northwind.example.org',
    await popup.inputValue('#email'),
  );

  /* ---------------- nothing raised an exception along the way -------- */

  check('none of these branches threw', popupErrors.length === 0, popupErrors.join(' | '));
} finally {
  await context.close();
}

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  - ${failures.join('\n  - ')}`
    : `\npopup-errors: all ${passed} checks passed`,
);
process.exit(failures.length ? 1 : 0);
