import { Router, Request, Response } from 'express';
import { CALENDAR_OAUTH_COOKIE } from '../services/calendar-sync.service.js';
import { mailboxOAuthService, MAILBOX_OAUTH_COOKIE_PATH } from '../services/mailbox-oauth.service.js';
import { env } from '../config/env.js';

/**
 * Where Microsoft sends the browser back after "Connect with Microsoft"
 * (migration 114). Public, because the browser arrives on a redirect with
 * no session of ours; identity comes from the HMAC-signed state, honoured
 * only in the browser holding the nonce cookie set when it started. Every
 * outcome ends back on the Email accounts page, saying what happened.
 */
export const mailboxOAuthRoutes = Router();

function nonceCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== CALENDAR_OAUTH_COOKIE) continue;
    try { return decodeURIComponent(part.slice(at + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

function back(res: Response, params: Record<string, string>) {
  res.clearCookie(CALENDAR_OAUTH_COOKIE, { path: MAILBOX_OAUTH_COOKIE_PATH });
  const base = (env.CLIENT_URL || '').replace(/\/+$/, '');
  res.redirect(`${base}/email-accounts?${new URLSearchParams(params).toString()}`);
}

mailboxOAuthRoutes.get('/microsoft/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description: description } = req.query as Record<string, string>;
  if (error) {
    const adminNeeded = /AADSTS65001|AADSTS90094|admin|approval/i.test(String(description || ''));
    return back(res, {
      microsoft: error === 'access_denied' && !adminNeeded ? 'cancelled' : 'error',
      message: adminNeeded
        ? 'Your organisation needs an admin to approve Sincerely before mailboxes can connect. Ask your Microsoft 365 admin to approve it, then try again.'
        : error === 'access_denied' ? 'Cancelled - nothing was connected.' : String(description || error).split('\r\n')[0].slice(0, 240),
    });
  }
  if (!code || !state) return back(res, { microsoft: 'error', message: 'Microsoft did not finish signing in. Try again.' });
  try {
    const r = await mailboxOAuthService.completeConnection(code, state, nonceCookie(req));
    return back(res, {
      microsoft: r.verified ? 'connected' : 'connected_unverified',
      email: r.email,
      account: r.accountId,
      ...(r.created ? {} : { moved: '1' }),
      ...(r.message && !r.verified ? { message: r.message.slice(0, 400) } : {}),
    });
  } catch (err: any) {
    return back(res, { microsoft: 'error', message: String(err?.message || 'Could not connect').slice(0, 240) });
  }
});
