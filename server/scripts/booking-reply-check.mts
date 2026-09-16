/*
 * Replying to a thread with your booking link.
 *
 * The shortest path in the product between "sure, when suits?" and a
 * meeting, which is exactly why it has to be right about two things.
 *
 * The link it sends must name the thread, or the booking that comes back
 * arrives from nowhere and the campaign that earned it gets no credit. And
 * it must refuse clearly when there is nothing to send, rather than mailing
 * a prospect a sentence with a blank where the link should be.
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

const MESSAGE = 'msg-1';
const CC = '00000000-0000-0000-0000-0000000000cc';

let world = {
  link: { slug: 'meet-jordan' } as any,
  message: {
    id: MESSAGE, user_id: 'u1', from_email: 'maud@northbeam.io',
    campaign_id: 'camp-1', contact_id: 'contact-1',
    contacts: { first_name: 'Maud' },
  } as any,
  campaignContact: { id: CC } as any,
};

/*
 * The stub HONOURS filters, which is the whole reason it is worth writing.
 *
 * A stub that returns its fixture for any query passes just as happily when
 * the code forgets `.eq('user_id', userId)` - so the test that claims
 * somebody else's thread is unreadable proves nothing at all. Recording the
 * eq() calls and matching them against the row is what makes removing that
 * filter fail here.
 */
const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = (table: string) => {
  const filters: [string, any][] = [];
  const row = () => (
    table === 'booking_links' ? world.link
      : table === 'inbox_messages' ? world.message
      : table === 'campaign_contacts' ? world.campaignContact
      : null
  );
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: any) => { filters.push([col, val]); return chain; },
    is: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => {
      const r = row();
      if (!r) return { data: null, error: null };
      const matches = filters.every(([col, val]) => !(col in r) || r[col] === val);
      return { data: matches ? r : null, error: null };
    },
  };
  return chain;
};

/* The reply itself is somebody else's tested code; what it was handed is
 * the thing under test here. */
const inbox = await import('../src/services/inbox.service.js');
let replied: any = null;
let replyThrows = false;
(inbox.inboxService as any).reply = async (
  userId: string, messageId: string, body: string, smtpId: any, html: string,
) => {
  if (replyThrows) throw new Error('smtp down');
  replied = { userId, messageId, body, html };
  return { success: true };
};

const { bookingService } = await import('../src/services/booking.service.js');
const { readBookingIdentity } = await import('../src/utils/booking-token.js');

console.log('replying with the link');
{
  replied = null;
  const result = await bookingService.sendLinkInReply('u1', MESSAGE);

  is('it reports sending', result.sent === true);
  is('a reply went out on this thread',
     replied?.messageId === MESSAGE, JSON.stringify(replied)?.slice(0, 120));
  is('addressed to them by first name',
     replied.body.startsWith('Hi Maud,'), replied.body.slice(0, 40));
  is('the link is in the plain text', replied.body.includes('/b/meet-jordan'), replied.body);
  is('and in the html', replied.html.includes('/b/meet-jordan'), replied.html);

  /*
   * The point of the whole exercise. Without a token naming the thread, a
   * meeting booked from this reply is indistinguishable from one booked by
   * a stranger off a website.
   */
  const token = result.url.match(/k=([A-Za-z0-9_-]+)/)?.[1];
  is('the link names the thread', !!token, result.url);
  const identity = readBookingIdentity(token || '');
  is('and it verifies', !!identity, token);
  is('as this contact in this campaign',
     identity?.campaignContactId === CC, JSON.stringify(identity));
  /*
   * A reply is not a step. The sentinel says so, rather than borrowing a
   * step id that would be a lie and would fail a foreign key besides.
   */
  is('with no step, because a typed reply is not one',
     identity?.stepId === 'reply', identity?.stepId);
}

console.log('\nwhat the account chose to say is what gets sent');
{
  replied = null;
  await bookingService.sendLinkInReply('u1', MESSAGE, 'Pick anything Thursday or after.');
  is('their line is used', replied.body.includes('Pick anything Thursday or after.'), replied.body);
  is('and the default is not', !replied.body.includes('grab whatever time suits'), replied.body);
  is('the link still follows it', replied.body.includes('/b/meet-jordan'));
}

console.log('\na thread with no campaign still gets a link');
{
  replied = null;
  const saved = world.message;
  world.message = { ...saved, campaign_id: null, contact_id: null };
  const result = await bookingService.sendLinkInReply('u1', MESSAGE);
  is('the reply goes out', result.sent === true);
  is('with a plain link and no token', !result.url.includes('k='), result.url);
  is('which is still a working address', result.url.endsWith('/b/meet-jordan'), result.url);
  world.message = saved;
}

console.log('\nnothing live means a clear refusal, not a blank link');
{
  replied = null;
  const saved = world.link;
  world.link = null;
  const err = await bookingService.sendLinkInReply('u1', MESSAGE).then(() => null, (e) => e);
  is('it refuses', !!err, String(err));
  is('with a 409, not a 500', err?.statusCode === 409 || err?.status === 409, JSON.stringify(err));
  is('saying what to do about it',
     /turn one on/i.test(err?.message || ''), err?.message);
  is('and nothing was mailed to the prospect', replied === null, JSON.stringify(replied));
  world.link = saved;
}

console.log('\na send that fails is not reported as sent');
{
  replied = null;
  replyThrows = true;
  const err = await bookingService.sendLinkInReply('u1', MESSAGE).then(() => null, (e) => e);
  is('the failure surfaces', !!err, String(err));
  replyThrows = false;
}

console.log('\nsomebody else\'s thread is not readable');
{
  /*
   * The message and the link both exist and both belong to u1. Everything
   * is present; the ONLY thing standing between an intruder and somebody
   * else's thread is the user_id filter on the read. Removing it must fail
   * here, which is why the stub above honours filters.
   */
  replied = null;
  const err = await bookingService.sendLinkInReply('intruder', MESSAGE).then(() => null, (e) => e);
  is('it refuses', !!err, String(err));
  is('as a 404, saying nothing about whose it is',
     /no such message/i.test(err?.message || ''), err?.message);
  is('and nothing was mailed on somebody else\'s thread',
     replied === null, JSON.stringify(replied));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} booking-reply check(s) failed`);
