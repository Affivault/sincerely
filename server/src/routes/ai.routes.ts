import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { AppError } from '../middleware/error.middleware.js';
import { aiAvailable } from '../services/ai.service.js';
import { aiUsageService } from '../services/ai-usage.service.js';

/** What Relay's AI has used this month, and the allowance it stops at. */
export const aiRoutes = Router();

aiRoutes.get('/usage', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await aiUsageService.usage(req.userId!, aiAvailable()));
  } catch (err) { next(err); }
});

aiRoutes.put('/usage/cap', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const raw = req.body?.cap_tokens;
    if (raw !== null && typeof raw !== 'number') throw new AppError('cap_tokens must be a number, or null for the server default.', 400);
    await aiUsageService.setCap(req.userId!, raw);
    res.json(await aiUsageService.usage(req.userId!, aiAvailable()));
  } catch (err) { next(err); }
});
