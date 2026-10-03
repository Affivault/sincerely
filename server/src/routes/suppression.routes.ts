import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { suppressionService } from '../services/suppression.service.js';

export const suppressionRoutes = Router();

suppressionRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await suppressionService.list(req.userId!, req.query as any);
    res.json(result);
  } catch (err) { next(err); }
});

suppressionRoutes.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, reason, notes } = req.body;
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email is required' });
    const entry = await suppressionService.add(req.userId!, email, reason, notes);
    res.status(201).json(entry);
  } catch (err) { next(err); }
});

suppressionRoutes.post('/bulk', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { emails, reason } = req.body;
    if (!Array.isArray(emails) || emails.length === 0 || !emails.every((e: unknown) => typeof e === 'string')) {
      return res.status(400).json({ error: 'emails array of strings required' });
    }
    const result = await suppressionService.addBulk(req.userId!, emails, reason);
    res.json(result);
  } catch (err) { next(err); }
});

suppressionRoutes.delete('/:email', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await suppressionService.remove(req.userId!, decodeURIComponent(req.params.email));
    res.status(204).send();
  } catch (err) { next(err); }
});

suppressionRoutes.get('/check', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.query.email;
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email query param required' });
    const suppressed = await suppressionService.isSuppressed(req.userId!, email);
    res.json({ suppressed });
  } catch (err) { next(err); }
});
