import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { prospectRulesService } from '../services/prospect-rules.service.js';
import { prospectingController } from '../controllers/prospecting.controller.js';
import { prospectDetailsService } from '../services/prospect-details.service.js';

async function wrapDetails(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await prospectDetailsService.details(req.userId!, String(req.params.id), {
      company: typeof req.query.company === 'string' ? req.query.company : undefined,
      domain: typeof req.query.domain === 'string' ? req.query.domain : undefined,
    }));
  } catch (err) { next(err); }
}

export const prospectingRoutes = Router();

prospectingRoutes.get('/status', prospectingController.status);
prospectingRoutes.post('/search', prospectingController.search);
prospectingRoutes.post('/count', prospectingController.count);
prospectingRoutes.get('/suggest/locations', prospectingController.suggestLocations);
prospectingRoutes.post('/companies/search', prospectingController.searchCompanies);
prospectingRoutes.get('/destinations', prospectingController.destinations);
prospectingRoutes.post('/reveal', prospectingController.reveal);
// The person panel: what a search row already holds, never a credit.
prospectingRoutes.get('/people/:id/details', wrapDetails);
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
