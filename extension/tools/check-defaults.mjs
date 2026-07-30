/**
 * The production API host lives in four places that must agree. They drifted
 * once already: the default pointed at a host that was never deployed, and it
 * was missing from host_permissions, so the extension asked Chrome for access
 * to an origin it should already have had — an extra click for every user, and
 * a bare "Failed to fetch" for anyone who declined.
 *
 * Pure file reads, so this runs in a second with no browser.
 */
import { readFileSync } from 'node:fs';

const EXT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const storage = readFileSync(`${EXT}/lib/storage.js`, 'utf8');
const manifest = JSON.parse(readFileSync(`${EXT}/manifest.json`, 'utf8'));
const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');

const defaultBase = storage.match(/DEFAULT_API_BASE = '([^']+)'/)?.[1];
check('lib/storage.js declares a default API base', Boolean(defaultBase), String(defaultBase));

const defaultOrigin = new URL(defaultBase).origin;

check(
  'the default API origin is in host_permissions, so it needs no runtime grant',
  manifest.host_permissions.includes(`${defaultOrigin}/*`),
  manifest.host_permissions.join(' ')
);

// The declared list inside originPatternFor(); anything in host_permissions
// must be here, or the extension prompts for access Chrome already gave it.
const declaredBlock = storage.match(/const declared = \[([^\]]+)\]/)?.[1] || '';
const declared = [...declaredBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
check('originPatternFor() has a declared list', declared.length > 0, declared.join(' '));

const apiHosts = manifest.host_permissions
  .filter((pattern) => !/linkedin|mail\.google/.test(pattern))
  .map((pattern) => pattern.replace(/\/\*$/, ''));

for (const host of apiHosts) {
  check(`host_permissions entry ${host} is also declared in originPatternFor()`, declared.includes(host));
}
for (const origin of declared) {
  check(`declared origin ${origin} is also in host_permissions`, apiHosts.includes(origin));
}

check(
  '.env.example points production VITE_API_URL at the same host',
  new RegExp(`VITE_API_URL=${defaultBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(envExample),
  envExample.split('\n').find((line) => line.includes('Production: VITE_API_URL')) || 'not found'
);

check(
  'the options page placeholder shows the same host',
  readFileSync(`${EXT}/options/options.html`, 'utf8').includes(`placeholder="${defaultOrigin}"`),
  defaultOrigin
);

check(
  'the README production row shows the same host',
  readFileSync(`${EXT}/README.md`, 'utf8').includes(`| Production | \`${defaultOrigin}\` |`),
  defaultOrigin
);

// The app's own pages, for the in-app Connect button's content script.
const connectEntry = manifest.content_scripts.find((entry) =>
  entry.js.includes('content/connect.js')
);
check('connect.js is declared as a content script', Boolean(connectEntry));
check(
  'and covers subdomains of the app domain, not just the bare host',
  connectEntry.matches.some((pattern) => pattern.startsWith('https://*.')),
  connectEntry.matches.join(' ')
);

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  - ${failures.join('\n  - ')}`
    : '\ndefaults: all checks passed'
);
process.exit(failures.length ? 1 : 0);
