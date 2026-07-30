import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import * as apikeyService from '../services/apikey.service.js';

export const apikeyController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const keys = await apikeyService.listKeys(req.userId!);
      res.json(keys);
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { name, scopes, rate_limit, expires_at } = req.body;
      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const result = await apikeyService.createKey(req.userId!, {
        name,
        scopes,
        rate_limit,
        expires_at,
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  },

  async rotate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await apikeyService.rotateKey(req.userId!, req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  },

  async revoke(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await apikeyService.revokeKey(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await apikeyService.deleteKey(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },
};
