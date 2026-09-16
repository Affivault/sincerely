/*
 * The emails a booking sends.
 *
 * Two things are checked here that reading the templates cannot settle.
 *
 * The first is whose clock each message is written on. The invitee booked in
 * their zone and the organiser lives in theirs, so the same instant has to
 * appear as two different times in two different emails. A single shared
 * formatter would pass every "does it mention a time" test and still put
 * somebody in an empty room.
 *
 * The second is that nothing here can take a booking down with it. Every
 * failure mode - no mailbox, an SMTP host that throws, a password that will
 * not decrypt - has to end in a logged warning and a booking that stands.
 */
import assert from 'node:assert';

process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.TRACKING_BASE_URL ||= 'https://app.sincerely.io';
process.env.CLIENT_URL ||= 'https://app.sincerely.io';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

/* ── The world the mail service reads ──────────────────────────────── */

let mailbox: any = {
  smtp_host: 'smtp.example.com', smtp_port: 587, smtp_secure: false,
  smtp_user: 'jordan@sincerely.io', smtp_pass_encrypted: '',
  email_address: 'jordan@sincerely.io', from_name: 'Jordan Lee', is_active: true,
};

const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = (table: string) => {
  const chain: any = {
    select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
    is: () => chain, not: () => chain, in: () => chain,
    update: () => ({ eq: async () => ({ data: null, error: null }) }),
    maybeSingle: async () => ({
      data: table === 'smtp_accounts' ? mailbox : null,
      error: null,
    }),
    single: async () => ({ data: null, error: null }),
  };
  return chain;
};

/*
 * A real ciphertext rather than a stubbed decrypt. ESM exports are read-only,
 * so the module cannot be patched after import - and encrypting a password
 * with the same key the service will use exercises the real path anyway.
 */
const { encrypt } = await import('../src/utils/encryption.js');
const GOOD_PASS = encrypt('hunter2');

/*
 * nodemailer is stubbed at createTransport, which is the lowest seam that is
 * actually writable and the highest one that still exercises the real send:
 * the multipart assembly, the from header and the icalEvent part are all
 * built by email-sender before this is reached.
 */
const nodemailer = (await import('nodemailer')).default as any;
let outbox: any[] = [];
let smtpThrows = false;
nodemailer.createTransport = () => ({
  sendMail: async (message: any) => {
    if (smtpThrows) throw new Error('connection refused');
    outbox.push(message);
    return { messageId: 'x', accepted: [message.to], rejected: [] };
  },
  close: () => {},
});

const { bookingMail } = await import('../src/services/booking-mail.service.js');

const BASE = {
  userId: 'u1',
  eventId: 'e1',
  manageToken: 'tok-abcdefghijklmnopqrstuvwxyz',
  // 14:30 UTC on a winter Tuesday. London is UTC+0, New York is UTC-5,
  // Tokyo is UTC+9 - so this instant is three different clock times and one
  // of them is the next day.
  start: new Date('2026-12-01T14:30:00.000Z'),
  end: new Date('2026-12-01T15:00:00.000Z'),
  durationMinutes: 30,
  headline: 'Intro call',
  organiser: 'Jordan Lee',
  inviteeName: 'Maud Grevstad',
  inviteeEmail: 'maud@northbeam.io',
  inviteeTimezone: 'America/New_York',
  organiserTimezone: 'Europe/London',
  locationKind: 'video',
  confirmationNote: null,
  inviteeMessage: null,
  sequence: 0,
  notifyOrganiser: true,
};

mailbox.smtp_pass_encrypted = GOOD_PASS;
const reset = () => { outbox = []; smtpThrows = false; mailbox = { ...mailbox, smtp_pass_encrypted: GOOD_PASS }; };

console.log('booking confirmed');
{
  reset();
  const result = await bookingMail.confirmed(BASE as any);

  is('the invitee is written to', outbox.some((m) => m.to === 'maud@northbeam.io'));
  is('and so is the account', outbox.some((m) => m.to === 'jordan@sincerely.io'));
  is('both were sent', result.invitee && result.organiser, JSON.stringify(result));

  const toInvitee = outbox.find((m) => m.to === 'maud@northbeam.io');
  const toOrganiser = outbox.find((m) => m.to === 'jordan@sincerely.io');

  /*
   * 14:30 UTC is 9:30 in New York and 14:30 in London. Each email must
   * carry the reader's own, and must NOT carry the other's.
   */
  is('the invitee is told their own time',
     toInvitee.html.includes('9:30') && toInvitee.text.includes('9:30'),
     toInvitee.text.slice(0, 200));
  is('and not the organiser\'s',
     !toInvitee.html.includes('2:30 pm') && !toInvitee.html.includes('14:30'),
     toInvitee.html.slice(0, 400));
  is('the organiser is told theirs',
     toOrganiser.html.includes('2:30') || toOrganiser.html.includes('14:30'),
     toOrganiser.text.slice(0, 200));
  is('the zone is named, not assumed',
     toInvitee.html.includes('America/New York') || toInvitee.text.includes('America/New_York'),
     toInvitee.text.slice(0, 200));

  is('the invite travels inside the message',
     toInvitee.icalEvent?.method === 'REQUEST' && /BEGIN:VCALENDAR/.test(toInvitee.icalEvent.content));
  is('and carries the right instant',
     toInvitee.icalEvent.content.includes('DTSTART:20261201T143000Z'),
     toInvitee.icalEvent.content);
  is('the manage link is in the body',
     toInvitee.html.includes('/booking/tok-abcdefghijklmnopqrstuvwxyz'));
  is('a reply to the account reaches the invitee',
     toOrganiser.replyTo === 'maud@northbeam.io', toOrganiser.replyTo);
  is('the subject says when, not just what',
     /December/.test(toInvitee.subject), toInvitee.subject);
}

console.log('\nwhat the invitee typed is escaped, not rendered');
{
  reset();
  await bookingMail.confirmed({
    ...BASE,
    inviteeName: '<script>alert(1)</script>',
    inviteeMessage: 'Break <b>this</b> & that',
  } as any);
  const toOrganiser = outbox.find((m) => m.to === 'jordan@sincerely.io');
  is('no raw script tag survives into the body',
     !toOrganiser.html.includes('<script>'), toOrganiser.html.slice(0, 300));
  is('the ampersand is entity-encoded',
     toOrganiser.html.includes('&amp;'), toOrganiser.html.slice(0, 300));
  is('and their words are still legible',
     toOrganiser.html.includes('Break') && toOrganiser.html.includes('that'));
}

console.log('\nthe account can ask not to be told');
{
  reset();
  const result = await bookingMail.confirmed({ ...BASE, notifyOrganiser: false } as any);
  is('the invitee still gets theirs', outbox.some((m) => m.to === 'maud@northbeam.io'));
  is('the account gets nothing', !outbox.some((m) => m.to === 'jordan@sincerely.io'));
  is('and the result says so', result.invitee && !result.organiser);
}

console.log('\nmoved');
{
  reset();
  await bookingMail.rescheduled(
    { ...BASE, sequence: 2 } as any,
    new Date('2026-11-30T10:00:00.000Z'),
  );
  const toInvitee = outbox.find((m) => m.to === 'maud@northbeam.io');
  is('the old time is shown struck through',
     toInvitee.html.includes('line-through'), toInvitee.html.slice(0, 500));
  is('the old time is in the invitee\'s zone too',
     toInvitee.text.includes('5:00') || toInvitee.text.includes('05:00'),
     toInvitee.text);
  /*
   * A calendar client ignores an update that does not outrank what it holds,
   * so a reschedule with SEQUENCE:0 silently leaves the meeting where it was.
   */
  is('the invite outranks the one it replaces',
     toInvitee.icalEvent.content.includes('SEQUENCE:2'), toInvitee.icalEvent.content);
}

console.log('\ncancelled');
{
  reset();
  await bookingMail.cancelled(BASE as any, 'invitee', 'Something came up');
  const toInvitee = outbox.find((m) => m.to === 'maud@northbeam.io');
  const toOrganiser = outbox.find((m) => m.to === 'jordan@sincerely.io');

  is('the invitee gets a receipt, not news',
     /that is cancelled/i.test(toInvitee.html), toInvitee.html.slice(0, 300));
  is('the account is told who cancelled',
     toOrganiser.subject.includes('Maud Grevstad'), toOrganiser.subject);
  is('and why', toOrganiser.html.includes('Something came up'));
  is('the cancellation is a CANCEL, not another invite',
     toInvitee.icalEvent.method === 'CANCEL'
     && toInvitee.icalEvent.content.includes('STATUS:CANCELLED'),
     toInvitee.icalEvent.content);

  reset();
  await bookingMail.cancelled(BASE as any, 'organiser', null);
  const told = outbox.find((m) => m.to === 'maud@northbeam.io');
  is('when the account cancels, the invitee is told who did',
     told.html.includes('Jordan Lee'), told.html.slice(0, 300));
  is('and offered another time', /book another time/i.test(told.html));
}

console.log('\nnothing here can take a booking down with it');
{
  reset();
  smtpThrows = true;
  const thrown = await bookingMail.confirmed(BASE as any).then(() => null, (e) => e);
  is('an SMTP failure does not throw', thrown === null, String(thrown));
  is('and reports that nothing was sent',
     JSON.stringify(await bookingMail.confirmed(BASE as any)) === '{"invitee":false,"organiser":false}');

  reset();
  const saved = mailbox;
  mailbox = null;
  const noBox = await bookingMail.confirmed(BASE as any).then((r) => r, (e) => e);
  is('no mailbox at all does not throw', !(noBox instanceof Error), String(noBox));
  is('and nothing is sent', outbox.length === 0);
  is('canSend says so plainly', (await bookingMail.canSend('u1')) === false);

  mailbox = { ...saved, smtp_pass_encrypted: 'not-a-real-ciphertext' };
  outbox = [];
  const bad = await bookingMail.confirmed(BASE as any).then((r) => r, (e) => e);
  is('an undecryptable password does not throw', !(bad instanceof Error), String(bad));
  is('and still sends nothing', outbox.length === 0);

  mailbox = saved;
  is('a working mailbox says it can send', (await bookingMail.canSend('u1')) === true);
}

console.log('\nthe note the account writes reaches the invitee');
{
  reset();
  await bookingMail.confirmed({
    ...BASE, confirmationNote: 'I will send a Meet link that morning.',
  } as any);
  const toInvitee = outbox.find((m) => m.to === 'maud@northbeam.io');
  is('it is in the confirmation', toInvitee.html.includes('Meet link'));
  is('and in the plain text part too', toInvitee.text.includes('Meet link'), toInvitee.text);

  reset();
  await bookingMail.reminder({ ...BASE, confirmationNote: 'Bring the numbers.' } as any);
  is('and in the reminder', outbox[0].html.includes('Bring the numbers'));
  is('the reminder offers a way out rather than only a nudge',
     /move or cancel/i.test(outbox[0].html), outbox[0].html.slice(0, 400));
  is('a reminder is not an invite - it must not re-add the meeting',
     !outbox[0].icalEvent, JSON.stringify(outbox[0].icalEvent));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} booking-mail check(s) failed`);
