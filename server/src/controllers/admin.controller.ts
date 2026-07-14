import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { adminService } from '../services/admin.service.js';

export const adminController = {
  /** GET /admin/users?search= — all accounts with their plan */
  async listUsers(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      res.json(await adminService.listUsers(search));
    } catch (err) { next(err); }
  },

  /** GET /admin/stats — platform-wide totals */
  async stats(_req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await adminService.stats()); } catch (err) { next(err); }
  },

  /** POST /admin/grant-lifetime { email } */
  async grantLifetime(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { email } = req.body || {};
      res.json(await adminService.grantLifetime(email));
    } catch (err) { next(err); }
  },

  /** POST /admin/revoke-lifetime { user_id } */
  async revokeLifetime(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { user_id } = req.body || {};
      if (!user_id) return res.status(400).json({ error: 'user_id is required' });
      await adminService.revokeLifetime(String(user_id));
      res.status(204).send();
    } catch (err) { next(err); }
  },
};
