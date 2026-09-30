import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { systemStatusService } from '../services/system-status.service.js';

/** Is everything running, for this account - and a check to prove it. */
export const systemRoutes = Router();

systemRoutes.get('/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await systemStatusService.status(req.userId!));
  } catch (err) { next(err); }
});

systemRoutes.post('/self-test', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ results: await systemStatusService.selfTest(req.userId!) });
  } catch (err) { next(err); }
});
