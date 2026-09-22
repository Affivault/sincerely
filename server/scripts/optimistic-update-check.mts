/* ═══════════════════════════════════════════════════════════════════════
   The screen moves when you click, not when the server answers.

   MEASURED BEFORE THIS LANDED: 189 mutations, 10 of which updated the
   screen before the round trip. The other 179 froze - ticking a task,
   starring a message, marking a reply read - and this is the slowness
   people feel most sharply, because it is the slowness they caused.

   The ten that existed were each written longhand and every one shared a
   gap: `setQueryData` with an EXACT key patches one cache. The same task
   also sits in ['crm','tasks',filter], in a contact's history and on a
   deal's timeline; the same message sits in every cached inbox folder.
   So a tick was instant in one place and late in three others, which
   reads as a bug rather than as a wait.

   THE DANGEROUS PART IS THE ROLLBACK, AND IT IS INVISIBLE WHEN BROKEN.

   An optimistic update with no rollback looks perfect until a request
   fails, and then the screen keeps showing a change that never happened -
   which is worse than the freeze it replaced, because the freeze never
   lied. Most of this file is about the failure path and the ordering
   rules that are easy to get subtly wrong and impossible to see.

   Run: npx tsx scripts/optimistic-update-check.mts
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

const helper = code(readFileSync(join(CLIENT, 'src/lib/optimistic.ts'), 'utf8'));

/* ── The walker, run rather than read ─────────────────────────────────── */

console.log('\nthe patcher finds a row wherever the response put it');
{
  /*
   * This is the half that would fail silently. A shape-walker that
   * matched nothing returns the cache untouched, every mutation carries
   * on working exactly as it did before, and the only symptom is that
   * nothing ever feels instant - which is the thing this was supposed to
   * fix. So it is imported and given the real response shapes.
   */
  const mod: { __patchRow: (node: unknown, id: string, patch: (row: any) => object) => unknown } =
    await import(pathToFileURL(join(CLIENT, 'src/lib/optimistic.ts')).href);
  const patch = mod.__patchRow;
  const flip = (row: any) => ({ is_done: !row.is_done });

  // A bare array, as the CRM endpoints return.
  const arr = [{ id: 'a', is_done: false }, { id: 'b', is_done: false }];
  const outA = patch(arr, 'a', flip) as any[];
  is('a bare array', outA[0].is_done === true && outA[1].is_done === false,
     JSON.stringify(outA));

  // { data: [...] }, as the inbox list returns.
  const wrapped = { total: 2, data: [{ id: 'a', is_read: false }] };
  const outW = patch(wrapped, 'a', () => ({ is_read: true })) as any;
  is('a list nested under a key', outW.data[0].is_read === true, JSON.stringify(outW));

  // A single record, as a detail endpoint returns.
  const one = { id: 'a', is_starred: false };
  is('a bare record', (patch(one, 'a', () => ({ is_starred: true })) as any).is_starred === true);

  /*
   * Untouched caches must come back by reference. A walker that rebuilt
   * every object would re-render every list in the app on every mutation,
   * and the app would get slower in exactly the way this is meant to fix.
   */
  is('an untouched cache is returned unchanged, by reference',
     patch(arr, 'nobody', flip) === arr,
     'structural sharing is broken and every memo downstream is defeated');

  /*
   * The scope is a key PREFIX, so an unrelated object carrying the same id
   * can be reached. Patching a field the row does not have would invent
   * `is_done` on a company.
   */
  const other = [{ id: 'a', name: 'Acme' }];
  is('a field the row does not have is not invented',
     patch(other, 'a', flip) === other,
     JSON.stringify(patch(other, 'a', flip)));

  /*
   * PROVEN VACUOUS ONCE, AND THIS IS THE REPAIR.
   *
   * The first version put a Date in a field and checked it came back a
   * Date - which it does with or without the guard, because a Date has no
   * `id` and no enumerable entries, so the walker returns it untouched
   * either way. Removing the guard scored 18 passed, 0 failed.
   *
   * The guard is about a class instance that DOES match and DOES have
   * fields: spreading it into a plain object silently drops its
   * prototype, and the row loses every method it had.
   */
  class Row { constructor(public id: string, public is_done: boolean) {}
              label() { return 'row ' + this.id; } }
  const instances = [new Row('a', false)];
  const outI = patch(instances, 'a', flip) as any[];
  is('a class instance is not flattened into a plain object',
     outI[0] instanceof Row && typeof outI[0].label === 'function',
     `${outI[0].constructor?.name}, label=${typeof outI[0].label}`);

  // And a Date in a field of a row that IS patched still comes back a Date.
  const withDate = [{ id: 'a', is_done: false, when: new Date('2020-01-01') }];
  const outD = patch(withDate, 'a', flip) as any[];
  is('and a Date on a patched row survives as a Date',
     outD[0].when instanceof Date && outD[0].is_done === true,
     String(outD[0].when));

  // And the row is found a couple of levels down, where real responses put it.
  const deep = { page: { rows: [{ id: 'a', is_done: false }] } };
  is('a row two levels down', (patch(deep, 'a', flip) as any).page.rows[0].is_done === true);
}

/* ── The rules that make the failure path safe ────────────────────────── */

console.log('\nthe helper does the three things that make this safe');
{
  /*
   * An in-flight refetch resolves with the server's OLD value and
   * overwrites the optimistic one, so the row changes, changes back, then
   * changes again when the mutation settles. It only shows up on a slow
   * connection, which is exactly where it matters.
   */
  is('it cancels in-flight refetches first',
     /onMutate[\s\S]{0,600}?await qc\.cancelQueries/.test(helper),
     'a refetch already in flight would overwrite the optimistic value');

  is('it snapshots every cache it is about to touch',
     /getQueriesData\(\{ queryKey: scope \}\)/.test(helper),
     'there would be nothing to roll back to');

  is('and patches every cache under the scope, not one exact key',
     /setQueriesData\(\{ queryKey: scope \}/.test(helper),
     'setQueryData with an exact key is the bug this helper exists to remove');

  is('it restores every snapshot on failure',
     /onError[\s\S]{0,300}?for \(const \[key, data\] of ctx\?\.snapshots[\s\S]{0,80}?setQueryData\(key, data\)/.test(helper),
     'a failed request would leave a change that never happened on screen');

  /*
   * queryClient's mutationCache shows a failure toast only for mutations
   * with no onError of their own, and this helper gives every mutation
   * one. Without a toast here, opting into an optimistic update silently
   * opts out of being told it failed.
   */
  is('and still says something when it fails',
     /onError[\s\S]{0,700}?toast\.error\(failureToast/.test(helper),
     'the row would snap back with no explanation at all');

  /*
   * Ticking four things quickly leaves four mutations in flight.
   * Invalidating when the first settles refetches a list the other three
   * have already changed, and they all flicker back.
   */
  is('it reconciles only when the last mutation settles',
     /isMutating\(\) <= 1/.test(helper),
     'a burst of clicks would flicker back to the old values');
}

/* ── How it is used ───────────────────────────────────────────────────── */

const users = files.filter((f) => /useOptimisticRow</.test(code(f.text)));

console.log('\nand every screen using it uses it correctly');
{
  is('it is actually used', users.length >= 5,
     `${users.length} files - the helper exists and nothing calls it`);

  /*
   * THE ORDERING RULE, AND THE REASON THIS CHECK EXISTS.
   *
   * `...optimistic` spread BEFORE an onError of the caller's own means the
   * caller's handler replaces the helper's - and the rollback goes with
   * it. The screen keeps the change, the request failed, and nothing says
   * so. It is a one-line mistake with no visible symptom until something
   * fails, which is the worst combination there is.
   */
  const shadowed: string[] = [];
  for (const f of users) {
    const src = code(f.text);
    for (const m of src.matchAll(/\.\.\.(\w*[Oo]ptimistic)\b([\s\S]{0,400}?)\n\s*\}\)/g)) {
      if (/\bonError\s*:/.test(m[2]) || /\bonMutate\s*:/.test(m[2]) || /\bonSettled\s*:/.test(m[2])) {
        shadowed.push(`${f.path}: a handler after ...${m[1]} replaces the helper's`);
      }
    }
  }
  is('none of them overrides a handler after the spread', shadowed.length === 0,
     shadowed.join('\n         '));

  /*
   * The patch callback receives the CURRENT row for a reason: a toggle
   * written against a value captured at render time is one click out of
   * date the moment two land in a row. Reading `row` is what makes the
   * second click flip back rather than repeat the first.
   */
  const toggles = users.filter((f) => /patch:\s*\([^)]*\)\s*=>\s*\(\{[^}]*!\s*\w+\./.test(code(f.text)));
  is('toggles read the row rather than captured state', toggles.length >= 4,
     `${toggles.length} - a toggle against stale state repeats itself instead of flipping`);
}

console.log('\nnothing is left hand-rolling what the helper does');
{
  /*
   * The point is one implementation. A second copy of the cancel /
   * snapshot / rollback dance is a place for the two to disagree, and the
   * exact-key bug is what every hand-rolled copy had.
   */
  /*
   * WRITING TO THE CACHE is the thing, not using onMutate.
   *
   * The first version of this flagged any onMutate at all, and named four
   * files that turned out to be setting a local spinner id - no cache
   * write, nothing to roll back, nothing for the helper to do. An
   * over-broad rule is its own kind of wrong: it would have pushed four
   * correct pieces of code through a pointless rewrite.
   */
  const writesCache = (t: string) => /onMutate[\s\S]{0,800}?qc?u?e?r?y?C?l?i?e?n?t?\.?(setQueryData|setQueriesData)/.test(t);

  /*
   * PROVEN VACUOUS ONCE, AND THIS IS THE REPAIR.
   *
   * This used to excuse any FILE that mentioned useOptimisticRow
   * anywhere. A page that adopts the helper for one mutation and
   * hand-rolls the next one - which is exactly how a half-migration
   * looks - passed cleanly. Planting that scored 18 passed, 0 failed.
   * It reads one mutation at a time now.
   */
  function mutationBlocks(text: string): string[] {
    const src = code(text);
    const out: string[] = [];
    let at = 0;
    for (;;) {
      const start = src.indexOf('useMutation({', at);
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

  /*
   * Two mutations do something this helper deliberately cannot, and are
   * named here with the reason. An exemption is a decision; one nobody
   * can see is just a hole, so they print on every run.
   */
  const EXEMPT: Array<{ match: RegExp; why: string }> = [
    { match: /crmApi\.updateTask\(t\.id, \{ due_date/,
      why: 'TasksPage bulk snooze: on a partial failure it rolls back only the tasks '
         + 'that actually failed, which a single-row helper cannot express - and snapping '
         + 'the successful ones back would be a worse lie than the wait' },
    { match: /inboxApi\.(un)?archiveThread/,
      why: 'archive and unarchive REMOVE rows matching an address from the current '
         + 'folder rather than patching one row by id; this helper is deliberately '
         + 'about a known row and a known field' },
  ];

  const handRolled: string[] = [];
  const exempted: string[] = [];
  const used = new Set<RegExp>();
  for (const f of files) {
    if (f.path.endsWith('lib/optimistic.ts')) continue;
    for (const block of mutationBlocks(f.text)) {
      if (!writesCache(block)) continue;
      if (/\.\.\.\w*[Oo]ptimistic\b/.test(block)) continue;
      const ex = EXEMPT.find((e) => e.match.test(block));
      if (ex) { used.add(ex.match); exempted.push(`${f.path} - ${ex.why}`); continue; }
      handRolled.push(`${f.path}: a mutation rolls its own - and will miss the sibling caches`);
    }
  }
  for (const e of [...new Set(exempted)]) console.log(`       (exempt) ${e}`);

  /*
   * And an exemption that no longer matches anything would quietly excuse
   * the next mutation written in the same shape.
   */
  /*
   * Each PATTERN has to match something, not each match a pattern - one
   * exemption legitimately covers archive and unarchive, which are the
   * same operation pointing opposite ways.
   */
  const stale = EXEMPT.filter((e) => !used.has(e.match));
  is('every exemption still matches a real mutation', stale.length === 0,
     stale.map((e) => `${e.match} matches nothing and would excuse the next one like it`)
       .join('\n         '));

  is('no mutation writes its own cancel/snapshot/rollback', handRolled.length === 0,
     [...new Set(handRolled)].join('\n         '));

  is('and there are mutations to have checked',
     files.flatMap((f) => mutationBlocks(f.text)).length > 150,
     'the useMutation scan is broken, so the rule above is checking nothing');

  /*
   * And onMutate used for something else entirely - a spinner id, a
   * disabled flag - is not this rule's business and must keep working.
   */
  const localStateOnly = files
    .filter((f) => /onMutate\s*:/.test(code(f.text)) && !writesCache(code(f.text)));
  is('and onMutate used only for local state is left alone', localStateOnly.length >= 3,
     `${localStateOnly.length} - if this hits zero the rule above has widened back out`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} optimistic update check(s) failed`);
