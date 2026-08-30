/**
 * The LinkedIn agent's hands.
 *
 * content/act.js is the only part of this extension that clicks things on
 * somebody's real LinkedIn account, and it had no test at all. That is the
 * worst place in the codebase to be running blind: a selector that misses
 * reports a failure the server records against the task, and a selector that
 * is too loose clicks the wrong button on a stranger's profile.
 *
 * The stub profile it runs against carries LinkedIn's real button markup —
 * visible text and an aria-label that say different things — because that is
 * exactly what the matching has to survive.
 *
 * The second half drives the worker's own loop — agentTick, agentPerform, the
 * tab it opens and the verdict it reports — against the mock's agent
 * endpoints. That loop was also untested, and held two faults: a listener
 * leaked on every timed-out action, and a profile that finished loading before
 * the listener attached was never acted on at all, timing out after a minute
 * and being reported to the server as a failure.
 *
 * Needs `linkedin-stub.mjs` and `mock-api.mjs`. run.mjs starts the mock; the
 * stub is started here so this suite can own the profile it drives.
 */
import { chromium } from 'playwright';
import { CHROMIUM, openExtensionPage } from './chromium.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCert } from './tls.mjs';

import { TEST_API_KEY } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(here, '..');
const LINKEDIN_STUB_PORT = 3444;
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

const { spki } = await ensureCert();

const stub = spawn('node', [join(here, 'linkedin-stub.mjs')], {
  stdio: 'ignore',
  env: { ...process.env, LINKEDIN_STUB_PORT: String(LINKEDIN_STUB_PORT) },
});
process.on('exit', () => stub.kill());
await new Promise((resolve) => setTimeout(resolve, 900));

const userDataDir = mkdtempSync(join(tmpdir(), 'sincerely-agent-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    `--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:${LINKEDIN_STUB_PORT}`,
    `--ignore-certificate-errors-spki-list=${spki}`,
    // CI and dev containers often set an HTTPS proxy, which would tunnel
    // linkedin.com outward and defeat the resolver rule. Everything is local.
    '--no-proxy-server',
  ],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });

  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/in/agent-target/');
  await page.waitForLoadState('domcontentloaded');

  /* act.js is declared for /in/* in the manifest, so it is already there. The
     worker is the only thing that can message a content script, so the action
     is dispatched from there — the same call path production uses. */
  const tabs = await worker.evaluate(async () => {
    const all = await chrome.tabs.query({ url: 'https://www.linkedin.com/in/*' });
    return all.map((t) => t.id);
  });
  check('the profile tab is visible to the worker', tabs.length > 0, JSON.stringify(tabs));
  const tabId = tabs[0];

  /* ---------------- connect, with a note ---------------- */

  const reply = await worker.evaluate(
    async ([id, note]) => {
      try {
        return await chrome.tabs.sendMessage(id, {
          type: 'AGENT_ACT',
          action: { channel: 'linkedin_connect', message: note, title: 'Connect with Rowan' },
        });
      } catch (err) {
        return { ok: false, reason: `sendMessage failed: ${err?.message || err}` };
      }
    },
    [tabId, 'Enjoyed your post on platform teams.'],
  );

  check(
    'the connection request goes through',
    reply?.ok === true,
    JSON.stringify(reply),
  );

  const state = await page.evaluate(() => window.__agent);
  check('an invitation was actually sent', state?.invitesSent === 1, JSON.stringify(state));
  check(
    'the note went with it, rather than an empty invite',
    state?.note === 'Enjoyed your post on platform teams.',
    JSON.stringify(state),
  );

  /* ---------------- already connected is not a failure ---------------- */

  // Strip Connect, leaving only Message — LinkedIn's shape for someone you
  // are already connected to. The agent should move on, not report an error.
  await page.evaluate(() => document.getElementById('connect')?.remove());
  const second = await worker.evaluate(
    async (id) =>
      chrome.tabs.sendMessage(id, {
        type: 'AGENT_ACT',
        action: { channel: 'linkedin_connect', message: 'hi', title: 'Connect again' },
      }),
    tabId,
  );
  check(
    'an existing connection is reported as done, not as a missing button',
    second?.ok === true && second?.already === true,
    JSON.stringify(second),
  );

  /* ---------------- a checkpoint stops everything ---------------- */

  await page.evaluate(() => {
    const note = document.createElement('p');
    note.textContent = 'We restricted your account for unusual activity.';
    document.body.appendChild(note);
  });
  const blocked = await worker.evaluate(
    async (id) =>
      chrome.tabs.sendMessage(id, {
        type: 'AGENT_ACT',
        action: { channel: 'linkedin_visit', title: 'Visit' },
      }),
    tabId,
  );
  check(
    'a restriction notice stops the agent fatally rather than being retried into',
    blocked?.ok === false && blocked?.fatal === true,
    JSON.stringify(blocked),
  );

  await page.close();

  /* ================================================================ */
  /* The worker's own loop: ask, open, act, report                    */
  /* ================================================================ */

  await worker.evaluate(
    ([key, api]) => chrome.storage.local.set({ apiKey: key, apiBaseUrl: api, agentPaused: false }),
    [TEST_API_KEY, API],
  );

  await fetch(`${MOCK}/__queue-agent-action?taskId=t1&channel=linkedin_visit`);

  // Sent from an extension page, not the worker: a worker cannot message
  // itself, and this is the same path the options page's "run now" uses.
  const extensionId = new URL(worker.url()).host;
  const driver = await openExtensionPage(context, `chrome-extension://${extensionId}/options/options.html`);
  await driver.waitForLoadState('domcontentloaded');

  await driver.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'AGENT_TICK_NOW', payload: {} }),
  );

  /*
   * Wait for the run to actually finish rather than for the message to come
   * back. Setting the API key fires a tick of its own through the storage
   * listener, so AGENT_TICK_NOW can find agentBusy already true and return
   * immediately while the real run is still opening the tab.
   */
  const TERMINAL = ['done_one', 'skipped_one', 'blocked', 'error', 'nothing_due'];
  const deadline = Date.now() + 40000;
  let status = null;
  while (Date.now() < deadline) {
    status = await worker.evaluate(async () =>
      (await chrome.storage.local.get('agentState')).agentState?.status ?? null,
    );
    if (TERMINAL.includes(status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  check('the run reaches a terminal state rather than hanging', TERMINAL.includes(status), String(status));

  const stats = await (await fetch(`${MOCK}/__agent-stats`)).json();
  check('the action was collected from the server', stats.handedOut.includes('t1'), JSON.stringify(stats));
  check(
    'and reported done, not timed out',
    stats.done.includes('t1'),
    `done ${JSON.stringify(stats.done)} failed ${JSON.stringify(stats.failed)}`,
  );

  const leftOpen = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    return tabs.length;
  });
  check('the tab it opened was closed again', leftOpen === 0, `${leftOpen} left open`);

  const agentState = await worker.evaluate(async () =>
    (await chrome.storage.local.get('agentState')).agentState,
  );
  check(
    'and the run is recorded for the UI',
    agentState?.status === 'done_one',
    JSON.stringify(agentState),
  );
} finally {
  await context.close();
  stub.kill();
}

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  - ${failures.join('\n  - ')}`
    : `\nagent: all ${passed} checks passed`,
);
process.exit(failures.length ? 1 : 0);
