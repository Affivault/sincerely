import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { leadsService } from '../services/leads.service.js';

export const leadsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const contactId = typeof req.query.contact_id === 'string' ? req.query.contact_id : undefined;
      res.json(await leadsService.list(req.userId!, { status, contactId }));
    } catch (err) { next(err); }
  },
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await leadsService.create(req.userId!, req.body)); } catch (err) { next(err); }
  },
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await leadsService.update(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },
  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try { await leadsService.remove(req.userId!, req.params.id); res.status(204).send(); } catch (err) { next(err); }
  },
  async archive(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await leadsService.archive(req.userId!, req.params.id, req.body?.reason)); } catch (err) { next(err); }
  },
  async reopen(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await leadsService.reopen(req.userId!, req.params.id)); } catch (err) { next(err); }
  },
  async convert(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await leadsService.convert(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },
};
