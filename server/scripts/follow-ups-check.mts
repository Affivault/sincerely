/* ═══════════════════════════════════════════════════════════════════════
   The ten follow-ups to the import and email-lights work: filters on the
   new fields, bulk edit, company merge tags, enriching people held
   without an email, Google Sheets sync, import history with undo,
   company fields on the contact page, the launch-time verify nudge and
   the phone layout. Each assertion names the behaviour it protects.

   Run: npx tsx scripts/follow-ups-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sanitizePersonFilters, exactIlike, sanitizeViewConfig, sameViewConfig, BULK_EDIT_FIELDS,
  personalize, usesCompanyTags, MERGE_FIELDS,
} from '@lemlist/shared';

const here = dirname(fileURLToPath(import.meta.url));
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');
const server = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const migration = readFileSync(join(here, '../../supabase/migrations/111_import_history_sheet_sync.sql'), 'utf8');
let passed = 0;
let failed = 0;
function is(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`); }
}

console.log('\n1-2. filters on country, industry, company size and engagement');
const f = sanitizePersonFilters({ country: '  United Kingdom ', engagement_min: '140', bogus: 'x', city: '' });
is('only known keys survive, trimmed, engagement capped at 100', f.country === 'United Kingdom' && f.engagement_min === 100 && !('bogus' in f) && !('city' in f));
is('LIKE wildcards in a picked value are literal', exactIlike('100%_a') === '100\\%\\_a');
const view = sanitizeViewConfig({ filters: { country: 'France' } } as any);
is('a saved view keeps its filters', (view as any).filters?.country === 'France');
is('and two views differ when only the filters do', !sameViewConfig({ filters: { country: 'France' } } as any, { filters: { country: 'Spain' } } as any));
const svc = server('services/contacts.service.ts');
is('the list, export and select-all share one filter function', /applyContactFilters/.test(svc) && /async matchingIds\(/.test(svc) && /companyFilterJoin\(/.test(svc));
is('company size filters through the company record', /co_filter\.size/.test(svc));
const list = client('pages/contacts/ContactsListPage.tsx');
is('the Filters menu sits on the people page', /<PersonFiltersMenu/.test(list));
is('segments can use the new fields', /'country'/.test(server('services/segments.service.ts')) && /'engagement_score'/.test(server('services/segments.service.ts')));

console.log('\n3. bulk edit');
is('country, city, state and industry can be set on a selection', ['country', 'city', 'state', 'industry'].every((k) => (BULK_EDIT_FIELDS as readonly string[]).includes(k)));
is('and merging duplicates keeps them', ['country', 'city', 'state', 'industry'].every((k) => (MERGE_FIELDS as readonly string[]).includes(k)));

console.log('\n4. company merge tags');
is('{{company_size}} is a company tag', usesCompanyTags('Hi, a {{company_size}} team') && !usesCompanyTags('Hi {{first_name}}'));
const out = personalize('{{company_industry}} / {{company_size}}', { contact: { company_rec: { industry: 'Fintech', size: '11-50' } } });
is('and reads the company record', out === 'Fintech / 11-50', out);
is('the sender loads the company only when the copy needs it', /withCompanyRecord\(/.test(server('services/sequence.service.ts')) && /usesCompanyTags\(\.\.\.texts\)/.test(server('services/company-tags.service.ts')));

console.log('\n5. enrich people held without an email');
const enrich = server('services/contact-enrichment.service.ts');
is('there is a held-person enrich, refunded when nothing is found', /async enrichHeld\(/.test(enrich) && /ref = `held:\$\{heldId\}`/.test(enrich) && /refund\(userId, ref, bucket, 'nothing_found'\)/.test(enrich));
is('it never looks for an email address', !/email-search|find-email|emailFinder/i.test(enrich.slice(enrich.indexOf('async function runHeld'), enrich.indexOf('export const contactEnrichmentService'))));
is('it only fills blanks', /if \(!held\.job_title && person\.job_title\)/.test(enrich));
is('each held row has an Enrich button', /data-held-enrich/.test(client('components/contacts/HeldPeoplePanel.tsx')));

console.log('\n6. Google Sheets sync');
const sheets = server('services/sheet-sync.service.ts');
const { sheetCsvUrl, parseSheetCsv } = await import('../src/utils/sheet-csv.js');
is('a sheet link becomes its CSV export, keeping the tab',
  sheetCsvUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=77') === 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=csv&gid=77');
is('and nothing but docs.google.com is fetched', sheetCsvUrl('https://evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345') === null && sheetCsvUrl('http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345') === null && sheetCsvUrl('http://169.254.169.254/') === null);
const parsed = parseSheetCsv('Title row,\n\nEmail,Email,\nada@x.io,b@y.io,z\n');
is('the sheet parses like a file: the first non-empty row is the header and a blank header gets a name', parsed.headers.join('|') === 'Title row|Column 2' && parsed.rows.length === 2, parsed.headers.join('|'));
is('a run fills blanks the way a re-import does and is recorded in history', /contactsService\.bulkCreate\(/.test(sheets) && /origin: 'sheet'/.test(sheets));
is('two servers cannot run the same sheet at once', /\.lte\('next_run_at'/.test(server('jobs/schedulers/sheet-sync.scheduler.ts')));
is('the scheduler is started', /startSheetSyncScheduler\(\)/.test(server('index.ts')));

console.log('\n7. import history with undo');
const hist = server('services/import-history.service.ts');
is('undo deletes only who the import added, and keeps anyone in a campaign', /import_run_contacts/.test(hist) && /campaign_contacts/.test(hist) && /!enrolled\.has\(id\)/.test(hist));
is('a batch is only recorded into the caller\'s own open import', /\.eq\('user_id', userId\)\.eq\('status', 'running'\)\.maybeSingle\(\)/.test(hist));
is('history never fails an import', /Never throws: history must not fail an import/.test(hist));
is('the import page opens a run and passes it with every batch', /importsApi\.start\(/.test(client('pages/contacts/BulkImportPage.tsx')) && /importId \}/.test(client('pages/contacts/BulkImportPage.tsx')));
is('the history page has Undo', /data-undo-run/.test(client('pages/contacts/ImportHistoryPage.tsx')));
is('migration 111 creates the tables and the tally', /CREATE TABLE IF NOT EXISTS import_runs/.test(migration) && /CREATE TABLE IF NOT EXISTS sheet_syncs/.test(migration) && /FUNCTION import_run_tally/.test(migration));
is('and pastes cleanly: ASCII, no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(BEGIN|COMMIT)\s*;/im.test(migration));

console.log('\n8. company fields from the contact page');
is('the HQ phone can be saved at last', /'phone', 'notes'\] as const/.test(server('services/companies.service.ts')));
is('size, industry, location and phone are editable on the contact', /function CompanyFacts/.test(client('pages/contacts/ContactDetailPage.tsx')) && /label="HQ phone"/.test(client('pages/contacts/ContactDetailPage.tsx')));

console.log('\n9. launch: few verified, verify them now');
const picker = client('components/campaigns/SendLightsPicker.tsx');
is('under half verified shows the nudge with a button', /counts!\.green \/ total < 0\.5/.test(picker) && /data-verify-unsure/.test(picker));
is('it checks only the unsure, 25 at a time, stopping when credits run out', /amber_ids/.test(picker) && /i \+= 25/.test(picker) && /if \(r\.no_credits\)/.test(picker));

console.log('\n10. phones get cards, not a cut-off table');
is('cards below sm, the table from sm up', /sm:hidden divide-y[^"]*" data-people-cards/.test(list) && /className="hidden sm:block overflow-auto"/.test(list));
is('a card can be selected for the bulk bar', /function PersonCard/.test(list) && /onToggle=\{\(\) => toggleSelectContact\(contact\.id\)\}/.test(list));

console.log(`\n${passed} passed, ${failed} failed`);
assert.equal(failed, 0, `${failed} follow-up check(s) failed`);
