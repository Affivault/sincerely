/* ═══════════════════════════════════════════════════════════════════════
   Google Drive backup (migration 112). What the spreadsheet holds, how
   the change log reads, and the rules that keep a backup trustworthy:
   fixed columns, plain text only, a deleted person kept, never writing
   one person's details onto another's row, and access to nothing in the
   customer's Drive but the one spreadsheet.

   Run: npx tsx scripts/drive-backup-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.TRACKING_BASE_URL ||= 'https://app.sincerely.io';
process.env.CLIENT_URL ||= 'https://app.sincerely.io';
process.env.API_BASE_URL ||= 'https://api.sincerely.io';
process.env.GOOGLE_CLIENT_ID ||= 'google-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'google-client-secret';

const shared = await import('@lemlist/shared');
const {
  PEOPLE_COLUMNS, COMPANY_COLUMNS, HELD_COLUMNS, LIST_COLUMNS, personRow, companyRow, heldRow, listRow,
  logRow, collapseLog, describeUpdate, columnLetter, a1, BACKUP_TABS, JOBS,
} = shared as any;
const { signState, verifyState, statePurpose } = await import('../src/services/calendar-sync.service.js');
const { driveBackupService } = await import('../src/services/drive-backup.service.js');

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), 'utf8');
const svc = read('../src/services/drive-backup.service.ts');
const migration = read('../../supabase/migrations/112_drive_backup.sql');
const callback = read('../src/routes/calendar-oauth.routes.ts');
let passed = 0;
let failed = 0;
function is(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`); }
}

const person = {
  id: '11111111-1111-1111-1111-111111111111', email: 'ada@analytical.io', first_name: 'Ada', last_name: 'Lovelace',
  lifecycle: 'contact', job_title: 'CTO', company: 'Analytical', country: 'United Kingdom',
  list_names: ['UK founders', 'Q4'], tag_names: ['VIP'], company_rec: { size: '11-50', industry: 'Software' },
  dcs_verified_at: '2026-10-01T00:00:00Z', dcs_score: 92, dcs_syntax_ok: true, dcs_domain_ok: true,
  custom_fields: { Source: 'Webinar', 'Deal size': '=HYPERLINK("x")' }, created_at: '2026-01-02T03:04:05Z',
};

console.log('\nthe spreadsheet');
is('six tabs, About first', BACKUP_TABS.join('|') === 'About|People|Companies|No email|Lists|Change log');
const row = personRow(person);
is('a person row fills exactly the People columns', row.length === PEOPLE_COLUMNS.length, `${row.length} vs ${PEOPLE_COLUMNS.length}`);
is('keyed by id in column A, with Type and Record', row[0] === person.id && row[1] === 'Active' && row[2] === 'Contact');
is('lists, tags and company details travel with them', row.includes('UK founders, Q4') && row.includes('VIP') && row.includes('11-50'));
is('the email light is in words', row.includes('Valid'));
is('custom fields share one column, so columns never shift', String(row[row.length - 1]).includes('Source: Webinar | Deal size:'));
is('a deleted person is kept, marked Deleted', personRow(person, { deletedAt: '2026-11-03T10:00:00Z' })[1] === 'Deleted');
is('company, held and list rows fill their columns',
  companyRow({ id: 'c', name: 'Analytical' }).length === COMPANY_COLUMNS.length
  && heldRow({ id: 'h', first_name: 'Ada' }).length === HELD_COLUMNS.length
  && listRow({ id: 'l', name: 'UK' }).length === LIST_COLUMNS.length);
is('A1 ranges quote tab names', a1('No email', 'A2') === "'No email'!A2" && columnLetter(35) === 'AI' && columnLetter(26) === 'Z');
is('values are written RAW: a formula stays text', (svc.match(/valueInputOption=RAW|valueInputOption: 'RAW'/g) || []).length >= 2 && !/USER_ENTERED/.test(svc));

console.log('\nthe change log');
const ev = (action: string, detail: string | null = null, entity = 'person') => ({ id: 1, entity, entity_id: person.id, action, detail, created_at: '2026-11-03T10:00:00Z' });
is('a lead becoming a contact says so', logRow(ev('updated', 'lifecycle,updated_at'), person)?.[1] === 'Became a contact');
is('moving lists is two plain lines', logRow(ev('list_removed', 'Cold'), person)?.[1] === 'Removed from list' && logRow(ev('list_added', 'Warm'), person)?.[4] === 'Warm');
const enriched = describeUpdate('person', 'enrichment,job_title,linkedin_url,profile_enriched_at', person);
is('an enrichment says what it filled', enriched?.what === 'Enriched' && /job title, LinkedIn/.test(enriched?.details || ''), JSON.stringify(enriched));
is('a verification says the result', describeUpdate('person', 'dcs_score,dcs_verified_at', person)?.details === 'Valid');
is('bookkeeping alone writes no line', logRow(ev('updated', 'engagement_score'), person) === null);
const many = Array.from({ length: 120 }, (_, i) => ['2026-11-03 10:00', 'Added', `P${i}`, '', 'From leads.csv']);
const collapsed = collapseLog([...many, ['2026-11-03 10:01', 'Tagged', 'Ada', '', 'VIP']]);
is('a big import is one line, not thousands', collapsed.length === 2 && /120 at once/.test(String(collapsed[0][1])), JSON.stringify(collapsed[0]));
is('deleting someone is one line, not one per list as well', /!\(\(e\.action === 'list_removed' \|\| e\.action === 'untagged'\) && deletedIds\.has/.test(svc));

console.log('\nkeeping it right');
is('every change is queued by the database, not by app code remembering to',
  ['trg_backup_contacts', 'trg_backup_companies', 'trg_backup_held_people', 'trg_backup_contact_lists', 'trg_backup_list_contacts', 'trg_backup_contact_tags']
    .every((t) => migration.includes(`CREATE TRIGGER ${t}`)));
is('only for accounts with backup on', (migration.match(/NOT backup_is_on\(v_user\)/g) || []).length === 2);
is('engagement re-scores and counters do not count as changes', /'engagement_score'/.test(migration) && /'list_count'/.test(migration));
is('a row is read back before it is overwritten, and a mismatch rebuilds instead', /values:batchGet/.test(svc) && /if \(String\(v \|\| ''\) !== slice\[j\]\.id\) return false/.test(svc));
is('a deleted record keeps its row, lists and tags', /Everything else on the row stays as it was/.test(svc) && /list_names: gone\(e\.entity_id, 'list_removed'\)/.test(svc));
is('a full rewrite logs the queued changes first, so none is lost', svc.indexOf('writeLogFor(userId, token, sid, upto)') < svc.indexOf("for (const t of tabs) {\n    const sheetId"));
is('two servers never write the same sheet', /busy_until\.is\.null,busy_until\.lt\./.test(svc));
is('a daily full refresh repairs hand edits', /FULL_EVERY_MS = 24 \* 60 \* 60 \* 1000/.test(svc));
is('inside Google\'s write limits', /sleep\(1100\)/.test(svc) && /res\.status === 429/.test(svc));
is('inside Google\'s 10 million cells', /BACKUP_CELL_BUDGET/.test(svc));
is('the change log gets its header when the tab is made', (svc.match(/await writeLogHeader\(token, /g) || []).length === 2);
is('the scheduler is registered as a job', JOBS.some((j: any) => j.id === 'drive_backup'));
is('the migration pastes cleanly: ASCII, no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(BEGIN|COMMIT)\s*;/im.test(migration));
is('tokens are never readable by the browser: no policy on the connection table', !/CREATE POLICY[^;]*backup_connections/.test(migration));

console.log('\nsigning in');
const { url } = driveBackupService.authorizeUrl('u1');
const u = new URL(url);
is('asks for drive.file only - this spreadsheet, nothing else in Drive',
  u.searchParams.get('scope') === 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email');
is('offline with consent, so it keeps working', u.searchParams.get('access_type') === 'offline' && u.searchParams.get('prompt') === 'consent');
const st = u.searchParams.get('state')!;
is('its state is signed for the backup', statePurpose(st) === 'backup');
is('a calendar state stays a calendar state', statePurpose(signState('u1')) === 'calendar' && verifyState(signState('u1')).purpose === 'calendar');
is('the shared callback sends backup consents to the backup', /statePurpose\(state\) === 'backup'\) return backupCallback/.test(callback));
is('a backup consent cannot connect a calendar', /purpose !== 'calendar'\) throw/.test(read('../src/services/calendar-sync.service.ts')));
is('and a missing Drive tick is caught', /includes\('drive\.file'\)/.test(svc));

console.log(`\n${passed} passed, ${failed} failed`);
assert.equal(failed, 0, `${failed} drive backup check(s) failed`);
