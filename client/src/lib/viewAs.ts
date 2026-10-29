/*
 * "View as this user". The admin backend mints a short-lived, read-only
 * token for an account and opens the app in a new tab; that tab sends the
 * token in place of the owner's own session until it ends. The token goes
 * through localStorage once (never the URL, so it is not in history) and
 * then lives only in that tab's sessionStorage.
 */

const KEY = 'sincerely.viewAs';
const HANDOFF = 'sincerely.viewAs.handoff';

export interface ViewAsSession { token: string; email: string; expires_at: string }

function read(store: Storage, key: string): ViewAsSession | null {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as ViewAsSession) : null;
  } catch {
    return null;
  }
}

/** From the admin backend: open the app as this account, in a new tab. */
export function startViewAs(session: ViewAsSession) {
  try { localStorage.setItem(HANDOFF, JSON.stringify(session)); } catch { /* storage blocked */ }
  window.open('/dashboard?view_as=1', '_blank', 'noopener');
}

/** At boot: if this tab was opened to view as someone, take the token for this tab only. */
export function claimViewAs() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('view_as')) return;
  const handed = read(localStorage, HANDOFF);
  try {
    localStorage.removeItem(HANDOFF);
    if (handed) sessionStorage.setItem(KEY, JSON.stringify(handed));
  } catch { /* storage blocked: the tab is just the owner's own */ }
  url.searchParams.delete('view_as');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/** The view-as session of this tab, if there is one and it has not run out. */
export function viewAsSession(): ViewAsSession | null {
  const s = read(sessionStorage, KEY);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() <= Date.now()) {
    endViewAs();
    return null;
  }
  return s;
}

export function endViewAs() {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
