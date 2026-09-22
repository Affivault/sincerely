import type { User } from '@supabase/supabase-js';

/* ═══════════════════════════════════════════════════════════════════════
   The answer to "are you signed in" is usually already on the machine.

   MEASURED BEFORE THIS LANDED: AuthContext started with loading: true and
   only cleared it when supabase.auth.getSession() resolved. Every route in
   the app is behind that flag, so EVERY page load - including a reload of
   a page you were already looking at - showed a skeleton first, and the
   app could not even begin fetching its data until it cleared.

   supabase-js persists the session in localStorage and reads it back
   asynchronously. The read itself is synchronous; the promise is the
   library's interface, not the storage's. So the information needed to
   render the right screen is sitting in memory the whole time the skeleton
   is up.

   This reads it directly, and ONLY to decide what to render first.

   WHAT THIS IS NOT
   ----------------
   It is not authentication, and nothing here is trusted. A token in
   localStorage proves nothing about whether the server will accept it -
   it may have been revoked, the account may be gone. Every request is
   still authorised by the server exactly as before.

   What it decides is whether to show the app or the login page for the
   few hundred milliseconds before supabase answers, and it only ventures
   an opinion when the stored token has real time left on it. If the
   server disagrees, getSession resolves with null a moment later and the
   redirect happens then - which is the same thing that happens today,
   just after a skeleton instead of after a glimpse of the app.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Don't trust a token that is nearly expired.
 *
 * Inside this window supabase will refresh over the network before it can
 * answer, so an optimistic yes could be wrong in the one case where being
 * wrong is visible - and the refresh itself is what the wait is for.
 */
const SAFETY_MARGIN_MS = 60_000;

/**
 * The localStorage key supabase-js writes under.
 *
 * Derived from the project ref in the URL, exactly as the library does it,
 * rather than hardcoded - a hardcoded key silently reads nothing the day
 * the project changes, and "silently reads nothing" here means the old
 * behaviour, which nobody would notice.
 */
function storageKey(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return null;
  try {
    const ref = new URL(url).hostname.split('.')[0];
    return ref ? `sb-${ref}-auth-token` : null;
  } catch {
    return null;
  }
}

/**
 * Parse whatever supabase-js happened to store.
 *
 * Three shapes have been in use across versions: the session as plain
 * JSON, the same JSON base64-encoded behind a `base64-` prefix, and an
 * older wrapper with the session under `currentSession`. Handling all
 * three is cheaper than pinning a version, and an unrecognised shape
 * simply means "no opinion" rather than an error.
 */
export function parsePersistedSession(raw: string | null, now = Date.now()): User | null {
  if (!raw) return null;
  try {
    let text = raw;
    if (text.startsWith('base64-')) {
      text = atob(text.slice('base64-'.length).replace(/-/g, '+').replace(/_/g, '/'));
    }
    const parsed = JSON.parse(text);
    const session = parsed?.currentSession ?? parsed;

    const user = session?.user;
    if (!user?.id) return null;

    /*
     * No expiry means no opinion.
     *
     * A stored blob without one is a shape this does not understand, and
     * guessing that it is still valid is exactly the case that would show
     * somebody the app and then throw them out of it.
     */
    const expiresAt = session?.expires_at;
    if (typeof expiresAt !== 'number') return null;
    if (expiresAt * 1000 - SAFETY_MARGIN_MS <= now) return null;

    return user as User;
  } catch {
    // Corrupt JSON, blocked storage, a private window. All mean the same
    // thing here: fall back to waiting for supabase, as before.
    return null;
  }
}

/**
 * The signed-in user this browser most likely has, decided synchronously.
 *
 * Returns null whenever there is any doubt at all, which is what makes
 * this safe to render from: a wrong null costs a skeleton that would have
 * been there anyway.
 */
export function readPersistedUser(): User | null {
  const key = storageKey();
  if (!key) return null;
  try {
    return parsePersistedSession(window.localStorage.getItem(key));
  } catch {
    // Storage can throw outright when site data is blocked.
    return null;
  }
}
