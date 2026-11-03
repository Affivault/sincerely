import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { driveBackupService } from '../services/drive-backup.service.js';
import { fileBackupService, BACKUP_OAUTH_COOKIE_PATH } from '../services/file-backup.service.js';
import { CALENDAR_OAUTH_COOKIE, CALENDAR_OAUTH_COOKIE_PATH, CALENDAR_OAUTH_TTL_MS } from '../services/calendar-sync.service.js';
import { env } from '../config/env.js';

/** Google Drive backup (migration 112). */
export const backupController = {
  async status(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await driveBackupService.status(req.userId!)); } catch (err) { next(err); }
  },

  async authorize(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { url, nonce } = driveBackupService.authorizeUrl(req.userId!);
      // The same browser-binding cookie the calendar connection uses: the
      // Google callback is shared, and only this browser can finish it.
      res.cookie(CALENDAR_OAUTH_COOKIE, nonce, {
        httpOnly: true,
        secure: /^https:/i.test(env.API_BASE_URL),
        sameSite: 'lax',
        path: CALENDAR_OAUTH_COOKIE_PATH,
        maxAge: CALENDAR_OAUTH_TTL_MS,
      });
      res.json({ url });
    } catch (err) { next(err); }
  },

  async setEnabled(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await driveBackupService.setEnabled(req.userId!, req.body?.enabled !== false)); } catch (err) { next(err); }
  },

  async backupNow(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await driveBackupService.backupNow(req.userId!)); } catch (err) { next(err); }
  },

  async disconnect(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await driveBackupService.disconnect(req.userId!)); } catch (err) { next(err); }
  },

  /* ── OneDrive, Dropbox, S3 (migration 113) ─────────────────────── */

  async filesStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await fileBackupService.status(req.userId!)); } catch (err) { next(err); }
  },

  async filesAuthorize(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { url, nonce } = fileBackupService.authorizeUrl(req.userId!, req.params.provider);
      // Only this browser can finish the connection (see calendar-sync).
      res.cookie(CALENDAR_OAUTH_COOKIE, nonce, {
        httpOnly: true,
        secure: /^https:/i.test(env.API_BASE_URL),
        sameSite: 'lax',
        path: BACKUP_OAUTH_COOKIE_PATH,
        maxAge: CALENDAR_OAUTH_TTL_MS,
      });
      res.json({ url });
    } catch (err) { next(err); }
  },

  async filesSaveS3(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await fileBackupService.saveS3(req.userId!, req.body || {})); } catch (err) { next(err); }
  },

  async filesUpdate(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await fileBackupService.update(req.userId!, req.params.provider, req.body || {})); } catch (err) { next(err); }
  },

  async filesNow(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await fileBackupService.backupNow(req.userId!, req.params.provider)); } catch (err) { next(err); }
  },

  async filesDisconnect(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await fileBackupService.disconnect(req.userId!, req.params.provider)); } catch (err) { next(err); }
  },
};
