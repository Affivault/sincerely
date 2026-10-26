/* ═══════════════════════════════════════════════════════════════════════
   LinkedIn as a channel.

   There is no public LinkedIn API for connection requests or messages to
   people you aren't connected to, so a LinkedIn step becomes a task —
   personalised, with the profile one click away — and the sequence waits
   for it before carrying on. The browser extension's agent does those
   tasks in the user's own logged-in browser, at a human pace; a person is
   only asked to step in when the agent cannot (signed out, a checkpoint).
   ═══════════════════════════════════════════════════════════════════════ */

/** LinkedIn caps a connection-request note at 300 characters. */
export const LINKEDIN_NOTE_MAX = 300;

export const LINKEDIN_STEP_META: Record<string, { label: string; verb: string; hint: string }> = {
  linkedin_connect: {
    label: 'LinkedIn invite',
    verb: 'Send connection request',
    hint: 'A note is optional, and invites without one are accepted more often.',
  },
  linkedin_message: {
    label: 'LinkedIn message',
    verb: 'Send message',
    hint: 'Only reaches people you are already connected to.',
  },
  linkedin_visit: {
    label: 'Profile visit',
    verb: 'View profile',
    hint: 'A visit often earns a look back — the cheapest touch there is.',
  },
};

/**
 * LinkedIn restricts on the week as much as the day. 80 sits under the
 * roughly-100 point where accounts get flagged, and 100 is the ceiling a
 * user may raise it to, because past that the cap is no protection at all.
 */
export const LINKEDIN_WEEKLY_CONNECT_DEFAULT = 80;
export const LINKEDIN_WEEKLY_CONNECT_MAX = 100;

/** Undone LinkedIn tasks are skipped after this many days unless changed. */
export const LINKEDIN_SKIP_AFTER_DAYS_DEFAULT = 7;

/** The agent tries a task this many times before the sequence moves on. */
export const LINKEDIN_TASK_MAX_ATTEMPTS = 3;

/**
 * Invites still pending this long are withdrawn (095). Three weeks is
 * long past the point anybody accepts, and a pile of stale pending
 * invites is one of the things LinkedIn weighs against an account.
 */
export const LINKEDIN_WITHDRAW_AFTER_DAYS_DEFAULT = 21;

/**
 * The extension checks in every minute while Chrome is open. Ten minutes
 * of silence means Chrome is closed or the extension is off, and nothing
 * LinkedIn-side will happen until somebody opens it.
 */
export const LINKEDIN_AGENT_OFFLINE_MINUTES = 10;

/** The longest a message step may wait for an invite to be accepted. */
export const LINKEDIN_WAIT_CONNECTED_MAX_DAYS = 90;

/** Daily caps for the agent's own upkeep, on top of the step caps (095). */
export const LINKEDIN_UPKEEP_LIMITS = {
  daily_check_limit: { default: 40, max: 150 },
  daily_withdraw_limit: { default: 10, max: 40 },
  daily_inbox_limit: { default: 8, max: 24 },
  daily_enrich_limit: { default: 60, max: 200 },
} as const;

/**
 * A profile URL with a scheme on it.
 *
 * People paste "linkedin.com/in/jane" or "www.linkedin.com/in/jane" far more
 * often than the full URL, and CSV exports drop the scheme too. Stored like
 * that, the browser reads it as a path on whatever page links to it, and the
 * agent opens a tab that never reaches LinkedIn. http:// is upgraded because
 * LinkedIn only serves https and the redirect loses the extension's tab.
 * Anything with another scheme is returned untouched: guessing what it was
 * meant to be is worse than leaving it visibly wrong.
 */
export function normalizeLinkedinUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return `https://${s.slice(7)}`;
  if (s.startsWith('//')) return `https:${s}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/]*linkedin\.com/i.test(s)) return s;
  return `https://${s.replace(/^\/+/, '')}`;
}

/** True for an https URL on linkedin.com, the only place the agent may go. */
export function isLinkedinProfileUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}
