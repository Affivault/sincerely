/* ═══════════════════════════════════════════════════════════════════════
   Official brand marks on Integrations and Backup, and connecting Gmail /
   Google Workspace with an app password, made easy.

   Run: npx tsx scripts/brands-google-check.mts
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

const { INTEGRATION_CATALOG } = await import('@lemlist/shared') as any;
const { normaliseMailboxPassword } = await import('../src/services/smtp.service.js');
const { describeSmtpError } = await import('../src/services/email-sender.service.js');
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), 'utf8');
const logos = read('../../client/src/components/shared/brandLogos.ts');
let passed = 0;
let failed = 0;
function is(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`); }
}

console.log('\nofficial logos');
const missing = INTEGRATION_CATALOG.map((p: any) => p.id).filter((id: string) => !new RegExp(`^  ${id}: \\{`, 'm').test(logos));
is('every integration has its official mark', missing.length === 0, missing.join(', '));
is('and every backup destination', ['google_drive', 'onedrive', 'dropbox', 's3'].every((id) => new RegExp(`^  ${id}: \\{`, 'm').test(logos)));
is('from public-domain (CC0) brand artwork, credited', /CC0/.test(logos) && /gilbarbara\/logos/.test(logos) && /Simple Icons/.test(logos));
is('drawn as static images, never as live SVG', /data:image\/svg\+xml/.test(read('../../client/src/components/shared/BrandLogo.tsx')) && !/dangerouslySetInnerHTML/.test(read('../../client/src/components/shared/BrandLogo.tsx')));
is('the Integrations page and the backup screens use them', /<BrandLogo id=\{providerId as BrandId\}/.test(read('../../client/src/pages/integrations/IntegrationsPage.tsx')) && /<BrandLogo id=\{BACKUP_BRAND\[id\]\}/.test(read('../../client/src/components/settings/BackupHub.tsx')));
is('no logo carries script or external references (only its own #parts)', !/<script|href=\\"(?!#)|javascript:/i.test(logos));

console.log('\nGmail and Google Workspace');
is('the 16 letters can be pasted with Google\'s spaces', normaliseMailboxPassword('smtp.gmail.com', 'abcd efgh ijkl mnop') === 'abcdefghijklmnop');
is('and no other provider\'s password is touched', normaliseMailboxPassword('smtp.office365.com', 'pass word') === 'pass word');
const guide = read('../../client/src/components/mailbox/GoogleConnect.tsx');
is('each Google page opens as the address being connected', /authuser=\$\{encodeURIComponent/.test(guide) && /myaccount\.google\.com\/apppasswords/.test(guide) && /signinoptions\/twosv/.test(guide));
is('the field counts to 16', /of 16 letters so far/.test(guide));
is('Workspace admins get the two switches, with line breaks that survive email apps', /Allow users to turn on 2-Step Verification/.test(guide) && /Enable IMAP access/.test(guide) && /join\('\\r\\n'\)/.test(guide));
is('the add-mailbox window uses it for Gmail and Workspace', /<GoogleAppPasswordGuide/.test(read('../../client/src/pages/smtp/SmtpAccountModal.tsx')));
is('"application-specific password required" says what to do', /app password/.test(describeSmtpError(new Error('534-5.7.9 Application-specific password required. gsmtp'))));
is('a refused app password says why it usually happens', /same Google account/.test(describeSmtpError(new Error('535-5.7.8 Username and Password not accepted. gsmtp'))));
is('Outlook no longer tells people to use an app password', !/create an app password under Security/.test(read('../../shared/src/mailbox-providers.ts')));

console.log(`\n${passed} passed, ${failed} failed`);
assert.equal(failed, 0, `${failed} brand/Google check(s) failed`);
