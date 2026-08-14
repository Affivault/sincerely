/**
 * Loads the unpacked extension in Chromium and drives it against the mock API.
 * Covers the service worker, options page, content-script injection, and the
 * popup's identity / picker / add / move / remove / suppress paths.
 */
import { chromium } from 'playwright';
import { CHROMIUM } from './chromium.mjs';
import { fileURLToPath } from 'node:url';

// Start from the fixture every run — the mock is stateful.
await fetch('http://localhost:3001/__reset');
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REVOKED_API_KEY, TEST_API_KEY, TEST_AUTH } from './fixtures.mjs';
const KEY = TEST_API_KEY;

const EXT_PATH = fileURLToPath(new URL('..', import.meta.url));
const API = 'http://localhost:3001/api/v1';

const failures = [];
const passes = [];

function check(name, condition, detail = '') {
  if (condition) {
    passes.push(name);
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const FIXTURE = `<!doctype html><html><head>
  <title>Sam Rivera — Head of Growth</title>
  <meta property="og:site_name" content="Northwind Capital" />
</head><body>
  <h1>Sam Rivera</h1>
  <p>Reach out: <a href="mailto:sam.rivera@northwind.example.org">sam.rivera@northwind.example.org</a></p>
  <p>Support: <a href="mailto:no-reply@northwind.example.org">no-reply@northwind.example.org</a></p>
</body></html>`;

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-ext-'));
const fixturePath = join(userDataDir, 'fixture.html');
writeFileSync(fixturePath, FIXTURE);

const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});

/**
 * Wait for the popup's lookup to settle rather than sampling mid-flight.
 *
 * The email input is debounced by 450ms, so waiting only for "not Checking"
 * would pass instantly on the stale frame before the lookup even starts.
 * Clear the debounce first, then wait for the in-flight state to end.
 */
async function settled(popup) {
  await popup.waitForTimeout(600);
  await popup.waitForFunction(
    () => !document.getElementById('standing-strip')?.textContent?.includes('Checking'),
    null,
    { timeout: 15000 }
  );
}

try {
  /* ---------------- service worker ---------------- */

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  check('service worker registered', Boolean(extensionId), worker.url());

  const workerErrors = [];
  context.on('weberror', (e) => workerErrors.push(e.error().message));

  /* ---------------- options page ---------------- */

  const options = await context.newPage();
  const optionsErrors = [];
  options.on('pageerror', (err) => optionsErrors.push(err.message));
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
  await options.waitForLoadState('domcontentloaded');

  check('options page has no JS errors', optionsErrors.length === 0, optionsErrors.join(' | '));
  check('options page rendered heading', (await options.locator('h1').textContent()) === 'Extension settings');

  // Pasting a key by hand is now the fallback path and lives inside a
  // <details>, since one-click connect is the recommended route.
  check('manual key entry is collapsed by default', !(await options.locator('#api-url').isVisible()));
  check('one-click connect is offered first', await options.locator('#open-app').isVisible());
  await options.locator('details.manual > summary').click();

  await options.click('#use-local');
  check('localhost shortcut fills the API URL', (await options.inputValue('#api-url')) === API);

  await options.fill('#api-key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  await options.click('#save');
  await options.waitForSelector('#result:not(.hidden)');
  check(
    'rejects a non-sk_live key with a useful message',
    /sk_live_/.test(await options.textContent('#result')) &&
      (await options.locator('#result').getAttribute('class')).includes('error')
  );

  // The commonest cause of "Invalid API key": copying the masked display off
  // the Developer page instead of using its copy button. It starts sk_live_,
  // so a prefix-only check waves it through and the server rejects it blankly.
  await options.fill('#api-key', 'sk_live_a1b2c3d4••••••••••••••••');
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('masked'),
    null,
    { timeout: 5000 }
  );
  check(
    'a masked key is named as masked, not sent and rejected',
    /copy button/.test(await options.textContent('#result')),
    await options.textContent('#result')
  );

  await options.fill('#api-key', 'sk_live_a1b2c3d4');
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('truncated'),
    null,
    { timeout: 5000 }
  );
  check(
    'a truncated key says how long it is and how long it should be',
    /16 characters, but a full key is 72/.test(await options.textContent('#result')),
    await options.textContent('#result')
  );

  await options.fill('#api-key', KEY);
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Connected'),
    null,
    { timeout: 20000 }
  );
  const connectMessage = await options.textContent('#result');
  check('connection test reports success', /Connected\./.test(connectMessage), connectMessage);
  check('connection test reports write capability', /add and remove people/.test(connectMessage));
  check('saved key is not rendered back into the field', (await options.inputValue('#api-key')) === '');
  check('tagging is on by default', await options.isChecked('#auto-tag'));
  check('the toolbar badge is on by default', await options.isChecked('#show-badge'));
  check(
    'the localhost shortcut also sets the web app URL',
    (await options.inputValue('#app-url')) === 'http://localhost:5173',
    await options.inputValue('#app-url')
  );
  check(
    'tag name defaults to something identifiable',
    (await options.inputValue('#auto-tag-name')) === 'chrome-extension'
  );

  /* ------- content script, injected for real by the worker ------- */

  const personPage = await context.newPage();
  const personErrors = [];
  personPage.on('pageerror', (err) => personErrors.push(err.message));
  await personPage.goto('http://localhost:3001/fixture');

  const injected = await options.evaluate(async (tabUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === tabUrl);
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONTEXT', payload: { tabId: tab.id } });
    return response?.data?.person ?? null;
  }, 'http://localhost:3001/fixture');

  check('worker injects the scraper and gets a person back', Boolean(injected));
  check(
    'generic adapter picks the personal address over the role inbox',
    injected?.email === 'sam.rivera@northwind.example.org',
    injected?.email
  );
  check(
    'role inbox is filtered out of candidates',
    !(injected?.email_candidates || []).includes('no-reply@northwind.example.org')
  );
  check(
    'second real address is offered as a candidate',
    (injected?.email_candidates || []).includes('dana.k@northwind.example.org')
  );
  check(
    "asset filename isn't mistaken for an email",
    !(injected?.email_candidates || []).some((e) => e.includes('icon@2x'))
  );
  check('name is split into first/last', injected?.first_name === 'Sam' && injected?.last_name === 'Rivera');
  check(
    "LinkedIn's connection-degree suffix is stripped from the name",
    !/2nd/.test(`${injected?.first_name} ${injected?.last_name}`)
  );
  check('company comes from og:site_name', injected?.company === 'Northwind Capital');
  check('content script raised no page errors', personErrors.length === 0, personErrors.join(' | '));

  const selectorCheck = await personPage.evaluate(() => {
    const selectors = [
      'main h1', '.pv-text-details__left-panel h1', '.text-heading-xlarge', 'h1',
      '.text-body-medium.break-words', '.pv-text-details__left-panel .text-body-medium',
      'main .text-body-medium',
      'button[aria-label^="Current company"] .pv-text-details__right-panel-item-text',
      '.pv-text-details__right-panel-item-text',
      '[data-field="experience_company_logo"] + div span[aria-hidden="true"]',
      '.gs .gD[email]', 'h3.iw span[email]', 'span[email]:not([email=""])',
      '[itemprop="name"]', 'meta[property="profile:first_name"]',
      'a[href^="mailto:"]', '[email], [data-email]',
    ];
    const broken = [];
    for (const selector of selectors) {
      try { document.querySelector(selector); } catch { broken.push(selector); }
    }
    return broken;
  });
  check('all LinkedIn/Gmail selectors are valid CSS', selectorCheck.length === 0, selectorCheck.join(' | '));

  /* ---------------- popup: identity + picker ---------------- */

  const popup = await context.newPage();
  const popupErrors = [];
  popup.on('pageerror', (err) => popupErrors.push(err.message));
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });

  check('popup has no JS errors', popupErrors.length === 0, popupErrors.join(' | '));
  check('setup panel is hidden once connected', await popup.locator('#setup').isHidden());

  // Opened as a bare tab there's no page to scrape, so the popup should open
  // the details and put the cursor where the work is.
  check(
    'with nobody detected, the details open automatically',
    (await popup.getAttribute('#details-toggle', 'aria-expanded')) === 'true'
  );
  check(
    'with nobody detected, focus lands on the email field',
    await popup.evaluate(() => document.activeElement?.id === 'email')
  );

  /* The destination lives in a collapsed dropdown at the foot of the popup now,
     so it has to be opened before it can be inspected. That is the point of the
     change: the picker used to be an always-open box that spent ~300px in the
     middle of the page on a choice that is usually one of three. */
  check('the destination is collapsed to one row by default', await popup.locator('#list-pop').isHidden());
  check(
    'and names where this person is going',
    (await popup.textContent('#list-trigger-name')).trim().length > 0,
    await popup.textContent('#list-trigger-name')
  );

  await popup.click('#list-trigger');
  await popup.waitForFunction(() => document.querySelectorAll('.campaign-option').length > 0, null, {
    timeout: 15000,
  });
  check('opening the trigger reveals the full picker', await popup.locator('#list-pop').isVisible());

  const listCount = await popup.locator('.campaign-option').count();
  check('picker lists all 3 lead lists', listCount === 3, String(listCount));
  check(
    'the default list is marked as such',
    (await popup.locator('.list-default').count()) === 1,
    String(await popup.locator('.list-default').count())
  );
  check(
    'each list shows its size, which is the useful thing at a glance',
    /\d+ contacts?/.test(await popup.textContent('.campaign-option-meta')),
    await popup.textContent('.campaign-option-meta')
  );
  check(
    'and its own colour swatch, so it is recognisable by what you already recognise it by',
    (await popup.locator('#lead-lists .list-swatch').count()) === 3
  );

  check(
    'the details toggle explains what is missing',
    (await popup.textContent('#details-summary')) === 'Enter an email address'
  );

  // Type-to-filter, the app's palette behaviour.
  await popup.fill('#list-search', 'warm');
  await popup.waitForFunction(
    () => document.querySelectorAll('.campaign-option').length === 1,
    null,
    { timeout: 5000 }
  );
  check('typing filters the list picker', true);
  check(
    'the filtered match becomes the active row',
    await popup.evaluate(() =>
      document.querySelector('.campaign-option.active .campaign-option-name')?.textContent?.includes('Warm')
    )
  );

  await popup.fill('#list-search', 'no-such-list');
  await popup.waitForFunction(
    () => Boolean(document.querySelector('.campaign-empty')),
    null,
    { timeout: 5000 }
  );
  check(
    'a search matching nothing says so rather than showing an empty box',
    /No lists match/.test(await popup.textContent('.campaign-empty'))
  );

  await popup.fill('#list-search', '');
  await popup.waitForFunction(
    () => document.querySelectorAll('.campaign-option').length === 3,
    null,
    { timeout: 5000 }
  );

  // Arrow keys move the selection, and the primary button names the target.
  await popup.focus('#list-search');
  await popup.keyboard.press('ArrowDown');
  check(
    'arrow keys move the active row',
    await popup.evaluate(
      () => document.querySelectorAll('.campaign-option')[1]?.classList.contains('active') === true
    )
  );
  await popup.keyboard.press('ArrowUp');
  check(
    'and back again',
    await popup.evaluate(
      () => document.querySelectorAll('.campaign-option')[0]?.classList.contains('active') === true
    )
  );

  /* ---------------- popup: identity for a known contact ---------------- */

  await popup.fill('#email', 'jane.doe@acme.com');
  await settled(popup);
  await popup.waitForFunction(() => document.querySelectorAll('.enrolment').length > 0, null, { timeout: 15000 });

  check('identity shows the contact name', (await popup.textContent('#person-name')) === 'Jane Doe');
  check(
    'identity sub-line carries title and company',
    /Head of Trading · Acme Ltd/.test(await popup.textContent('#person-sub')),
    await popup.textContent('#person-sub')
  );
  check('avatar shows initials', (await popup.textContent('#avatar')) === 'JD');
  check(
    'a known contact links through to their record in the app',
    (await popup.getAttribute('#person-name a', 'href')) === 'http://localhost:5173/contacts/k1',
    await popup.getAttribute('#person-name a', 'href')
  );
  check(
    'membership rows link through to the list in the app',
    (await popup.getAttribute('.enrolment-name', 'href')) === 'http://localhost:5173/contacts?list=L1',
    await popup.getAttribute('.enrolment-name', 'href')
  );
  check(
    'app links open in a new tab rather than replacing the popup',
    (await popup.getAttribute('.enrolment-name', 'target')) === '_blank'
  );
  check(
    'avatar colour is derived, not fixed',
    /linear-gradient/.test(await popup.getAttribute('#avatar', 'style'))
  );
  check(
    'engagement summary replaces the bare membership count',
    /opened 2×/.test(await popup.textContent('#standing-strip')),
    await popup.textContent('#standing-strip')
  );
  check(
    'unverified contact shows the neutral pill',
    (await popup.locator('#verification').textContent()) === 'Unverified'
  );

  /* ---------------- add + tag ---------------- */

  // Jane (k1) starts on L1 only, so L3 is a genuine addition.
  await popup.fill('#list-search', 'Conference');
  await popup.waitForFunction(
    () => document.querySelector('.campaign-option.active .campaign-option-name')?.textContent?.includes('Conference'),
    null,
    { timeout: 5000 }
  );
  await popup.click('#add');
  await popup.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('Added to'),
    null,
    { timeout: 15000 }
  );
  check(
    'add reports success naming the list',
    /Added to "Conference — Q3"/.test(await popup.textContent('#status')),
    await popup.textContent('#status')
  );
  check('successful add offers Undo', await popup.locator('.status-action').first().isVisible());

  const tagState = await popup.evaluate(
    (auth) =>
      fetch('http://localhost:3001/__tag-applications').then((r) => r.json())
  );
  check(
    'the source tag was created',
    tagState.tags.some((t) => t.name === 'chrome-extension'),
    JSON.stringify(tagState.tags)
  );
  check(
    'the contact was tagged on add',
    tagState.applications.some((a) => a.contact_ids.includes('k1')),
    JSON.stringify(tagState.applications)
  );

  await popup.waitForFunction(() => document.querySelectorAll('.enrolment').length === 2, null, { timeout: 15000 });
  check('standing refreshes to show both memberships', true);

  /* ---------------- the add cannot be offered twice ---------------- */

  /*
   * The server upserts, so a repeat add succeeds and its reply cannot tell the
   * two apart — meaning a second press would report a change that never
   * happened. The extension used to allow the press and then explain itself
   * afterwards ("Already on X — nothing changed"). Not offering a pointless
   * action in the first place is better than apologising for it, so the button
   * now names the state and goes inert.
   */
  await popup.waitForFunction(
    () => document.getElementById('add-label')?.textContent?.trim() === 'On list',
    null,
    { timeout: 15000 }
  );
  /* The verb carries the state; the destination is named by the dropdown beside
     it. Spelling the list out on the button too is what produced two controls
     both reading "Add to <list>". */
  check(
    'once they are on the chosen list the button says so rather than offering the add again',
    (await popup.textContent('#add-label')).trim() === 'On list',
    await popup.textContent('#add-label')
  );
  check(
    'and the destination beside it still names the list',
    (await popup.textContent('#list-trigger-name')).includes('Conference'),
    await popup.textContent('#list-trigger-name')
  );
  check('and cannot be pressed', await popup.locator('#add').isDisabled());
  check(
    'and reads as settled rather than broken',
    (await popup.getAttribute('#add', 'class'))?.includes('is-done'),
    await popup.getAttribute('#add', 'class')
  );
  check(
    'the membership row is not duplicated',
    (await popup.locator('.enrolment').count()) === 2,
    String(await popup.locator('.enrolment').count())
  );

  /* ---------------- removing a membership ---------------- */

  const rows = popup.locator('.enrolment');
  const targetRow = rows.filter({ hasText: 'Conference' }).first();
  await targetRow.locator('.remove-btn').click();
  await popup.waitForFunction(() => document.querySelectorAll('.enrolment').length === 1, null, {
    timeout: 15000,
  });
  check(
    'removing a membership takes them off that list only',
    (await popup.locator('.enrolment-name').first().textContent())?.includes('Brokers'),
    await popup.locator('.enrolment-name').first().textContent()
  );

  /* ---------------- stale-state guard ---------------- */

  check('setup: company was backfilled', (await popup.inputValue('#company')) === 'Acme Ltd');

  await popup.fill('#email', 'nobody.here@nowhere.example.net');
  await settled(popup);
  await popup.waitForFunction(() => document.querySelectorAll('.enrolment').length === 0, null, { timeout: 15000 });
  check('changing the address clears the previous enrolments', true);
  check(
    'no Remove buttons remain that would act on the old contact',
    (await popup.locator('.remove-btn').count()) === 0
  );
  check('API-backfilled fields are cleared with the address', (await popup.inputValue('#company')) === '');

  // Typing over a backfilled field takes ownership of it: a later lookup must
  // not wipe what the user wrote.
  await popup.fill('#email', 'jane.doe@acme.com');
  await settled(popup);
  check('setup: company was backfilled again', (await popup.inputValue('#company')) === 'Acme Ltd');
  await popup.fill('#company', 'Northwind Capital');
  await popup.fill('#email', 'someone.new@elsewhere.example.net');
  await settled(popup);
  check(
    'a field the user typed into survives the next lookup',
    (await popup.inputValue('#company')) === 'Northwind Capital',
    `company read "${await popup.inputValue('#company')}"`
  );
  check(
    'an unknown address is explained rather than erroring',
    /New contact/.test(await popup.textContent('#standing-strip')),
    await popup.textContent('#standing-strip')
  );

  /* ---------------- remove + suppress ---------------- */

  await popup.fill('#email', 'jane.doe@acme.com');
  await settled(popup);
  await popup.waitForFunction(() => document.querySelectorAll('.enrolment').length === 1, null, { timeout: 15000 });

  await popup.locator('.remove-btn').first().click();
  await popup.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('Taken off'),
    null,
    { timeout: 15000 }
  );
  check(
    'remove explains they are only off that one list',
    /stay in your contacts/.test(await popup.textContent('#status')),
    await popup.textContent('#status')
  );

  await popup.click('#suppress');
  check('suppress arms before firing', /Click again to confirm/.test(await popup.textContent('#suppress')));
  check('suppress warning explains the blast radius', /every future send/.test(await popup.textContent('#status')));
  await popup.click('#suppress');
  await popup.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('suppressed'),
    null,
    { timeout: 15000 }
  );
  check('suppress reports what happened', /suppressed/.test(await popup.textContent('#status')));
  // Announced once, at the top, in red — not repeated in a panel further down.
  await popup.waitForFunction(
    () => /Suppressed/.test(document.getElementById('standing-strip')?.textContent || ''),
    null,
    { timeout: 15000 }
  );
  check(
    'the strip leads with suppression, which outranks everything else',
    /Suppressed/.test(await popup.textContent('#standing-strip')),
    await popup.textContent('#standing-strip')
  );
  check('and it is visible without scrolling, inside the person card',
    await popup.locator('#standing-strip').isVisible());
  check('suppress button disables once suppressed', await popup.locator('#suppress').isDisabled());

  /* ---------------- Prospector ---------------- */

  // A LinkedIn-shaped person: name, company, profile URL, no address.
  await popup.fill('#email', '');
  await popup.fill('#first-name', 'Sam');
  await popup.fill('#last-name', 'Rivera');
  await popup.fill('#company', 'Northwind Capital');
  await popup.waitForFunction(() => !document.getElementById('no-email-help')?.classList.contains('hidden'), null, {
    timeout: 5000,
  });
  check('with no address, the prospect route is offered', await popup.locator('#prospect-find').isVisible());

  await popup.click('#prospect-find');
  try {
    await popup.waitForFunction(
      () => !document.getElementById('prospect-result')?.classList.contains('hidden'),
      null,
      { timeout: 15000 }
    );
  } catch (waitErr) {
    console.log('  DIAG status:', await popup.textContent('#status'));
    console.log('  DIAG findBtn:', await popup.textContent('#prospect-find'));
    console.log('  DIAG form:', JSON.stringify(await popup.evaluate(() => ({
      email: document.getElementById('email').value,
      first: document.getElementById('first-name').value,
      last: document.getElementById('last-name').value,
      company: document.getElementById('company').value,
    }))));
    throw waitErr;
  }
  const prospectText = await popup.textContent('#prospect-result');
  check('prospect search finds the person', /Sam Rivera/.test(prospectText), prospectText);
  check('the match shows title and company', /Head of Growth/.test(prospectText), prospectText);
  check('the credit cost is stated before spending', /1 credit/.test(prospectText), prospectText);
  check('the refund promise is stated', /refunded if no email is found/.test(prospectText), prospectText);
  check('the remaining balance is shown', /25 left/.test(prospectText), prospectText);

  await popup.locator('#prospect-result button').first().click();
  await popup.waitForFunction(
    () => document.getElementById('email')?.value?.includes('@'),
    null,
    { timeout: 15000 }
  );
  check(
    'revealing drops the address straight into the flow',
    (await popup.inputValue('#email')) === 'sam.rivera@northwind.example.org',
    await popup.inputValue('#email')
  );
  check(
    'the reveal hands the user their next step',
    /Check the list below/.test(await popup.textContent('#status')),
    await popup.textContent('#status')
  );

  const creditsAfter = await popup.evaluate(
    (auth) =>
      fetch('http://localhost:3001/api/v1/prospecting/status', {
        headers: { Authorization: auth },
      }).then((r) => r.json()),
    TEST_AUTH
  );
  check('exactly one credit was spent', creditsAfter.credits.remaining === 24, JSON.stringify(creditsAfter));

  // Someone the provider has no address for must not cost anything.
  await popup.fill('#email', '');
  await popup.fill('#first-name', 'No');
  await popup.fill('#last-name', 'Mailbox');
  await popup.click('#prospect-find');
  await popup.waitForFunction(
    () => document.getElementById('prospect-result')?.textContent?.includes('No Mailbox'),
    null,
    { timeout: 15000 }
  );
  const noMailText = await popup.textContent('#prospect-result');
  check(
    'a person with no email on record is flagged before spending',
    /no work email on record/i.test(noMailText),
    noMailText
  );
  check(
    'no reveal button is offered when there is nothing to reveal',
    (await popup.locator('#prospect-result button').count()) === 0
  );

  // With no provider configured the API 503s; say so plainly.
  await popup.evaluate(() => fetch('http://localhost:3001/__set-prospector?provider=none'));
  await popup.fill('#first-name', 'Sam');
  await popup.fill('#last-name', 'Rivera');
  await popup.click('#prospect-find');
  await popup.waitForFunction(
    () => document.getElementById('status')?.classList.contains('error'),
    null,
    { timeout: 15000 }
  );
  check(
    'an unconfigured Prospector is explained, not surfaced as a raw 503',
    /not set up on this account/.test(await popup.textContent('#status')),
    await popup.textContent('#status')
  );
  await popup.evaluate(() => fetch('http://localhost:3001/__set-prospector?provider=pdl'));

  /* ------- a 401 explains which key was sent ------- */

  await options.evaluate(
    (key) => chrome.storage.local.set({ apiKey: key }),
    REVOKED_API_KEY
  );
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.classList.contains('error'),
    null,
    { timeout: 20000 }
  );
  const rejected = await options.textContent('#result');
  check('a rejected key relays the server message', /Invalid or expired API key/.test(rejected), rejected);
  check(
    'and names the key prefix so it can be compared with the app',
    /sk_live_dead0000/.test(rejected),
    rejected
  );
  check('and says where to look', /Webhooks page, API keys tab/.test(rejected), rejected);

  // Put the working key back for the rest of the run.
  await options.fill('#api-key', KEY);
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Connected'),
    null,
    { timeout: 20000 }
  );

  /* ------- every [email] attribute is read, not alternate ones ------- */

  const attrPage = await context.newPage();
  await attrPage.goto('http://localhost:3001/attr-fixture');
  const attrPerson = await options.evaluate(async (tabUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === tabUrl);
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONTEXT', payload: { tabId: tab.id } });
    return response?.data?.person ?? null;
  }, 'http://localhost:3001/attr-fixture');

  const attrEmails = attrPerson?.email_candidates || [];
  check(
    'all four [email] attributes are found, not every other one',
    ['one', 'two', 'three', 'four'].every((n) =>
      attrEmails.includes(`${n}.person@northwind.example.org`)
    ),
    JSON.stringify(attrEmails)
  );
  await attrPage.close();

  /* ---------------- bulk add ---------------- */

  // A team page: several real addresses on one domain, plus a role inbox.
  const teamPage = await context.newPage();
  await teamPage.goto('http://localhost:3001/team-fixture');

  const bulkPopup = await context.newPage();
  const bulkErrors = [];
  bulkPopup.on('pageerror', (err) => bulkErrors.push(err.message));
  await bulkPopup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await bulkPopup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 15000,
  });

  // Feed it the team page's scrape, the way the worker would from that tab.
  const teamPerson = await options.evaluate(async (tabUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === tabUrl);
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONTEXT', payload: { tabId: tab.id } });
    return response?.data?.person ?? null;
  }, 'http://localhost:3001/team-fixture');

  check('the team page yields several addresses', (teamPerson?.email_candidates || []).length >= 3, JSON.stringify(teamPerson?.email_candidates));
  check(
    'the role inbox is excluded from the page addresses',
    !(teamPerson?.email_candidates || []).includes('no-reply@northwind.example.org')
  );

  // The bulk button is gated on what's actually on screen, so populate the
  // candidates the way a scrape would and check the affordance appears.
  await bulkPopup.evaluate((emails) => {
    const select = document.getElementById('candidates');
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'other addresses…';
    select.appendChild(placeholder);
    for (const email of emails) {
      const option = document.createElement('option');
      option.value = email;
      option.textContent = email;
      select.appendChild(option);
    }
    document.getElementById('email').value = emails[0];
    document.getElementById('email').dispatchEvent(new Event('input'));
  }, teamPerson.email_candidates);
  await bulkPopup.waitForTimeout(700);

  check('bulk is offered when the page holds several people', await bulkPopup.locator('#bulk-add').isVisible());
  check(
    'the bulk button says how many it will add',
    /Add all 3 addresses/.test(await bulkPopup.textContent('#bulk-label')),
    await bulkPopup.textContent('#bulk-label')
  );

  // First click arms and spells out what is about to happen.
  await bulkPopup.click('#bulk-add');
  check(
    'bulk arms before firing',
    /Click again/.test(await bulkPopup.textContent('#bulk-label')),
    await bulkPopup.textContent('#bulk-label')
  );
  const armedText = await bulkPopup.textContent('#status');
  check('the arming message names the addresses', /ana\.silva@northwind/.test(armedText), armedText);
  // Names whichever list is selected — the point is that it says *where* before
  // it does anything, not which one the fixture happened to leave highlighted.
  check('the arming message names the list it will add to', /to "[^"]+"/.test(armedText), armedText);

  const bulkResult = await bulkPopup.evaluate(
    (emails) => chrome.runtime.sendMessage({ type: 'BULK_ADD', payload: { listId: 'L2', emails } }),
    teamPerson.email_candidates
  );
  check('bulk add succeeds', bulkResult?.ok === true, JSON.stringify(bulkResult));
  check(
    'bulk add creates the contacts it did not have',
    bulkResult?.data?.created === 3,
    JSON.stringify(bulkResult?.data)
  );
  check(
    'bulk add puts everyone on the list in one go',
    bulkResult?.data?.added === 3,
    JSON.stringify(bulkResult?.data)
  );

  // Running it again must not double-create or double-enrol.
  const bulkAgain = await bulkPopup.evaluate(
    (emails) => chrome.runtime.sendMessage({ type: 'BULK_ADD', payload: { listId: 'L2', emails } }),
    teamPerson.email_candidates
  );
  check('re-running bulk creates nobody new', bulkAgain?.data?.created === 0, JSON.stringify(bulkAgain?.data));
  check('re-running bulk adds nobody new', bulkAgain?.data?.added === 0, JSON.stringify(bulkAgain?.data));
  check(
    're-running bulk reports them as already on the list rather than failing',
    bulkAgain?.data?.alreadyOnList === 3,
    JSON.stringify(bulkAgain?.data)
  );

  const bulkTags = await bulkPopup.evaluate(() =>
    fetch('http://localhost:3001/__tag-applications').then((r) => r.json())
  );
  check(
    'bulk-added contacts are tagged too',
    bulkTags.applications.some((a) => a.contact_ids.length === 3),
    JSON.stringify(bulkTags.applications)
  );

  check('bulk popup raised no JS errors', bulkErrors.length === 0, bulkErrors.join(' | '));
  await bulkPopup.close();
  await teamPage.close();

  /* ---------------- 401 handling ---------------- */

  await popup.evaluate((key) => chrome.storage.local.set({ apiKey: key }), REVOKED_API_KEY);
  /*
   * The Prospector check above left an error in #status. Waiting for "#status
   * has the error class" is therefore already satisfied on entry, and this
   * asserted against the *previous* message — so a real auth failure and no
   * auth call at all looked identical. Wait for the text to actually change.
   */
  const staleStatus = await popup.textContent('#status');
  await popup.fill('#email', 'someone@else.example.com');
  await settled(popup);
  await popup.waitForFunction(
    (before) => {
      const node = document.getElementById('status');
      return node?.classList.contains('error') && node.textContent !== before;
    },
    staleStatus,
    { timeout: 15000 }
  );
  const authStatus = await popup.textContent('#status');
  check('revoked key surfaces the server message', /Invalid or expired API key/.test(authStatus), authStatus);
  check('auth errors offer an Open settings shortcut', /Open settings/.test(authStatus), authStatus);

  check('no uncaught worker errors', workerErrors.length === 0, workerErrors.join(' | '));
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
