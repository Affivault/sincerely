/**
 * Exercises the in-page panel on a real linkedin.com/in/ URL.
 *
 * The URL matters: the content script only runs on hosts declared in the
 * manifest, so the page is served by intercepting the request rather than by
 * pointing at localhost. That also means the LinkedIn adapter's selectors are
 * finally tested against markup shaped like the real profile page instead of
 * only being checked for syntax.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_API_KEY } from './fixtures.mjs';
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

/** Markup mirroring LinkedIn's profile top card, including the classes the adapter targets. */
const PROFILE = (slug, name, headline, company) => `<!doctype html>
<html lang="en"><head><title>${name} | LinkedIn</title></head>
<body>
  <nav>LinkedIn nav</nav>
  <main>
    <section class="artdeco-card pv-top-card">
      <div class="pv-text-details__left-panel">
        <h1 class="text-heading-xlarge inline t-24 v-align-middle break-words">${name}</h1>
        <div class="text-body-medium break-words">${headline}</div>
      </div>
      <ul class="pv-text-details__right-panel">
        <li><button aria-label="Current company: ${company}. Click to skip to experience card">
          <span class="pv-text-details__right-panel-item-text">${company}</span>
        </button></li>
      </ul>
    </section>
  </main>
  <script>history.replaceState({}, '', '/in/${slug}/');</script>
</body></html>`;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'panel-')), {
  executablePath: '/opt/pw-browsers/chromium',
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});

/** Serve our own markup for any LinkedIn profile URL. */
await context.route('https://www.linkedin.com/**', async (route) => {
  const url = route.request().url();
  const slug = (url.match(/\/in\/([^/?#]+)/) || [])[1] || 'unknown';
  const people = {
    'jane-doe': ['Jane Doe', 'Head of Trading at Acme Ltd', 'Acme Ltd'],
    'sam-rivera': ['Sam Rivera', 'Head of Growth at Northwind Capital', 'Northwind Capital'],
  };
  // Anything that isn't a profile gets feed-shaped markup — otherwise the
  // profile fixture's replaceState would turn every URL into a profile and the
  // "don't mount on the feed" check would be testing nothing.
  if (!/\/in\//.test(new URL(url).pathname)) {
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Feed | LinkedIn</title></head><body><main><h1>Feed</h1></main></body></html>',
    });
  }

  const [name, headline, company] = people[slug] || ['Unknown Person', 'Consultant at Nowhere', 'Nowhere'];
  await route.fulfill({ status: 200, contentType: 'text/html', body: PROFILE(slug, name, headline, company) });
});

/** Read something out of the panel's shadow root. */
async function panelText(page) {
  return page.evaluate(() => {
    const host = document.getElementById('sincerely-panel-host');
    return host?.shadowRoot?.querySelector('.panel')?.textContent ?? '';
  });
}

/**
 * Wait until the panel has finished its deep contact-info read.
 *
 * The panel paints immediately and then says "Checking contact info…" while it
 * works through the routes — including opening LinkedIn's overlay by URL when
 * there is no link to click. Acting before that settles means clicking buttons
 * the panel has not drawn yet.
 */
async function settled(page) {
  await page.waitForFunction(
    () => {
      const text =
        document.getElementById('sincerely-panel-host')?.shadowRoot?.querySelector('.panel')
          ?.textContent || '';
      return text && !text.includes('Reading this page') && !text.includes('Checking contact info');
    },
    null,
    { timeout: 25000 }
  );
}

async function panelQuery(page, selector) {
  return page.evaluate((sel) => {
    const host = document.getElementById('sincerely-panel-host');
    return host?.shadowRoot?.querySelector(sel)?.textContent ?? null;
  }, selector);
}

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  // Connect first.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);
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

  /* ---------- a known contact's profile ---------- */

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto('https://www.linkedin.com/in/jane-doe/');

  await page.waitForFunction(
    () => document.getElementById('sincerely-panel-host')?.shadowRoot?.querySelector('.panel'),
    null,
    { timeout: 15000 }
  );
  check('the panel mounts itself on a LinkedIn profile', true);
  check('no page errors from the injected panel', pageErrors.length === 0, pageErrors.join(' | '));

  await settled(page);

  check(
    'the LinkedIn adapter reads the name from the real top-card markup',
    (await panelQuery(page, '.who-name')) === 'Jane Doe',
    await panelQuery(page, '.who-name')
  );
  check(
    'it reads title and company from the headline and current-company button',
    (await panelQuery(page, '.who-sub')) === 'Head of Trading · Acme Ltd',
    await panelQuery(page, '.who-sub')
  );
  check('the avatar shows initials', (await panelQuery(page, '.avatar')) === 'JD');
  check(
    'a LinkedIn profile with no address says so',
    /No email on this profile/.test(await panelText(page))
  );
  check(
    'the Prospector is offered right there',
    /Find their email/.test(await panelText(page))
  );

  /* ---------- find + reveal, in the page ---------- */

  await page.evaluate(() => {
    const buttons = [...document.getElementById('sincerely-panel-host').shadowRoot.querySelectorAll('button')];
    buttons.find((b) => b.textContent.includes('Find their email'))?.click();
  });
  // Jane isn't in the prospect database, so this is the no-match path: it must
  // say nothing was charged rather than leaving a spinner.
  await page.waitForFunction(
    () => document.getElementById('sincerely-panel-host')?.shadowRoot?.textContent?.includes('No match'),
    null,
    { timeout: 15000 }
  );
  check(
    'a miss says plainly that nothing was charged',
    /Nothing was charged/.test(await panelText(page)),
    await panelText(page)
  );

  /* ---------- an address revealed after load (Contact info) ---------- */

  // The commonest LinkedIn case: the address is behind "Contact info", so it
  // isn't in the DOM when the panel first reads the page.
  await page.evaluate(() => {
    const modal = document.createElement('section');
    modal.className = 'pv-contact-info';
    modal.innerHTML =
      '<h3>Contact info</h3><a href="mailto:jane.doe@acme.com">jane.doe@acme.com</a>';
    document.querySelector('main').appendChild(modal);
  });

  await page.waitForFunction(
    () =>
      document
        .getElementById('sincerely-panel-host')
        ?.shadowRoot?.querySelector('.panel')
        ?.textContent?.includes('jane.doe@acme.com'),
    null,
    { timeout: 15000 }
  );
  check('an address opened after load is picked up without a reload', true);
  check(
    'and the panel says where it came from',
    /Found jane\.doe@acme\.com on this profile/.test(await panelText(page)),
    await panelText(page)
  );
  check(
    'the lead-list picker appears now there is something to act on',
    (await page.evaluate(
      () => !!document.getElementById('sincerely-panel-host').shadowRoot.querySelector('#sx-list')
    )) === true
  );
  check(
    'their existing list membership is shown alongside it',
    /Brokers — UK/.test(await panelText(page)),
    await panelText(page)
  );

  /* ---------- a profile we can act on ---------- */

  await page.goto('https://www.linkedin.com/in/sam-rivera/');
  await page.waitForFunction(
    () => {
      const text = document.getElementById('sincerely-panel-host')?.shadowRoot?.textContent || '';
      return text.includes('Sam Rivera');
    },
    null,
    { timeout: 15000 }
  );
  check('the panel follows an SPA navigation to a new profile', true);

  await settled(page);
  await page.evaluate(() => {
    const buttons = [...document.getElementById('sincerely-panel-host').shadowRoot.querySelectorAll('button')];
    buttons.find((b) => b.textContent.includes('Find their email'))?.click();
  });
  await page.waitForFunction(
    () => document.getElementById('sincerely-panel-host')?.shadowRoot?.textContent?.includes('Reveal email'),
    null,
    { timeout: 15000 }
  );
  check(
    'the cost is stated in the panel before the spend',
    /1 credit/.test(await panelText(page)),
    await panelText(page)
  );
  await page.evaluate(() => {
    const buttons = [...document.getElementById('sincerely-panel-host').shadowRoot.querySelectorAll('button')];
    buttons.find((b) => b.textContent.includes('Reveal email'))?.click();
  });
  // Match inside .panel, not the shadow root — the root also holds the <style>
  // block, whose @media rule would satisfy a naive '@' check instantly.
  await page.waitForFunction(
    () =>
      document
        .getElementById('sincerely-panel-host')
        ?.shadowRoot?.querySelector('.panel')
        ?.textContent?.includes('sam.rivera@'),
    null,
    { timeout: 20000 }
  );
  check(
    'revealing puts the address into the panel',
    /sam\.rivera@northwind\.example\.org/.test(await panelText(page)),
    await panelText(page)
  );
  check(
    'once there is an address, the lead-list picker appears',
    (await page.evaluate(
      () => !!document.getElementById('sincerely-panel-host').shadowRoot.querySelector('#sx-list')
    )) === true
  );

  await page.screenshot({ path: join(OUT, '9-panel-linkedin.png') });

  /* ---------- add from the panel ---------- */

  await page.evaluate(() => {
    const shadow = document.getElementById('sincerely-panel-host').shadowRoot;
    const select = shadow.querySelector('#sx-list');
    select.value = 'L1';
    select.dispatchEvent(new Event('change'));
    // The verb only — the select beside it names the destination.
    [...shadow.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add')?.click();
  });
  await page.waitForFunction(
    () => document.getElementById('sincerely-panel-host')?.shadowRoot?.textContent?.includes('Added to'),
    null,
    { timeout: 20000 }
  );
  check('adding works from inside the page', /Added to "Brokers — UK"/.test(await panelText(page)));
  check('a successful add offers Undo in the panel', /Undo/.test(await panelText(page)));
  check(
    'the membership appears in the panel without a reload',
    /On these lead lists/.test(await panelText(page)),
    await panelText(page)
  );
  check(
    'the panel never claims "not on any lead list" while announcing an add',
    !/not on any lead list/.test(await panelText(page)),
    await panelText(page)
  );

  await page.screenshot({ path: join(OUT, '10-panel-added.png') });

  /* ---------- collapse ---------- */

  await page.evaluate(() => {
    const shadow = document.getElementById('sincerely-panel-host').shadowRoot;
    shadow.querySelector('.head button')?.click();
  });
  await page.waitForFunction(
    () => document.getElementById('sincerely-panel-host')?.shadowRoot?.querySelector('.panel.collapsed'),
    null,
    { timeout: 5000 }
  );
  check('the panel collapses out of the way', true);

  // chrome.storage isn't reachable from the page context; read it from an
  // extension page instead.
  const collapsedPref = await options.evaluate(() => chrome.storage.local.get({ panelCollapsed: false }));
  check('the collapsed choice is remembered', collapsedPref.panelCollapsed === true);

  /* ---------- stays off pages it has no business on ---------- */

  const feed = await context.newPage();
  await feed.goto('https://www.linkedin.com/feed/');
  await feed.waitForTimeout(2000);
  const onFeed = await feed.evaluate(
    () => !!document.getElementById('sincerely-panel-host')?.shadowRoot?.querySelector('.panel')
  );
  check('no panel on the LinkedIn feed, only on profiles', onFeed === false);
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
