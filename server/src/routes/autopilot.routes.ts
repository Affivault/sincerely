import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { AppError } from '../middleware/error.middleware.js';
import { autopilotService } from '../services/autopilot.service.js';
import { complaintsFor } from '../services/complaint-intake.service.js';

/** The deliverability autopilot: what it is doing, and the three overrides. */
export const autopilotRoutes = Router();

autopilotRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await autopilotService.status(req.userId!));
  } catch (err) { next(err); }
});

autopilotRoutes.put('/enabled', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') throw new AppError('enabled must be true or false', 400);
    await autopilotService.setEnabled(req.userId!, req.body.enabled);
    res.json({ enabled: req.body.enabled });
  } catch (err) { next(err); }
});

autopilotRoutes.post('/mailboxes/:id/resume', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await autopilotService.resumeMailbox(req.userId!, req.params.id);
    res.json({ resumed: true });
  } catch (err) { next(err); }
});

autopilotRoutes.delete('/holds/:provider', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await autopilotService.releaseHold(req.userId!, String(req.params.provider).toLowerCase());
    res.json({ released: true });
  } catch (err) { next(err); }
});

/** Spam complaints in the last 30 days, newest first, against what was sent. */
autopilotRoutes.get('/complaints', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await complaintsFor(req.userId!));
  } catch (err) { next(err); }
});
