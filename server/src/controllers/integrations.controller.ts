import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import * as integrationsService from '../services/integrations.service.js';
import { getPagination } from '../utils/pagination.js';

export const integrationsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const integrations = await integrationsService.listIntegrations(req.userId!);
      res.json(integrations);
    } catch (err) { next(err); }
  },

  async connect(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await integrationsService.connectIntegration(
        req.userId!,
        req.params.provider,
        req.body || {}
      );
      res.status(201).json(result);
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const integration = await integrationsService.updateIntegration(req.userId!, req.params.id, req.body || {});
      res.json(integration);
    } catch (err) { next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await integrationsService.deleteIntegration(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async test(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await integrationsService.testIntegration(req.userId!, req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  },

  async activity(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { limit } = getPagination({ limit: req.query.limit ? Number(req.query.limit) : 30 });
      const activity = await integrationsService.getActivity(req.userId!, req.params.id, limit);
      res.json(activity);
    } catch (err) { next(err); }
  },
};
