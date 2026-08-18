/**
 * The LinkedIn adapter against the markup LinkedIn actually ships.
 *
 * content/scraper.js carries a fallback chain per field — four selectors for
 * the name, three for the headline, three for the company. The existing
 * fixtures only ever exercise the last one in each chain, so the top-card
 * markup that most real profiles use, and the most reliable company signal the
 * adapter has, were never read by a test at all.
 *
 * Nor was any of the name cleaning, which is what decides whether a contact is
 * stored as "Priya Raman" or as "Priya Raman (she/her) · 2nd". LinkedIn
 * appends pronouns, connection degree and credentials to the visible name, and
 * every one of those lands in a stored last name if it is not stripped —
 * permanently, on a record that then gets merge-tagged into an email.
 *
 * Needs `linkedin-stub.mjs`, started here so this suite owns its profiles.
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
const LINKEDIN_STUB_PORT = 3445;

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
await new Promise((resolve) => setTimeout(resolve, 900));

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-variants-'));
const context = await chromium.launchPersistentContext(userDataDir, {
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

  /** Load a variant profile and ask the content script what it sees. */
  async function scrape(slug) {
    const page = await context.newPage();
    await page.goto(`https://www.linkedin.com/in/${slug}/`);
    await page.waitForLoadState('domcontentloaded');
    // The adapter reads the DOM as it stands; give the script a beat to land.
    await page.waitForTimeout(600);
    const tabId = (await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      return tabs.map((t) => t.id);
    }, `https://www.linkedin.com/in/${slug}/`))[0];
    const result = await worker.evaluate(
      async (id) => chrome.tabs.sendMessage(id, { type: 'SINCERELY_SCRAPE' }),
      tabId,
    );
    await page.close();
    return result;
  }

  /* ---------------- the top card ---------------- */

  const topcard = await scrape('variant-topcard');
  check(
    'the name is read from the top card, not only from a bare h1',
    topcard?.first_name === 'Ines' && topcard?.last_name === 'Okonkwo',
    JSON.stringify(topcard),
  );
  check(
    "the current-company button is read — the adapter's most reliable company signal",
    topcard?.company === 'Northwind Capital',
    JSON.stringify(topcard),
  );
  check(
    'and the headline becomes the job title',
    topcard?.job_title === 'Chief Revenue Officer',
    JSON.stringify(topcard),
  );

  /* ---------------- headline shapes ---------------- */

  const atSign = await scrape('variant-at-sign');
  check(
    '"Title @ Company" splits the same way "Title at Company" does',
    atSign?.job_title === 'Partner' && atSign?.company === 'Northwind Capital',
    JSON.stringify(atSign),
  );

  const noCompany = await scrape('variant-no-company');
  check(
    'a headline with no company gives a title and no invented employer',
    noCompany?.job_title === 'Software Engineer' && !noCompany?.company,
    JSON.stringify(noCompany),
  );

  /* ---------------- what LinkedIn appends to a name ---------------- */

  const pronouns = await scrape('variant-pronouns');
  check(
    'pronouns and the connection degree are stripped from the name',
    pronouns?.first_name === 'Priya' && pronouns?.last_name === 'Raman',
    JSON.stringify(pronouns),
  );

  const credentials = await scrape('variant-credentials');
  check(
    'trailing credentials do not become part of the surname',
    credentials?.first_name === 'Jane' && credentials?.last_name === 'Doe',
    JSON.stringify(credentials),
  );

  const doubled = await scrape('variant-doubled');
  check(
    'a name printed twice for screen readers is stored once',
    doubled?.first_name === 'Ada' && doubled?.last_name === 'Lovelace',
    JSON.stringify(doubled),
  );
} finally {
  await context.close();
  stub.kill();
}

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  - ${failures.join('\n  - ')}`
    : `\nscraper-variants: all ${passed} checks passed`,
);
process.exit(failures.length ? 1 : 0);
