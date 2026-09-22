/* ═══════════════════════════════════════════════════════════════════════
   The first screen: what blocks it, and what it can decide without asking.

   TWO THINGS MEASURED, BOTH OF THEM ON EVERY SINGLE PAGE LOAD.

   1. THE AUTH GATE. AuthContext started with loading: true and cleared it
      only when supabase.auth.getSession() resolved. Every route is behind
      that flag, so every load - including a reload of the page you were
      already looking at - showed a skeleton first, and the app could not
      begin fetching its data until it cleared. supabase persists the
      session in localStorage and hands it back through a promise; the
      storage read itself is synchronous, so the answer was in memory the
      whole time the skeleton was up.

   2. THE FONTS. There were TWO Google Fonts requests, and the expensive
      one was an @import at the top of index.css. A stylesheet cannot be
      discovered until the stylesheet that imports it has downloaded and
      parsed, so it was a second round trip chained behind the first, both
      blocking the first paint. It is invisible in development, where
      everything is a local cache hit.

   Run: npx tsx scripts/first-screen-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../..');
const CLIENT = join(REPO, 'client');

/** Comments must never satisfy or trip a rule about code. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
/** The same for CSS, where only the block form exists. */
const css = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');
/** And for HTML. */
const html = (t: string) => t.replace(/<!--[\s\S]*?-->/g, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const all = walk(join(CLIENT, 'src')).map((f) => ({
  path: relative(CLIENT, f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}));
const indexHtml = readFileSync(join(CLIENT, 'index.html'), 'utf8');

/* ── The persisted session, run rather than read ──────────────────────── */

console.log('\nthe stored session is read correctly, or not at all');
{
  /*
   * Run, not grepped. A parser that returned null for everything would
   * leave the old behaviour in place exactly - a skeleton on every load -
   * and every structural assertion below would still pass. The only
   * symptom would be that nothing got faster.
   */
  const mod: { parsePersistedSession: (raw: string | null, now?: number) => unknown } =
    await import(pathToFileURL(join(CLIENT, 'src/lib/persistedSession.ts')).href);
  const parse = mod.parsePersistedSession;

  const NOW = 1_700_000_000_000;
  const soon = Math.floor(NOW / 1000) + 3600;      // an hour of life left
  const user = { id: 'u1', email: 'a@b.c' };

  is('a live session yields its user',
     (parse(JSON.stringify({ user, expires_at: soon }), NOW) as any)?.id === 'u1');

  /*
   * supabase-js has stored this three different ways across versions.
   * Handling all three is cheaper than pinning a version, and an
   * unrecognised shape means "no opinion" rather than a crash.
   */
  const b64 = 'base64-' + Buffer.from(JSON.stringify({ user, expires_at: soon })).toString('base64');
  is('and so does the base64 form', (parse(b64, NOW) as any)?.id === 'u1');
  is('and the older currentSession wrapper',
     (parse(JSON.stringify({ currentSession: { user, expires_at: soon } }), NOW) as any)?.id === 'u1');

  /*
   * Everything below is a case where being optimistic would show somebody
   * the app and then throw them out of it, which is the one failure that
   * is worse than the skeleton this replaces.
   */
  const past = Math.floor(NOW / 1000) - 10;
  is('an expired session yields nothing',
     parse(JSON.stringify({ user, expires_at: past }), NOW) === null);

  const nearly = Math.floor(NOW / 1000) + 30;   // inside the safety margin
  is('and one about to expire yields nothing',
     parse(JSON.stringify({ user, expires_at: nearly }), NOW) === null,
     'supabase has to refresh over the network before it can answer, so a yes here could be wrong');

  is('a session with no expiry yields nothing',
     parse(JSON.stringify({ user }), NOW) === null,
     'an unrecognised shape must mean no opinion, not an assumed yes');
  is('a session with no user yields nothing',
     parse(JSON.stringify({ expires_at: soon }), NOW) === null);
  is('corrupt JSON yields nothing', parse('{not json', NOW) === null);
  is('and an empty store yields nothing', parse(null, NOW) === null);

  /*
   * The margin has to be real. A zero margin would pass every assertion
   * above except the near-expiry one, which is the only thing standing
   * between this and a visible wrong answer.
   */
  const src = code(readFileSync(join(CLIENT, 'src/lib/persistedSession.ts'), 'utf8'));
  const margin = Number((src.match(/SAFETY_MARGIN_MS\s*=\s*([\d_]+)/) || [])[1]?.replace(/_/g, ''));
  is('the safety margin is at least half a minute', margin >= 30_000, `${margin}ms`);
}

console.log('\nand it is used to render, never to authorise');
{
  const auth = code(readFileSync(join(CLIENT, 'src/context/AuthContext.tsx'), 'utf8'));

  is('the provider starts from the persisted user', /readPersistedUser\(\)/.test(auth),
     'every page load would show a skeleton until supabase answered');
  is('and only shows a skeleton when there is no opinion',
     /useState\(!optimisticUser\)/.test(auth),
     'loading would stay true and the optimistic read would change nothing');

  /*
   * THE LINE THIS MUST NOT CROSS.
   *
   * A token in localStorage proves nothing - it may have been revoked,
   * the account may be gone. It decides what to RENDER for a few hundred
   * milliseconds; it must never decide what is permitted.
   */
  is('supabase still decides the real answer', /supabase\.auth\.getSession\(\)/.test(auth),
     'the persisted read would have become the authentication');
  is('and a revoked session still clears the user',
     /onAuthStateChange/.test(auth) && /setUser\(session\?\.user \?\? null\)/.test(auth),
     'somebody signed out elsewhere would stay looking at the app');

  /*
   * Every request still gets its token from supabase, per request, so the
   * optimistic window cannot send an unauthenticated call - the first
   * fetch simply waits for the real session the way it always did.
   */
  const client = code(readFileSync(join(CLIENT, 'src/api/client.ts'), 'utf8'));
  is('and every request still asks supabase for its token',
     /await supabase\.auth\.getSession\(\)/.test(client),
     'a request could go out with no Authorization header during the optimistic window');

  /*
   * `session` is deliberately left null until supabase answers. That is
   * only safe while nothing reads it off the context, so the moment
   * something does, this has to be revisited.
   */
  const consumers = all.filter((f) => /useAuth\(\)/.test(code(f.text)))
    .filter((f) => /\bsession\b\s*[,}]/.test((code(f.text).match(/const \{[^}]*\} = useAuth\(\)/g) || []).join(' ')));
  is('nothing reads session off the context', consumers.length === 0,
     consumers.map((f) => `${f.path} reads session, which is null during the optimistic window`)
       .join('\n         '));
}

/* ── Fonts ────────────────────────────────────────────────────────────── */

console.log('\nthe fonts do not hold up the first paint');
{
  /*
   * An @import inside a stylesheet is the slowest way to load a font:
   * undiscoverable until the importing stylesheet has downloaded AND
   * parsed, so it is a chained round trip, and both of them block
   * rendering.
   */
  const importers = all
    .filter((f) => f.path.endsWith('.css'))
    .filter((f) => /@import\s+url\(['"]?https?:/.test(css(f.text)));
  is('no stylesheet imports a font over the network', importers.length === 0,
     importers.map((f) => `${f.path} chains a second blocking request behind itself`)
       .join('\n         '));

  const doc = html(indexHtml);
  const requests = [...doc.matchAll(/https:\/\/fonts\.googleapis\.com\/css2[^"']*/g)].map((m) => m[0]);

  /*
   * One request, plus the noscript copy of the same one. Two DIFFERENT
   * requests is what this replaced - the app's fonts and the landing
   * pages', asking for JetBrains Mono twice between them.
   */
  is('the document makes exactly one font request',
     new Set(requests).size === 1, `${new Set(requests).size} distinct: ${[...new Set(requests)].join(' | ')}`);
  is('and it appears twice - the real one and the noscript fallback',
     requests.length === 2, `${requests.length} occurrences`);

  is('it is preloaded rather than blocking',
     /rel="preload"[\s\S]{0,80}as="style"/.test(doc),
     'a plain rel=stylesheet holds up the first paint for a third-party round trip');
  is('and promotes itself to a stylesheet on arrival',
     /onload="this\.onload=null;this\.rel='stylesheet'"/.test(doc),
     'a preload that is never promoted downloads the font and never applies it');
  is('with a noscript fallback', /<noscript>[\s\S]*?fonts\.googleapis[\s\S]*?<\/noscript>/.test(doc),
     'no fonts at all without JavaScript');

  /*
   * display=swap is what makes not blocking safe rather than merely
   * faster: text paints immediately in the fallback stack and swaps when
   * the webfont lands. Without it the browser hides the text anyway and
   * the whole change buys nothing.
   */
  is('and display=swap, which is what makes that safe',
     requests.every((r) => /display=swap/.test(r)),
     'text would be invisible until the webfont arrived, blocking or not');
}

console.log('\nand every font downloaded is a font something uses');
{
  /*
   * Derived both ways, because both directions were wrong at once:
   * Plus Jakarta Sans and Newsreader were requested in the document while
   * the app's own Inter was reachable only through the chained @import.
   * A hand-kept list would not have caught either.
   */
  const requested = new Set(
    [...html(indexHtml).matchAll(/family=([^:&"]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' ')),
  );
  is('the request names some families', requested.size >= 3, [...requested].join(', '));

  /*
   * Which families the source actually names.
   *
   * The first version of this only looked after `font-family:`, and
   * reported Plus Jakarta Sans and JetBrains Mono as unused - both are
   * real and both are reached another way: through a CSS custom property
   * (`--font-data: 'JetBrains Mono', ...`) and through an inline style
   * whose nested quoting the pattern could not follow. A rule that
   * reports a live font as dead is how a live font gets deleted.
   */
  const source = all
    .filter((f) => /\.(css|tsx?)$/.test(f.path))
    .map((f) => (f.path.endsWith('.css') ? css(f.text) : code(f.text)))
    .join('\n');

  const namedInSource = (family: string) =>
    new RegExp(`['"]${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'i').test(source);

  is('the source names families at all', namedInSource('Inter'),
     'the family scan is broken, so the rules below check nothing');

  const unused = [...requested].filter((r) => !namedInSource(r));
  is('nothing is downloaded that nothing uses', unused.length === 0,
     unused.map((f) => `${f} is fetched on every page load and referenced nowhere`).join('\n         '));

  /*
   * And the other direction, which is the one that was wrong: a family
   * the stylesheets ask for but the document never requests renders in
   * the fallback stack and looks like a styling bug nobody can find.
   * Inter was in exactly that state, reachable only through the chained
   * @import this change removed.
   */
  const declared = new Set<string>();
  for (const m of source.matchAll(/(?:font-?[Ff]amily|--font-[\w-]+)\s*:\s*([^;"`\n]+)/g)) {
    const first = m[1].trim().match(/^["']?([A-Za-z][\w ]*[\w])["']?/);
    if (!first) continue;
    const name = first[1].trim();
    if (/^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|var|cursive)$/i.test(name)) continue;
    declared.add(name);
  }
  is('and the stylesheets declare some', declared.size >= 3, [...declared].join(', '));

  const FALLBACKS = /^(Georgia|Consolas|SF Mono|Times New Roman|Segoe UI|BlinkMacSystemFont|Arial|Helvetica|Menlo|Monaco|Courier New)$/i;
  const notFetched = [...declared]
    .filter((u) => ![...requested].some((r) => r.toLowerCase() === u.toLowerCase()))
    .filter((u) => !FALLBACKS.test(u));
  is('and nothing leads a stack that is never downloaded', notFetched.length === 0,
     notFetched.map((f) => `${f} leads a font stack and is never requested - it renders as the fallback`)
       .join('\n         '));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} first screen check(s) failed`);
