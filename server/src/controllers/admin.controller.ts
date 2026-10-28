import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { adminService } from '../services/admin.service.js';
import { adminAccountsService } from '../services/admin-accounts.service.js';

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

  /** GET /admin/usage?month=YYYY-MM — cost, revenue and profit per account */
  async usage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const month = typeof req.query.month === 'string' ? req.query.month : undefined;
      res.json(await adminService.usage(month));
    } catch (err) { next(err); }
  },

  /** GET /admin/health — relay, Redis and platform-wide counts (moved off public /health) */
  async health(_req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await adminService.health()); } catch (err) { next(err); }
  },

  /** POST /admin/grant-lifetime { email } */
  async grantLifetime(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { email } = req.body || {};
      const row = await adminService.grantLifetime(email);
      await adminAccountsService.audit(req.userEmail!, 'lifetime_grant', { id: row.id, email: row.email });
      res.json(row);
    } catch (err) { next(err); }
  },

  /** POST /admin/revoke-lifetime { user_id } */
  async revokeLifetime(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { user_id } = req.body || {};
      if (!user_id) return res.status(400).json({ error: 'user_id is required' });
      await adminService.revokeLifetime(String(user_id));
      await adminAccountsService.audit(req.userEmail!, 'lifetime_revoke', { id: String(user_id), email: null });
      res.status(204).send();
    } catch (err) { next(err); }
  },

  /** GET /admin/accounts?month=YYYY-MM — every account with usage, cost and revenue */
  async accounts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const month = typeof req.query.month === 'string' ? req.query.month : undefined;
      res.json(await adminAccountsService.list(month));
    } catch (err) { next(err); }
  },

  /** GET /admin/accounts/:id — one account in full */
  async account(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await adminAccountsService.detail(req.params.id)); } catch (err) { next(err); }
  },

  /** POST /admin/accounts/:id/plan { plan, status? } */
  async setPlan(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { plan, status } = req.body || {};
      if (typeof plan !== 'string') return res.status(400).json({ error: 'plan is required' });
      res.json(await adminAccountsService.setPlan(req.userEmail!, req.params.id, plan, typeof status === 'string' ? status : undefined));
    } catch (err) { next(err); }
  },

  /** POST /admin/accounts/:id/allowance { credit_allowance: number | null } */
  async setAllowance(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const value = req.body?.credit_allowance;
      await adminAccountsService.setAllowance(req.userEmail!, req.params.id, value === null || value === '' ? null : Number(value));
      res.status(204).send();
    } catch (err) { next(err); }
  },

  /** POST /admin/accounts/:id/credits { amount, note } */
  async adjustCredits(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { amount, note } = req.body || {};
      await adminAccountsService.adjustCredits(req.userEmail!, req.params.id, Number(amount), String(note || ''));
      res.status(204).send();
    } catch (err) { next(err); }
  },

  /** POST /admin/accounts/:id/suspend { reason? } */
  async suspend(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await adminAccountsService.suspend(req.userEmail!, req.params.id, req.body?.reason);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  /** POST /admin/accounts/:id/unsuspend */
  async unsuspend(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await adminAccountsService.unsuspend(req.userEmail!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  /** POST /admin/accounts/:id/note { note } */
  async setNote(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await adminAccountsService.setNote(req.userEmail!, req.params.id, String(req.body?.note ?? ''));
      res.status(204).send();
    } catch (err) { next(err); }
  },

  /** GET /admin/audit?limit= — every change made from the admin backend */
  async audit(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const limit = Number(req.query.limit) || 200;
      res.json(await adminAccountsService.auditLog(limit));
    } catch (err) { next(err); }
  },
};
