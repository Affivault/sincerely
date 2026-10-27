/* ═══════════════════════════════════════════════════════════════════════
   Load the People Data Labs Free Company Dataset into company_directory.

   Migration 098 must have been run first. Download the dataset from
   https://www.peopledatalabs.com/company-dataset (CSV or JSON, unzipped or
   .gz), then from server/:

     npx tsx scripts/import-company-directory.mts <file> --dry-run
     npx tsx scripts/import-company-directory.mts <file>

   It reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from server/.env (or
   the environment) and upserts in batches, so a run that stops can simply be
   started again, or resumed with --skip=<rows already loaded>.

   Options
     --dry-run           read and count only; nothing is written
     --keep-no-domain    also load companies without a website (skipped by
                         default: with no domain, nobody there can be emailed)
     --countries=a,b     only these countries, e.g. --countries="united states,united kingdom"
     --skip=N            skip the first N usable rows (to resume a run)
     --batch=N           rows per request (default 1000)
     --parallel=N        requests in flight (default 4)

   A quarterly refresh is a full reload, because PDL ids change between
   releases: run  TRUNCATE company_directory;  in the SQL editor, then import.
   ═══════════════════════════════════════════════════════════════════════ */

import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type { Readable } from 'node:stream';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';
import { normalizeCompanyRecord, type CompanyDirectoryRow } from '../src/services/company-directory.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

if (!file) {
  console.error('Usage: npx tsx scripts/import-company-directory.mts <file.csv|file.json[.gz]> [--dry-run]');
  process.exit(1);
}

const dryRun = flag('dry-run');
const keepNoDomain = flag('keep-no-domain');
const countries = option('countries') ? new Set(option('countries')!.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)) : null;
const skip = Math.max(0, Number(option('skip')) || 0);
const batchSize = Math.min(5000, Math.max(100, Number(option('batch')) || 1000));
const parallel = Math.min(16, Math.max(1, Number(option('parallel')) || 4));

const supabase = dryRun ? null : (() => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server/.env).');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
})();

const counts = { read: 0, unusable: 0, noDomain: 0, otherCountry: 0, skipped: 0, loaded: 0 };
let usable = 0;
let batch: CompanyDirectoryRow[] = [];
const inFlight = new Set<Promise<void>>();
const started = Date.now();

async function send(rows: CompanyDirectoryRow[], attempt = 1): Promise<void> {
  const { error } = await supabase!.from('company_directory').upsert(rows, { onConflict: 'id' });
  if (!error) { counts.loaded += rows.length; return; }
  if (attempt >= 5) throw new Error(`batch failed after ${attempt} tries: ${error.message}`);
  await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  return send(rows, attempt + 1);
}

/** Queue a full batch; waits while too many are already in flight. */
async function flush() {
  if (!batch.length) return;
  const rows = batch;
  batch = [];
  if (dryRun) { counts.loaded += rows.length; return; }
  const p = send(rows).finally(() => inFlight.delete(p));
  inFlight.add(p);
  if (inFlight.size >= parallel) await Promise.race(inFlight);
}

let lastLog = 0;
function progress(force = false) {
  if (!force && Date.now() - lastLog < 5000) return;
  lastLog = Date.now();
  const secs = Math.max(1, (Date.now() - started) / 1000);
  console.log(`  read ${counts.read.toLocaleString()}  ${dryRun ? 'would load' : 'loaded'} ${counts.loaded.toLocaleString()}  (${Math.round(counts.loaded / secs).toLocaleString()}/s)`);
}

/** Returns true when the row was queued (the caller may need to wait on flush). */
function take(record: Record<string, unknown>): boolean {
  counts.read++;
  const row = normalizeCompanyRecord(record);
  if (!row) { counts.unusable++; return false; }
  if (!row.domain && !keepNoDomain) { counts.noDomain++; return false; }
  if (countries && !countries.has(row.country || '')) { counts.otherCountry++; return false; }
  usable++;
  if (usable <= skip) { counts.skipped++; return false; }
  batch.push(row);
  return batch.length >= batchSize;
}

function open(path: string): Readable {
  const raw = createReadStream(path);
  return path.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
}

async function importJson(path: string) {
  // Newline-delimited JSON; a JSON array laid out one object per line works too.
  const lines = createInterface({ input: open(path), crlfDelay: Infinity });
  for await (const line of lines) {
    const s = line.trim().replace(/^\[/, '').replace(/,?\]?$/, '').trim();
    if (!s) continue;
    let record: Record<string, unknown>;
    try { record = JSON.parse(s); } catch { counts.read++; counts.unusable++; continue; }
    if (take(record)) await flush();
    progress();
  }
}

function importCsv(path: string): Promise<void> {
  // Delimiter is auto-detected, so the pipe-delimited file works as well.
  return new Promise((resolve, reject) => {
    Papa.parse(open(path) as any, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim().toLowerCase(),
      step: (result: Papa.ParseStepResult<Record<string, unknown>>, parser: Papa.Parser) => {
        if (!take(result.data)) return progress();
        parser.pause();
        flush().then(() => { progress(); parser.resume(); }, (err) => { parser.abort(); reject(err); });
      },
      complete: () => resolve(),
      error: (err: Error) => reject(err),
    } as any);
  });
}

console.log(`${dryRun ? 'Dry run of' : 'Importing'} ${file}${countries ? ` (countries: ${[...countries].join(', ')})` : ''}`);
try {
  if (/\.(json|jsonl|ndjson)(\.gz)?$/i.test(file)) await importJson(file);
  else await importCsv(file);
  await flush();
  await Promise.all(inFlight);
} catch (err: any) {
  progress(true);
  console.error(`\nStopped: ${err?.message || err}`);
  console.error(`Resume with --skip=${counts.skipped + counts.loaded} (rows are upserted, so overlap is harmless).`);
  process.exit(1);
}
progress(true);
console.log(`\nDone in ${Math.round((Date.now() - started) / 60000)} min.`);
console.log(`  read            ${counts.read.toLocaleString()}`);
console.log(`  ${dryRun ? 'would load' : 'loaded    '}      ${counts.loaded.toLocaleString()}`);
console.log(`  no website      ${counts.noDomain.toLocaleString()}${keepNoDomain ? '' : ' (skipped; --keep-no-domain to load them)'}`);
if (countries) console.log(`  other country   ${counts.otherCountry.toLocaleString()}`);
console.log(`  unusable        ${counts.unusable.toLocaleString()}`);
if (skip) console.log(`  resumed past    ${counts.skipped.toLocaleString()}`);
if (!dryRun) console.log('\nThe Prospector picks the new rows up within 10 minutes (or on a server restart).');
