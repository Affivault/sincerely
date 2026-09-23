/* ═══════════════════════════════════════════════════════════════════════
   Where somebody was going when they were asked to sign in.

   Every route to the login page used to forget the way back. A link to a
   reply from a notification, a campaign bookmarked last week, a session
   that expired halfway through writing a sequence - all of them landed on
   the dashboard after signing in, and the person had to find their way
   back to the thing they had clicked. For a link shared with a colleague
   that is often the end of it: they do not know where it pointed.

   Kept in sessionStorage rather than only in router state, because two of
   the ways back do not come through the router at all: a full-page
   redirect when the API reports the session gone, and the round trip to
   Google and back for "Continue with Google".
   ═══════════════════════════════════════════════════════════════════════ */

const KEY = 'sincerely_return_to';

/** Pages that are the sign-in flow itself, and so never a destination. */
const NOT_A_DESTINATION = ['/login', '/signup', '/forgot-password', '/reset-password'];

/**
 * Only same-site paths. Anything else - an absolute URL, a protocol-relative
 * `//evil.example`, a backslash trick - is dropped, so a crafted link cannot
 * use the sign-in page as an open redirect.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  const bare = path.split(/[?#]/)[0];
  if (bare === '/' || NOT_A_DESTINATION.includes(bare)) return null;
  return path;
}

/*
 * Signing out on purpose is not "interrupted on the way somewhere".
 * Without this, pressing Sign out on the settings page would send the next
 * person to sign in on this tab straight back to those settings.
 */
let signingOut = false;

export function markSignedOutOnPurpose(): void {
  signingOut = true;
  try { sessionStorage.removeItem(KEY); } catch { /* nothing stored */ }
}

export function clearSignedOutOnPurpose(): void {
  signingOut = false;
}

/** Remember where to go once signed in. */
export function rememberReturnTo(path: string): void {
  if (signingOut) return;
  const safe = safeReturnPath(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(KEY, safe);
  } catch {
    // Private mode without storage: the dashboard is an acceptable fallback.
  }
}

/** Where to go now, forgotten as it is read so it is only ever used once. */
export function takeReturnTo(): string | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return safeReturnPath(stored);
  } catch {
    return null;
  }
}

/** Whether a destination is waiting, without using it up. */
export function hasReturnTo(): boolean {
  try {
    return !!safeReturnPath(sessionStorage.getItem(KEY));
  } catch {
    return false;
  }
}
