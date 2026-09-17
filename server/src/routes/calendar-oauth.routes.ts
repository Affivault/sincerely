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
  const { code, state, error } = req.query as Record<string, string>;

  // The user pressed Cancel. Not an error, and must not read as one.
  if (error) return back(res, { calendar: 'cancelled' });
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
