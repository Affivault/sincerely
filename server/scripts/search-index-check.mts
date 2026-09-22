/* ═══════════════════════════════════════════════════════════════════════
   Every search in this app reads an index, not every row.

   MEASURED BEFORE THIS LANDED: no trigram index existed anywhere in the
   schema, and every search in the product was a leading-wildcard match:

       email ILIKE '%acme%'

   A leading wildcard cannot use a B-tree index, so each one was a
   sequential scan. The command palette was the worst of it - one keystroke
   fanned out across nine tables in parallel, so a single search was nine
   full table scans. It is fast on a new account and gets slower every day
   the product is used, which is the shape of problem that never appears in
   development and is only ever reported as "the app feels slow".

   THIS FILE IS THE FENCE, AND IT IS THE INTERESTING KIND: it reads the
   SERVICE CODE to find what is searched, reads the MIGRATIONS to find what
   is indexed, and fails when the two disagree. A list of indexes that
   somebody has to remember to update is not a mechanism; deriving the
   requirement from the query is.

   Run: npx tsx scripts/search-index-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../..');
const SERVICES = join(REPO, 'server/src/services');
const MIGRATIONS = join(REPO, 'supabase/migrations');

/** Comments must never satisfy or trip a rule about code. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/*
 * The same rule for SQL, where a comment is `--`.
 *
 * Caught by this check failing on its own migration: 072 explains at
 * length why CONCURRENTLY is unusable here, and the rule banning
 * CONCURRENTLY was reading that explanation as a use of it. The prose
 * about a mistake must never count as the mistake.
 */
const sql = (t: string) => t.replace(/--[^\n]*/g, '');

const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ name: f, text: readFileSync(join(MIGRATIONS, f), 'utf8') }));

const allSql = migrations.map((m) => m.text).join('\n').toLowerCase();

/* ── What the code searches ───────────────────────────────────────────── */

/**
 * `table.column` pairs reached by a leading-wildcard ILIKE.
 *
 * Derived from the service source rather than listed, so a new search
 * predicate brings its own index requirement with it and cannot be added
 * without either an index or a deliberate exemption below.
 */
function searchedColumns(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const add = (table: string, col: string) => {
    if (!found.has(table)) found.set(table, new Set());
    found.get(table)!.add(col);
  };

  for (const file of readdirSync(SERVICES).filter((f) => f.endsWith('.ts'))) {
    const src = code(readFileSync(join(SERVICES, file), 'utf8'));

    /*
     * Which table a query is against is established by `.from('x')` and
     * holds until the next one. Supabase queries are written as a single
     * chain, so walking the file in order and remembering the last
     * `.from()` attributes each predicate correctly.
     */
    let table: string | null = null;
    for (const line of src.split('\n')) {
      const from = line.match(/\.from\('(\w+)'\)/);
      if (from) table = from[1];
      if (!table) continue;

      // .or(`a.ilike.%x%,b.ilike.%x%`)
      for (const m of line.matchAll(/(\w+)\.ilike\.%/g)) add(table, m[1]);
      // .ilike('col', like)   with a leading-wildcard value
      const direct = line.match(/\.ilike\('(\w+)'/);
      if (direct) add(table, direct[1]);
    }
  }
  return found;
}

/**
 * Searches that are deliberately unindexed, each with a reason.
 *
 * An exemption is a decision, so it has to be written down next to the
 * thing it excuses. An empty reason is not an exemption.
 */
const EXEMPT: Record<string, string> = {
  'inbox_messages.body_text':
    'migration 073, kept optional: a trigram index over full message bodies is '
    + 'hundreds of megabytes and is a decision rather than a default',
};

console.log('\nthe scan found real search predicates');
const searched = searchedColumns();
{
  /*
   * Stops every assertion below from passing because the scan found
   * nothing. A regex that matched no ILIKE at all would report a perfectly
   * indexed application.
   */
  const total = [...searched.values()].reduce((n, s) => n + s.size, 0);
  is('service code yields searched columns', total >= 15,
     `${total} found - the ILIKE scan is probably broken`);
  is('and it attributed them to several tables', searched.size >= 8,
     `${searched.size} tables: ${[...searched.keys()].join(', ')}`);
  is('and it found the palette\'s contact search',
     !!searched.get('contacts')?.has('first_name'),
     'the .from()/.ilike() pairing has drifted, so nothing below is being checked');
}

/* ── What the schema indexes ──────────────────────────────────────────── */

console.log('\nthe extensions that make an indexed ILIKE possible are installed');
{
  is('pg_trgm is created', /create extension if not exists pg_trgm/.test(allSql),
     'gin_trgm_ops does not exist without it and every index below fails to create');

  /*
   * btree_gin is what lets user_id sit in the same index as the trigrams.
   * Without it these tables would be indexed by text alone, and a search
   * would find every matching row belonging to every account before
   * throwing all but one account's away.
   */
  is('and btree_gin, so user_id can share the index',
     /create extension if not exists btree_gin/.test(allSql),
     'a trigram-only index scans other tenants\' rows to answer one tenant\'s search');
}

console.log('\nevery searched column has an index that can serve it');
{
  const missing: string[] = [];
  const exempted: string[] = [];

  for (const [table, cols] of searched) {
    for (const col of cols) {
      const key = `${table}.${col}`;
      if (EXEMPT[key]) { exempted.push(`${key} - ${EXEMPT[key]}`); continue; }

      /*
       * The index has to be a trigram one ON THIS COLUMN. Matching the
       * table and the column separately would accept any index on the
       * table, which is how a check like this passes while the query it
       * describes still scans.
       */
      const pattern = new RegExp(
        `on\\s+${table}\\s+using\\s+gin\\s*\\([^)]*\\b${col}\\s+gin_trgm_ops`,
        's',
      );
      if (!pattern.test(allSql)) missing.push(key);
    }
  }

  is('no searched column is left without one', missing.length === 0,
     missing.map((m) => `${m} is matched with ILIKE '%...%' and has no gin_trgm_ops index`)
       .join('\n         '));

  // An exemption nobody can see is just a hole. Print them every run.
  for (const e of exempted) console.log(`       (exempt) ${e}`);

  is('and every exemption carries a reason',
     Object.values(EXEMPT).every((r) => r.trim().length > 20),
     'an exemption without a reason is an unexplained slow query');
}

console.log('\nthe indexes are scoped to the account, not just the column');
{
  /*
   * Every one of these queries filters by user_id as well as the search
   * term. An index on the text alone would answer "who anywhere matches
   * acme" and then discard the rows belonging to everybody else.
   */
  const trigramIndexes = [...allSql.matchAll(/using\s+gin\s*\(([^)]*gin_trgm_ops[^)]*)\)/g)]
    .map((m) => m[1].trim());

  is('there are trigram indexes to check', trigramIndexes.length >= 15,
     `${trigramIndexes.length} found`);

  const unscoped = trigramIndexes.filter((body) => !/\buser_id\b/.test(body));
  is('each one leads with user_id', unscoped.length === 0,
     unscoped.join('\n         '));
}

/* ── The floor, in one place ──────────────────────────────────────────── */

console.log('\nno search is sent that an index could not answer');
{
  const sharedSrc = code(readFileSync(join(REPO, 'shared/src/search.types.ts'), 'utf8'));

  /*
   * Below three characters there is no complete trigram, so the index has
   * nothing to look up and the query degrades to the sequential scan this
   * whole change exists to remove. Two was the old floor, and since every
   * search passes through two characters on the way to a real term, the
   * most expensive query in the product ran on the way to every cheap one.
   */
  const floor = Number((sharedSrc.match(/MIN_SEARCH_LENGTH\s*=\s*(\d+)/) || [])[1]);
  is('the floor is at least the length of a trigram', floor >= 3,
     `MIN_SEARCH_LENGTH is ${floor} - below 3 the index cannot be used at all`);

  /*
   * One definition. The server used to reject short terms while the client
   * sent them anyway, which is a round trip spent being told "too short"
   * and a "no results" flash for a term that matches one keystroke later.
   */
  const defs = ['server/src/services/search.service.ts', 'client/src/components/CommandPalette.tsx']
    .filter((f) => /MIN_SEARCH_LENGTH\s*=/.test(code(readFileSync(join(REPO, f), 'utf8'))));
  is('and it is defined once, in shared', defs.length === 0,
     `redefined in: ${defs.join(', ')}`);

  /*
   * Both halves read it. A shared constant nobody imports is a comment.
   */
  for (const f of [
    'server/src/services/search.service.ts',
    'client/src/components/CommandPalette.tsx',
    'client/src/components/crm/CrmPrimitives.tsx',
    'client/src/components/crm/DealPeople.tsx',
  ]) {
    is(`${f.split('/').pop()} reads it`,
       /MIN_SEARCH_LENGTH/.test(code(readFileSync(join(REPO, f), 'utf8'))),
       'this search box has its own floor and can still fire a scan');
  }

  // And nothing is left gating on a bare 2.
  const stragglers = ['client/src/components/CommandPalette.tsx',
    'client/src/components/crm/CrmPrimitives.tsx', 'client/src/components/crm/DealPeople.tsx']
    .filter((f) => /(?:debounced|trimmed)\.length\s*[<>]=?\s*2\b/.test(code(readFileSync(join(REPO, f), 'utf8'))));
  is('and no search box still gates on a bare 2', stragglers.length === 0,
     stragglers.join(', '));
}

/* ── The migrations are runnable as pasted ────────────────────────────── */

console.log('\nthe migrations can be pasted into the Supabase editor');
{
  const mine = migrations.filter((m) => /^07[23]_/.test(m.name));
  is('072 and 073 are both present', mine.length === 2,
     mine.map((m) => m.name).join(', '));

  /*
   * The editor wraps a pasted script in its own transaction, so an explicit
   * BEGIN prints "there is already a transaction in progress" - which reads
   * as a failure even though nothing is wrong.
   */
  const withTx = mine.filter((m) => /^\s*(begin|commit)\s*;/im.test(m.text));
  is('neither opens its own transaction', withTx.length === 0,
     withTx.map((m) => m.name).join(', '));

  /*
   * And for the same reason CREATE INDEX CONCURRENTLY cannot be used here:
   * it is not allowed inside a transaction block. Using it would fail on
   * paste, which is the one place these are actually run.
   */
  const concurrent = mine.filter((m) => /concurrently/i.test(sql(m.text)));
  is('and neither uses CONCURRENTLY, which cannot run in one', concurrent.length === 0,
     concurrent.map((m) => m.name).join(', '));

  // Re-running a migration by hand is normal. It must not be destructive.
  for (const m of mine) {
    const creates = [...sql(m.text).matchAll(/create\s+index\s+(if not exists\s+)?/gi)];
    const guarded = creates.filter((c) => c[1]);
    is(`${m.name} is safe to run twice`,
       creates.length > 0 && guarded.length === creates.length,
       `${guarded.length}/${creates.length} indexes guarded with IF NOT EXISTS`);
  }

  /*
   * Numbers are how these get run by hand, so two files sharing one is how
   * one of them gets skipped.
   *
   * FOUR PAIRS ALREADY EXIST, and they are named here rather than quietly
   * tolerated. They are not renamed because they have already been applied
   * to live databases, and renaming an applied migration makes the record
   * of what ran disagree with what is on disk - which is the same class of
   * problem, pointing the other way. The rule is live for everything
   * added from here on.
   */
  const KNOWN_COLLISIONS = new Set(['025', '036', '037', '048']);

  const numbers = migrations.map((m) => m.name.slice(0, 3));
  const dupes = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))];

  const fresh = dupes.filter((n) => !KNOWN_COLLISIONS.has(n));
  is('no new migration reuses a number', fresh.length === 0,
     fresh.map((n) => `${n}: ${migrations.filter((m) => m.name.startsWith(n)).map((m) => m.name).join(' and ')}`)
       .join('\n         '));

  for (const n of [...KNOWN_COLLISIONS].sort()) {
    const files = migrations.filter((m) => m.name.startsWith(n)).map((m) => m.name);
    console.log(`       (pre-existing collision) ${n}: ${files.join(' and ')}`);
  }

  /*
   * And the grandfather list itself has to stay honest: a number listed
   * here that no longer collides would silently excuse a future collision
   * on the same number.
   */
  const stale = [...KNOWN_COLLISIONS].filter((n) => !dupes.includes(n));
  is('and the grandfathered list has no stale entries', stale.length === 0,
     `${stale.join(', ')} no longer collide and would excuse a future clash`);

  /*
   * 073 depends on the extensions 072 creates. Saying so in the file is the
   * only thing standing between a correct run order and a confusing error
   * for somebody who pastes the interesting-looking one first.
   */
  const m073 = mine.find((m) => m.name.startsWith('073'))!;
  is('073 states that 072 comes first', /run 072 first/i.test(m073.text),
     'pasting 073 alone fails on a missing gin_trgm_ops with no explanation');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} search index check(s) failed`);
