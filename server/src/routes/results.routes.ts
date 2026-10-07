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

// Each open runs a dozen queries, so a courtesy limit per caller.
const WINDOW_MS = 60_000;
const BUDGET = 20;
const hits = new Map<string, { count: number; windowStart: number }>();
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, entry] of hits) if (entry.windowStart < cutoff) hits.delete(key);
}, WINDOW_MS).unref();

function limit(req: Request, res: Response, next: NextFunction) {
  const who = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'anon';
  const now = Date.now();
  const entry = hits.get(who);
  if (!entry || now - entry.windowStart > WINDOW_MS) { hits.set(who, { count: 1, windowStart: now }); return next(); }
  entry.count += 1;
  if (entry.count > BUDGET) {
    res.setHeader('Retry-After', String(Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000)));
    res.status(429).json({ error: 'Too many requests. Give it a moment.' });
    return;
  }
  next();
}

publicResultsRoutes.get('/:token', limit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shared = await resultsShareService.open(String(req.params.token));
    if (!shared) { res.status(404).json({ error: 'This link has been switched off or does not exist.' }); return; }
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    res.json(shared);
  } catch (err) { next(err); }
});
