import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { pauseRecipient, resumeRecipient } from '../services/account-pause.service.js';
import { enrollByName } from '../services/command.service.js';

/* The command bar's instructions. See shared/command-intent.ts. */
export const commandRoutes = Router();

commandRoutes.post('/pause', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await pauseRecipient(req.userId!, String(req.body?.target || ''))); } catch (err) { next(err); }
});

commandRoutes.post('/resume', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await resumeRecipient(req.userId!, String(req.body?.target || ''))); } catch (err) { next(err); }
});

commandRoutes.post('/enroll', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await enrollByName(req.userId!, req.body?.email, req.body?.campaign)); } catch (err) { next(err); }
});
