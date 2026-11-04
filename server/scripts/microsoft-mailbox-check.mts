/* ═══════════════════════════════════════════════════════════════════════
   Outlook and Microsoft 365 mailboxes connected with Microsoft sign-in
   (migration 114), and "Continue with Microsoft" on login and sign-up.

   Run: npx tsx scripts/microsoft-mailbox-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

const { encrypt } = await import('../src/utils/encryption.js');
const { smtpAuth, imapAuth, mailboxSecret, microsoftMarker, mailboxOAuthService, mailboxRedirectUri, describeMicrosoftSmtpError, MS_MAIL_SCOPES } =
  await import('../src/services/mailbox-oauth.service.js');
const { statePurpose } = await import('../src/services/calendar-sync.service.js');

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), 'utf8');
let passed = 0;
let failed = 0;
function is(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`); }
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

console.log('\nsigning in to a mailbox');
is('a password mailbox signs in with its password, exactly as before',
  JSON.stringify(smtpAuth('a@x.com', 'pw')) === JSON.stringify({ user: 'a@x.com', pass: 'pw' })
  && JSON.stringify(imapAuth('a@x.com', 'pw')) === JSON.stringify({ user: 'a@x.com', pass: 'pw' }));
is('a Microsoft mailbox signs in with a token (XOAUTH2)',
  JSON.stringify(smtpAuth('a@x.com', 'oauth2:TOK')) === JSON.stringify({ type: 'OAuth2', user: 'a@x.com', accessToken: 'TOK' })
  && JSON.stringify(imapAuth('a@x.com', 'oauth2:TOK')) === JSON.stringify({ user: 'a@x.com', accessToken: 'TOK' }));
is('a stored password still decrypts to itself', (await mailboxSecret(encrypt('hunter2'))) === 'hunter2');
is('a Microsoft mailbox stores a marker, never a password', microsoftMarker('abc') !== 'msoauth:abc' && microsoftMarker('abc').length > 20);

const src = walk(join(here, '../src'));
const raw = src.filter((f) => !f.endsWith('mailbox-oauth.service.ts')).filter((f) => /decrypt\([A-Za-z_.?!]*\.smtp_pass_encrypted\)/.test(readFileSync(f, 'utf8')));
is('no code reads a mailbox password around the Microsoft sign-in', raw.length === 0, raw.join(', '));
const bare = src.filter((f) => /new ImapFlow\(|createTransport\(/.test(readFileSync(f, 'utf8')))
  .filter((f) => /auth: \{ user: [^}]*pass: /.test(readFileSync(f, 'utf8')));
is('every SMTP and IMAP connection can sign in with a token', bare.length === 0, bare.join(', '));
is('the send relay understands a token too', /startsWith\('oauth2:'\)/.test(read('../../api/send-email.ts')));

console.log('\nconnecting');
const u = new URL(mailboxOAuthService.authorizeUrl('u1', { loginHint: 'alex@outlook.com' }).url);
is('asks for sending and reading mail, and nothing else', MS_MAIL_SCOPES === 'openid email profile offline_access https://outlook.office.com/SMTP.Send https://outlook.office.com/IMAP.AccessAsUser.All' && u.searchParams.get('scope') === MS_MAIL_SCOPES);
is('works for personal and work accounts', u.pathname.startsWith('/common/'));
is('suggests the address being connected', u.searchParams.get('login_hint') === 'alex@outlook.com');
is('its state is signed for mailboxes only', statePurpose(u.searchParams.get('state')!) === 'mailbox_microsoft');
is('returns to its own address', mailboxRedirectUri() === 'https://api.sincerely.io/api/oauth/mailbox/microsoft/callback');
const svc = read('../src/services/mailbox-oauth.service.ts');
is('only the browser that started it can finish it', /if \(!browserNonce\) throw/.test(svc));
is('refuses a sign-in without send permission or a renewal token', /SMTP\\\.Send/.test(svc) && /if \(!t\.refresh_token\)/.test(svc));
is('personal accounts send through Outlook.com, work ones through Microsoft 365', /personal \? 'smtp-mail\.outlook\.com' : 'smtp\.office365\.com'/.test(svc));
is('an existing mailbox is moved onto Microsoft sign-in, not added twice', /if \(existing\) \{\s*accountId = existing\.id;/.test(svc));
is('the plan\'s mailbox cap applies', /assertCanAddInbox\(userId\)/.test(svc));
is('it is tested before anyone relies on it', /smtpService\.verifyCredentials\(userId/.test(svc));
is('renewal tokens are rotated and kept encrypted', /if \(t\.refresh_token\) patch\.refresh_token = encrypt\(t\.refresh_token\)/.test(svc));
is('a revoked sign-in says "reconnect", on the mailbox', /broken_reason: reason/.test(svc) && /last_send_error: reason/.test(svc));

console.log('\nwhat people read');
is('"Authenticated SMTP is off" says who fixes it and where', /admin centre/.test(describeMicrosoftSmtpError('535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant') || ''));
is('the add-mailbox flow offers Microsoft sign-in', /<MicrosoftConnectCard/.test(read('../../client/src/pages/smtp/SmtpAccountModal.tsx')));
is('a broken Microsoft mailbox offers "Reconnect with Microsoft"', /Reconnect with Microsoft/.test(read('../../client/src/components/mailbox/MailboxDrawer.tsx')));
is('login and sign-up offer "Continue with Microsoft"', ['LoginPage', 'SignupPage'].every((p) => /<OAuthButtons/.test(read(`../../client/src/pages/auth/${p}.tsx`)))
  && /id: 'azure', name: 'Microsoft'/.test(read('../../client/src/components/auth/OAuthButtons.tsx')));
is('and ask Microsoft for the email address', /scopes: 'openid email profile'/.test(read('../../client/src/context/AuthContext.tsx')));
const migration = read('../../supabase/migrations/114_microsoft_mailboxes.sql');
is('the migration pastes cleanly: ASCII, no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(BEGIN|COMMIT)\s*;/im.test(migration));
is('tokens are never readable by the browser', !/CREATE POLICY[^;]*mailbox_oauth/.test(migration));

console.log('\neveryday use');
const { categoriseImapError } = await import('../src/services/inbox-sync.service.js');
is('a Microsoft mailbox that cannot read its inbox is told about IMAP, not a password',
  /IMAP/.test(categoriseImapError('AUTHENTICATIONFAILED', { microsoft: true })) && !/password/i.test(categoriseImapError('AUTHENTICATIONFAILED', { microsoft: true }))
  && /password/.test(categoriseImapError('AUTHENTICATIONFAILED')));
is('a new Microsoft mailbox starts at the cold-email pace, not 200 a day', /daily_send_limit: RECOMMENDED_DAILY_LIMIT/.test(svc));
const buttons = read('../../client/src/components/auth/OAuthButtons.tsx');
const providers = read('../../client/src/lib/oauthSignIn.ts');
is('login shows only the providers Supabase has switched on', /auth\/v1\/settings/.test(providers) && /available\[p\.id\]/.test(buttons));
is('a failed Google or Microsoft sign-in comes back to the login page in plain words', /captureOAuthError\(\);/.test(read('../../client/src/context/AuthContext.tsx')) && /takeOAuthError\(\)/.test(read('../../client/src/pages/auth/LoginPage.tsx')));
is('each button shows it is working, and the one used last is marked', /Opening \$\{name\}/.test(buttons) && /Last used/.test(buttons));
const methods = read('../../client/src/components/settings/SignInMethods.tsx');
is('Settings > Account links and unlinks Google and Microsoft', /linkIdentity/.test(methods) && /unlinkIdentity/.test(methods));
is('and never unlinks the last way in', /identities\.length < 2/.test(methods));
const connect = read('../../client/src/components/mailbox/MicrosoftConnect.tsx');
is('the connect card has a step-by-step guide for cold email', /data-microsoft-guide/.test(connect) && /Authenticated SMTP/.test(connect) && /spf\.protection\.outlook\.com/.test(connect));
is('signed in with Microsoft? that mailbox is offered in one click', /function SuggestMicrosoftMailbox/.test(connect) && /<SuggestMicrosoftMailbox/.test(read('../../client/src/pages/smtp/EmailAccountsPage.tsx')));

console.log('\nlooking after mailboxes');
is('every Microsoft mailbox sign-in is renewed about daily, so a revoked one is found early', /async checkAll\(\)/.test(svc) && /lt\('updated_at', since\)/.test(svc) && /startMailboxSigninScheduler\(\)/.test(read('../src/index.ts')));
is('a revoked one leaves the sending rotation', /last_send_error: reason, is_verified: false/.test(svc));
const status = read('../src/services/system-status.service.ts');
is('and its owner is told, once, by the watchdog', /mailbox-microsoft:\$\{b\.id\}/.test(status) && /Reconnect \$\{b\.email_address\} with Microsoft/.test(status));
const admin = new URL(mailboxOAuthService.adminConsentUrl());
is('an IT admin gets a one-click approval for the whole organisation', admin.pathname === '/organizations/v2.0/adminconsent' && admin.searchParams.get('client_id') === 'ms-id' && admin.searchParams.get('redirect_uri') === mailboxRedirectUri());
is('and lands on a plain thank-you page', /state === 'admin-consent'/.test(read('../src/routes/mailbox-oauth.routes.ts')));
const connect2 = read('../../client/src/components/mailbox/MicrosoftConnect.tsx');
is('the steps for the admin name the switches and a PowerShell line per mailbox', /Set-CASMailbox -Identity \$\{m\} -SmtpClientAuthenticationDisabled \$false -ImapEnabled \$true/.test(connect2));
is('teams connect mailbox after mailbox', /function MicrosoftTeamPanel/.test(connect2) && /function ConnectNextBanner/.test(connect2));
is('first-run setup offers the Microsoft account someone signed up with, and comes back to setup', /data-start-microsoft/.test(read('../../client/src/pages/start/StartPage.tsx')) && /returnTo="\/start"/.test(read('../../client/src/pages/start/StartPage.tsx')));
is('a Microsoft 365 domain gets Microsoft\'s own checklist', /function Microsoft365Checklist/.test(read('../../client/src/pages/domains/DomainsPage.tsx')));

console.log(`\n${passed} passed, ${failed} failed`);
assert.equal(failed, 0, `${failed} Microsoft mailbox check(s) failed`);
