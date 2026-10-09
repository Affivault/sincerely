import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { AppError } from '../middleware/error.middleware.js';
import { signalsService } from '../services/signals.service.js';

/** Moments: who to email today, and why (services/signals). */
export const signalsRoutes = Router();

const UUID = /^[0-9a-f-]{36}$/i;
const idOf = (req: AuthRequest) => {
  const id = String(req.params.id || '');
  if (!UUID.test(id)) throw new AppError('Moment not found', 404);
  return id;
};
const optionalId = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);

signalsRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await signalsService.list(req.userId!)); } catch (err) { next(err); }
});

signalsRoutes.get('/count', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json({ count: await signalsService.count(req.userId!) }); } catch (err) { next(err); }
});

signalsRoutes.put('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await signalsService.configure(req.userId!, {
      web: typeof req.body?.web === 'boolean' ? req.body.web : undefined,
      topics: Array.isArray(req.body?.topics) ? req.body.topics : undefined,
    }));
  } catch (err) { next(err); }
});

signalsRoutes.post('/settings/suggest', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await signalsService.suggest(req.userId!)); } catch (err) { next(err); }
});

signalsRoutes.post('/:id/dismiss', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await signalsService.setStatus(req.userId!, idOf(req), 'dismissed')); } catch (err) { next(err); }
});

signalsRoutes.post('/:id/restore', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await signalsService.setStatus(req.userId!, idOf(req), 'new')); } catch (err) { next(err); }
});

signalsRoutes.post('/:id/done', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await signalsService.setStatus(req.userId!, idOf(req), 'acted')); } catch (err) { next(err); }
});

signalsRoutes.post('/:id/draft', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await signalsService.draft(req.userId!, idOf(req), optionalId(req.body?.contact_id))); } catch (err) { next(err); }
});

signalsRoutes.post('/:id/send', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await signalsService.send(req.userId!, idOf(req), {
      contact_id: optionalId(req.body?.contact_id),
      subject: String(req.body?.subject || '').slice(0, 300),
      body: String(req.body?.body || '').slice(0, 20_000),
      smtp_account_id: optionalId(req.body?.smtp_account_id),
    }));
  } catch (err) { next(err); }
});

signalsRoutes.post('/:id/enrol', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const campaignId = optionalId(req.body?.campaign_id);
    if (!campaignId) throw new AppError('Choose a campaign.', 400);
    res.json(await signalsService.enrol(req.userId!, idOf(req), { contact_id: optionalId(req.body?.contact_id), campaign_id: campaignId }));
  } catch (err) { next(err); }
});
