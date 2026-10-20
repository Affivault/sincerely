import { Router, Request, Response } from 'express';
import {
  calendarSync, CALENDAR_OAUTH_COOKIE, CALENDAR_OAUTH_COOKIE_PATH,
} from '../services/calendar-sync.service.js';
import { env } from '../config/env.js';

/**
 * Where Google sends the browser back to.
 *
 * Public, because the browser arrives on a redirect with no session of
 * ours. Identity comes from the HMAC-signed state, and the state is only
 * honoured in the browser holding the nonce cookie set when the flow was
 * started - see calendar-sync for the login-CSRF this closes.
 *
 * Every outcome ends in a redirect to the app. A raw JSON error rendered in
 * the address bar after a consent screen is somebody assuming the product
 * is broken.
 */
export const calendarOAuthRoutes = Router();

/** The nonce cookie, read without pulling in a cookie parser for one value. */
function nonceCookie(req: Request): string | undefined {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== CALENDAR_OAUTH_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function back(res: Response, params: Record<string, string>) {
  // Used once, whatever the outcome: a nonce left behind is one more thing
  // a later, unrelated callback could be matched against.
  res.clearCookie(CALENDAR_OAUTH_COOKIE, { path: CALENDAR_OAUTH_COOKIE_PATH });
  const base = (env.CLIENT_URL || '').replace(/\/+$/, '');
  const query = new URLSearchParams(params).toString();
  res.redirect(`${base}/calendar/availability?${query}`);
}

calendarOAuthRoutes.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description: description } = req.query as Record<string, string>;

  if (error) {
    /*
     * access_denied means two very different things and Google sends the
     * same code for both: the person pressed Cancel, or Google refused them
     * because the app is unverified and they are not on the test-user list.
     *
     * Treating it only as a cancellation - which this did - leaves somebody
     * who was BLOCKED staring at a page that says nothing happened, with no
     * idea the consent screen is the thing to fix. So the message names
     * both possibilities and where to look.
     */
    if (error === 'access_denied') {
      return back(res, {
        calendar: 'denied',
        message: description
          || 'Cancelled, or Google blocked it. If you did not press cancel, add this '
           + 'address as a test user on the OAuth consent screen.',
      });
    }
    return back(res, {
      calendar: 'error',
      message: String(description || error).slice(0, 200),
    });
  }
  if (!code || !state) return back(res, { calendar: 'error', message: 'Missing code or state' });

  try {
    const { email } = await calendarSync.completeConnection(code, state, nonceCookie(req));
    return back(res, { calendar: 'connected', account: email });
  } catch (err: any) {
    return back(res, {
      calendar: 'error',
      message: String(err?.message || 'Could not connect').slice(0, 200),
    });
  }
});
