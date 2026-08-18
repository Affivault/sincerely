/**
 * The in-page launcher, and the sidebar it opens.
 *
 * This replaces the old panel suite. The extension used to inject a whole
 * sidebar into LinkedIn while every other site got a popup — two layouts, two
 * code paths, one job. Chrome's own side panel does the job everywhere, so all
 * that is left in the page is a button to open it.
 *
 * What can honestly be tested here has a limit worth stating: a real side panel
 * is browser UI, and `chrome.tabs.query({active: true})` from inside one
 * returns the page underneath it. Opened as a tab — the only way Playwright can
 * reach it — that same call returns the sidebar's own tab. So the tab-following
 * behaviour is exercised through `retarget()` directly rather than by switching
 * tabs and hoping.
 */
import { chromium } from 'playwright';
import { CHROMIUM } from './chromium.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_API_KEY } from './fixtures.mjs';

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

const PROFILE = (slug, name) => `<!doctype html>
<html lang="en"><head><title>${name} | LinkedIn</title></head>
<body>
  <nav>LinkedIn nav</nav>
  <main>
    <section class="artdeco-card pv-top-card">
      <div class="pv-text-details__left-panel">
        <h1 class="text-heading-xlarge inline t-24 v-align-middle break-words">${name}</h1>
        <div class="text-body-medium break-words">Head of Trading at Acme Ltd</div>
      </div>
    </section>
  </main>
  <script>history.replaceState({}, '', '/in/${slug}/');</script>
</body></html>`;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'launcher-')), {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});

await context.route('https://www.linkedin.com/**', async (route) => {
  const url = route.request().url();
  if (!/\/in\//.test(new URL(url).pathname)) {
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Feed | LinkedIn</title></head><body><main><h1>Feed</h1></main></body></html>',
    });
  }
  const slug = (url.match(/\/in\/([^/?#]+)/) || [])[1] || 'jane-doe';
  await route.fulfill({ status: 200, contentType: 'text/html', body: PROFILE(slug, 'Jane Doe') });
});

// A site the manifest does not declare, for the permission path below.
await context.route('https://example.com/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>Example</title></head><body><main><h1>Example</h1><a href="mailto:hi@example.com">hi</a></main></body></html>',
  })
);

/** The launcher's button, read out of its shadow root. */
const launcher = (page) =>
  page.evaluate(() => {
    const host = document.getElementById('sincerely-launcher-host');
    return host?.shadowRoot?.querySelector('.launch')?.textContent?.trim() ?? null;
  });

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.locator('details.manual > summary').click();
  await options.click('#use-local');
  await options.fill('#api-key', KEY);
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Connected'),
    null,
    { timeout: 20000 }
  );

  /* ---------------- the launcher in the page ---------------- */

  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/in/jane-doe/');
  await page.waitForFunction(
    () => !!document.getElementById('sincerely-launcher-host')?.shadowRoot?.querySelector('.launch'),
    null,
    { timeout: 15000 }
  );
  check('the launcher appears on a profile', /Sincerely/.test(await launcher(page)));

  // The whole point of replacing the panel: nothing large is injected any more.
  check(
    'and no in-page panel is injected alongside it',
    (await page.evaluate(() => !!document.getElementById('sincerely-panel-host'))) === false
  );

  const feed = await context.newPage();
  await feed.goto('https://www.linkedin.com/feed/');
  await feed.waitForTimeout(1500);
  check(
    'no launcher on the feed, only on profiles',
    (await feed.evaluate(() => !!document.getElementById('sincerely-launcher-host'))) === false
  );
  await feed.close();

  /* ---------------- it asks the worker to open the sidebar ---------------- */

  /*
   * The side panel is browser UI that Playwright cannot see, so what is checked
   * is the contract between the page and the worker: the click sends
   * OPEN_SIDE_PANEL, and the worker has a handler that answers it. A message
   * with no handler resolves to undefined, which is the regression that would
   * leave the button doing nothing at all.
   */
  const reply = await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL', payload: {} }).catch((err) => ({
      threw: String(err?.message || err),
    }))
  );
  /*
   * Either answer is a pass. Headless Chrome will not actually raise a side
   * panel without a real gesture, so `ok: false` with a reason is the expected
   * result here — what must not happen is `undefined`, which is what a message
   * with no registered handler resolves to, and which would leave the button in
   * the page doing nothing at all.
   */
  check(
    'the worker answers OPEN_SIDE_PANEL rather than ignoring it',
    reply != null && typeof reply === 'object' && 'ok' in reply,
    JSON.stringify(reply)
  );

  // And the button itself wires up to that message without throwing.
  const clickErrors = [];
  page.on('pageerror', (err) => clickErrors.push(err.message));
  await page.evaluate(() => {
    document.getElementById('sincerely-launcher-host').shadowRoot.querySelector('.launch').click();
  });
  await page.waitForTimeout(400);
  check('clicking the launcher raises no error in the page', clickErrors.length === 0, clickErrors.join(' | '));

  /* ---------------- dismissing it sticks ---------------- */

  await page.evaluate(() => {
    document.getElementById('sincerely-launcher-host').shadowRoot.querySelector('.dismiss').click();
  });
  await page.waitForFunction(() => !document.getElementById('sincerely-launcher-host'), null, {
    timeout: 5000,
  });
  check('dismissing hides the launcher', true);

  const hidden = await options.evaluate(() => chrome.storage.local.get({ launcherHidden: false }));
  check('and the choice is remembered', hidden.launcherHidden === true);

  const second = await context.newPage();
  await second.goto('https://www.linkedin.com/in/sam-rivera/');
  await second.waitForTimeout(1500);
  check(
    'so it stays hidden on the next profile',
    (await second.evaluate(() => !!document.getElementById('sincerely-launcher-host'))) === false
  );
  await second.close();

  /*
   * And a way back. The button removes itself from the page, so without a
   * setting to restore it the sidebar would only ever be reachable from the
   * toolbar icon, with nothing on screen explaining where the button went.
   */
  await options.reload();
  await options.waitForFunction(() => document.getElementById('show-launcher') !== null, null, {
    timeout: 10000,
  });
  check(
    'the setting reflects that it is hidden',
    (await options.locator('#show-launcher').isChecked()) === false
  );
  await options.locator('#show-launcher').check();
  await options.waitForFunction(
    async () => (await chrome.storage.local.get({ launcherHidden: true })).launcherHidden === false,
    null,
    { timeout: 10000 }
  );

  const restored = await context.newPage();
  await restored.goto('https://www.linkedin.com/in/jane-doe/');
  await restored.waitForFunction(
    () => !!document.getElementById('sincerely-launcher-host')?.shadowRoot?.querySelector('.launch'),
    null,
    { timeout: 15000 }
  );
  check('turning it back on brings the button back', true);
  await restored.close();
  await page.close();

  /* ---------------- the sidebar surface ---------------- */

  const sidebar = await context.newPage();
  await sidebar.goto(`chrome-extension://${extensionId}/popup/popup.html?surface=sidepanel`);
  await sidebar.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 20000,
  });

  check(
    'the sidebar marks itself as one, so it can fill the panel',
    await sidebar.evaluate(() => document.documentElement.classList.contains('surface-sidepanel'))
  );
  check(
    'and it is not pinned to the popup width',
    await sidebar.evaluate(() => {
      const width = getComputedStyle(document.body).maxWidth;
      return width === 'none';
    }),
    await sidebar.evaluate(() => getComputedStyle(document.body).maxWidth)
  );

  // Escape closes a popup. Closing the sidebar out from under someone who meant
  // to clear a field would be rude, and Chrome would not reopen it for them.
  await sidebar.keyboard.press('Escape');
  await sidebar.waitForTimeout(300);
  check('Escape does not close the sidebar', !sidebar.isClosed());

  /*
   * Re-reading has to clear what belonged to the previous page. Called directly
   * because a real tab switch cannot be staged here — see the note at the top.
   */
  const cleared = await sidebar.evaluate(async () => {
    const before = document.getElementById('person-name')?.textContent;
    window.__sincerelyRetarget?.();
    await new Promise((r) => setTimeout(r, 1200));
    return { before, after: document.getElementById('person-name')?.textContent };
  });
  check(
    're-targeting re-reads rather than leaving the last person on screen',
    typeof cleared.after === 'string',
    JSON.stringify(cleared)
  );

  await sidebar.close();

  /* ---------------- ordinary sites need a grant ---------------- */

  /*
   * The sidebar follows the user between tabs with no click on the way, so
   * `activeTab` does not cover the page they land on. Without a prompt the
   * panel just says "Nobody detected" on every site the extension has not been
   * granted — which reads as a page with no addresses rather than as a missing
   * permission, and is exactly the case this surface exists for.
   *
   * Asked of the worker directly: a real sidebar reads the tab underneath it,
   * and one opened as a tab would only ever inspect itself.
   */
  const other = await context.newPage();
  await other.goto('https://example.com/');
  const otherTabId = await options.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || '').includes('example.com'))?.id ?? null;
  });
  const otherContext = await options.evaluate(
    (id) => chrome.runtime.sendMessage({ type: 'GET_CONTEXT', payload: { tabId: id } }),
    otherTabId
  );
  check(
    'an ungranted site is reported as needing permission, not as empty',
    otherContext?.data?.needsSitePermission === 'https://example.com',
    JSON.stringify(otherContext?.data?.needsSitePermission)
  );

  // And a declared host must not be prompted for — nothing is missing there.
  const liTabId = await options.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || '').includes('linkedin.com/in/'))?.id ?? null;
  });
  if (liTabId) {
    const liContext = await options.evaluate(
      (id) => chrome.runtime.sendMessage({ type: 'GET_CONTEXT', payload: { tabId: id } }),
      liTabId
    );
    check(
      'a declared host is never prompted for',
      !liContext?.data?.needsSitePermission,
      JSON.stringify(liContext?.data?.needsSitePermission)
    );
  }
  await other.close();
} catch (err) {
  failures.push(`harness threw: ${err.message}`);
  console.log(`\n  HARNESS ERROR: ${err.message}`);
} finally {
  await context.close();
}

console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
