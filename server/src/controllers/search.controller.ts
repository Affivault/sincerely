import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { searchService } from '../services/search.service.js';

export const searchController = {
  /** GET /search?q= — every object type the user owns, in one request. */
  async search(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      res.json(await searchService.search(req.userId!, q));
    } catch (err) { next(err); }
  },
};
