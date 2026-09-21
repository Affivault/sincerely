import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { segmentRevenueService } from '../services/segment-revenue.service.js';
import { DIMENSION_LABELS, type SegmentDimension } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   What the people who buy have in common.
   ═══════════════════════════════════════════════════════════════════════ */

export const segmentRevenueRoutes = Router();

const DIMENSIONS = Object.keys(DIMENSION_LABELS) as SegmentDimension[];

segmentRevenueRoutes.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dimension = String(req.query.dimension || 'industry') as SegmentDimension;
    if (!DIMENSIONS.includes(dimension)) {
      return res.status(400).json({ error: `dimension must be one of: ${DIMENSIONS.join(', ')}` });
    }
    const campaignId = req.query.campaign_id ? String(req.query.campaign_id) : null;
    res.json(await segmentRevenueService.report(req.userId!, dimension, campaignId));
  } catch (err) { next(err); }
});
