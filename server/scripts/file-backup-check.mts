/* ═══════════════════════════════════════════════════════════════════════
   Backups to OneDrive, Dropbox and S3-compatible storage (migration 113),
   and the shared change queue they read alongside Google Drive.

   Run: npx tsx scripts/file-backup-check.mts
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
process.env.CLIENT_URL ||= 'https://app.sincerely.io';
process.env.API_BASE_URL ||= 'https://api.sincerely.io';
process.env.MICROSOFT_CLIENT_ID ||= 'ms-id';
process.env.MICROSOFT_CLIENT_SECRET ||= 'ms-secret';
process.env.DROPBOX_APP_KEY ||= 'dbx-key';
process.env.DROPBOX_APP_SECRET ||= 'dbx-secret';

const { s3ConfigProblems, BACKUP_PROVIDERS, toCsv, formatBackupBytes } = await import('@lemlist/shared') as any;
const { sigV4, fileBackupService, providerConfigured, backupRedirectUri } = await import('../src/services/file-backup.service.js');
const { verifyState, statePurpose } = await import('../src/services/calendar-sync.service.js');

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), 'utf8');
const svc = read('../src/services/file-backup.service.ts');
const drive = read('../src/services/drive-backup.service.ts');
const migration = read('../../supabase/migrations/113_file_backups.sql');
const hub = read('../../client/src/components/settings/BackupHub.tsx');
const integrations = read('../../client/src/pages/integrations/IntegrationsPage.tsx');
let passed = 0;
let failed = 0;
function is(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`); }
}

console.log('\nwhere a backup can go');
is('Google Drive, OneDrive, Dropbox and S3', BACKUP_PROVIDERS.map((p: any) => p.id).join('|') === 'google_drive|onedrive|dropbox|s3');
is('OneDrive and Dropbox switch on with their app keys; S3 always', providerConfigured('onedrive') && providerConfigured('dropbox') && providerConfigured('s3'));
is('their sign-in comes back to its own address', backupRedirectUri('dropbox') === 'https://api.sincerely.io/api/oauth/backup/dropbox/callback');

console.log('\nsigning in asks for the least that works');
const od = new URL(fileBackupService.authorizeUrl('u1', 'onedrive').url);
is('OneDrive: its app folder only, offline', od.searchParams.get('scope') === 'offline_access Files.ReadWrite.AppFolder User.Read');
const dbx = new URL(fileBackupService.authorizeUrl('u1', 'dropbox').url);
is('Dropbox: offline, so it keeps working', dbx.searchParams.get('token_access_type') === 'offline');
is('each state is signed for its own provider', statePurpose(od.searchParams.get('state')!) === 'backup_onedrive' && statePurpose(dbx.searchParams.get('state')!) === 'backup_dropbox');
is('and a OneDrive consent cannot finish a Dropbox connection', /purpose !== \(provider === 'onedrive' \? 'backup_onedrive' : 'backup_dropbox'\)/.test(svc));
is('only the browser that started it can finish it', /if \(!browserNonce\) throw/.test(svc) && typeof verifyState === 'function');

console.log('\nS3');
const sig = sigV4({
  method: 'GET', path: '/test.txt', query: '',
  headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z' },
  payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', amzDate: '20130524T000000Z',
});
is('requests are signed exactly as AWS\'s own worked example', sig.endsWith('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'), sig);
is('settings are checked before saving', s3ConfigProblems({ bucket: 'Bad_Bucket', region: 'eu-west-2', access_key_id: 'k' }).length > 0
  && s3ConfigProblems({ endpoint: 'http://minio.local', bucket: 'ok-bucket', region: 'x', access_key_id: 'k' }).some((p: string) => /https/.test(p))
  && s3ConfigProblems({ bucket: 'ok-bucket', region: 'auto', access_key_id: 'k', secret_access_key: 's' }, { needSecret: true }).length === 0);
is('a typed-in endpoint must be public, and the request goes to the address checked', /assertSafeWebhookUrl\(base\.toString\(\)\)/.test(svc) && /lookup: pinnedLookup\(addresses\)/.test(svc));
is('keys are proved by writing before they are saved', /store\.put\('\.sincerely-check'/.test(svc));
is('the secret is stored encrypted and never sent back', /secret: encrypt\(secret\)/.test(svc) && !/secret: d\.config\?\.secret/.test(svc));

console.log('\nthe files');
is('CSV cells cannot run as formulas', toCsv(['a'], [['=HYPERLINK("x")']]).includes("'=HYPERLINK"));
is('and open as UTF-8 in Excel', /const BOM = '\\uFEFF'/.test(svc));
is('a latest set, and a dated copy each day', /store\.put\(`latest\/\$\{f\.name\}`/.test(svc) && /store\.put\(`daily\/\$\{day\}\/\$\{f\.name\}`/.test(svc));
is('old copies are removed after the days chosen', /lt\('day', cutoff\)/.test(svc) && /removeFolder\(o\.folder\)/.test(svc));
is('bigger accounts are rewritten less often', /people > 100_000\) return 60 \* 60_000/.test(svc));
is('large files go up in pieces', /createUploadSession/.test(svc) && /upload_session\/start/.test(svc));
is('sizes read plainly', formatBackupBytes(3_412_877) === '3.3 MB');

console.log('\none queue, several readers');
is('every reader keeps its own place', /ADD COLUMN IF NOT EXISTS cursor bigint/.test(migration) && /cursor           bigint NOT NULL DEFAULT 0/.test(migration));
is('a change is dropped only when every reader has passed it', /CREATE OR REPLACE FUNCTION backup_prune/.test(migration) && /SELECT min\(x\.c\)/.test(migration));
is('changes are queued while any backup is on', /FROM backup_destinations d\s+WHERE d\.user_id = p_user AND d\.enabled/.test(migration));
is('Google Drive reads from its place instead of deleting', /\.gt\('id', from\)/.test(drive) && /await advance\(conn, upto\)/.test(drive) && !/backup_outbox'\)\.delete\(\)\.eq\('user_id', userId\)\.lte/.test(drive));
is('and still works before migration 113', /if \(!hasCursor\(conn\)\)/.test(drive));
is('the change log is kept once and written everywhere', /backup_log/.test(svc) && /processLog\(dest\.user_id\)/.test(svc));
is('the migration pastes cleanly: ASCII, no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(BEGIN|COMMIT)\s*;/im.test(migration));

console.log('\non screen');
is('Settings > Backup opens on where the data is kept', /data-coverage-map/.test(hub) && /function CoverageMap/.test(hub));
is('daily copies show as a strip of days', /data-daily-strip/.test(hub));
is('S3 has presets for AWS, R2, Backblaze and Wasabi', ['Amazon S3', 'Cloudflare R2', 'Backblaze B2', 'Wasabi'].every((n) => hub.includes(`name: '${n}'`)));
is('the Integrations page has a Backup section', /<BackupDestinations \/>/.test(integrations));

console.log(`\n${passed} passed, ${failed} failed`);
assert.equal(failed, 0, `${failed} file backup check(s) failed`);
