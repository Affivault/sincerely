/**
 * Sales Navigator.
 *
 * This is where anyone paying for a cold-email tool actually prospects, and
 * until now the extension did nothing there at all. Not a stale selector —
 * a gap in the concept. The manifest matched linkedin.com/*, so every
 * content script loaded, but each of them then checked the path: the
 * scraper wanted /in/, the bulk bar wanted /search/results/people, and the
 * launcher wanted either. On /sales/ all three loaded and did nothing.
 *
 * Three things are worth testing, and they are the three that would break
 * first:
 *
 *   - the lead page reads the lead, not the rail. A Sales Navigator lead
 *     page lists other people at the same company beside the profile, each
 *     with their own person-name node, so an unscoped read of the first one
 *     returns a colleague. That is the kind of wrong that looks right.
 *
 *   - a lead with no /in/ link still produces a contact. Sales Navigator
 *     usually links only to its own /sales/lead/ route, and storing nothing
 *     rather than a working-for-you link would drop the lead entirely.
 *
 *   - search rows are found by name marker, not by profile link. There are
 *     no /in/ links in a Sales Navigator result row, which is precisely why
 *     the existing findRows returned zero of them.
 *
 * Needs `linkedin-stub.mjs`, started here so this suite owns its pages.
 */
import { chromium } from 'playwright';
import { CHROMIUM } from './chromium.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCert } from './tls.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(here, '..');
const STUB_PORT = 3448;

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
  env: { ...process.env, LINKEDIN_STUB_PORT: String(STUB_PORT) },
});
process.on('exit', () => stub.kill());
await new Promise((resolve) => setTimeout(resolve, 900));

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-salesnav-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    `--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:${STUB_PORT}`,
    `--ignore-certificate-errors-spki-list=${spki}`,
    '--no-proxy-server',
  ],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });

  /** Open a Sales Navigator page and ask the content script what it sees. */
  async function scrapeAt(path) {
    const url = `https://www.linkedin.com${path}`;
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(600);
    const tabId = (await worker.evaluate(
      async (u) => (await chrome.tabs.query({ url: u })).map((t) => t.id),
      url,
    ))[0];
    const result = await worker.evaluate(
      async (id) => chrome.tabs.sendMessage(id, { type: 'SINCERELY_SCRAPE' }),
      tabId,
    );
    await page.close();
    return result;
  }

  /* ---------------- the lead page ---------------- */

  console.log('\na Sales Navigator lead is read as a person');

  const lead = await scrapeAt('/sales/lead/ACwAAB1sales,NAME_SEARCH');

  check(
    'the lead is scraped at all — on /sales/ this used to return nothing',
    Boolean(lead && lead.full_name),
    JSON.stringify(lead),
  );
  check(
    'and it is the lead, not the first person in the right-hand rail',
    lead?.first_name === 'Ana' && lead?.last_name === 'Beltrán',
    JSON.stringify(lead),
  );
  check(
    'the job title comes from its own marked field',
    lead?.job_title === 'VP Revenue Operations',
    JSON.stringify(lead),
  );
  check(
    'so does the company',
    lead?.company === 'Northwind Capital',
    JSON.stringify(lead),
  );
  check(
    'the public profile link is preferred, so this is not a duplicate of a contact you already hold',
    lead?.linkedin_url === 'https://www.linkedin.com/in/ana-beltran-77',
    JSON.stringify(lead),
  );
  check(
    'nothing is reported as still loading — Sales Navigator has no contact-info overlay to wait for',
    lead?.contact_info_pending === false,
    JSON.stringify(lead),
  );

  /* ---------------- a lead with no public profile ---------------- */

  console.log('\na lead with no link out still becomes a contact');

  const noPublic = await scrapeAt('/sales/lead/nopublic,NAME_SEARCH');
  check(
    'the person is still read',
    noPublic?.first_name === 'Tomas' && noPublic?.last_name === 'Nowak',
    JSON.stringify(noPublic),
  );
  check(
    'the Sales Navigator URL is stored rather than nothing',
    /\/sales\/lead\//.test(String(noPublic?.linkedin_url || '')),
    JSON.stringify(noPublic),
  );
  check(
    'and "Title @ Company" still splits',
    noPublic?.job_title === 'Head of Growth' && noPublic?.company === 'Brightline',
    JSON.stringify(noPublic),
  );

  /* ---------------- the search results page ---------------- */

  console.log('\nsearch results get a bulk bar and readable rows');

  const search = await context.newPage();
  await search.goto('https://www.linkedin.com/sales/search/people?query=x');
  await search.waitForLoadState('domcontentloaded');
  await search.waitForTimeout(1400);

  const bar = await search.evaluate(() => {
    const host = document.getElementById('sincerely-bulk-host');
    return Boolean(host && host.shadowRoot && host.shadowRoot.querySelector('.bar'));
  });
  check('the bulk bar appears on a Sales Navigator search', bar);

  const boxes = await search.evaluate(
    () => document.querySelectorAll('.sincerely-box-host').length,
  );
  check(
    'every result row gets a checkbox, despite none of them carrying an /in/ link',
    boxes === 3,
    `found ${boxes}`,
  );

  const marked = await search.evaluate(() =>
    [...document.querySelectorAll('[data-sincerely-row]')].map((n) =>
      n.getAttribute('data-sincerely-row'),
    ),
  );
  check(
    'and each row is keyed by its lead URL',
    marked.length === 3 && marked.every((u) => /\/sales\/lead\/ACwAAA00\d$/.test(u)),
    JSON.stringify(marked),
  );

  // The trap this fixture exists for: an ancestor holding all three names
  // must not be taken as one row, which would collapse the page into a
  // single selection.
  check(
    'the list itself is not mistaken for a row',
    new Set(marked).size === 3,
    JSON.stringify(marked),
  );

  await search.close();

  /* ---------------- the launcher ---------------- */

  console.log('\nand there is a way into the sidebar from a lead');

  const leadPage = await context.newPage();
  await leadPage.goto('https://www.linkedin.com/sales/lead/ACwAAB1sales,NAME_SEARCH');
  await leadPage.waitForLoadState('domcontentloaded');
  await leadPage.waitForTimeout(900);
  const launcher = await leadPage.evaluate(() => {
    const host = document.getElementById('sincerely-launcher-host');
    return Boolean(host && host.shadowRoot && host.shadowRoot.querySelector('.launch'));
  });
  check('the launcher is mounted on a Sales Navigator lead page', launcher);
  await leadPage.close();
} finally {
  await context.close();
  stub.kill();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
