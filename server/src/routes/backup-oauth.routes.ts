import { Router, Request, Response } from 'express';
import { CALENDAR_OAUTH_COOKIE } from '../services/calendar-sync.service.js';
import { fileBackupService, BACKUP_OAUTH_COOKIE_PATH } from '../services/file-backup.service.js';
import { env } from '../config/env.js';

/**
 * Where Microsoft and Dropbox send the browser back to (migration 113).
 *
 * Public, because the browser arrives on a redirect with no session of
 * ours. Identity comes from the HMAC-signed state, honoured only in the
 * browser holding the nonce cookie set when the connection was started.
 * Every outcome ends back on Settings > Backup.
 */
export const backupOAuthRoutes = Router();

function nonceCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== CALENDAR_OAUTH_COOKIE) continue;
    try { return decodeURIComponent(part.slice(at + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

function back(res: Response, params: Record<string, string>) {
  res.clearCookie(CALENDAR_OAUTH_COOKIE, { path: BACKUP_OAUTH_COOKIE_PATH });
  const base = (env.CLIENT_URL || '').replace(/\/+$/, '');
  res.redirect(`${base}/settings?${new URLSearchParams({ tab: 'backup', ...params }).toString()}`);
}

backupOAuthRoutes.get('/:provider/callback', async (req: Request, res: Response) => {
  const provider = req.params.provider === 'onedrive' ? 'onedrive' : req.params.provider === 'dropbox' ? 'dropbox' : null;
  const { code, state, error, error_description: description } = req.query as Record<string, string>;
  if (!provider) return back(res, { backup: 'error', message: 'Unknown provider' });
  if (error) {
    return back(res, {
      backup: error === 'access_denied' ? 'denied' : 'error', provider,
      message: error === 'access_denied' ? 'Cancelled - nothing was connected.' : String(description || error).slice(0, 200),
    });
  }
  if (!code || !state) return back(res, { backup: 'error', provider, message: 'Missing code or state' });
  try {
    const { label } = await fileBackupService.completeConnection(provider, code, state, nonceCookie(req));
    return back(res, { backup: 'connected', provider, account: label });
  } catch (err: any) {
    return back(res, { backup: 'error', provider, message: String(err?.message || 'Could not connect').slice(0, 200) });
  }
});
