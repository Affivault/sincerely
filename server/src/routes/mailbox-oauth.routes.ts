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

/** The page an IT admin sees after approving Sincerely for their organisation. */
function adminPage(res: Response, ok: boolean, detail: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  res.status(ok ? 200 : 400).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sincerely - ${ok ? 'approved' : 'not approved'}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAF8;color:#18191D;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;">
<main style="max-width:460px;background:#fff;border:1px solid #E7E6E1;border-radius:14px;padding:28px;">
<p style="margin:0 0 8px;font-size:22px;font-weight:600;">${ok ? 'Sincerely is approved' : 'Sincerely was not approved'}</p>
<p style="margin:0;font-size:15px;line-height:1.6;color:#5B5C64;">${esc(detail)}</p>
</main></body></html>`);
}

mailboxOAuthRoutes.get('/microsoft/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description: description } = req.query as Record<string, string>;
  // An IT admin approving Sincerely for the whole organisation (adminConsentUrl).
  if (state === 'admin-consent') {
    const approved = String(req.query.admin_consent || '').toLowerCase() === 'true';
    return approved
      ? adminPage(res, true, 'Everyone in your organisation can now connect their mailbox with "Connect with Microsoft" without asking for approval. You can close this page.')
      : adminPage(res, false, String(description || error || 'The approval did not complete.').split('\r\n')[0].slice(0, 300));
  }
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
