import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { readinessService } from '../services/readiness.service.js';

export const readinessRoutes = Router();

/** Everything that decides whether this account can safely send, in one answer. */
readinessRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await readinessService.report(req.userId!));
  } catch (err) { next(err); }
});
