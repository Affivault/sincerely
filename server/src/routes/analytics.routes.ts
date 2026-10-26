import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { stepOutcomes } from '../services/step-outcomes.service.js';
import { analyticsController } from '../controllers/analytics.controller.js';
import { comparisonService } from '../services/comparison.service.js';

export const analyticsRoutes = Router();

analyticsRoutes.get('/overview', analyticsController.overview);
// What each campaign earned, not just what it sent.
analyticsRoutes.get('/revenue', analyticsController.revenue);
// One campaign, sent to banked, and which step earned it.
analyticsRoutes.get('/revenue/:id', analyticsController.campaignRevenue);
analyticsRoutes.get('/deliverability', analyticsController.deliverability);
analyticsRoutes.get('/trend', analyticsController.trend);
analyticsRoutes.get('/export/overview', analyticsController.exportOverviewReport);
analyticsRoutes.get('/export/campaigns/:campaignId', analyticsController.exportCampaignReport);

// Two to four campaigns side by side: ?ids=a,b,c
analyticsRoutes.get('/compare', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await comparisonService.campaigns(req.userId!, req.query.ids)); } catch (err) { next(err); }
});
// Results by the mailbox that sent them and by its domain: ?from=YYYY-MM-DD&to=YYYY-MM-DD
analyticsRoutes.get('/by-sender', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await comparisonService.bySender(req.userId!, req.query.from, req.query.to)); } catch (err) { next(err); }
});

// /campaigns must be registered BEFORE /:campaignId to prevent shadowing
analyticsRoutes.get('/campaigns', analyticsController.campaignList);
analyticsRoutes.get('/campaigns/:campaignId', analyticsController.campaign);
analyticsRoutes.get('/campaigns/:campaignId/trend', analyticsController.campaignTrend);
analyticsRoutes.get('/campaigns/:campaignId/contacts', analyticsController.campaignContacts);
analyticsRoutes.get('/campaigns/:campaignId/funnel', analyticsController.campaignFunnel);
analyticsRoutes.get('/campaigns/:campaignId/steps', analyticsController.sequencePerformance);
// Meetings and money per hundred emails, per step and per A/B arm.
analyticsRoutes.get('/campaigns/:campaignId/outcomes', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await stepOutcomes(req.userId!, req.params.campaignId)); } catch (err) { next(err); }
});
analyticsRoutes.get('/campaigns/:campaignId/ab-test', analyticsController.campaignAbTest);
analyticsRoutes.get('/campaigns/:campaignId/heatmap', analyticsController.campaignHeatmap);

analyticsRoutes.get('/contacts/:contactId/timeline', analyticsController.contactTimeline);
