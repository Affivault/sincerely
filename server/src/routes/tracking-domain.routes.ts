import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { trackingDomainService, cnameInstruction, trackingCnameTarget } from '../services/tracking-domain.service.js';

export const trackingDomainRoutes = Router();

/** The account's tracking domain, with the CNAME it needs. */
trackingDomainRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const record = await trackingDomainService.get(req.userId!);
    res.json({
      domain: record,
      cname: record ? cnameInstruction(record.domain) : null,
      target: trackingCnameTarget(),
    });
  } catch (err) { next(err); }
});

trackingDomainRoutes.put('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const record = await trackingDomainService.set(req.userId!, req.body?.domain);
    res.json({ domain: record, cname: cnameInstruction(record.domain), target: trackingCnameTarget() });
  } catch (err) { next(err); }
});

/** Re-check DNS and HTTPS. Activates only when both pass, deactivates if not. */
trackingDomainRoutes.post('/verify', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await trackingDomainService.verify(req.userId!));
  } catch (err) { next(err); }
});

trackingDomainRoutes.delete('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await trackingDomainService.remove(req.userId!);
    res.status(204).send();
  } catch (err) { next(err); }
});
