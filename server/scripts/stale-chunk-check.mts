/* ===================================================================
   A tab open across a deploy must not show "Failed to fetch dynamically
   imported module".

   After a deploy the hashed screen chunks an old tab knows about are
   gone. The app reloads once to pick up the new deploy (client
   lib/chunkReload.ts), guarded against loops, and Vercel must answer a
   missing chunk with a 404 rather than index.html, and must never let a
   browser cache index.html.

   Run: npx tsx scripts/stale-chunk-check.mts
   =================================================================== */

import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ''}`); }
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLIENT = join(ROOT, 'client/src');

// Minimal browser globals for the module under test.
const store = new Map<string, string>();
let reloads = 0;
let online = true;
(globalThis as any).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
};
(globalThis as any).window = { location: { reload: () => { reloads++; } } };
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return online; } }, configurable: true });

const mod = await import(pathToFileURL(join(CLIENT, 'lib/chunkReload.ts')).href);
const { isChunkLoadError, reloadForNewVersion, withChunkReload } = mod;

console.log('\nwhich errors are a stale chunk');
is('Chrome', isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://www.usesincerely.com/assets/ContactsListPage-BtAfMcOk.js')));
is('Safari', isChunkLoadError(new TypeError('Importing a module script failed.')));
is('Firefox', isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/assets/a.js')));
is('a missing stylesheet', isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css')));
is('an ordinary bug is not', !isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")));
is('nothing is not', !isChunkLoadError(null));

console.log('\nreload once, never in a loop');
is('the first failure reloads', reloadForNewVersion() === true && reloads === 1);
is('a second failure moments later does not', reloadForNewVersion() === false && reloads === 1);
store.clear();
online = false;
is('offline never reloads', reloadForNewVersion() === false && reloads === 1);
online = true;

console.log('\nthe wrapped import');
{
  store.clear();
  let settled = false;
  const p = withChunkReload(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/x.js')))();
  p.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((r) => setTimeout(r, 20));
  is('a stale chunk reloads and holds the loading state instead of erroring', reloads === 2 && !settled);

  let caught: unknown = null;
  await withChunkReload(() => Promise.reject(new Error('boom')))().catch((e: unknown) => { caught = e; });
  is('any other failure still surfaces', (caught as Error | null)?.message === 'boom');
}

console.log('\nevery lazy screen goes through it');
{
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
  const bare = walk(CLIENT)
    .filter((f) => !f.endsWith('chunkReload.ts'))
    .filter((f) => {
      const t = readFileSync(f, 'utf8');
      return /\blazy\(/.test(t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/lazy\(withChunkReload\(/g, ''));
    })
    .map((f) => f.slice(CLIENT.length + 1));
  is('no React.lazy without the reload', bare.length === 0, bare.join(', '));
}

console.log('\nVercel serves the right thing for a missing chunk');
{
  const v = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const spa = (v.rewrites || []).find((r: any) => r.destination === '/index.html');
  const re = spa && new RegExp(`^${spa.source.replace(/^\//, '/')}$`);
  is('the SPA rewrite does not answer /assets/* with index.html', !!re && !re.test('/assets/ContactsListPage-BtAfMcOk.js') && re.test('/leads'));
  const hdr = (path: string) => (v.headers || [])
    .filter((h: any) => new RegExp(`^${h.source}$`).test(path))
    .flatMap((h: any) => h.headers)
    .find((x: any) => x.key.toLowerCase() === 'cache-control')?.value || '';
  is('index.html is never cached', /no-cache|max-age=0/.test(hdr('/leads')));
  is('hashed assets are cached for good', /immutable/.test(hdr('/assets/a-123.js')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} stale chunk check(s) failed`);
