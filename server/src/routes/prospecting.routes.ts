import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { prospectRulesService } from '../services/prospect-rules.service.js';
import { prospectingController } from '../controllers/prospecting.controller.js';

export const prospectingRoutes = Router();

prospectingRoutes.get('/status', prospectingController.status);
prospectingRoutes.post('/search', prospectingController.search);
prospectingRoutes.post('/reveal', prospectingController.reveal);
prospectingRoutes.post('/credits/checkout', prospectingController.buyCredits);

/* Standing searches - saved searches that prospect, verify and enrol on a cadence. */
const wrap = (fn: (req: AuthRequest) => Promise<unknown>, status = 200) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req)); } catch (err) { next(err); }
  };
prospectingRoutes.get('/rules', wrap((req) => prospectRulesService.list(req.userId!)));
prospectingRoutes.post('/rules', wrap((req) => prospectRulesService.create(req.userId!, req.body || {}), 201));
prospectingRoutes.put('/rules/:id', wrap((req) => prospectRulesService.update(req.userId!, req.params.id, req.body || {})));
prospectingRoutes.delete('/rules/:id', wrap(async (req) => { await prospectRulesService.remove(req.userId!, req.params.id); return { ok: true }; }));
prospectingRoutes.post('/rules/:id/run', wrap((req) => prospectRulesService.run(req.userId!, req.params.id)));
