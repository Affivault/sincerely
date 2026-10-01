import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { sendTestNotification } from '../services/notify.service.js';
import { digestService } from '../services/digest.service.js';

/** Settings > Notifications: try them out. */
export const notifyRoutes = Router();

/** One short notification, so you can see where they come from and land. */
notifyRoutes.post('/test', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await sendTestNotification(req.userId!));
  } catch (err) { next(err); }
});

/** Last week's digest, now, whatever the switch says. */
notifyRoutes.post('/digest', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await digestService.send(req.userId!));
  } catch (err) { next(err); }
});
