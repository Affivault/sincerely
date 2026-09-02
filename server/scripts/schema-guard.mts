/* ═══════════════════════════════════════════════════════════════════════
   Do the tables and columns the services name actually exist?

   Written after shipping a service that queried a table called `emails`,
   which has never existed - the table is `inbox_messages` - and selected a
   column called `contact_email`, which has never existed either. Every
   triage request would have 404'd in production.

   The unit tests passed throughout, because the harness stubbed a world
   with an `emails` table in it. That is the failure worth guarding against:
   a fixture written from the same wrong assumption as the code agrees with
   the code, and agreement is not evidence. So this reads the migrations -
   the only thing that is actually true about the database - and checks the
   names the code uses against them.

   Deliberately narrow. It parses `.from('x')` and the column list of a
   neighbouring `.select(...)`, which is the shape this codebase uses
   everywhere. It is a smoke alarm, not a type system: it will not catch a
   dynamic table name, and it is not supposed to.

   Run: npx tsx scripts/schema-guard.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '../../supabase/migrations');
const SERVICES = join(here, '../src/services');

/* ---- what the database actually has ---------------------------------- */

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');

const tables = new Set<string>();
const columns = new Map<string, Set<string>>();

const add = (table: string, column: string) => {
  if (!columns.has(table)) columns.set(table, new Set());
  columns.get(table)!.add(column);
};

// CREATE TABLE [IF NOT EXISTS] name ( ...body... )
for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_.]*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
  const table = m[1].replace(/^public\./, '');
  tables.add(table);
  for (const line of m[2].split('\n')) {
    const col = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/i);
    // Skip table-level constraints, which look like columns to a regex.
    if (col && !/^(primary|foreign|unique|constraint|check)$/i.test(col[1])) add(table, col[1].toLowerCase());
  }
}

/*
 * ALTER TABLE name ADD COLUMN [IF NOT EXISTS] col, ADD COLUMN ...
 *
 * Two things a naive regex gets wrong here, and both of them look like the
 * code is buggy rather than the parser. These statements are routinely
 * written across several lines, and one ALTER TABLE often adds several
 * columns in a comma-separated list — matching only the first silently
 * loses the rest.
 */
for (const stmt of sql.matchAll(/alter\s+table\s+(?:only\s+)?([a-z_][a-z0-9_.]*)([\s\S]*?);/gi)) {
  const table = stmt[1].replace(/^public\./, '');
  const clauses = [...stmt[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)];
  if (clauses.length === 0) continue;
  tables.add(table);
  for (const c of clauses) add(table, c[1].toLowerCase());
}

/**
 * The columns a select asks for *of the table it is on*.
 *
 * Everything inside `relation(...)` belongs to that relation, not to this
 * table — so `contacts(first_name, last_name)` must not be read as
 * `inbox_messages.last_name`. Splitting on commas alone gets this wrong for
 * every embed with more than one column, which is most of them, and a guard
 * that cries wolf on two dozen valid queries is a guard people switch off.
 */
function topLevelColumns(select: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';

  const flush = () => {
    const name = current
      .replace(/^[a-z_][a-z0-9_]*:/i, '')  // alias:column
      .replace(/!inner|!left/gi, '')
      .trim()
      .toLowerCase();
    current = '';
    if (name && name !== '*' && !name.includes(' ')) out.push(name);
  };

  for (const ch of select) {
    if (ch === '(') { depth++; if (depth === 1) { current = ''; continue; } }
    if (ch === ')') { depth--; continue; }
    if (depth > 0) continue;            // inside an embed: not ours
    if (ch === ',') { flush(); continue; }
    current += ch;
  }
  flush();
  return out;
}

/* ---- what the code claims -------------------------------------------- */

let pass = 0;
let fail = 0;
const problems: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else { fail++; problems.push(`${label}${detail ? ` — ${detail}` : ''}`); }
}

/*
 * Tables the app talks to that this repo does not create.
 *
 * `auth.users` is Supabase's. The rest are checked; anything genuinely
 * external should be added here with a reason rather than by widening the
 * regex until the guard stops complaining.
 */
const NOT_OURS = new Set(['auth.users']);

for (const file of readdirSync(SERVICES).filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(join(SERVICES, file), 'utf8');

  for (const m of src.matchAll(/\.from\((['"])([a-z_][a-z0-9_.]*)\1\)([\s\S]{0,400})/gi)) {
    const table = m[2];
    if (NOT_OURS.has(table)) continue;

    check(`${file}: table "${table}"`, tables.has(table),
      `no migration creates it. Known: ${[...tables].slice(0, 6).join(', ')}…`);
    if (!tables.has(table)) continue;

    /*
     * The first .select() after the .from(), and only if it is still part of
     * the same query. Without the cut, a `.from('x').delete()` followed by an
     * unrelated query inside the window has that second query's columns
     * attributed to x — which reads as a bug in code that is perfectly fine.
     */
    const window = m[3].split(/\.from\(/)[0];
    const sel = window.match(/\.select\(\s*(['"`])([\s\S]*?)\1/);
    if (!sel) continue;

    const known = columns.get(table) ?? new Set();
    for (const name of topLevelColumns(sel[2])) {
      if (tables.has(name)) continue;  // an embed's name, not a column
      check(`${file}: ${table}.${name}`, known.has(name), `not a column of ${table}`);
    }
  }
}

console.log(`schema guard: ${tables.size} tables and ${[...columns.values()].reduce((n, s) => n + s.size, 0)} columns known from migrations`);
if (problems.length) {
  console.log('\nnames the code uses that the database does not have:\n');
  for (const p of problems) console.log(`  FAIL ${p}`);
}
console.log(`\n${pass} checked, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
