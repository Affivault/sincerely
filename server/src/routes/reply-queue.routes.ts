import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { replyQueueService } from '../services/reply-queue.service.js';

/* ═══════════════════════════════════════════════════════════════════════
   The reply queue: what to answer first, and what is late.
   ═══════════════════════════════════════════════════════════════════════ */

export const replyQueueRoutes = Router();

replyQueueRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const filter = String(req.query.filter || 'all') as any;
    res.json(await replyQueueService.queue(req.userId!, { filter }));
  } catch (err) { next(err); }
});

replyQueueRoutes.get('/counts', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await replyQueueService.counts(req.userId!));
  } catch (err) { next(err); }
});

/**
 * Claim a reply, or hand it back.
 *
 * Only ever the caller themselves for now. Every service in this app
 * scopes by user_id, so a teammate cannot open another user's inbox at
 * all - assigning to them would hand over a reply they have no way to
 * read. The service takes any user id, so this opens up without a schema
 * change once org-scoped access exists.
 */
replyQueueRoutes.patch('/:id/assign', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { assigned } = req.body ?? {};
    if (typeof assigned !== 'boolean') {
      return res.status(400).json({ error: 'assigned must be true or false' });
    }
    res.json(await replyQueueService.assign(req.userId!, req.params.id, assigned ? req.userId! : null));
  } catch (err) { next(err); }
});

replyQueueRoutes.patch('/:id/snooze', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { until, note } = req.body ?? {};
    if (until !== null && typeof until !== 'string') {
      return res.status(400).json({ error: 'until must be an ISO timestamp, or null to unpark' });
    }
    res.json(await replyQueueService.snooze(req.userId!, req.params.id, until, note));
  } catch (err) { next(err); }
});
