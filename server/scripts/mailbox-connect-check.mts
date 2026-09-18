/* ═══════════════════════════════════════════════════════════════════════
   Connecting a mailbox, and being told the truth about whether it worked.

   Three mailboxes on one domain were showing "Verified" and a green 100%
   deliverability score while every sync failed with "The IMAP host could
   not be found", and pressing Test produced either a raw relay error or a
   browser "Network error". Everything in this file comes from taking that
   apart.

   The root cause was not the DNS. It was that the thing which TESTS a
   mailbox and the thing which USES it were different code, and they
   disagreed about which server the mailbox is on:

     · The connection check read imap_host, logged in, and passed.
     · The sync ignored imap_host entirely and derived its own name from
       smtp_host by string substitution, so smtp.spacemail.com became
       imap.spacemail.com - which does not exist.
     · The warm-up service, a third copy, honoured imap_host all along.

   So the field the form edits was decorative, and the check that was meant
   to catch this was testing a different server from the one that would be
   used. Most of what follows is about keeping those paths from drifting
   apart again.

   Run: npx tsx scripts/mailbox-connect-check.mts
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

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');

const { imapHostFor } = await import('../src/services/inbox-sync.service.js');

console.log('\nthe mailbox server is the one the account was given');
{
  /*
   * The exact configuration that was failing. Sending works on
   * smtp.spacemail.com; the mailboxes are on mail.spacemail.com; and
   * imap.spacemail.com - what the derivation produced - is not a name at
   * all, which is why the error said the host could not be found.
   */
  const spacemail = {
    imap_host: 'mail.spacemail.com',
    smtp_host: 'smtp.spacemail.com',
    email_address: 'scott@yieldstones.co.uk',
  };

  is('a stored IMAP host is used as given',
     imapHostFor(spacemail) === 'mail.spacemail.com', imapHostFor(spacemail));
  is('and is not overridden by anything derived from the SMTP host',
     imapHostFor(spacemail) !== 'imap.spacemail.com', imapHostFor(spacemail));

  // Whitespace from a paste must not make a stored host look absent.
  is('a padded value still counts as stored',
     imapHostFor({ ...spacemail, imap_host: '  mail.spacemail.com  ' }) === 'mail.spacemail.com',
     imapHostFor({ ...spacemail, imap_host: '  mail.spacemail.com  ' }));
  is('an empty string falls through rather than returning nothing',
     imapHostFor({ ...spacemail, imap_host: '   ' }) === 'imap.spacemail.com',
     imapHostFor({ ...spacemail, imap_host: '   ' }));
}

console.log('\nmailboxes connected before the field existed still resolve');
{
  // The derivation is a fallback now, not the rule. It still has to work,
  // or fixing this would disconnect every account that predates it.
  is('Gmail', imapHostFor({ smtp_host: 'smtp.gmail.com' }) === 'imap.gmail.com');
  is('Microsoft', imapHostFor({ smtp_host: 'smtp.office365.com' }) === 'outlook.office365.com');
  is('a conventional host', imapHostFor({ smtp_host: 'smtp.example.net' }) === 'imap.example.net');
  is('nothing but an address',
     imapHostFor({ email_address: 'a@example.net' }) === 'imap.example.net');
}

console.log('\nthe sync reads the settings it is meant to use');
{
  const sync = src('services/inbox-sync.service.ts');

  /*
   * A column that is never selected is a column the sync cannot honour, no
   * matter what the function above decides. This was the second half of the
   * same bug: even with imapHostFor fixed, imap_host was not in the query,
   * so it would have read undefined forever - and the automatic repair,
   * which writes that column, would have gone on reporting "No IMAP server
   * is set" about a mailbox that had one.
   */
  const select = sync.match(/\.select\('id, user_id[^']*'\)/)?.[0] || '';
  is('imap_host is fetched', select.includes('imap_host'), select);
  is('imap_port is fetched', select.includes('imap_port'), select);
  is('imap_secure is fetched', select.includes('imap_secure'), select);

  // Port and TLS were hardcoded, so a mailbox saved on 143 was unreachable
  // whatever the form said.
  is('the port comes from the account', /port: raw\.imap_port \|\| 993/.test(sync));
  is('and so does the TLS setting', /secure: raw\.imap_secure !== false/.test(sync));
}

console.log('\nthere is one answer to "does this mailbox work"');
{
  const smtp = src('services/smtp.service.ts');
  const testBody = smtp.slice(smtp.indexOf('async test('), smtp.indexOf('async verifyCredentials('));

  /*
   * Test used to send a probe mail and call that a pass, which is how a
   * mailbox whose replies could not be read at all still showed "Verified".
   * It now goes through the same check as the button in the form - the one
   * that tries IMAP too.
   */
  is('Test runs the full connection check', /this\.verifyCredentials\(/.test(testBody), testBody.slice(0, 200));
  is('and hands it the IMAP settings, so that leg can actually run',
     /imap_host: account\.imap_host/.test(testBody));
  is('it no longer sends its own probe mail in parallel',
     !/sendViaSmtp\(/.test(testBody), 'Test still has its own send path');
  is('and no longer returns the raw error text',
     !/err\.message \|\| 'Connection failed'/.test(testBody),
     'a relay failure would surface as "SMTP relay error: ..." again');
}

console.log('\nnothing waits longer than the browser will');
{
  const sender = src('services/email-sender.service.ts');
  const relay = sender.slice(sender.indexOf('async function sendViaRelay'));

  /*
   * postToRelay has always accepted an AbortSignal and was never given one,
   * so the fetch had no deadline. The relay's own limit bounds the SMTP
   * conversation inside the function and says nothing about a cold start or
   * a queued invocation, so the request could outlive the browser's 30s
   * timeout - which the user sees as "Network error", intermittently,
   * because cold starts are intermittent.
   */
  is('the relay call is given a deadline', /controller\.signal/.test(relay), 'relay fetch is unbounded');
  // Read the ceiling out of the code rather than pattern-matching the
  // expression around it, so the assertion is about the number that matters.
  const ceiling = Number(
    (relay.match(/const budget = Math\.min\(.*?,\s*([0-9_]+)\s*\)/)?.[1] || '0').replace(/_/g, ''),
  );
  is('and the deadline is under the client’s 30s timeout',
     ceiling > 0 && ceiling < 30_000, `ceiling is ${ceiling}ms against a 30000ms client timeout`);
  is('the timer is always cleared', /finally \{\s*\n\s*clearTimeout\(deadline\);/.test(relay));

  /*
   * Giving up waiting is not the same as the relay failing. It may be
   * delivering the message at that moment, so a direct retry is how the
   * same email arrives twice.
   */
  is('a give-up does not trigger a duplicate direct send',
     /AbortError/.test(relay) && relay.indexOf('AbortError') < relay.indexOf('falling back to direct SMTP'),
     'an aborted relay call still falls through to sendDirect');
}

console.log('\nthe three IMAP host resolvers agree');
{
  /*
   * There were three, with the same name and different behaviour: the sync
   * ignored imap_host, warm-up honoured it, and the connection check used
   * it directly. A mailbox could therefore be warmed up and tested against
   * one server while its mail was read from another.
   */
  const warmup = src('services/warmup.service.ts');
  const sync = src('services/inbox-sync.service.ts');

  is('warm-up prefers the stored host', /if \(account\.imap_host\) return account\.imap_host;/.test(warmup));
  is('and so does the sync', /const explicit = \(account\.imap_host \|\| ''\)\.trim\(\);/.test(sync));
  is('the connection check uses it directly',
     /host: input\.imap_host/.test(src('services/smtp.service.ts')));
}

console.log('\nthe repair can reach the column it writes');
{
  /*
   * The repair sets imap_host. If the sync neither selects nor honours that
   * column, the repair is writing to a field nothing reads - it would
   * report success and change nothing observable. This is the assertion
   * that ties the two together.
   */
  const sync = src('services/inbox-sync.service.ts');
  const repairCall = sync.slice(sync.indexOf('repairImapHost(raw'));
  is('the repair is handed the row, which now carries imap_host',
     repairCall.startsWith('repairImapHost(raw'), repairCall.slice(0, 80));
  is('and it runs on exactly the failure it can fix',
     /\/could not be found\/\.test\(friendly\)/.test(sync));
}

console.log('\ndiagnostics cover the leg that is actually broken');
{
  const diag = src('services/smtp-diagnostics.service.ts');
  const modal = readFileSync(join(here, '../../client/src/pages/smtp/SmtpAccountModal.tsx'), 'utf8');

  /*
   * Diagnostics probed SMTP only. That is the leg proven every time a
   * campaign goes out; the failure people press the button for is the other
   * one - sending works, replies never arrive. So "find out exactly why"
   * ran a staircase of green ticks against the healthy half and answered a
   * question nobody had asked, which is worse than having no button.
   */
  is('there is an IMAP probe at all', /async function diagnoseImap\(/.test(diag));
  is('and it runs the same four stages as SMTP',
     ["id: 'dns'", "id: 'tcp'", "id: 'tls'", "id: 'auth'"].every((id) => diag.slice(diag.indexOf('async function diagnoseImap(')).includes(id)),
     'the IMAP probe does not separate DNS, port, greeting and sign-in');

  // A refused sign-in and a refused connection send somebody to fix
  // completely different things.
  is('a refused sign-in is told apart from a refused connection',
     /const isAuth = /.test(diag) && /refused the username or password/.test(diag));

  is('both legs are returned together', /async diagnoseMailbox\(/.test(diag));
  is('the endpoint calls the two-leg version',
     /smtpDiagnosticsService\.diagnoseMailbox\(/.test(src('controllers/smtp.controller.ts')));

  /*
   * The server can probe IMAP perfectly and still be handed nothing to
   * probe. The saved row is the fallback so diagnosing an existing mailbox
   * needs nothing retyped.
   */
  is('the endpoint falls back to the saved IMAP settings',
     /imap_host: req\.body\?\.imap_host \?\? saved\?\.imap_host/.test(src('controllers/smtp.controller.ts')));
  is('the form sends its IMAP settings too', /imap_host: form\.imap_host \|\| undefined,[\s\S]{0,200}onSuccess: \(res\) => setDiagnostics/.test(modal));

  is('each leg is labelled, so it is clear which one failed',
     /Sending \(SMTP\)/.test(modal) && /Receiving \(IMAP\)/.test(modal));
  is('a mailbox with no IMAP server says so rather than showing nothing',
     /nothing to test/.test(modal));
}

console.log('\ndiagnostics can be reached without first making a check fail');
{
  const modal = readFileSync(join(here, '../../client/src/pages/smtp/SmtpAccountModal.tsx'), 'utf8');

  /*
   * The button used to require verify.status === 'done' AND a failure, so
   * the one thing that explains a connection was locked behind the thing
   * that could not explain itself. If the check errored at the transport -
   * which it did, for a 30s timeout - or somebody just wanted to know why a
   * saved mailbox was quiet, there was no way in.
   */
  const gate = modal.slice(modal.indexOf('data-run-diagnostics') - 900, modal.indexOf('data-run-diagnostics'));
  is('the button is not gated on a failed check',
     !/verifyFailed && !diagnostics && \(\s*<button/.test(modal), 'still requires a failed check first');
  is('it only needs somewhere to connect to', /!diagnostics && form\.smtp_host && \(/.test(gate), gate.slice(-200));
}

console.log('\nsigning in as one mailbox and sending as another');
{
  const { describeSmtpError } = await import('../src/services/email-sender.service.js');

  /*
   * The exact string a live Spacemail server returned for a mailbox whose
   * username had been left pointing at a sibling account. It matters that
   * this is quoted verbatim: the previous classifier saw "rejected" and
   * "auth"-ish text, fell through to "check the username/password", and
   * sent somebody to re-enter a password that was always correct.
   */
  const real = "SMTP relay error: Can't send mail - all recipients were rejected: "
    + '553 5.7.1 <invest@yieldstones.co.uk>: Sender address rejected: '
    + 'not owned by user acquisitions@yieldstones.co.uk';
  const said = describeSmtpError(new Error(real));

  is('the signed-in account is named back to the user',
     said.includes('acquisitions@yieldstones.co.uk'), said);
  is('it points at the username, not the password',
     /username/i.test(said) && /password is not the problem/i.test(said), said);
  is('and it is not mistaken for a bad password',
     !/Authentication failed/.test(said), said);
  is('nor for a raw relay error', !said.startsWith('SMTP relay error'), said);

  // Ordinary auth failures must still classify as auth failures.
  const authFail = describeSmtpError(new Error('Invalid login: 535 5.7.8 Authentication failed'));
  is('a genuine bad password still reads as one',
     /Authentication failed/.test(authFail), authFail);
}

console.log('\nthe username follows the address until somebody changes it');
{
  const modal = readFileSync(join(here, '../../client/src/pages/smtp/SmtpAccountModal.tsx'), 'utf8');

  /*
   * How the wrong username got saved. `prev.smtp_user || email` looks like
   * it mirrors the From address and does not: once the field holds anything,
   * a later correction never reaches it. Type acquisitions@, change your
   * mind, type invest@, save - and the mailbox signs in as acquisitions@
   * for good.
   *
   * The IMAP leg then SUCCEEDS, because those credentials are valid, so the
   * row quietly reads the other account's inbox and reports that receiving
   * works. That is why this needed catching in the form rather than only in
   * the error message.
   */
  is('the username is no longer pinned to whatever was typed first',
     !/smtp_user: prev\.smtp_user \|\| email/.test(modal),
     'a corrected From address still leaves the old username behind');
  is('it mirrors the address until deliberately edited',
     /smtp_user: userEdited \? prev\.smtp_user : email/.test(modal));
  is('editing the field marks it deliberate',
     /setUserEdited\(true\)/.test(modal));
  is('and a saved mailbox whose username already differs is left alone',
     /setUserEdited\(!!editAccount && editAccount\.smtp_user !== editAccount\.email_address\)/.test(modal));

  /*
   * Guarded on the condition, not merely present in the file. An earlier
   * draft of this assertion looked for `data-sender-mismatch` anywhere in
   * the source, which stays true when the block is rendered behind a
   * constant false - so replacing the guard broke the warning and failed
   * nothing.
   */
  is('a mismatch is flagged before a send has to fail',
     /\{senderMismatch && \(/.test(modal),
     'the warning is not rendered on the mismatch condition');
  is('and the condition is the shared predicate, not an inline comparison',
     /isSenderMismatch\(form\.smtp_user, form\.email_address\)/.test(modal));

  /*
   * Asserted against real values rather than by grepping the component,
   * because a grep for the comparison stays true when somebody prefixes the
   * whole expression with `false &&`.
   */
  const { isSenderMismatch } = await import('@lemlist/shared');
  is('the exact failing pair is a mismatch',
     isSenderMismatch('acquisitions@yieldstones.co.uk', 'invest@yieldstones.co.uk') === true);
  is('a matching pair is not', isSenderMismatch('invest@yieldstones.co.uk', 'invest@yieldstones.co.uk') === false);
  is('case and padding do not invent one',
     isSenderMismatch('  Invest@Yieldstones.co.uk ', 'invest@yieldstones.co.uk') === false);
  // SendGrid signs in as "apikey", Mailgun as a postmaster handle. Neither
  // says anything about who owns the From address.
  is('a non-address username is not treated as one', isSenderMismatch('apikey', 'invest@example.com') === false);
  is('and a blank username is not', isSenderMismatch('', 'invest@example.com') === false);
  is('the warning names the receiving risk, not just the sending one',
     /read \{form\.smtp_user\}&rsquo;s inbox instead of its own/.test(modal),
     'the quieter half - reading the wrong mailbox - is not mentioned');
  is('and it can be corrected in one press', /data-fix-sender/.test(modal));
}

console.log('\nthe app fixes the wrong username itself');
{
  const repair = src('services/mailbox-repair.service.ts');

  /*
   * Telling somebody to go and edit the username on each mailbox is asking
   * them to clean up after the software. The username can be repaired. The
   * password cannot - the stored one belongs to the OTHER mailbox, which is
   * precisely why the sign-in was working - and pretending otherwise would
   * leave a row claiming to be verified against credentials it can no
   * longer demonstrate.
   */
  is('there is a sender-identity repair', /export async function repairSenderIdentity\(/.test(repair));
  is('it sets the username to the mailbox\u2019s own address',
     /smtp_user: address,/.test(repair));
  is('and the IMAP login with it, which is the half reading the wrong inbox',
     /if \(isSenderMismatch\(account\.imap_user, address\)\) patch\.imap_user = address;/.test(repair));
  is('the row stops claiming to be verified',
     /is_verified: false,/.test(repair),
     'a repaired mailbox would still assert credentials it can no longer prove');
  is('and the note says whose password is now needed',
     /belongs to \$\{wrong\}/.test(repair));
  is('a mailbox signing in as itself is left alone',
     /signs in as itself/.test(repair));
  is('identity is repaired before the host, being the one actively doing harm',
     repair.indexOf('repairSenderIdentity(account as any)') < repair.indexOf('repairImapHost(account as any)'));
  is('the endpoint runs both repairs', /repairMailboxes\(req\.userId!\)/.test(src('controllers/smtp.controller.ts')));
}

console.log('\nthe sync refuses to read somebody else\u2019s inbox');
{
  const sync = src('services/inbox-sync.service.ts');

  /*
   * The worst outcome in this whole thread, and the only one with no
   * symptom. Valid credentials for the wrong mailbox sign in cleanly, so
   * the sync succeeds and files that account's mail under this one. The
   * owner sees a full unibox, their own replies missing, and a colleague's
   * mail duplicated - with every status in the app reporting health.
   *
   * Failing loudly is better by a distance: a mailbox that says why it is
   * empty can be fixed, one quietly full of the wrong mail cannot even be
   * noticed.
   */
  is('the login is compared against the mailbox it belongs to',
     /if \(isSenderMismatch\(login, raw\.email_address\)\) \{/.test(sync),
     'the sync will still log in as whatever username is stored');
  is('and it skips rather than connecting', /continue;/.test(sync.slice(sync.indexOf('isSenderMismatch(login'))));
  is('the reason is recorded where the mailbox can show it',
     /would read \$\{login\}'s inbox instead of its own/.test(sync));
  is('the check happens before any connection is opened',
     sync.indexOf('isSenderMismatch(login') < sync.indexOf('new ImapFlow('));
}

console.log('\nnothing else gets to write the sign-in username');
{
  const modal = readFileSync(join(here, '../../client/src/pages/smtp/SmtpAccountModal.tsx'), 'utf8');

  /*
   * How the wrong username really got there. Not a mistyped address - a
   * password manager.
   *
   * An email field, a field labelled "Username" and a password field, all
   * on one domain, is the exact shape a manager fills. The password field
   * was protected with autoComplete="new-password"; nothing else was. So a
   * saved credential for one mailbox on yieldstones.co.uk was written into
   * the username of another, on a tab the account holder had no reason to
   * revisit, after they had typed the right address into "From email".
   *
   * Which is why "you must have typed it" was the wrong diagnosis, and why
   * this section is about the field existing at all rather than about
   * mirroring.
   */
  /*
   * Scoped to the <form> tag itself. An earlier version of this assertion
   * searched the whole file for autoComplete="off" near data-1p-ignore,
   * which the override field also satisfies - so deleting the form-level
   * opt-out failed nothing.
   */
  const formTag = modal.slice(modal.indexOf('<form'), modal.indexOf('>', modal.indexOf('<form')) + 1);
  is('the form opts out of autofill',
     /autoComplete="off"/.test(formTag) && /data-1p-ignore/.test(formTag) && /data-lpignore/.test(formTag),
     `the form tag is still a password manager target: ${formTag.replace(/\s+/g, ' ')}`);
  is('and so does the From email field',
     /name="sincerely-from-email"/.test(modal));

  /*
   * Better than defending a field: not having one. For nearly every
   * provider the sign-in IS the address, so it is shown rather than typed,
   * and there is nothing for anything to fill.
   */
  is('the sign-in is displayed, not a text input, by default',
     /data-signs-in-as/.test(modal), 'there is still a free-text username field by default');
  is('the override has to be asked for', /data-override-login/.test(modal));
  is('and the override field is off-limits to autofill too',
     /name="sincerely-smtp-login"/.test(modal));

  // SendGrid signs in as "apikey", Mailgun as a postmaster handle. The
  // override exists for them and must not be removed.
  is('a provider that needs a different login can still have one',
     /Use a different username/.test(modal));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} mailbox connection check(s) failed`);
