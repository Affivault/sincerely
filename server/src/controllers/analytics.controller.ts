import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { analyticsService } from '../services/analytics.service.js';

export const analyticsController = {
  async overview(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : undefined;
      const data = await analyticsService.overview(req.userId!, days);
      res.json(data);
    } catch (err) { next(err); }
  },

  async trend(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      const data = await analyticsService.trend(req.userId!, days);
      res.json(data);
    } catch (err) { next(err); }
  },

  async campaignList(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.campaignList(req.userId!);
      res.json(data);
    } catch (err) { next(err); }
  },

  async campaign(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.campaign(req.userId!, req.params.campaignId);
      res.json(data);
    } catch (err) { next(err); }
  },

  async campaignContacts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.campaignContacts(req.userId!, req.params.campaignId);
      res.json(data);
    } catch (err) { next(err); }
  },

  async campaignFunnel(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.campaignFunnel(req.userId!, req.params.campaignId);
      res.json(data);
    } catch (err) { next(err); }
  },

  async campaignAbTest(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.campaignAbTest(req.userId!, req.params.campaignId);
      res.json(data);
    } catch (err) { next(err); }
  },

  async campaignTrend(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 14;
      const data = await analyticsService.campaignTrend(req.userId!, req.params.campaignId, days);
      res.json(data);
    } catch (err) { next(err); }
  },

  async campaignHeatmap(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.campaignHeatmap(req.userId!, req.params.campaignId);
      res.json(data);
    } catch (err) { next(err); }
  },

  async exportCampaignReport(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const csv = await analyticsService.exportCampaignReport(req.userId!, req.params.campaignId);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="campaign-report-${req.params.campaignId}.csv"`);
      res.send(csv);
    } catch (err) { next(err); }
  },

  async exportOverviewReport(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : undefined;
      const csv = await analyticsService.exportOverviewReport(req.userId!, days);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="overview-report.csv"');
      res.send(csv);
    } catch (err) { next(err); }
  },

  async contactTimeline(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.contactTimeline(req.userId!, req.params.contactId);
      res.json(data);
    } catch (err) { next(err); }
  },

  async deliverability(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.deliverability(req.userId!);
      res.json(data);
    } catch (err) { next(err); }
  },
};
