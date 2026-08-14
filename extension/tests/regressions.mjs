/**
 * Regressions for six bugs that shipped and were found by reading the code
 * rather than by any test failing. Each one had a plausible-looking
 * implementation, which is why none of them were noticed.
 *
 * Needs `mock-api.mjs` on :3001 and the LinkedIn stub. `run.mjs` starts both.
 */
import { chromium } from 'playwright';
import { CHROMIUM } from './chromium.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCert } from './tls.mjs';
import { TEST_API_KEY, TEST_AUTH } from './fixtures.mjs';

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
  executablePath: CHROMIUM,
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
   * A deep read that is still running when the user moves on must not stop the
   * next profile getting one of its own. This used to be a fault in the in-page
   * panel's `deepen()`, which bailed whenever a read was already in flight and
   * had nothing to re-trigger it afterwards; with the panel replaced by the
   * sidebar the concurrency lives in the scraper, so it is driven straight
   * through DEEP_SCRAPE here rather than through a UI that no longer exists.
   */
  const profile = await context.newPage();
  await profile.goto('https://www.linkedin.com/in/priya-raman/');
  await profile.waitForLoadState('domcontentloaded');

  const profileTabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || '').includes('priya-raman'))?.id ?? null;
  });

  // Start the first profile's read and deliberately leave it running.
  const firstRead = worker.evaluate(
    (id) => chrome.tabs.sendMessage(id, { type: 'SINCERELY_SCRAPE_DEEP' }).catch(() => null),
    profileTabId
  );

  /*
   * Move to another profile the way LinkedIn does — pushState and a DOM swap,
   * with no document reload. That distinction is the whole test: a full
   * navigation tears down the content script and takes the in-flight state with
   * it, so the bug cannot reproduce.
   */
  await profile.evaluate(() => {
    history.pushState({}, '', '/in/quiet-profile/');
    const main = document.querySelector('main');
    main.querySelector('h1').textContent = 'Quiet Profile';
    main.querySelector('#ci').setAttribute('href', '/in/quiet-profile/overlay/contact-info/');
  });

  let second = null;
  for (let i = 0; i < 20 && !second?.email; i += 1) {
    second = await worker.evaluate(
      (id) => chrome.tabs.sendMessage(id, { type: 'SINCERELY_SCRAPE_DEEP' }).catch(() => null),
      profileTabId
    );
    if (!second?.email) await profile.waitForTimeout(400);
  }
  await firstRead;

  check(
    'a profile opened during another profile’s deep read still gets its address',
    second?.email === ADDRESS,
    second?.email || 'none'
  );
  await profile.close();

  /* ================================================================ */
  /* 1b. No button to click, and it still finds the address           */
  /* ================================================================ */

  /*
   * The reported failure, reproduced exactly: a profile with no contact-info
   * anchor anywhere in the markup, a dead legacy endpoint, and the address
   * nowhere in the document. Every route the extension had came up empty and it
   * declared "no email" for somebody who plainly had one — the user had to open
   * Contact info by hand and leave it on screen.
   *
   * The way in is LinkedIn's own router: the overlay is a route, so pushing its
   * URL makes the app open the dialog itself. Nothing is clicked, so nothing can
   * be mis-clicked.
   */
  const router = await context.newPage();
  await router.goto('https://www.linkedin.com/in/router-only/');
  await router.waitForLoadState('domcontentloaded');

  check(
    'the fixture really has no contact-info link to click',
    (await router.locator('a[href*="overlay/contact-info"]').count()) === 0
  );
  check(
    'and no address anywhere in the document',
    !/dana\.okafor@/.test(await router.evaluate(() => document.body.innerText))
  );

  const routerTabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || '').includes('router-only'))?.id ?? null;
  });

  let routerDeep = null;
  for (let i = 0; i < 20 && !routerDeep?.person?.email; i += 1) {
    routerDeep = await worker.evaluate(
      async (id) => {
        try {
          return { person: await chrome.tabs.sendMessage(id, { type: 'SINCERELY_SCRAPE_DEEP' }) };
        } catch {
          return null;
        }
      },
      routerTabId
    );
    if (!routerDeep?.person?.email) await router.waitForTimeout(500);
  }

  check(
    'the address is found with no button pressed and nothing visible on screen',
    routerDeep?.person?.email === 'dana.okafor@northwind.example.org',
    routerDeep?.person?.email || 'none'
  );

  await router.waitForTimeout(600);
  const routerState = await router.evaluate(() => ({
    url: location.pathname,
    host: location.hostname,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    locked: getComputedStyle(document.body).overflowY === 'hidden',
    styles: document.querySelectorAll('style[data-sincerely]').length,
  }));

  check('the profile URL is put back afterwards', routerState.url === '/in/router-only/', routerState.url);
  /*
   * The fixture's own dismiss calls history.back(), and so did the restore —
   * two backs took the page off the profile entirely and landed on about:blank,
   * the content script with it. Stepping back is now guarded on still being
   * parked on the overlay URL, not on who opened it.
   */
  check(
    'and the user is still on LinkedIn, not one entry further back than they ever were',
    routerState.host === 'www.linkedin.com',
    routerState.host
  );
  check('the dialog it opened is closed again', routerState.dialogs === 0, String(routerState.dialogs));
  check('and the page is left unlocked', !routerState.locked);
  check('with none of our stylesheet left behind', routerState.styles === 0, String(routerState.styles));
  await router.close();

  /* ================================================================ */
  /* 1c. The address exists only in LinkedIn's own network traffic    */
  /* ================================================================ */

  /*
   * The hardest case and the one the reports keep describing: no contact-info
   * link, nothing in the markup, no dialog, and no endpoint of ours that
   * answers. The address is in exactly one place — a JSON response the page
   * fetches for itself, which is what LinkedIn does for profiles whose address
   * you are allowed to see.
   *
   * Every markup-reading and endpoint-guessing route fails here. Only reading
   * LinkedIn's own traffic finds it, and it finds it with nothing clicked and
   * nothing opened.
   */
  const tap = await context.newPage();
  await tap.goto('https://www.linkedin.com/in/tap-only/');
  await tap.waitForLoadState('domcontentloaded');

  check(
    'the fixture has no contact-info link',
    (await tap.locator('a[href*="overlay/contact-info"]').count()) === 0
  );
  check(
    'and the address is nowhere in the document',
    !/marcus\.webb@/.test(await tap.evaluate(() => document.documentElement.outerHTML))
  );

  const tapTabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || '').includes('tap-only'))?.id ?? null;
  });

  let tapped = null;
  for (let i = 0; i < 20 && !tapped?.person?.email; i += 1) {
    tapped = await worker.evaluate(
      async (id) => {
        try {
          return { person: await chrome.tabs.sendMessage(id, { type: 'SINCERELY_SCRAPE_DEEP' }) };
        } catch {
          return null;
        }
      },
      tapTabId
    );
    if (!tapped?.person?.email) await tap.waitForTimeout(400);
  }

  check(
    'the address is found from LinkedIn’s own response, with nothing clicked',
    tapped?.person?.email === 'marcus.webb@northwind.example.org',
    tapped?.person?.email || 'none'
  );

  const tapState = await tap.evaluate(() => ({
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    locked: getComputedStyle(document.body).overflowY === 'hidden',
    path: location.pathname,
  }));
  check('no dialog was opened to get it', tapState.dialogs === 0, String(tapState.dialogs));
  check('the page was not locked', !tapState.locked);
  check('and the user stayed on the profile', tapState.path === '/in/tap-only/', tapState.path);
  await tap.close();

  /* ================================================================ */
  /* 1b. The link that renders late — the actual production failure   */
  /* ================================================================ */

  /*
   * The bug four fixes missed, because every fixture until now put the Contact
   * info link in the initial HTML and real LinkedIn does not.
   *
   * LinkedIn draws the top card client-side, after `document_idle`. The scraper
   * looked for the link once, at the first possible moment, found nothing, and
   * cached "this profile has no contact info" for the life of the tab — so no
   * later attempt ever ran, however many times the page mutated. The address
   * then only ever appeared when the user opened Contact info themselves, which
   * is the complaint word for word.
   *
   * The deep read here is issued immediately on load, exactly as the panel
   * issues it, with no retry loop to paper over the failure: a build that looks
   * once gets `none`.
   */
  const late = await context.newPage();
  await late.goto('https://www.linkedin.com/in/late-anchor/');
  await late.waitForLoadState('domcontentloaded');

  check(
    'the contact-info link is genuinely absent when the scrape starts',
    (await late.locator('a[href*="overlay/contact-info"]').count()) === 0
  );
  check(
    'and nothing readable on the page carries the address yet',
    await late.evaluate(
      () =>
        !/nadia\.hassan@/.test(document.body.innerText || '') &&
        document.querySelectorAll('a[href^="mailto:"]').length === 0
    )
  );

  const lateTabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || '').includes('late-anchor'))?.id ?? null;
  });

  // One deep read, started now, awaited to completion. No polling.
  const lateRead = await worker.evaluate(async (id) => {
    try {
      return await chrome.tabs.sendMessage(id, { type: 'SINCERELY_SCRAPE_DEEP' });
    } catch {
      return null;
    }
  }, lateTabId);

  check(
    'the address is found on a profile whose link renders late, with nothing clicked by hand',
    lateRead?.email === 'nadia.hassan@northwind.example.org',
    lateRead?.email || 'none'
  );

  const lateState = await late.evaluate(() => ({
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    locked: getComputedStyle(document.body).overflowY === 'hidden',
    path: location.pathname,
  }));
  check('the dialog it opened was closed again', lateState.dialogs === 0, String(lateState.dialogs));
  check('the page was left scrollable', !lateState.locked);
  check('and the user stayed on the profile', lateState.path === '/in/late-anchor/', lateState.path);

  // The answer is kept: a second read must not reopen the dialog on a profile
  // already resolved. (Failures are retried; successes are not.)
  const opensBefore = await late.evaluate(() => window.__dialogOpens);
  const lateAgain = await worker.evaluate(async (id) => {
    try {
      return await chrome.tabs.sendMessage(id, { type: 'SINCERELY_SCRAPE_DEEP' });
    } catch {
      return null;
    }
  }, lateTabId);
  check(
    'asking again returns the same address without reopening anything',
    lateAgain?.email === 'nadia.hassan@northwind.example.org' &&
      (await late.evaluate(() => window.__dialogOpens)) === opensBefore,
    `${lateAgain?.email || 'none'}, opens ${opensBefore}→${await late.evaluate(() => window.__dialogOpens)}`
  );
  await late.close();

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

  /* ================================================================ */
  /* 6. The destination dropdown                                      */
  /* ================================================================ */

  await popup.fill('#email', 'jane.doe@acme.com');
  await popup.waitForTimeout(1600);

  check('the dropdown starts closed', await popup.locator('#list-pop').isHidden());

  await popup.click('#list-trigger');
  check('the trigger opens it', await popup.locator('#list-pop').isVisible());
  check(
    'and marks lists they are already on, before the choice is made',
    (await popup.locator('.campaign-option.is-member .on-it').count()) >= 1,
    String(await popup.locator('.campaign-option.is-member .on-it').count())
  );

  await popup.keyboard.press('Escape');
  check('Escape closes it', await popup.locator('#list-pop').isHidden());

  await popup.click('#list-trigger');
  await popup.click('#person-name');
  check('clicking away closes it', await popup.locator('#list-pop').isHidden());

  /*
   * Picking a destination is not the same act as adding somebody to it. Firing
   * the add straight off a list row made the dropdown behave like a trapdoor —
   * you opened it to look and it committed on the way past.
   */
  await popup.click('#list-trigger');
  const rows = popup.locator('.campaign-option:not(.is-member)');
  const wanted = ((await rows.first().locator('.campaign-option-name').textContent()) || '').trim();
  await rows.first().click();

  check('choosing a list closes the dropdown', await popup.locator('#list-pop').isHidden());
  check(
    'and sets the destination without adding anybody',
    (await popup.textContent('#list-trigger-name')).trim() === wanted,
    `${await popup.textContent('#list-trigger-name')} vs ${wanted}`
  );
  check(
    'the button is a plain verb, not a second copy of the destination',
    (await popup.textContent('#add-label')).trim() === 'Add',
    await popup.textContent('#add-label')
  );
  check(
    'and it says where it will go on hover, without shouting it twice on screen',
    ((await popup.getAttribute('#add', 'title')) || '').includes(wanted),
    await popup.getAttribute('#add', 'title')
  );


  /* ================================================================ */
  /* 7. A fresh account can make its first list from here             */
  /* ================================================================ */

  /*
   * "No lead lists on this account yet. Create one in Sincerely first." was the
   * whole of the empty state — a dead end in a popup, from a tool whose entire
   * job is putting people on lists. Worse, the trigger was disabled when the
   * list was empty, so there was nothing pressable anywhere on the screen.
   */
  await popup.click('#list-trigger');
  check('the destination opens even with lists present', await popup.locator('#list-pop').isVisible());
  check('and offers a way to make a new one', await popup.locator('#new-list-name').isVisible());

  const madeName = `Trade show ${Date.now() % 100000}`;
  await popup.fill('#new-list-name', madeName);
  await popup.click('#new-list-create');

  await popup.waitForTimeout(2500);
  console.log('DEBUG status:', await popup.textContent('#status').catch(() => 'n/a'));
  console.log('DEBUG trigger:', await popup.textContent('#list-trigger-name'));
  await popup.waitForFunction(
    (wanted) => document.getElementById('list-trigger-name')?.textContent?.trim() === wanted,
    madeName,
    { timeout: 15000 }
  );
  check('creating a list selects it as the destination', true);
  check('and closes the picker', await popup.locator('#list-pop').isHidden());
  check(
    'and the button offers to add to it',
    (await popup.textContent('#add-label')).trim() === 'Add' &&
      ((await popup.getAttribute('#add', 'title')) || '').includes(madeName),
    await popup.getAttribute('#add', 'title')
  );

  const listsNow = await popup.evaluate((auth) =>
    fetch('http://localhost:3001/api/v1/lists', { headers: { Authorization: auth } }).then((r) => r.json()),
    TEST_AUTH
  );
  check(
    'the list really exists on the account',
    (listsNow || []).some((l) => l.name === madeName),
    JSON.stringify((listsNow || []).map((l) => l.name))
  );


  /* ================================================================ */
  /* 8. Whether the list actually sends                               */
  /* ================================================================ */

  /*
   * A lead list no campaign draws from is a bucket: the add succeeds, the popup
   * says "Added", and nothing is ever emailed. In the fixture, L3 has no
   * campaign at all and L2's only campaign is a draft — neither will send.
   */
  await popup.click('#list-trigger');
  await popup.fill('#list-search', 'Conference');
  await popup.waitForFunction(
    () => document.querySelectorAll('.campaign-option').length === 1,
    null,
    { timeout: 10000 }
  );
  check(
    'a list with no campaign is marked as such in the picker',
    (await popup.locator('.campaign-option .no-send').count()) === 1,
    String(await popup.locator('.campaign-option .no-send').count())
  );
  await popup.locator('.campaign-option').first().click();

  await popup.waitForFunction(
    () => !document.getElementById('dest-note')?.classList.contains('hidden'),
    null,
    { timeout: 10000 }
  );
  check(
    'and says so on the collapsed control, where most adds never open the picker',
    /No campaign sends from this list/.test(await popup.textContent('#dest-note')),
    await popup.textContent('#dest-note')
  );

  // A list that does feed a running campaign says nothing — silence is the
  // signal that everything is fine.
  await popup.click('#list-trigger');
  await popup.fill('#list-search', 'Brokers');
  await popup.waitForFunction(
    () => document.querySelectorAll('.campaign-option').length === 1,
    null,
    { timeout: 10000 }
  );
  await popup.locator('.campaign-option').first().click();
  await popup.waitForFunction(
    () => document.getElementById('dest-note')?.classList.contains('hidden'),
    null,
    { timeout: 10000 }
  );
  check('a list feeding a running campaign is not flagged', true);

  /* ================================================================ */
  /* 9. The same person under a second address                        */
  /* ================================================================ */

  /*
   * The extension scrapes the same human from LinkedIn and from their company's
   * team page under two addresses, and cheerfully makes two contacts with two
   * separate histories. Jane Doe is already held as jane.doe@acme.com.
   */
  await popup.fill('#email', 'j.doe@acme.com');
  await popup.fill('#first-name', 'Jane');
  await popup.fill('#last-name', 'Doe');
  await popup.fill('#company', 'Acme Ltd');
  await popup.waitForTimeout(1600);

  await popup.waitForFunction(
    () => !document.getElementById('duplicate')?.classList.contains('hidden'),
    null,
    { timeout: 15000 }
  );
  check(
    'a near-match under another address is surfaced before the add',
    /jane\.doe@acme\.com/.test(await popup.textContent('#duplicate')),
    await popup.textContent('#duplicate')
  );
  check(
    'it is a statement, not a barrier — the add is still available',
    !(await popup.locator('#add').isDisabled())
  );

  await popup.click('#dup-use');
  await popup.waitForFunction(
    () => document.getElementById('email')?.value === 'jane.doe@acme.com',
    null,
    { timeout: 10000 }
  );
  check('and one press switches to the contact already held', true);

  // Somebody genuinely new must not be accused of being a duplicate.
  await popup.fill('#email', 'nobody.here@elsewhere.example.net');
  await popup.fill('#first-name', 'Nobody');
  await popup.fill('#last-name', 'Here');
  await popup.fill('#company', 'Elsewhere');
  await popup.waitForTimeout(1800);
  check(
    'a genuinely new person is not flagged',
    await popup.locator('#duplicate').isHidden()
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
