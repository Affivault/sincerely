import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { billingService } from '../services/billing.service.js';
import { stripeService } from '../services/stripe.service.js';

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

  /** POST /billing/checkout { plan, interval } — returns a Stripe Checkout URL. */
  async checkout(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { plan, interval } = req.body || {};
      if (plan !== 'starter' && plan !== 'growth') {
        return res.status(400).json({ error: 'plan must be "starter" or "growth"' });
      }
      const billingInterval = interval === 'annual' ? 'annual' : 'monthly';
      const url = await stripeService.createCheckoutSession(req.userId!, req.userEmail, plan, billingInterval);
      res.json({ url });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /billing/refresh — re-sync plan state straight from Stripe, then
   * return the usage summary. Safety net for missed webhooks (called by the
   * client right after returning from Checkout).
   */
  async refresh(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (stripeService.isConfigured()) {
        await stripeService.refreshFromStripe(req.userId!);
      }
      const summary = await billingService.getUsageSummary(req.userId!);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },

  /** POST /billing/portal — returns a Stripe Customer Portal URL. */
  async portal(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const url = await stripeService.createPortalSession(req.userId!);
      res.json({ url });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/billing/webhook — Stripe webhook. Mounted directly in app.ts with
   * a raw body parser and no auth (Stripe calls it). Signature is verified.
   */
  async webhook(req: Request, res: Response) {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }
    try {
      await stripeService.handleWebhook(req.body as Buffer, signature);
      res.json({ received: true });
    } catch (err: any) {
      console.error('[Stripe webhook]', err.message);
      res.status(err.statusCode || 400).json({ error: err.message });
    }
  },
};
