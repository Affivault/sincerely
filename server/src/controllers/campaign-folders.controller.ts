import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { campaignFoldersService } from '../services/campaign-folders.service.js';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().optional(),
  icon: z.string().optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  position: z.number().int().optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

const moveSchema = z.object({
  campaign_id: z.string().uuid(),
  folder_id: z.string().uuid().nullable(),
});

export const campaignFoldersController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await campaignFoldersService.list(req.userId!);
      res.json(data);
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const input = createSchema.parse(req.body);
      const data = await campaignFoldersService.create(req.userId!, input);
      res.status(201).json(data);
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const input = updateSchema.parse(req.body);
      const data = await campaignFoldersService.update(req.userId!, req.params.id, input);
      res.json(data);
    } catch (err) { next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await campaignFoldersService.delete(req.userId!, req.params.id);
      res.status(204).end();
    } catch (err) { next(err); }
  },

  async moveCampaign(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const input = moveSchema.parse(req.body);
      await campaignFoldersService.moveCampaign(req.userId!, input.campaign_id, input.folder_id);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async folderAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await campaignFoldersService.folderAnalytics(req.userId!, req.params.id);
      res.json(data);
    } catch (err) { next(err); }
  },
};
