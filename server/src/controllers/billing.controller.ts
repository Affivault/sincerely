import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { billingService } from '../services/billing.service.js';

export const billingController = {
  /** GET /billing/usage — current plan, limits, and this period's usage. */
  async usage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const summary = await billingService.getUsageSummary(req.userId!);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
};
