import { Router } from 'express';
import { analyticsController } from '../controllers/analytics.controller.js';

export const analyticsRoutes = Router();

analyticsRoutes.get('/overview', analyticsController.overview);
analyticsRoutes.get('/deliverability', analyticsController.deliverability);
analyticsRoutes.get('/trend', analyticsController.trend);
analyticsRoutes.get('/export/overview', analyticsController.exportOverviewReport);
analyticsRoutes.get('/export/campaigns/:campaignId', analyticsController.exportCampaignReport);

// /campaigns must be registered BEFORE /:campaignId to prevent shadowing
analyticsRoutes.get('/campaigns', analyticsController.campaignList);
analyticsRoutes.get('/campaigns/:campaignId', analyticsController.campaign);
analyticsRoutes.get('/campaigns/:campaignId/trend', analyticsController.campaignTrend);
analyticsRoutes.get('/campaigns/:campaignId/contacts', analyticsController.campaignContacts);
analyticsRoutes.get('/campaigns/:campaignId/funnel', analyticsController.campaignFunnel);
analyticsRoutes.get('/campaigns/:campaignId/ab-test', analyticsController.campaignAbTest);
analyticsRoutes.get('/campaigns/:campaignId/heatmap', analyticsController.campaignHeatmap);

analyticsRoutes.get('/contacts/:contactId/timeline', analyticsController.contactTimeline);
