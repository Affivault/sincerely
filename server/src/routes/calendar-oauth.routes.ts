import { Router, Request, Response } from 'express';
import { calendarSync } from '../services/calendar-sync.service.js';
import { env } from '../config/env.js';

/**
 * Where Google sends the browser back to.
 *
 * Public, because the browser arrives on a redirect with no session of
 * ours. Identity comes from the HMAC-signed state, exactly as the
 * integrations OAuth callback does - the two are deliberately the same
 * construction so there is one thing to reason about.
 *
 * Every outcome ends in a redirect to the app. A raw JSON error rendered in
 * the address bar after a consent screen is somebody assuming the product
 * is broken.
 */
export const calendarOAuthRoutes = Router();

function back(res: Response, params: Record<string, string>) {
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
    const { email } = await calendarSync.completeConnection(code, state);
    return back(res, { calendar: 'connected', account: email });
  } catch (err: any) {
    return back(res, {
      calendar: 'error',
      message: String(err?.message || 'Could not connect').slice(0, 200),
    });
  }
});
