/* ═══════════════════════════════════════════════════════════════════════
   A list does not blank because you changed your mind about it.

   MEASURED BEFORE THIS LANDED: twenty-one queries in this app carry a
   search term, a tab, a page number or a date range in their key, and
   exactly ONE of them kept its data across a change. React Query treats a
   changed key as a different question, and with no cached answer it
   reports isLoading - so every one of these dropped to a skeleton:

       ['inbox', folder, tagFilter, search, messageLimit]
       ['suppression', page, search, reasonFilter]
       ['companies', debounced]
       ['analytics', 'trend', days]

   Typing one letter wiped the table and rebuilt it. Switching a tab
   blinked. Changing the analytics range cleared the charts. The worst
   instance: messageLimit is in the Unibox key, so pressing Load more threw
   away the fifty messages you were reading - which React Query was holding
   the entire time.

   THE RULE THIS FILE ENFORCES IS THE PAIR, NOT THE FIX.

   Keeping the previous rows is one line per query. It is also, on its own,
   a small lie: for a couple of hundred milliseconds the filter says
   Archived and the rows are still the inbox. So a query that keeps its
   previous data must SAY SO - a busy search box or a bar over the list -
   and taking the first half without the second fails here.

   Run: npx tsx scripts/list-continuity-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(join(CLIENT, 'src')).map((f) => ({
  path: relative(CLIENT, f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}));

/* ── Finding the queries this rule is about ───────────────────────────── */

/** Every `useQuery({ ... })` call, as source text. */
function queryBlocks(text: string): string[] {
  const src = code(text);
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const start = src.indexOf('useQuery({', at);
    if (start < 0) break;
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    out.push(src.slice(start, i + 1));
    at = i + 1;
  }
  return out;
}

/**
 * Whether a key changes because the QUESTION changed rather than because
 * the RECORD changed.
 *
 * The distinction is the whole rule. `['companies', debounced]` asks a
 * different question about the same list, and the previous answer is a
 * reasonable thing to leave on screen for 200ms. `['contact', id]` is a
 * different person, and showing one person's details under another's name
 * would be worse than a skeleton, not better.
 */
function isFilterKey(key: string): boolean {
  const varies = /,\s*[A-Za-z_$][\w.$]*/.test(key) || /\$\{/.test(key);
  const filterish = /page|search|filter|query|debounc|stage|status|tab|sort|range|days|limit|folder/i.test(key);
  return varies && filterish;
}

/**
 * Keys that LOOK like filters and are not, each with a reason.
 *
 * Both of these change only when the component around them remounts, so
 * there is never a previous answer to keep - and keeping one would show
 * the wrong context for a moment rather than none. An exemption is a
 * decision, so it is written down beside the thing it excuses.
 */
const EXEMPT: Record<string, string> = {
  "'list-folders', listKind":
    'listKind is the route (/leads vs /contacts), and those are different '
    + 'pages - keeping data across it would show lead folders on the contacts page',
  "'campaign-folder-analytics', folderId":
    'the modal is mounted per folder, so the key never changes while it is open',
};

const relevant: Array<{ path: string; key: string; block: string }> = [];
for (const f of files) {
  for (const block of queryBlocks(f.text)) {
    const key = (block.match(/queryKey:\s*\[([^\]]*)\]/) || [])[1];
    if (!key || !isFilterKey(key)) continue;
    if (EXEMPT[key.trim()]) continue;
    relevant.push({ path: f.path, key: key.trim(), block });
  }
}

console.log('\nthe scan found the queries this is about');
{
  /*
   * Stops every assertion below from passing because the scan found
   * nothing. A regex that matched no useQuery at all would report a
   * perfectly continuous application.
   */
  is('there are filter-varying queries to check', relevant.length >= 18,
     `${relevant.length} found - the useQuery scan is probably broken`);

  is('and the Unibox list is among them',
     relevant.some((r) => r.key.includes('messageLimit')),
     'the key that made Load more throw away fifty messages is not being checked');

  /*
   * And the other half of the discrimination: a record-keyed query must
   * NOT be swept in, or this rule would start demanding that one contact's
   * details be left on screen under another contact's name.
   */
  is('and a record-keyed query is not', !isFilterKey("'contact', id"),
     'the filter/record distinction has collapsed and this would push a real lie');

  // Exemptions are printed every run. One nobody can see is just a hole.
  for (const [k, why] of Object.entries(EXEMPT)) console.log(`       (exempt) [${k}] - ${why}`);
  is('and every exemption carries a reason',
     Object.values(EXEMPT).every((r) => r.trim().length > 20),
     'an exemption without a reason is an unexplained blank');

  /*
   * And an exemption for a key that no longer exists would quietly excuse
   * the next query that happens to be written with the same shape.
   */
  const allKeys = new Set(files.flatMap((f) => queryBlocks(f.text))
    .map((b) => ((b.match(/queryKey:\s*\[([^\]]*)\]/) || [])[1] || '').trim()));
  const stale = Object.keys(EXEMPT).filter((k) => !allKeys.has(k));
  is('and no exemption points at a query that is gone', stale.length === 0,
     stale.join(', '));
}

console.log('\nnone of them blanks when its key changes');
{
  const blanking = relevant.filter((r) => !/keepPrevious|placeholderData/.test(r.block));
  is('every one keeps its previous result', blanking.length === 0,
     blanking.map((r) => `${r.path}: [${r.key}]`).join('\n         '));

  /*
   * Through the shared helper, not by hand. The one query that already did
   * this wrote `placeholderData: (prev) => prev` inline, which is the same
   * behaviour with nowhere to put the reason - and the reason is the only
   * thing that stops the next person removing it.
   */
  const inline = relevant.filter((r) => /placeholderData/.test(r.block) && !/keepPrevious/.test(r.block));
  is('and does it through the one shared helper', inline.length === 0,
     inline.map((r) => `${r.path}: [${r.key}] spells it out instead of spreading keepPrevious`)
       .join('\n         '));
}

console.log('\nand none of them pretends the old rows are the new answer');
{
  /*
   * THE HALF THAT IS EASY TO SKIP.
   *
   * Keeping previous data with no indication is how a filter and its list
   * end up disagreeing silently. Every file that keeps data has to show
   * it: isPlaceholderData driving a <Refreshing> bar, a busy search box,
   * or an AsyncPanel (which does it for the caller).
   */
  const keepers = [...new Set(relevant.filter((r) => /keepPrevious/.test(r.block)).map((r) => r.path))];
  is('there are files keeping data to check', keepers.length >= 15, `${keepers.length}`);

  const silent = keepers.filter((path) => {
    const src = code(files.find((f) => f.path === path)!.text);
    const saysSo = /isPlaceholderData/.test(src) && /<Refreshing|busy=\{/.test(src);
    const viaPanel = /<AsyncPanel/.test(src);
    // A few already had a live indicator of their own before this landed -
    // the palette's spinner, the booking page's slot loader - and a second
    // one stacked on top would be noise.
    const ownIndicator = /isFetching/.test(src) && /(Searching…|isFetching \?|isFetching &&|loading=\{)/.test(src);
    return !saysSo && !viaPanel && !ownIndicator;
  });

  is('every one of them says it is refreshing', silent.length === 0,
     silent.map((p) => `${p} keeps previous data with nothing on screen to say so`)
       .join('\n         '));
}

/* ── The mechanism itself ─────────────────────────────────────────────── */

const listQuery = code(readFileSync(join(CLIENT, 'src/lib/listQuery.ts'), 'utf8'));
const refreshing = code(readFileSync(join(CLIENT, 'src/components/ui/Refreshing.tsx'), 'utf8'));
const asyncPanel = code(readFileSync(join(CLIENT, 'src/components/ui/AsyncPanel.tsx'), 'utf8'));
const searchInput = code(readFileSync(join(CLIENT, 'src/components/shared/SearchInput.tsx'), 'utf8'));
const css = readFileSync(join(CLIENT, 'src/index.css'), 'utf8');

console.log('\nthe helper is the real thing, not a renamed default');
{
  is('keepPrevious is react-query\'s keepPreviousData',
     /placeholderData:\s*keepPreviousData/.test(listQuery),
     'anything else here silently does nothing and every assertion above passes');
  is('and it is imported from react-query',
     /import \{ keepPreviousData \} from '@tanstack\/react-query'/.test(listQuery),
     'a local definition of that name would be a no-op the checks cannot see');
}

console.log('\nthe indicator cannot move the page it sits on');
{
  /*
   * This toggles on every keystroke. Anything that changes the height of
   * the list when it appears would show up as a shudder while typing -
   * which is a worse artefact than the blanking it replaced.
   */
  /*
   * PROVEN VACUOUS ONCE, AND THIS IS THE REPAIR.
   *
   * This used to test the whole file from `.refresh-bar` onwards, so the
   * next rule in index.css that happened to say `position: absolute`
   * satisfied it. Putting the bar back in the flow scored 20 passed, 0
   * failed. Scoped to the rule's own body now, with a guard proving the
   * body was actually found.
   */
  const barRule = (() => {
    const at = css.indexOf('.refresh-bar {');
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  })();
  is('the .refresh-bar rule was found', barRule.length > 20,
     'the selector has been renamed and the rules below check nothing');
  is('the bar is positioned out of flow', /position:\s*absolute/.test(barRule),
     'the list would jump by two pixels on every keystroke');
  is('and its wrapper establishes the containing block',
     /className=\{cn\('relative'/.test(refreshing),
     'an absolutely positioned bar would escape to the nearest positioned ancestor');
  is('and RefreshingBar renders nothing when idle',
     /if \(!active\) return null;/.test(refreshing),
     'an empty element becomes a phantom gap inside a flex row');

  /*
   * Motion here carries no information the rows do not already carry, so
   * anyone who has asked for less of it loses nothing by getting a static
   * hairline.
   */
  is('and reduced motion is honoured',
     /prefers-reduced-motion[\s\S]{0,200}refresh-bar/.test(css),
     'a permanent sweeping animation for somebody who asked for no animation');
}

console.log('\nthe shared panel does it for its callers');
{
  is('AsyncPanel accepts isPlaceholderData', /isPlaceholderData\?: boolean/.test(asyncPanel),
     'a screen using AsyncPanel could not surface it at all');
  is('and renders the indicator when it is set',
     /if \(query\.isPlaceholderData\) \{[\s\S]{0,200}<Refreshing active/.test(asyncPanel),
     'AsyncPanel would be indistinguishable from a settled panel');

  /*
   * Order matters. isPlaceholderData has to be read AFTER the failure and
   * loading branches: a query that has never loaded has no previous data
   * to keep, and checking it first would draw a refresh bar over an empty
   * panel.
   */
  const errIdx = asyncPanel.indexOf('query.isError');
  const loadIdx = asyncPanel.indexOf('query.isLoading');
  const staleIdx = asyncPanel.indexOf('query.isPlaceholderData) {');
  is('and reads it after failure and loading, not before',
     errIdx > 0 && loadIdx > errIdx && staleIdx > loadIdx,
     `isError@${errIdx} isLoading@${loadIdx} isPlaceholderData@${staleIdx}`);
}

console.log('\nthe search box can say it is still working');
{
  is('SearchInput takes a busy flag', /busy\?: boolean/.test(searchInput),
     'six screens share this input and none of them could show the state');
  is('and it replaces the icon rather than adding one',
     /busy\s*\n?\s*\?\s*<Loader2/.test(searchInput),
     'an extra element changes the box width and reflows it on every keystroke');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} list continuity check(s) failed`);
