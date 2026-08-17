/**
 * Run every extension suite.
 *
 * These tests drive the *real* unpacked extension in Chromium — service worker,
 * content scripts, popup, options page — against a mock API that mirrors the
 * server's response shapes. That is deliberate: almost every bug this extension
 * has had was a wiring or timing fault (a message type nothing handled, a scrape
 * that blocked the UI, a key saved but never verified) and none of those are
 * visible to a unit test.
 *
 *   node tests/run.mjs            every suite
 *   node tests/run.mjs fastpath   just one
 *
 * Requires: playwright, and a Chromium — see chromium.mjs for how it is found.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Pure-node suites: no browser, no services. */
const UNIT = ['defaults.test.mjs', 'harvest.test.mjs'];

/** Browser suites, each needing the mock API up. */
const BROWSER = [
  'smoke.mjs',
  'connect.mjs',
  'tabconnect.mjs',
  'coldstart.mjs',
  'launcher.mjs',
  'listbar.mjs',
  'scan.mjs',
  'fastpath.mjs',
  'ratelimit.mjs',
  'agent.mjs',
  'regressions.mjs',
  /*
   * Screenshots of every surface, last because it asserts nothing — it only
   * produces the images the UI gets judged from. It sat in this directory
   * unlisted, so those images went stale for weeks while the panel was
   * rebuilt underneath them, which is exactly how a design regression ships
   * unnoticed.
   */
  'shots.mjs',
];

const only = process.argv[2];
const match = (name) => !only || name.startsWith(only) || name === `${only}.mjs`;

/** @param {string} file @returns {Promise<boolean>} */
function run(file) {
  return new Promise((resolve) => {
    console.log(`\n━━━ ${file} ${'━'.repeat(Math.max(0, 56 - file.length))}`);
    const child = spawn('node', [join(here, file)], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

/** Wait for the mock to actually answer, rather than sleeping and hoping. */
async function waitForMock(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://localhost:3001/__reset');
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const unitSuites = UNIT.filter(match);
const browserSuites = BROWSER.filter(match);

if (unitSuites.length === 0 && browserSuites.length === 0) {
  console.error(`No suite matches "${only}".`);
  process.exit(1);
}

/** @type {string[]} */
const failed = [];

for (const suite of unitSuites) {
  if (!(await run(suite))) failed.push(suite);
}

if (browserSuites.length > 0) {
  /*
   * Refuse to run against a mock we did not start.
   *
   * A stale mock left listening on :3001 from an earlier session silently wins
   * the port, the freshly spawned one dies, and every suite then tests an old
   * build of the fixture — which presents as impossible failures ("no mock route
   * for POST /lists" when the route is plainly there). Fail loudly instead.
   */
  const alreadyUp = await fetch('http://localhost:3001/__reset')
    .then(() => true)
    .catch(() => false);
  if (alreadyUp) {
    console.error(
      '\nSomething is already listening on :3001. That is almost certainly a stale\n' +
        'mock-api.mjs, and running against it tests the wrong fixture.\n' +
        'Stop it first:  pkill -f mock-api.mjs\n'
    );
    process.exit(1);
  }

  const mock = spawn('node', [join(here, 'mock-api.mjs')], { stdio: 'ignore' });
  process.on('exit', () => mock.kill());

  if (!(await waitForMock())) {
    console.error('\nThe mock API never came up on :3001.');
    mock.kill();
    process.exit(1);
  }

  for (const suite of browserSuites) {
    // Every suite resets the mock itself, so one leaving state behind cannot
    // change what the next one sees.
    await fetch('http://localhost:3001/__reset').catch(() => {});
    if (!(await run(suite))) failed.push(suite);
  }

  mock.kill();
}

console.log(`\n${'═'.repeat(60)}`);
if (failed.length === 0) {
  console.log(`All ${unitSuites.length + browserSuites.length} suite(s) passed.`);
} else {
  console.log(`${failed.length} suite(s) failed: ${failed.join(', ')}`);
  process.exit(1);
}
