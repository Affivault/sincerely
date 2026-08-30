/**
 * Row selection and the bulk bar on a LinkedIn search-results page.
 *
 * Served by intercepting linkedin.com so the content scripts actually run and
 * the row selectors are tested against search-shaped markup.
 */
import { chromium } from 'playwright';
import { CHROMIUM, openExtensionPage } from './chromium.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_API_KEY, TEST_AUTH } from './fixtures.mjs';
const KEY = TEST_API_KEY;

await fetch('http://localhost:3001/__reset');

const EXT_PATH = fileURLToPath(new URL('..', import.meta.url));
const OUT = '/tmp/claude-0/-home-user-sincerely/7ea69c10-8f1d-5eb9-b6cf-326d102dc999/scratchpad/shots';

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

/** Search results shaped like LinkedIn's, including the classes we target. */
const PEOPLE = [
  ['sam-rivera', 'Sam Rivera', 'Head of Growth at Northwind Capital'],
  ['jane-doe', 'Jane Doe', 'Head of Trading at Acme Ltd'],
  ['no-mailbox', 'No Mailbox', 'Analyst at Northwind Capital'],
  ['ana-silva', 'Ana Silva', 'Managing Partner at Northwind Capital'],
];

const SEARCH = `<!doctype html><html><head><title>People | LinkedIn</title></head><body>
<main><ul class="reusable-search__entity-result-list">
${PEOPLE.map(
  ([slug, name, subtitle]) => `
  <li class="reusable-search__result-container">
    <div class="entity-result">
      <span class="entity-result__title-text">
        <a class="app-aware-link" href="/in/${slug}/?trk=search">
          <span aria-hidden="true">${name}</span><span class="visually-hidden">${name}</span>
        </a>
      </span>
      <div class="entity-result__primary-subtitle t-14 t-black t-normal">${subtitle}</div>
    </div>
  </li>`
).join('')}
</ul></main></body></html>`;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'list-')), {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});

await context.route('https://www.linkedin.com/**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'text/html', body: SEARCH });
});

const barText = (page) =>
  page.evaluate(
    () => document.getElementById('sincerely-bulk-host')?.shadowRoot?.querySelector('.bar')?.textContent ?? ''
  );

const clickBar = (page, label) =>
  page.evaluate((text) => {
    const shadow = document.getElementById('sincerely-bulk-host').shadowRoot;
    [...shadow.querySelectorAll('button')].find((b) => b.textContent.includes(text))?.click();
  }, label);

const checkedCount = (page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('.sincerely-box-host')].filter(
        (host) => host.shadowRoot?.querySelector('input')?.checked
      ).length
  );

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  const options = await openExtensionPage(context, `chrome-extension://${extensionId}/options/options.html`);
  // Manual key entry is the fallback path now, collapsed behind a <details>.
  await options.locator('details.manual > summary').click();
  await options.click('#use-local');
  await options.fill('#api-key', KEY);
  await options.click('#save');
  await options.waitForFunction(
    () => document.getElementById('result')?.textContent?.includes('Connected'),
    null,
    { timeout: 20000 }
  );

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto('https://www.linkedin.com/search/results/people/?keywords=growth');

  await page.waitForFunction(
    () => document.querySelectorAll('[data-sincerely-row]').length > 0,
    null,
    { timeout: 15000 }
  );
  check('rows on a search page get a checkbox', true);
  check('no page errors from the injected selection UI', pageErrors.length === 0, pageErrors.join(' | '));

  const rowCount = await page.evaluate(() => document.querySelectorAll('[data-sincerely-row]').length);
  check('every result row is decorated', rowCount === 4, String(rowCount));

  await page.waitForFunction(
    () => document.getElementById('sincerely-bulk-host')?.shadowRoot?.querySelector('.bar'),
    null,
    { timeout: 15000 }
  );
  check('a bulk bar appears', true);
  check('the bar counts the rows', /0 of 4 selected/.test(await barText(page)), await barText(page));

  /* ---------------- select all ---------------- */

  await clickBar(page, 'Select all');
  await page.waitForTimeout(300);
  check('select all ticks every row', (await checkedCount(page)) === 4, String(await checkedCount(page)));
  check('the count follows', /4 of 4 selected/.test(await barText(page)), await barText(page));

  await clickBar(page, 'Clear');
  await page.waitForTimeout(300);
  check('clearing unticks everything', (await checkedCount(page)) === 0);

  /* ---------------- net new ---------------- */

  // Jane Doe is already on a lead list in the fixture, so she is not
  // net new; the other three are.
  await clickBar(page, 'Net new');
  await page.waitForFunction(
    () => !document.getElementById('sincerely-bulk-host')?.shadowRoot?.textContent?.includes('Checking'),
    null,
    { timeout: 20000 }
  );
  await page.waitForTimeout(400);

  const afterNetNew = await checkedCount(page);
  check('net new leaves out the person already on a list', afterNetNew === 3, String(afterNetNew));
  check(
    'and says how many it skipped and why',
    /1 skipped — already on a list, or suppressed/.test(await barText(page)),
    await barText(page)
  );

  const janeChecked = await page.evaluate(() => {
    const row = document.querySelector('[data-sincerely-row*="jane-doe"]');
    return row?.querySelector('.sincerely-box-host')?.shadowRoot?.querySelector('input')?.checked;
  });
  check('specifically, it is Jane who is left out', janeChecked === false);

  await page.screenshot({ path: join(OUT, '11-list-bulk-bar.png') });

  /* ---------------- add the selection ---------------- */

  // Only Sam is in the prospect database with an address; the rest can't be
  // revealed, and that must be reported rather than silently dropped.
  await page.evaluate(() => {
    const shadow = document.getElementById('sincerely-bulk-host').shadowRoot;
    const select = shadow.querySelector('select');
    select.value = 'L2';
    select.dispatchEvent(new Event('change'));
  });
  await clickBar(page, 'Add ');
  await page.waitForFunction(
    () => /Added \d/.test(document.getElementById('sincerely-bulk-host')?.shadowRoot?.textContent || ''),
    null,
    { timeout: 40000 }
  );

  const result = await barText(page);
  check('it reports what it added', /Added 1/.test(result), result);
  check('it reports what it revealed', /1 revealed/.test(result), result);
  check('it reports who had no address', /had no address/.test(result), result);
  check('it reports the remaining credit balance', /credits left/.test(result), result);

  const credits = await options.evaluate(
    (auth) =>
      fetch('http://localhost:3001/api/v1/prospecting/status', { headers: { Authorization: auth } }).then((r) => r.json()),
    TEST_AUTH
  );
  check(
    'a credit is spent only for the person actually revealed',
    credits.credits.remaining === 24,
    JSON.stringify(credits)
  );

  check('the selection clears after enrolling', (await checkedCount(page)) === 0);

  /* ------- someone we already hold costs no credit ------- */

  // Sam is now a contact from the enrol above. Selecting and adding him again
  // must recognise that and not pay to reveal someone we already have.
  const creditsBefore = credits.credits.remaining;
  await page.evaluate(() => {
    const host = [...document.querySelectorAll('[data-sincerely-row]')].find((r) =>
      r.getAttribute('data-sincerely-row').includes('sam-rivera')
    );
    const box = host?.querySelector('.sincerely-box-host')?.shadowRoot?.querySelector('input');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
  });
  // Same list as before: L2 is the one the earlier add used, so this stays
  // exclusivity rule, which is a different thing from what this checks.
  await clickBar(page, 'Add ');
  await page.waitForFunction(
    () => /Added \d/.test(document.getElementById('sincerely-bulk-host')?.shadowRoot?.textContent || ''),
    null,
    { timeout: 40000 }
  );

  const creditsAfter = await options.evaluate(
    (auth) =>
      fetch('http://localhost:3001/api/v1/prospecting/status', { headers: { Authorization: auth } }).then((r) => r.json()),
    TEST_AUTH
  );
  check(
    're-adding a contact we already hold spends no credit',
    creditsAfter.credits.remaining === creditsBefore,
    `before ${creditsBefore}, after ${creditsAfter.credits.remaining}`
  );

  /* ------- the bar survives an SPA navigation ------- */

  await page.evaluate(() => history.pushState({}, '', '/search/results/people/?keywords=trading'));
  await page.waitForFunction(
    () => document.querySelectorAll('[data-sincerely-row]').length > 0,
    null,
    { timeout: 20000 }
  );
  const afterNav = await page.evaluate(() => document.querySelectorAll('.sincerely-box-host').length);
  check(
    'checkboxes come back after an in-page navigation',
    afterNav === 4,
    `${afterNav} boxes`
  );
  check(
    'and exactly one per row — no stacking',
    afterNav === (await page.evaluate(() => document.querySelectorAll('[data-sincerely-row]').length)),
    String(afterNav)
  );
  check(
    'the bar returns with a usable lead-list picker',
    !/No lead lists/.test(await barText(page)),
    await barText(page)
  );

  /* ---------------- stays off pages it has no business on ---------------- */

  const profile = await context.newPage();
  await profile.goto('https://www.linkedin.com/in/sam-rivera/');
  await profile.waitForTimeout(2500);
  const barOnProfile = await profile.evaluate(
    () => !!document.getElementById('sincerely-bulk-host')?.shadowRoot?.querySelector('.bar')
  );
  check('no bulk bar on a single profile', barOnProfile === false);
  /* ---------------- keyboard triage ---------------- */

  /*
   * These pages get worked in volume — twenty-five results, most a yes or no on
   * sight — and a checkbox each means a mouse trip per person. J and K move,
   * space picks, Enter adds.
   *
   * Last in the file on purpose: it changes the selection, and every flow above
   * depends on the selection it set up.
   */
  await page.goto('https://www.linkedin.com/search/results/people/?keywords=broker');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-sincerely-row]').length > 0,
    null,
    { timeout: 20000 }
  );

  // The checkboxes live in per-row shadow roots, so a plain document query
  // cannot see them.
  await page.evaluate(() => {
    document.querySelectorAll('[data-sincerely-row]').forEach((row) => {
      const box = row.querySelector('.sincerely-box-host')?.shadowRoot?.querySelector('input');
      if (box?.checked) box.click();
    });
  });
  await page.waitForTimeout(300);

  await page.click('body');
  await page.keyboard.press('j');
  await page.waitForTimeout(200);

  const cursorOn = await page.evaluate(
    () => [...document.querySelectorAll('[data-sincerely-row]')].filter((n) => n.style.outline).length
  );
  check('J moves a visible cursor onto a result', cursorOn === 1, String(cursorOn));

  await page.keyboard.press(' ');
  await page.waitForTimeout(250);
  check('space selects the row under the cursor', /1 of \d+ selected/.test(await barText(page)), await barText(page));

  await page.keyboard.press('j');
  await page.keyboard.press(' ');
  await page.waitForTimeout(250);
  check('and moving on selects a second', /2 of \d+ selected/.test(await barText(page)), await barText(page));

  await page.keyboard.press('k');
  await page.keyboard.press(' ');
  await page.waitForTimeout(250);
  check('K goes back, and space deselects', /1 of \d+ selected/.test(await barText(page)), await barText(page));

  /*
   * The important restraint: LinkedIn's own inputs keep their letters. Typing
   * "j" into a search box must search, not move a cursor nobody can see.
   */
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'their-search';
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press('j');
  await page.waitForTimeout(200);
  check(
    'typing in a page input does not drive the cursor',
    (await page.evaluate(() => document.getElementById('their-search').value)) === 'j',
    await page.evaluate(() => document.getElementById('their-search').value)
  );
  check('and the selection is untouched', /1 of \d+ selected/.test(await barText(page)), await barText(page));
  await page.evaluate(() => document.getElementById('their-search')?.remove());

  check(
    'the shortcuts are advertised on the bar rather than left to be discovered',
    /J K/.test(await barText(page)),
    await barText(page)
  );

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
