/* ═══════════════════════════════════════════════════════════════════════
   What counts as a bounce.

   Getting this wrong is expensive in both directions. Miss a bounce and
   dead addresses stay in rotation, the bounce rate under-reports, and the
   guard that protects the sending domain never fires. Invent one and a
   real prospect is marked undeliverable across every campaign, for good,
   with no way for the user to know why they stopped hearing back.

   Both mistakes have actually shipped here: relay sends carried the reply
   code only inside the message text and so never registered a bounce at
   all, and the first fix for that read any three-digit number anywhere in
   the string — so "Processed 550 contacts successfully" was a hard bounce,
   and a rejected mailbox password buried a whole campaign's contacts.

   Run: npx tsx scripts/send-failure-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import {
  classifySendFailure,
  smtpResponseCode,
  isBounceFailure,
  stallReasonFor,
} from '../src/utils/send-failure.js';

let pass = 0;
let fail = 0;

function eq(label: string, got: unknown, want: unknown): void {
  if (got === want) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}  got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

console.log('\npermanent failures — the address is wrong');
eq('nodemailer numeric 550', classifySendFailure({ responseCode: 550 }), 'bounce');
eq('nodemailer numeric 553', classifySendFailure({ responseCode: 553 }), 'bounce');
eq('EENVELOPE', classifySendFailure({ code: 'EENVELOPE' }), 'bounce');
eq('relay text, leading code', classifySendFailure({ response: '550 5.1.1 User unknown' }), 'bounce');
eq('relay message form', classifySendFailure({ message: 'SMTP relay error: 550 5.1.1 <a@b.c> not found' }), 'bounce');
eq('code with a hyphen continuation', classifySendFailure({ response: '550-5.7.1 Blocked' }), 'bounce');

console.log('\ntransient failures — must NOT mark anyone undeliverable');
eq('greylisting 451', classifySendFailure({ responseCode: 451 }), 'transient');
eq('mailbox full 452', classifySendFailure({ response: '452 4.2.2 Mailbox full' }), 'transient');
eq('rate limited 421', classifySendFailure({ message: '421 4.7.0 Try again later' }), 'transient');
eq('a transient is not a bounce', isBounceFailure({ responseCode: 451 }), false);

console.log('\nunknown stays unknown — never guessed into a bounce');
eq('connection timeout', classifySendFailure({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }), 'unknown');
eq('DNS failure', classifySendFailure({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND smtp.x' }), 'unknown');
eq('empty error', classifySendFailure({}), 'unknown');
eq('null', classifySendFailure(null), 'unknown');
eq('bare string', classifySendFailure('something broke'), 'unknown');

console.log('\nour login failing says nothing about the recipient');
eq('535 bad credentials', classifySendFailure({ message: 'Invalid login: 535 Authentication failed' }), 'auth');
eq('530 auth required', classifySendFailure({ responseCode: 530 }), 'auth');
eq('534 weak mechanism', classifySendFailure({ response: '534 5.7.9 Please log in' }), 'auth');
eq('538 encryption required', classifySendFailure({ responseCode: 538 }), 'auth');
eq('nodemailer EAUTH', classifySendFailure({ code: 'EAUTH', message: 'Invalid login' }), 'auth');
eq('an auth failure is never a bounce', isBounceFailure({ responseCode: 535 }), false);
eq('454 temp auth is still transient', classifySendFailure({ responseCode: 454 }), 'transient');
eq('auth gets a stall reason', stallReasonFor('auth') !== null, true);
eq('a bounce does not', stallReasonFor('bounce'), null);

console.log('\nthe trap: a number in prose is not a reply code');
eq('"550 contacts imported" is not a bounce',
  classifySendFailure({ message: 'Processed 550 contacts successfully' }), 'unknown');
eq('a 550ms timeout is not a bounce',
  classifySendFailure({ message: 'Socket closed after 550 ms' }), 'unknown');
eq('code after a wrapping prefix still counts',
  classifySendFailure({ message: 'SMTP relay error: 552 Message too large' }), 'bounce');
eq('enhanced code with a bracketed address',
  smtpResponseCode({ response: '550 5.1.1 <a@b.c>: Recipient address rejected' }), 550);

console.log('\nresponse code extraction');
eq('numeric wins', smtpResponseCode({ responseCode: 421, message: '550 nope' }), 421);
eq('from response text', smtpResponseCode({ response: '554 5.7.1 Rejected' }), 554);
eq('none present', smtpResponseCode({ message: 'no code here' }), null);
eq('out-of-range numeric ignored', smtpResponseCode({ responseCode: 99999, message: 'no code' }), null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
