import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { placementService } from '../services/placement.service.js';

/* ═══════════════════════════════════════════════════════════════════════
   Inbox placement.

   Every route is scoped to req.userId and the service re-scopes every
   query on top of that, so a test id from another account returns "not
   found" rather than somebody else's deliverability.
   ═══════════════════════════════════════════════════════════════════════ */

export const placementRoutes = Router();

/** The seed mailboxes, and whether each can actually be read. */
placementRoutes.get('/seeds', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await placementService.listSeeds(req.userId!));
  } catch (err) { next(err); }
});

/** Mark an existing mailbox as a seed, or stop it being one. */
placementRoutes.patch('/seeds/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { is_seed } = req.body ?? {};
    if (typeof is_seed !== 'boolean') {
      return res.status(400).json({ error: 'is_seed must be true or false' });
    }
    res.json(await placementService.setSeed(req.userId!, req.params.id, is_seed));
  } catch (err) { next(err); }
});

placementRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Number(req.query.limit) || 20;
    res.json(await placementService.list(req.userId!, limit));
  } catch (err) { next(err); }
});

placementRoutes.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { smtp_account_id, campaign_id, step_id, subject, body_html } = req.body ?? {};
    if (!smtp_account_id) {
      return res.status(400).json({ error: 'smtp_account_id is required' });
    }
    const result = await placementService.start(req.userId!, {
      smtp_account_id, campaign_id, step_id, subject, body_html,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

placementRoutes.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await placementService.get(req.userId!, req.params.id));
  } catch (err) { next(err); }
});

/**
 * Look again, now.
 *
 * The poller runs on its own schedule, but somebody watching a test they
 * just started should not have to wait out a sweep interval to see the
 * first result land. Ownership is checked before the poll rather than
 * inside it: `poll` is also the scheduler's entry point and has no user
 * to check against.
 */
placementRoutes.post('/:id/refresh', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await placementService.get(req.userId!, req.params.id);
    await placementService.poll(req.params.id);
    res.json(await placementService.get(req.userId!, req.params.id));
  } catch (err) { next(err); }
});
