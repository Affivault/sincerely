/* ═══════════════════════════════════════════════════════════════════════
   What the browser has to load before anything appears.

   MEASURED BEFORE THIS LANDED: 1,113 kB of JavaScript on the critical path
   of every first paint, including the login page, the landing page and a
   public booking link. A third of it - 366 kB - was ProseMirror, because
   index.html carried a modulepreload for it.

   Nobody put it there. The chain was five imports long and every link in
   it was reasonable:

       main -> AppLayout -> PeekDrawer -> ContactHistory
            -> QuickCompose -> RichTextEditor -> @tiptap/*

   That is the whole problem with first-paint weight: it is never added,
   it ACCUMULATES, one correct import at a time, and it is invisible at
   every single step. A reviewer looking at the diff that added
   <QuickCompose> to contact history would have approved it, and been
   right to.

   So this is not a rule about what to import. It is the measurement,
   written down and run on every commit: it walks the STATIC import graph
   out of main.tsx and fails if anything heavy has found a way back in.
   The graph walk is the point - it catches the five-hop version, which is
   the only version that actually happens.

   AFTER: 623 kB, and the editor, the CRM peek drawer, the command palette
   and the CSV parser are all reached from elsewhere.

   Run: npx tsx scripts/first-paint-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
const SHARED = join(REPO, 'shared');

/** Comments must never satisfy or trip a rule about code. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* ── The graph walk ───────────────────────────────────────────────────── */

/**
 * Every static import in a file, and nothing dynamic.
 *
 * `import()` is the whole mechanism being asserted about, so it must not
 * be followed - a rule that treated a dynamic import as an edge would
 * report the entire application as eagerly loaded and pass nothing.
 *
 * `import type` is skipped for the opposite reason: it erases completely
 * at build time, costs zero bytes, and counting it would make this fail
 * over things that are not there.
 */
function staticImportsOf(text: string): string[] {
  const src = code(text);
  const out: string[] = [];

  // import ... from 'x'   /   export ... from 'x'   (both may span lines)
  for (const m of src.matchAll(/(?:^|\n)\s*(import|export)\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const clause = m[2];
    // `import type { X } from` and `export type { X } from` are free.
    if (/^type\b/.test(clause.trim())) continue;
    out.push(m[3]);
  }
  // Bare side-effect import: import 'x'
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);

  return out;
}

const EXTS = ['.ts', '.tsx', '.js', '.jsx'];

/** A specifier to a file on disk, or null for a package / asset. */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  if (spec === '@lemlist/shared') return join(SHARED, 'src/index.ts');
  if (!spec.startsWith('.')) return null;            // a package
  if (/\.(css|svg|png|jpe?g|json)$/.test(spec)) return null;

  const base = resolve(dirname(fromFile), spec);

  /*
   * `./enums.js` means ./enums.ts.
   *
   * shared/src/index.ts is written for NodeNext, where an import of a
   * TypeScript file carries the extension it will HAVE, not the one it
   * has. A resolver that took those literally found no file, stopped at
   * the barrel, and reported the whole of shared/ as absent from the
   * critical path - every assertion below it passing because nothing was
   * ever looked at. The "did the walk find anything" assertion at the top
   * is what caught it, which is the only reason that assertion exists.
   */
  const candidates = [base];
  const asTs = base.replace(/\.(js|jsx)$/, '');
  if (asTs !== base) candidates.push(asTs);

  for (const c of candidates) {
    if (existsSync(c) && !statSync(c).isDirectory()) return c;
    for (const e of EXTS) if (existsSync(c + e)) return c + e;
    for (const e of EXTS) if (existsSync(join(c, 'index' + e))) return join(c, 'index' + e);
  }
  return null;
}

interface Graph {
  /** Absolute paths of every source file loaded before the first paint. */
  files: Set<string>;
  /** Bare package specifiers reached, mapped to a file that reached them. */
  packages: Map<string, string>;
  /** How a given file was first reached, for the failure message. */
  via: Map<string, string>;
}

function eagerGraph(entry: string): Graph {
  const g: Graph = { files: new Set(), packages: new Map(), via: new Map() };
  const queue = [entry];
  g.files.add(entry);

  while (queue.length) {
    const file = queue.shift()!;
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }

    for (const spec of staticImportsOf(text)) {
      const target = resolveSpecifier(spec, file);
      if (!target) {
        if (!spec.startsWith('.') && !g.packages.has(spec)) g.packages.set(spec, file);
        continue;
      }
      if (g.files.has(target)) continue;
      g.files.add(target);
      g.via.set(target, file);
      queue.push(target);
    }
  }
  return g;
}

const rel = (p: string) => relative(REPO, p).replace(/\\/g, '/');

/** The import chain that reached a file, for a failure that explains itself. */
function chainTo(g: Graph, file: string): string {
  const steps: string[] = [];
  let cur: string | undefined = file;
  while (cur) { steps.unshift(rel(cur)); cur = g.via.get(cur); }
  return steps.join('\n           -> ');
}

/** Every client source file, for the rules that are about the whole app. */
function walkClient(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const dive = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) dive(full);
      else if (/\.tsx?$/.test(entry)) out.push({ path: rel(full), text: readFileSync(full, 'utf8') });
    }
  };
  dive(join(CLIENT, 'src'));
  return out;
}

const ENTRY = join(CLIENT, 'src/main.tsx');
const graph = eagerGraph(ENTRY);

console.log('\nthe graph walk found something to walk');
{
  /*
   * The assertion that stops every assertion below from passing because
   * the walk silently found nothing. A resolver that returns null for
   * everything would report a beautifully small first paint.
   */
  is('main.tsx resolves into a real module graph', graph.files.size > 40,
     `${graph.files.size} modules reached - the resolver is probably broken`);
  is('and it reaches the app shell',
     [...graph.files].some((f) => f.endsWith('components/layout/AppLayout.tsx')),
     'AppLayout is not in the eager graph, so this is not measuring the app');
  is('and it reaches react',
     graph.packages.has('react'), [...graph.packages.keys()].slice(0, 12).join(', '));
}

/* ── Nothing heavy is on the critical path ────────────────────────────── */

console.log('\nnothing heavy is loaded before the first screen');
{
  /*
   * Each of these was, or trivially could be, reachable from main.tsx, and
   * each is needed by a minority of screens. The number is what it cost on
   * every page of the app including the ones with no account attached.
   */
  const BANNED: Array<{ match: RegExp; what: string; cost: string }> = [
    { match: /^@tiptap\//,     what: 'the rich text editor', cost: '366 kB, 116 kB over the wire' },
    { match: /^prosemirror-/,  what: 'ProseMirror',          cost: 'the editor by another name' },
    { match: /^tippy\.js$/,    what: "the editor's tooltips", cost: 'arrives with ProseMirror' },
    { match: /^recharts$/,     what: 'the charting library', cost: '422 kB, for three screens' },
    { match: /^papaparse$/,    what: 'the CSV parser',       cost: '19 kB, for two screens' },
    { match: /^@dnd-kit\//,    what: 'drag and drop',        cost: 'for the sequence builder alone' },
  ];

  for (const { match, what, cost } of BANNED) {
    const hit = [...graph.packages.entries()].find(([p]) => match.test(p));
    is(`${what} is not on the critical path — ${cost}`,
       !hit,
       hit ? `${hit[0]} imported by ${rel(hit[1])}\n         reached via:\n           -> ${chainTo(graph, hit[1])}` : '');
  }
}

console.log('\nand neither is the code that pulls it in');
{
  /*
   * The package check above is the outcome; these are the doors. Naming
   * the modules as well as the packages is what makes a failure readable -
   * "@tiptap/react is on the critical path" sends you looking through
   * node_modules, "ContactHistory is on the critical path" sends you
   * straight to the import that did it.
   */
  const HEAVY: Array<[string, string]> = [
    ['components/ui/RichTextEditorImpl.tsx', 'the editor itself'],
    ['components/peek/PeekDrawer.tsx',       'the CRM peek drawer'],
    ['components/CommandPalette.tsx',        'the command palette'],
    ['components/ShortcutsOverlay.tsx',      'the shortcuts sheet'],
    ['components/crm/ContactHistory.tsx',    'contact history, 35 kB'],
    ['components/crm/CrmPrimitives.tsx',     'the CRM primitives, 27 kB'],
    ['components/shared/QuickCompose.tsx',   'the quick composer'],
  ];

  for (const [suffix, what] of HEAVY) {
    const hit = [...graph.files].find((f) => f.endsWith(suffix));
    is(`${what} is behind a dynamic import`, !hit,
       hit ? `reached via:\n           -> ${chainTo(graph, hit)}` : '');
  }
}

console.log('\nthe only screens loaded up front are the ones with no account');
{
  /*
   * Everything a signed-out visitor can reach, and nothing else. These are
   * eager on purpose: a landing page that needs a second round trip to
   * render is the one place deferring is unambiguously wrong.
   */
  const ALLOWED = [
    'pages/LandingPage.tsx',
    'pages/auth/LoginPage.tsx',
    'pages/auth/SignupPage.tsx',
    'pages/auth/ForgotPasswordPage.tsx',
    'pages/auth/ResetPasswordPage.tsx',
  ];

  const eagerPages = [...graph.files]
    .filter((f) => f.includes('/client/src/pages/') && /\.tsx$/.test(f))
    .filter((f) => !ALLOWED.some((a) => f.endsWith(a)));

  is('no signed-in screen is in the first paint', eagerPages.length === 0,
     eagerPages.map((f) => `${rel(f)}\n           -> ${chainTo(graph, f)}`).join('\n         '));

  // And the five that are meant to be there still are - otherwise the rule
  // above would pass just as well with the landing page accidentally lazy.
  for (const a of ALLOWED) {
    is(`${a.split('/').pop()} is still loaded up front`,
       [...graph.files].some((f) => f.endsWith(a)),
       'a signed-out visitor now waits for a second round trip');
  }
}

/* ── Routes and their prefetch registration agree ─────────────────────── */

const appSrc = readFileSync(join(CLIENT, 'src/App.tsx'), 'utf8');

console.log('\nevery route registers the chunk that serves it');
{
  /** component -> the paths it was DECLARED under in lazyRoute(...) */
  const declared = new Map<string, string[]>();
  for (const m of code(appSrc).matchAll(
    /const\s+(\w+)\s*=\s*lazyRoute\(\s*(\[[^\]]*\]|'[^']*')\s*,/g,
  )) {
    declared.set(m[1], [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]));
  }

  is('the routes are declared through lazyRoute', declared.size > 40,
     `${declared.size} found - App.tsx is not registering its chunks`);

  /** component -> the paths it is actually ROUTED to in the <Route> table */
  const routed = new Map<string, string[]>();
  for (const m of code(appSrc).matchAll(
    /<Route\s+path=\{?["']([^"']+)["']\}?\s+element=\{<(\w+)\b/g,
  )) {
    if (!routed.has(m[2])) routed.set(m[2], []);
    routed.get(m[2])!.push(m[1]);
  }

  is('and the <Route> table was parsed', routed.size > 40,
     `${routed.size} routes found - the element regex has drifted from the markup`);

  /*
   * The two halves have to match exactly, in both directions.
   *
   * A path routed but not declared is a link that never prefetches - a
   * silent loss of the entire feature for that screen. A path declared but
   * not routed is worse: hovering it downloads a chunk for a screen that
   * is not there, which is bandwidth spent on nothing and impossible to
   * notice, because prefetching correctly produces no visible effect
   * either way.
   */
  /*
   * PROVEN VACUOUS ONCE, AND THIS IS THE REPAIR.
   *
   * The first version of this compared routed paths against declared ones
   * only for components that appeared in `declared` - so replacing a
   * lazyRoute with a plain lazy() removed the component from BOTH sides
   * and the check passed, which is precisely the regression most likely to
   * happen: somebody adds a screen by copying the line above the one that
   * was converted. Planting it scored 47 passed, 0 failed.
   *
   * So the rule is stated the other way round now: a lazy route may only
   * be declared one way, and every routed component has to be accounted
   * for by name.
   */
  is('App.tsx has no hand-rolled lazy() left', !/\blazy\(/.test(code(appSrc)),
     'a route declared with lazy() instead of lazyRoute registers no chunk and silently never prefetches');

  /** Pages imported eagerly at the top, which are not meant to be registered. */
  const eagerImports = new Set(
    [...code(appSrc).matchAll(/import\s*\{\s*(\w+)\s*\}\s*from\s*'\.\/pages\//g)].map((m) => m[1]),
  );
  is('and its eager page imports were found', eagerImports.size >= 5,
     `${eagerImports.size} - the import regex has drifted, so unregistered routes would be excused`);

  /** Elements in the route table that are not pages at all. */
  const NOT_A_PAGE = new Set(['Navigate', 'AppLayout', 'ProtectedRoute', 'PublicRoute', 'LandingOrDashboard']);

  const unaccounted = [...routed.keys()]
    .filter((c) => !declared.has(c) && !eagerImports.has(c) && !NOT_A_PAGE.has(c));
  is('every routed screen is either registered or deliberately eager', unaccounted.length === 0,
     unaccounted.map((c) => `${c} is routed but neither lazyRoute'd nor imported up front`).join('\n         '));

  const problems: string[] = [];
  for (const [comp, paths] of routed) {
    if (!declared.has(comp)) continue;          // eagerly imported page, handled above
    const d = new Set(declared.get(comp)!);
    for (const p of paths) if (!d.has(p)) problems.push(`${comp}: routed at ${p}, not registered`);
  }
  is('no route is missing its prefetch registration', problems.length === 0,
     problems.join('\n         '));

  const orphans: string[] = [];
  for (const [comp, paths] of declared) {
    const r = new Set(routed.get(comp) || []);
    for (const p of paths) if (!r.has(p)) orphans.push(`${comp}: registered at ${p}, routed nowhere`);
  }
  is('and no registration points at a path that does not exist', orphans.length === 0,
     orphans.join('\n         '));
}

/* ── The prefetcher spends bandwidth honestly ─────────────────────────── */

const prefetchSrc = readFileSync(join(CLIENT, 'src/lib/prefetch.ts'), 'utf8');

console.log('\nprefetching is speculative, and behaves like it');
{
  const c = code(prefetchSrc);

  is('it refuses on Save-Data', /saveData/.test(c),
     'Save-Data is an explicit request not to spend bandwidth on guesses');
  is('and on a 2G connection', /effectiveType/.test(c),
     'a speculative 117 kB competes with the page they are waiting for');
  is('there is a cap on how much it will fetch', /MAX_PREFETCHES/.test(c),
     'a pointer dragged down the sidebar would pull the whole app');
  is('and the cap is actually enforced', /asked\.size\s*>=\s*MAX_PREFETCHES/.test(c),
     'the constant exists and nothing reads it');
  is('each chunk is asked for at most once', /asked\.add\(/.test(c) && /asked\.has\(/.test(c),
     'hovering the same link twice would fetch twice');
  is('a cross-origin href is ignored', /url\.origin\s*!==\s*window\.location\.origin/.test(c),
     'an outbound marketing link would be matched against app routes');
  is('and so is the page you are already on',
     /pathname\s*===\s*window\.location\.pathname/.test(c),
     'every link back to the current screen would re-import it');

  /*
   * One listener at the document, not a component per link. The
   * alternative is a <PrefetchLink> and a hundred call sites, which works
   * until the next plain <Link> is written.
   */
  is('it listens once, at the document', /document\.addEventListener\('pointerover'/.test(c),
     'per-link wiring is a call site somebody will forget');
  is('keyboard navigation gets it too', /focusin/.test(c),
     'tabbing to a link is intent just as much as hovering it');
  is('and touch', /touchstart/.test(c),
     'a finger landing buys the same head start as a pointer arriving');

}

/* ── The matcher, run rather than read ────────────────────────────────── */

console.log('\nthe matcher finds the right chunk for a real URL');
{
  /*
   * Grepping for `startsWith(':')` would prove the parameter code exists,
   * not that it works - and this is the half of prefetching that fails
   * silently in the direction that looks fine: a wrong answer prefetches
   * the wrong screen and nobody sees anything at all. So the module is
   * imported and asked.
   *
   * It touches `window` only inside prefetchHref, which is not called
   * here, so it loads under node unchanged.
   */
  const mod = await import(
    pathToFileURL(join(CLIENT, 'src/lib/prefetch.ts')).href
  ) as typeof import('../../client/src/lib/prefetch.js');

  const noop = async () => ({ default: () => null });
  mod.lazyRoute('/deals', noop, (m: any) => m.default);
  // Registered in the order App.tsx declares them, which is the awkward
  // one: the parameterised route comes FIRST, so a matcher that took the
  // first hit of the right shape would answer /deals/:id for
  // /deals/insights and this test would be the only thing that noticed.
  mod.lazyRoute('/deals/:id', noop, (m: any) => m.default);
  mod.lazyRoute('/deals/insights', noop, (m: any) => m.default);
  mod.lazyRoute(['/leads', '/contacts'], noop, (m: any) => m.default);
  mod.lazyRoute('/analytics/revenue/:id', noop, (m: any) => m.default);

  is('an exact path matches itself', mod.matchRoute('/deals') === '/deals',
     String(mod.matchRoute('/deals')));

  is('a record id finds its detail route', mod.matchRoute('/deals/8f21ab') === '/deals/:id',
     String(mod.matchRoute('/deals/8f21ab')));

  /*
   * The one that decides whether this is worth having. /deals/insights and
   * /deals/:id are the same shape, and a matcher that took the first hit
   * would hover Insights and download the deal detail page - a wasted
   * request AND a missing one, from a link that looks like it works.
   */
  is('a literal route beats a parameterised one of the same shape',
     mod.matchRoute('/deals/insights') === '/deals/insights',
     String(mod.matchRoute('/deals/insights')));

  is('a screen with two paths answers to both',
     mod.matchRoute('/leads') === '/leads' && mod.matchRoute('/contacts') === '/contacts',
     `${mod.matchRoute('/leads')} / ${mod.matchRoute('/contacts')}`);

  is('a path of the wrong length matches nothing',
     mod.matchRoute('/deals/8f21ab/extra') === null,
     String(mod.matchRoute('/deals/8f21ab/extra')));

  is('and an unknown route matches nothing', mod.matchRoute('/nowhere') === null,
     String(mod.matchRoute('/nowhere')));

  is('a parameter deeper in the path still matches',
     mod.matchRoute('/analytics/revenue/c9') === '/analytics/revenue/:id',
     String(mod.matchRoute('/analytics/revenue/c9')));

  // And the registry really is being written to - otherwise every answer
  // above would be null and half of these would pass by accident.
  is('the routes under test were registered', mod.registeredRoutes().length === 6,
     mod.registeredRoutes().join(', '));
}

/* ── Deferred, but warmed ─────────────────────────────────────────────── */

const shellSrc = readFileSync(join(CLIENT, 'src/components/layout/AppLayout.tsx'), 'utf8');
const doorSrc = readFileSync(join(CLIENT, 'src/components/ui/RichTextEditor.tsx'), 'utf8');
const overlaySrc = readFileSync(join(CLIENT, 'src/components/layout/Overlays.tsx'), 'utf8');

console.log('\nwhat was deferred still arrives before anybody reaches for it');
{
  /*
   * The half of this work that is easy to skip and expensive to skip.
   *
   * Moving 471 kB off the critical path makes the first paint faster and,
   * left alone, makes the first Reply and the first Cmd+K slower - and a
   * wait after you have decided to act is worse than the same wait before
   * you could act. Fetching during the first idle frame gets both: off the
   * critical path, and in memory by the time it is wanted.
   */
  const c = code(shellSrc);
  is('the shell warms the editor', /warmRichTextEditor\(\)/.test(c),
     'the first Reply would pay for the whole editor chunk');
  is('and the overlays', /warmOverlays\(\)/.test(c),
     'the first Cmd+K would pay for the palette');
  is('and starts listening for route intent', /listenForRouteIntent\(\)/.test(c),
     'nothing would ever prefetch');

  /*
   * PROVEN VACUOUS ONCE, AND THIS IS THE REPAIR.
   *
   * This used to grep the file for `requestIdleCallback`, which the line
   * that READS the function off window satisfies just as well as the line
   * that calls it. Disabling the call scored 47 passed, 0 failed. It has
   * to assert the scheduling, not the vocabulary.
   */
  const schedules = (t: string) => /\bidle\(go\b/.test(t) && /setTimeout\(go\b/.test(t);
  is('the editor is fetched on an idle callback, not on mount', schedules(code(doorSrc)),
     'fetching it eagerly from the shell just moves the cost, it does not remove it');
  is('and so are the overlays', schedules(code(overlaySrc)),
     'three chunks would compete with the first screen instead of following it');

  /*
   * Only for a signed-in session. The shell is what mounts for one, which
   * is why the warm-up lives there and not in main.tsx - a stranger on the
   * landing page must not be made to download a CRM.
   */
  is('and only once the app shell is mounted',
     !/warmRichTextEditor|warmOverlays/.test(code(readFileSync(join(CLIENT, 'src/main.tsx'), 'utf8'))),
     'the landing page would fetch the editor and the peek drawer');
}

console.log('\na lazy editor cannot blank the page it is on');
{
  /*
   * Suspense boundaries, at the door rather than left to an ancestor.
   *
   * Without one here, the first render of a lazy editor suspends all the
   * way up to the route boundary in App.tsx and replaces the entire screen
   * with a skeleton - you press Reply and the message you were replying to
   * vanishes. This is the failure that turns a size win into a bug report.
   */
  is('the editor carries its own Suspense boundary', /<Suspense/.test(code(doorSrc)),
     'suspending would fall through to the route boundary and blank the page');
  is('and the overlays carry theirs', /<Suspense/.test(code(overlaySrc)),
     'opening a peek would blank the page behind it');

  is('the editor placeholder holds the real size',
     /minHeight/.test(code(doorSrc)),
     'the composer would jump when the editor arrived');

  /*
   * The hook has to stay on the near side. It is pure React state, several
   * screens call it while their editor is closed, and a hook cannot be
   * lazy - if it moved across the boundary, importing it would drag the
   * whole chunk back onto the critical path and quietly undo all of this.
   */
  is('useRichTextEditorRef stayed on the light side of the split',
     /export function useRichTextEditorRef/.test(code(doorSrc)),
     'calling it would import ProseMirror again');
  is('and the door itself imports no tiptap',
     !/@tiptap/.test(code(doorSrc)),
     'the split exists on paper only');

  /*
   * One door.
   *
   * The failure this guards against is the one that cost the most
   * elsewhere in this codebase: a second definition of the same name, in
   * a second file, agreeing with the first until somebody edits one of
   * them. A component called RichTextEditor that is not this wrapper is a
   * call site that loads ProseMirror eagerly and passes every check above,
   * because every check above looks at THIS file.
   */
  const defines = walkClient()
    .filter((f) => /^\s*export function RichTextEditor\(/m.test(code(f.text)));
  is('and there is exactly one component called RichTextEditor',
     defines.length === 1,
     defines.map((f) => f.path).join(', ') || 'none found - the door has been renamed');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} first-paint check(s) failed`);
