import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { renewalsService } from '../services/renewals.service.js';
import { processLifecycleTriggers } from '../services/post-sale.service.js';

export const renewalsController = {
  /** The book: every renewal still to be decided. */
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await renewalsService.list(req.userId!, req.query as any));
    } catch (err) { next(err); }
  },

  /** What is coming up, when, and for how much. */
  async summary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await renewalsService.summary(req.userId!));
    } catch (err) { next(err); }
  },

  /** Correct the date, the notice period, or take it out of the book. */
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await renewalsService.update(req.userId!, req.params.id, req.body || {}));
    } catch (err) { next(err); }
  },

  /** They renewed: the next term becomes its own deal. */
  async markRenewed(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await renewalsService.markRenewed(req.userId!, req.params.id, req.body || {}));
    } catch (err) { next(err); }
  },

  /** They did not. */
  async markChurned(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await renewalsService.markChurned(req.userId!, req.params.id, (req.body || {}).reason));
    } catch (err) { next(err); }
  },

  /** Which post-sale sequences this deal has actually been put into. */
  async activity(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await renewalsService.activity(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },

  /**
   * Run the trigger pass now.
   *
   * The worker does this on its own every thirty seconds. This exists so
   * that somebody who has just switched a renewal sequence on can see it
   * work, rather than wondering for half a minute whether they set it up
   * wrong — which is when people give up on an automation.
   */
  async runTriggers(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await processLifecycleTriggers());
    } catch (err) { next(err); }
  },
};
