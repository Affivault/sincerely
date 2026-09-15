import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { calendarService } from '../services/calendar.service.js';

export const calendarController = {
  /** Every kind of meeting this account uses, seeded on first read. */
  async listTypes(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await calendarService.listTypes(req.userId!));
    } catch (err) { next(err); }
  },

  async createType(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.status(201).json(await calendarService.createType(req.userId!, req.body || {}));
    } catch (err) { next(err); }
  },

  async updateType(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await calendarService.updateType(req.userId!, req.params.id, req.body || {}));
    } catch (err) { next(err); }
  },

  /** Retired, not deleted — events already point at it. */
  async archiveType(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await calendarService.archiveType(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },
};
