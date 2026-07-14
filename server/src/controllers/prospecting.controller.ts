import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { prospectingService } from '../services/prospecting.service.js';
import { stripeService } from '../services/stripe.service.js';

export const prospectingController = {
  /** GET /prospecting/status — configured provider + this month's credits */
  async status(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await prospectingService.status(req.userId!)); } catch (err) { next(err); }
  },

  /** POST /prospecting/search — run a filtered people search (no emails returned) */
  async search(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { filters, page } = req.body || {};
      res.json(await prospectingService.search(req.userId!, filters || {}, Number(page) || 1));
    } catch (err) { next(err); }
  },

  /** POST /prospecting/reveal — spend a credit, save the lead as a contact */
  async reveal(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await prospectingService.reveal(req.userId!, req.body || {})); } catch (err) { next(err); }
  },

  /** POST /prospecting/credits/checkout — Stripe checkout for a credit pack */
  async buyCredits(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { pack_id } = req.body || {};
      if (!pack_id) return res.status(400).json({ error: 'pack_id is required' });
      const url = await stripeService.createCreditPackCheckout(req.userId!, req.userEmail, String(pack_id));
      res.json({ url });
    } catch (err) { next(err); }
  },
};
