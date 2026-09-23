import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { buildFlow } from '../services/flow.service.js';
import { replyQueueService } from '../services/reply-queue.service.js';
import { meetingBrief } from '../services/meeting-brief.service.js';
import { awaySummary } from '../services/away.service.js';

/* The day's work as one ranked queue. See services/flow.service.ts. */
export const flowRoutes = Router();

flowRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await buildFlow(req.userId!));
  } catch (err) { next(err); }
});

/** A reply dealt with somewhere else - a call, another thread - so nobody is waiting. */
flowRoutes.post('/replies/:id/handled', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await replyQueueService.markResponded(req.userId!, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/** Everything to know before a meeting, on one card. */
flowRoutes.get('/meetings/:id/brief', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await meetingBrief(req.userId!, req.params.id));
  } catch (err) { next(err); }
});

/** Counts of what changed since the caller last looked. */
flowRoutes.get('/since', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await awaySummary(req.userId!, req.query.at));
  } catch (err) { next(err); }
});
