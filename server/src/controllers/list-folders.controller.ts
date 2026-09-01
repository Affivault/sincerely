import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { listFoldersService } from '../services/list-folders.service.js';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().optional(),
  icon: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  position: z.number().int().optional(),
});

const moveSchema = z.object({
  list_id: z.string().uuid(),
  folder_id: z.string().uuid().nullable(),
});

export const listFoldersController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const raw = req.query.kind;
      const kind = raw === 'lead' || raw === 'contact' ? raw : undefined;
      const data = await listFoldersService.list(req.userId!, kind);
      res.json(data);
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const input = createSchema.parse(req.body);
      const data = await listFoldersService.create(req.userId!, input);
      res.status(201).json(data);
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const input = updateSchema.parse(req.body);
      const data = await listFoldersService.update(req.userId!, req.params.id, input);
      res.json(data);
    } catch (err) { next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await listFoldersService.delete(req.userId!, req.params.id);
      res.status(204).end();
    } catch (err) { next(err); }
  },

  async moveList(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const input = moveSchema.parse(req.body);
      await listFoldersService.moveList(req.userId!, input.list_id, input.folder_id);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async trashList(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await listFoldersService.trashList(req.userId!, req.params.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async restoreList(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await listFoldersService.restoreList(req.userId!, req.params.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async listTrashed(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await listFoldersService.listTrashed(req.userId!);
      res.json(data);
    } catch (err) { next(err); }
  },
};
