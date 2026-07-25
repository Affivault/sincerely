import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import * as webhookService from '../services/webhook.service.js';
import { getPagination } from '../utils/pagination.js';

export const webhookController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const endpoints = await webhookService.listEndpoints(req.userId!);
      res.json(endpoints);
    } catch (err) { next(err); }
  },

  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const endpoint = await webhookService.getEndpoint(req.userId!, req.params.id);
      if (!endpoint) {
        res.status(404).json({ error: 'Endpoint not found' });
        return;
      }
      res.json(endpoint);
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const endpoint = await webhookService.createEndpoint(req.userId!, req.body);
      res.status(201).json(endpoint);
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const endpoint = await webhookService.updateEndpoint(req.userId!, req.params.id, req.body);
      res.json(endpoint);
    } catch (err) { next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await webhookService.deleteEndpoint(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async regenerateSecret(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const endpoint = await webhookService.regenerateSecret(req.userId!, req.params.id);
      res.json(endpoint);
    } catch (err) { next(err); }
  },

  async test(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await webhookService.testEndpoint(req.userId!, req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  },

  async deliveries(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const endpointId = req.query.endpoint_id as string | undefined;
      // Unlike every other list endpoint, this took the raw query param
      // straight through to the DB query with no bound — `limit=5000000`
      // forced an unbounded scan, and `limit=-1` (truthy, so `|| 50` never
      // kicked in) passed a negative limit straight to Supabase.
      const { limit } = getPagination({ limit: req.query.limit ? Number(req.query.limit) : 50 });
      const deliveries = await webhookService.getDeliveries(req.userId!, endpointId, limit);
      res.json(deliveries);
    } catch (err) { next(err); }
  },
};
