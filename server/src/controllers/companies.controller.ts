import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { companiesService } from '../services/companies.service.js';

export const companiesController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      res.json(await companiesService.list(req.userId!, search));
    } catch (err) { next(err); }
  },

  async summary(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await companiesService.summary(req.userId!, req.params.id)); } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await companiesService.createOrGet(req.userId!, req.body)); } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await companiesService.update(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try { await companiesService.delete(req.userId!, req.params.id); res.status(204).send(); } catch (err) { next(err); }
  },

  async linkContact(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { contact_id, company_id } = req.body || {};
      res.json(await companiesService.linkContact(req.userId!, contact_id, company_id ?? null));
    } catch (err) { next(err); }
  },
};
