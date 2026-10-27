/**
 * "People at this company": the Apollo panel.
 *
 * Standing on a company's website, or its LinkedIn page, the sidebar offers the
 * people who work there; ticking some and saving reveals each one onto the
 * chosen lead list, which the server also enrols into that list's campaigns.
 *
 * What is pinned here is the wiring that would quietly break it: the search is
 * scoped to the company's domain, every reveal carries the list and the search
 * row (without the row the server saved a contact with an address and nothing
 * else), and the outcome lands back on the rows that were ticked.
 *
 * The popup is opened as a tab, so `chrome.tabs.query({active: true})` would
 * return the popup itself. An init script points it at the tab under test
 * instead, which is what a real side panel would see.
 */
import { chromium } from 'playwright';
import { CHROMIUM, openExtensionPage } from './chromium.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCert } from './tls.mjs';
import { TEST_API_KEY } from './fixtures.mjs';

await fetch('http://localhost:3001/__reset');

const here = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(here, '..');
const LINKEDIN_STUB_PORT = 3447;
const SITE = 'http://www.northwind.io/';
const COMPANY_PAGE = 'https://www.linkedin.com/company/northwind-capital/';
const SHOTS = process.env.SHOTS_DIR || '/tmp/ui-shots';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(name);
};
const mock = (path) => fetch(`http://localhost:3001${path}`).then((r) => r.json());

const { spki } = await ensureCert();
const stub = spawn('node', [join(here, 'linkedin-stub.mjs')], {
  stdio: 'ignore',
  env: { ...process.env, LINKEDIN_STUB_PORT: String(LINKEDIN_STUB_PORT) },
});
process.on('exit', () => stub.kill());
await new Promise((resolve) => setTimeout(resolve, 900));

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'company-')), {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    `--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:${LINKEDIN_STUB_PORT}, MAP www.northwind.io 127.0.0.1:3001`,
    `--ignore-certificate-errors-spki-list=${spki}`,
    '--no-proxy-server',
  ],
});

/** A popup that reads `url`'s tab as the one it was opened over. */
async function popupOver(extensionId, url) {
  const page = await openExtensionPage(context, `chrome-extension://${extensionId}/popup/popup.html?surface=sidepanel`, {
    init: (page) =>
      page.addInitScript((target) => {
        const original = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = async (query) => {
          if (!query?.active) return original(query);
          const tabs = await original({});
          return tabs.filter((t) => (t.url || '').startsWith(target)).slice(0, 1);
        };
      }, url),
  });
  await page.setViewportSize({ width: 400, height: 860 });
  return page;
}

/** For judging the panel by eye; asserts nothing. Same folder as shots.mjs. */
async function shot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) }).catch(() => {});
}

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  const options = await openExtensionPage(context, `chrome-extension://${extensionId}/options/options.html`);
  await options.locator('details.manual > summary').click();
  await options.click('#use-local');
  await options.fill('#api-key', TEST_API_KEY);
  await options.click('#save');
  await options.waitForFunction(() => document.getElementById('result')?.textContent?.includes('Connected'), null, {
    timeout: 20000,
  });

  /* ---------------- on the company's own website ---------------- */

  const site = await context.newPage();
  await site.goto(SITE);

  const popup = await popupOver(extensionId, SITE);
  await popup.waitForFunction(() => !document.getElementById('main')?.classList.contains('hidden'), null, {
    timeout: 20000,
  });
  await popup.waitForFunction(() => !document.getElementById('company-block')?.classList.contains('hidden'), null, {
    timeout: 10000,
  }).catch(() => {});

  check('a company website gets the "People at" panel', await popup.locator('#company-block').isVisible());
  check(
    'and it names the domain it will search',
    (await popup.textContent('#company-sub')).includes('northwind.io'),
    await popup.textContent('#company-sub')
  );
  check(
    'it is the first thing on the page, not buried under the person card',
    await popup.evaluate(() => {
      const block = document.getElementById('company-block');
      const card = document.querySelector('.person-card');
      return Boolean(block.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
    })
  );
  check('nothing is searched until somebody asks', (await mock('/__prospector')).searches.length === 0);

  await popup.click('#company-search');
  await popup.waitForFunction(() => document.querySelectorAll('#company-results .person-row').length > 0, null, {
    timeout: 10000,
  });
  const first = (await mock('/__prospector')).searches.at(-1);
  check(
    'the search is scoped to the company domain',
    JSON.stringify(first?.filters?.companies) === JSON.stringify(['northwind.io']),
    JSON.stringify(first)
  );
  const names = await popup.$$eval('#company-results .person-row-name', (nodes) => nodes.map((n) => n.textContent));
  check('the people there are listed', names.includes('Sam Rivera') && names.includes('Lee Okafor'), names.join(', '));
  check(
    'each row links to their LinkedIn profile',
    (await popup.locator('#company-results .person-li').count()) === names.length
  );

  await popup.click('#company-block .chip[data-dept="leadership"]');
  await popup.waitForFunction(() => document.querySelector('#company-block .chip[data-dept="leadership"]')?.classList.contains('is-on'));
  await popup.waitForFunction(() => document.querySelectorAll('#company-results .person-row').length > 0, null, { timeout: 10000 });
  const leadership = (await mock('/__prospector')).searches.at(-1);
  check(
    'a department chip narrows the search by seniority',
    JSON.stringify(leadership?.filters?.seniorities) === JSON.stringify(['owner', 'c_suite']),
    JSON.stringify(leadership)
  );

  await popup.fill('#company-title-filter', 'Growth');
  await popup.waitForFunction(() => document.querySelectorAll('#company-results .person-row').length === 1, null, { timeout: 10000 });
  const titled = (await mock('/__prospector')).searches.at(-1);
  check(
    'a typed title replaces the department',
    JSON.stringify(titled?.filters?.titles) === JSON.stringify(['Growth']) && !titled?.filters?.seniorities,
    JSON.stringify(titled)
  );
  check(
    'and the department chip lets go',
    await popup.evaluate(() => document.querySelector('#company-block .chip[data-dept=""]')?.classList.contains('is-on'))
  );

  await popup.fill('#company-title-filter', '');
  await popup.waitForFunction(() => document.querySelectorAll('#company-results .person-row').length === 2, null, { timeout: 10000 });

  // The destination: the list a running campaign draws from.
  await popup.click('#list-trigger');
  await popup.locator('#lead-lists [role="option"]', { hasText: 'Brokers' }).first().click();
  check('the save button waits for a selection', await popup.locator('#company-save').isDisabled());

  await popup.check('#company-all');
  check(
    'select all ticks everyone who can be saved',
    (await popup.textContent('#company-count')).trim() === '2 selected',
    await popup.textContent('#company-count')
  );
  check(
    'the cost is stated before anything is spent',
    /Up to 2 credits/.test(await popup.textContent('#company-cost')),
    await popup.textContent('#company-cost')
  );

  check('with a list chosen and people ticked, saving is offered', await popup.locator('#company-save').isEnabled());
  check('an empty person card does not sit under the panel', !(await popup.locator('.person-card').isVisible()));
  await popup.waitForTimeout(250);
  await shot(popup, '10-company-selected');
  await popup.click('#company-save');
  await popup.waitForFunction(() => document.querySelectorAll('#company-results .badge-success').length === 2, null, {
    timeout: 15000,
  });

  const { reveals } = await mock('/__prospector');
  check('one reveal per ticked person', reveals.length === 2, String(reveals.length));
  check('every reveal carries the chosen list', reveals.every((r) => r.list_id === 'L1'), JSON.stringify(reveals));
  check(
    'and the search row the contact is built from',
    reveals.every((r) => r.person?.first_name && r.person?.last_name && r.person?.company === 'Northwind Capital'),
    JSON.stringify(reveals.map((r) => r.person))
  );
  check(
    'and the search that found them, for the contact\'s source',
    reveals.every((r) => r.search?.companies?.[0] === 'northwind.io'),
    JSON.stringify(reveals.map((r) => r.search))
  );
  const status = await popup.textContent('#status');
  check('the result says where they went', status.includes('Saved 2 to "Brokers'), status);
  check('and which campaign they joined', status.includes('Q3 Brokers Outreach'), status);
  check(
    'the found address replaces the title on the row',
    (await popup.locator('#company-results .person-row-email').count()) === 2
  );
  check('saved rows cannot be saved twice', await popup.locator('#company-save').isDisabled());
  await shot(popup, '11-company-saved');

  await popup.close();
  await site.close();

  /* ---------------- on a LinkedIn company page ---------------- */

  const page = await context.newPage();
  await page.goto(COMPANY_PAGE);
  await page.waitForTimeout(700);
  const tabId = (await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` })).map((t) => t.id), COMPANY_PAGE))[0];
  const scraped = await worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'SINCERELY_SCRAPE' }), tabId);
  check('a company page is read as a company', scraped?.company_page?.name === 'Northwind Capital', JSON.stringify(scraped));
  check(
    "its website comes from the top card, through LinkedIn's redirector",
    scraped?.company_page?.domain === 'northwind.io',
    JSON.stringify(scraped?.company_page)
  );
  check('and the company is never taken for a person', !scraped?.full_name && !scraped?.first_name, JSON.stringify(scraped));

  const searchesBefore = (await mock('/__prospector')).searches.length;
  const sidebar = await popupOver(extensionId, COMPANY_PAGE);
  await sidebar.waitForFunction(() => !document.getElementById('company-block')?.classList.contains('hidden'), null, {
    timeout: 20000,
  });
  await sidebar.waitForFunction(() => document.querySelectorAll('#company-results .person-row').length > 0, null, {
    timeout: 10000,
  }).catch(() => {});
  const pageSearch = (await mock('/__prospector')).searches.slice(searchesBefore);
  check(
    'a company page searches by itself, on the website it lists',
    pageSearch.length === 1 && pageSearch[0].filters?.companies?.[0] === 'northwind.io',
    JSON.stringify(pageSearch)
  );
  check(
    'the sidebar leads with the company',
    (await sidebar.textContent('#company-title')).trim() === 'People at Northwind Capital',
    await sidebar.textContent('#company-title')
  );
  await shot(sidebar, '12-linkedin-company');
  check('the empty person card is not shown', !(await sidebar.locator('.person-card').isVisible()));
  check('nor the single-person Add', !(await sidebar.locator('#add').isVisible()));
  await sidebar.close();
  await page.close();

  /* ---------------- LinkedIn search results ---------------- */

  await fetch('http://localhost:3001/__reset');
  const bulk = await options.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'BULK_ADD_PROFILES',
      payload: { listId: 'L3', people: [{ first_name: 'Sam', last_name: 'Rivera', company: 'Northwind Capital' }] },
    })
  );
  check('a bulk add from LinkedIn still works', bulk?.ok === true && bulk.data.revealed === 1, JSON.stringify(bulk));
  const bulkReveal = (await mock('/__prospector')).reveals[0];
  check(
    'its reveal files them on the list and carries their details',
    bulkReveal?.list_id === 'L3' && bulkReveal?.person?.first_name === 'Sam' && bulkReveal?.person?.linkedin_url,
    JSON.stringify(bulkReveal)
  );
} catch (err) {
  failures.push(`threw: ${err.message}`);
  console.log(`  FAIL  threw: ${err.stack}`);
} finally {
  await context.close();
  stub.kill();
}

console.log(`\n${failures.length ? `${failures.length} failed` : 'all passed'}`);
process.exit(failures.length ? 1 : 0);
