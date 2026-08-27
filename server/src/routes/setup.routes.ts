import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { setupService } from '../services/setup.service.js';

export const setupRoutes = Router();

/** What this account still has to do before it can send anything. */
setupRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await setupService.get(req.userId!));
  } catch (err) { next(err); }
});
