import crypto from 'node:crypto';
import { env } from '../config/env.js';

/* ═══════════════════════════════════════════════════════════════════════
   Who a booking link was sent to.

   A link that goes out in a campaign carries a token naming the send it
   came from. The booking page reads it to greet the person by name and
   fill in the address it already knows, and the booking reads it to record
   which sequence produced the meeting.

   It is the same payload the open and click trackers already sign -
   campaign_contact_id and step_id - deliberately, so there is one notion of
   "which send was this" in the product rather than two that can disagree.

   Two properties matter.

   It is signed, so it cannot be edited into somebody else's identity. The
   prefill is a convenience, but the attribution is a number the account
   will make decisions on, and an unsigned token would let anyone with a
   link credit any campaign they liked.

   It is not a secret. It travels in an email, in a URL, through a click
   tracker and into a browser's history, and anyone holding the link can
   see the name it fills in - but that is a name the link was mailed to in
   the first place. Nothing here may ever gate anything a stranger should
   not reach; a booking page is public whether or not the token verifies.
   ═══════════════════════════════════════════════════════════════════════ */

export interface BookingIdentity {
  campaignContactId: string;
  stepId: string;
}

/** The same construction the tracking pixel uses, so the two cannot drift. */
function sign(payload: string): string {
  return crypto.createHmac('sha256', env.TRACKING_SECRET)
    .update(payload).digest('hex').slice(0, 16);
}

export function signBookingIdentity(campaignContactId: string, stepId: string): string {
  const payload = `${campaignContactId}:${stepId}`;
  return Buffer.from(`${payload}:${sign(payload)}`).toString('base64url');
}

/**
 * The step a link sent by hand came from, which is no step at all.
 *
 * A reply typed in the inbox belongs to a campaign - that is how the thread
 * exists - but not to any step of it. The sentinel says so explicitly rather
 * than borrowing a step id that would be a lie, and identify() turns it back
 * into a null so nothing tries to write it into a foreign key.
 */
export const NO_STEP = 'reply';

/** Does this look like something campaign_steps could actually contain? */
export function isStepId(value: string | null | undefined): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Read a token back, or null.
 *
 * Null for anything that does not verify, and the caller treats that as "we
 * do not know who this is" rather than as an error. A booking page reached
 * with a mangled token must still take a booking - the token is worth a
 * prefill, never a refusal.
 */
export function readBookingIdentity(token: string | undefined | null): BookingIdentity | null {
  if (!token || typeof token !== 'string') return null;
  // Longer than any legitimate token; refuse before doing work on it.
  if (token.length > 512) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const parts = decoded.split(':');
  if (parts.length !== 3) return null;
  const [campaignContactId, stepId, mac] = parts;
  if (!campaignContactId || !stepId || !mac) return null;

  const expected = sign(`${campaignContactId}:${stepId}`);
  /*
   * Constant-time, because a timing oracle on a signature is a way to forge
   * one a byte at a time. The lengths are compared first: timingSafeEqual
   * throws on a mismatch rather than returning false, which would turn a
   * malformed token into a 500.
   */
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  return { campaignContactId, stepId };
}

/**
 * Put the token on every booking link in an email body.
 *
 * Done at send time rather than when the merge tag is filled, because the
 * token names a specific send and nothing before this point knows which one
 * it is. Runs before click-wrapping, so the tracker's redirect target is the
 * personalised URL rather than the bare one.
 *
 * Two things this gets right that a narrower version does not.
 *
 * It matches bare URLs as well as hrefs. `{{booking_link}}` is most often
 * dropped into a sentence - "grab a time: {{booking_link}}" - which renders
 * as text, not as an anchor. Matching only `href="..."` would personalise
 * the links nobody writes and miss the ones everybody does.
 *
 * It matches only this app's own origin. A prospect's website can perfectly
 * well have a path like /blog/b/something, and appending a token to it would
 * both do nothing useful and tell a third party which send the reader is on.
 * Origin is the only reliable way to tell our booking page from a URL that
 * merely looks like one.
 */
export function personaliseBookingLinks(text: string, token: string): string {
  const origin = (env.CLIENT_URL || '').replace(/\/+$/, '');
  if (!origin) return text;

  // Escaped, because an origin is a URL and a URL is full of regex syntax.
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(${escaped}/b/[a-z0-9][a-z0-9-]{1,48}[a-z0-9])(\\?[^\\s"'<>]*)?`,
    'gi',
  );

  return text.replace(pattern, (_match, url: string, query: string | undefined) => {
    // Never add it twice, and never overwrite a token somebody put there by
    // hand - a link pasted from elsewhere may already name its own send.
    if (query && /[?&]k=/.test(query)) return `${url}${query}`;
    return `${url}${query ? `${query}&` : '?'}k=${token}`;
  });
}
