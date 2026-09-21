import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { domainService } from '../services/domain.service.js';

export const domainController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const domains = await domainService.list(req.userId!);
      res.json(domains);
    } catch (err) { next(err); }
  },

  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const domain = await domainService.get(req.userId!, req.params.id);
      res.json(domain);
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { domain } = req.body;
      if (!domain) return res.status(400).json({ error: 'domain is required' });
      const result = await domainService.create(req.userId!, domain);
      res.status(201).json(result);
    } catch (err) { next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await domainService.delete(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  /** POST /domains/:id/verify - Check DNS and update verification status */
  async verify(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await domainService.verify(req.userId!, req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  },

  /** GET /domains/:id/records - Get DNS records to add */
  async getRecords(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await domainService.getRecords(req.userId!, req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  },
  /** Tell us the DKIM selector, and check it straight away. */
  async setDkimSelector(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await domainService.setDkimSelector(
        req.userId!, req.params.id, (req.body || {}).selector,
      ));
    } catch (err) { next(err); }
  },
};
