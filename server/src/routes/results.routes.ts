import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { AppError } from '../middleware/error.middleware.js';
import { RESULTS_PERIODS, type ResultsPeriodKey } from '@lemlist/shared';
import { resultsService } from '../services/results.service.js';
import { resultsShareService } from '../services/results-share.service.js';

/** What the outreach produced, for a period - and links to share it. */
export const resultsRoutes = Router();

resultsRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || 'this_month');
    if (!(RESULTS_PERIODS as readonly string[]).includes(period)) throw new AppError('Unknown period', 400);
    res.json(await resultsService.report(req.userId!, period as ResultsPeriodKey));
  } catch (err) { next(err); }
});

resultsRoutes.get('/shares', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await resultsShareService.list(req.userId!)); } catch (err) { next(err); }
});

resultsRoutes.post('/shares', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await resultsShareService.create(req.userId!, {
      period: String(req.body?.period || ''),
      title: req.body?.title,
      show_campaigns: req.body?.show_campaigns !== false,
    }));
  } catch (err) { next(err); }
});

resultsRoutes.delete('/shares/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { await resultsShareService.revoke(req.userId!, req.params.id); res.json({ revoked: true }); } catch (err) { next(err); }
});

/** Mounted outside authentication: the token is the only key. */
export const publicResultsRoutes = Router();

publicResultsRoutes.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shared = await resultsShareService.open(String(req.params.token));
    if (!shared) { res.status(404).json({ error: 'This link has been switched off or does not exist.' }); return; }
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    res.json(shared);
  } catch (err) { next(err); }
});
