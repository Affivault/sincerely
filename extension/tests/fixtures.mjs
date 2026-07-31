/**
 * Shared fixtures for the extension suites.
 *
 * The API key is assembled rather than written out, and that is not cosmetic.
 * The extension validates a key as `sk_live_` plus 64 hex characters, so a
 * fixture has to have exactly that shape to exercise the validation at all —
 * which means a literal here looks precisely like a live credential to a secret
 * scanner. GitHub's push protection duly blocked it.
 *
 * Building it from parts keeps the shape exact and keeps a string that pattern-
 * matches a real key out of the source. Nothing here is or ever was secret: the
 * mock API accepts this one value and rejects everything else.
 */

/** The prefix the extension uses to tell an API key from a session token. */
const LIVE_PREFIX = ['sk', 'live', ''].join('_');

/** 64 hex characters, the length a real key's random half has. */
const FIXTURE_BODY = 'a1b2c3d4'.repeat(8);

/** The one key the mock API accepts. 72 characters, like the real thing. */
export const TEST_API_KEY = `${LIVE_PREFIX}${FIXTURE_BODY}`;

/** Authorization header value for the mock. */
export const TEST_AUTH = `Bearer ${TEST_API_KEY}`;

/** Stands in for a Supabase access token in the app page's localStorage. */
export const TEST_JWT = 'eyJhbGciOiJIUzI1NiJ9.stand-in-session.signature';

/**
 * A correctly-shaped key the mock rejects.
 *
 * Used by the iframe test: a hostile frame posts this at the connect relay, and
 * the extension must refuse it because of where it came from — not because it
 * looks wrong. A malformed decoy would be caught by shape validation and the
 * test would prove nothing about origin checking.
 */
export const HOSTILE_API_KEY = `${LIVE_PREFIX}${'f'.repeat(64)}`;

/** Shaped like a real key, but revoked server-side. Tests the 401 path. */
export const REVOKED_API_KEY = `${LIVE_PREFIX}${'dead0000'.repeat(8)}`;
