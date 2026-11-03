import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { driveBackupService } from '../services/drive-backup.service.js';
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
};
