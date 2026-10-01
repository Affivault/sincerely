import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { systemStatusService } from '../services/system-status.service.js';
import { replyCheckService } from '../services/reply-check.service.js';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { settingsService } from '../services/settings.service.js';

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

/** Send, answer, sync, match, stop - on this account's own mailboxes. Takes up to two minutes. */
systemRoutes.post('/reply-check', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await replyCheckService.run(req.userId!));
  } catch (err) { next(err); }
});

/** Turn the automatic daily check on or off. */
systemRoutes.put('/reply-check/daily', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body?.daily !== 'boolean') throw new AppError('daily must be true or false', 400);
    await settingsService.get(req.userId!); // the row must exist to be changed
    const { error } = await supabaseAdmin
      .from('user_settings')
      .update({ reply_check_daily: req.body.daily, updated_at: new Date().toISOString() })
      .eq('user_id', req.userId!);
    if (error) {
      if (/reply_check_daily/.test(error.message)) throw new AppError('Run migration 079 to change this.', 409);
      throw new AppError(error.message, 500);
    }
    res.json({ daily: req.body.daily });
  } catch (err) { next(err); }
});
