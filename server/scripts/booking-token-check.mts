/*
 * The token that names which send a booking link came from.
 *
 * It is not a secret - it rides in an email and through a browser's history
 * - but it IS a signature, and the number it protects is one the account
 * will make decisions on. An unsigned or forgeable token would let anyone
 * holding a link credit any campaign they liked, and "which sequence booked
 * meetings" is the report this whole feature exists to produce.
 *
 * So the tests here are mostly attempts to break it, plus one that matters
 * as much: a token that does not verify must never refuse a booking. The
 * page is public. Being unrecognised is the normal case.
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

const { signBookingIdentity, readBookingIdentity, personaliseBookingLinks } =
  await import('../src/utils/booking-token.js');

const CC = 'cc-11111111-1111-1111-1111-111111111111';
const STEP = 'step-22222222-2222-2222-2222-222222222222';

console.log('a token round-trips');
{
  const token = signBookingIdentity(CC, STEP);
  const back = readBookingIdentity(token);
  is('it reads back', !!back);
  is('as the same send', back?.campaignContactId === CC && back?.stepId === STEP, JSON.stringify(back));
  is('and is url-safe - no padding, no slashes, no plus',
     !/[+/=]/.test(token), token);
}

console.log('\nit cannot be edited into somebody else');
{
  const token = signBookingIdentity(CC, STEP);
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  const [, , mac] = decoded.split(':');

  // Swap the contact, keep the signature.
  const forged = Buffer.from(
    `cc-99999999-9999-9999-9999-999999999999:${STEP}:${mac}`,
  ).toString('base64url');
  is('a swapped contact is refused', readBookingIdentity(forged) === null);

  // Swap the step, keep the signature.
  const forgedStep = Buffer.from(
    `${CC}:step-99999999-9999-9999-9999-999999999999:${mac}`,
  ).toString('base64url');
  is('a swapped step is refused', readBookingIdentity(forgedStep) === null);

  // A signature off by one character.
  const bent = mac.slice(0, -1) + (mac.endsWith('a') ? 'b' : 'a');
  is('a signature one character out is refused',
     readBookingIdentity(Buffer.from(`${CC}:${STEP}:${bent}`).toString('base64url')) === null);

  // A signature of the wrong length: this is the one that throws rather than
  // returning false if lengths are not checked before timingSafeEqual.
  is('a short signature is refused rather than throwing',
     readBookingIdentity(Buffer.from(`${CC}:${STEP}:abc`).toString('base64url')) === null);
  is('a long one too',
     readBookingIdentity(Buffer.from(`${CC}:${STEP}:${mac}${mac}`).toString('base64url')) === null);
}

console.log('\nrubbish is rubbish, never an exception');
{
  for (const junk of [
    undefined, null, '', '   ', 'not-base64!!', 'YQ', 'x'.repeat(600),
    Buffer.from('only:two').toString('base64url'),
    Buffer.from('a:b:c:d').toString('base64url'),
    Buffer.from('::').toString('base64url'),
  ]) {
    const label = String(junk).slice(0, 24);
    let threw = false;
    let result: any = 'unset';
    try { result = readBookingIdentity(junk as any); } catch { threw = true; }
    is(`"${label}" is refused without throwing`, !threw && result === null,
       threw ? 'threw' : JSON.stringify(result));
  }
}

console.log('\nthe link in an email carries it');
{
  const token = signBookingIdentity(CC, STEP);
  const html = '<p>Grab a time: <a href="https://app.sincerely.io/b/meet-jordan">here</a></p>';
  const out = personaliseBookingLinks(html, token);
  is('the booking link gains the token', out.includes(`/b/meet-jordan?k=${token}`), out);

  is('a link that already has a query keeps it',
     personaliseBookingLinks(
       '<a href="https://app.sincerely.io/b/meet-jordan?utm=x">x</a>', token,
     ).includes(`?utm=x&k=${token}`));

  is('a link that already has a token is left alone',
     personaliseBookingLinks(
       `<a href="https://app.sincerely.io/b/meet-jordan?k=existing">x</a>`, token,
     ).includes('k=existing'));

  /*
   * The regex must not touch anything else in the body. A prospect's own
   * website, an unsubscribe link, a case study - none of them are booking
   * pages, and appending a token to somebody else's URL leaks which send
   * this was to a third party.
   */
  const others = '<a href="https://northbeam.io/blog">blog</a>'
    + '<a href="https://app.sincerely.io/api/track/unsubscribe/abc">un</a>'
    + '<a href="https://example.com/before/b/after">nested</a>';
  const untouched = personaliseBookingLinks(others, token);
  is('a prospect\'s own site is untouched',
     untouched.includes('https://northbeam.io/blog"'), untouched);
  is('the unsubscribe link is untouched',
     untouched.includes('/api/track/unsubscribe/abc"'), untouched);
  is('nothing without a real slug is rewritten',
     !untouched.includes('k=') || untouched.split('k=').length === 2,
     untouched);

  /*
   * The case that actually ships. {{booking_link}} is dropped into a
   * sentence far more often than it is wrapped in an anchor, and an earlier
   * version of this matched only href="..." - so every real sequence lost
   * its attribution while every test passed.
   */
  const bare = personaliseBookingLinks(
    '<p>Grab a time: https://app.sincerely.io/b/meet-jordan</p>', token);
  is('a bare URL in a sentence is personalised too',
     bare.includes(`/b/meet-jordan?k=${token}`), bare);
  is('and reads back as the same send',
     readBookingIdentity(bare.match(/k=([A-Za-z0-9_-]+)/)?.[1] || '')?.campaignContactId === CC);

  const plain = personaliseBookingLinks(
    'Grab a time: https://app.sincerely.io/b/meet-jordan\n\nBest, Jordan', token);
  is('in a plaintext part as well',
     plain.includes(`/b/meet-jordan?k=${token}`), plain);
  is('without swallowing what follows it',
     plain.includes('Best, Jordan'), plain);

  is('a body with no booking link is returned unchanged',
     personaliseBookingLinks('<p>no links here</p>', token) === '<p>no links here</p>');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} booking-token check(s) failed`);
