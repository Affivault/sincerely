import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { mailboxOAuthService, microsoftMailConfigured, MAILBOX_OAUTH_COOKIE_PATH } from '../services/mailbox-oauth.service.js';
import { CALENDAR_OAUTH_COOKIE, CALENDAR_OAUTH_TTL_MS } from '../services/calendar-sync.service.js';
import { env } from '../config/env.js';

/** "Connect with Microsoft" for Outlook and Microsoft 365 mailboxes (migration 114). */
export const mailboxOAuthController = {
  async status(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json({ microsoft: microsoftMailConfigured(), states: await mailboxOAuthService.states(req.userId!) });
    } catch (err) { next(err); }
  },

  async authorize(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { url, nonce } = mailboxOAuthService.authorizeUrl(req.userId!, { loginHint: String(req.query.email || '') });
      // Only this browser can finish the connection (see calendar-sync).
      res.cookie(CALENDAR_OAUTH_COOKIE, nonce, {
        httpOnly: true,
        secure: /^https:/i.test(env.API_BASE_URL),
        sameSite: 'lax',
        path: MAILBOX_OAUTH_COOKIE_PATH,
        maxAge: CALENDAR_OAUTH_TTL_MS,
      });
      res.json({ url });
    } catch (err) { next(err); }
  },
};
