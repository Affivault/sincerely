import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { apiKeyMiddleware } from '../middleware/apikey.middleware.js';
import { contactRoutes } from './contact.routes.js';
import { tagRoutes } from './tag.routes.js';
import { listsRoutes } from './lists.routes.js';
import { segmentsRoutes } from './segments.routes.js';
import { campaignRoutes } from './campaign.routes.js';
import { smtpRoutes } from './smtp.routes.js';
import { analyticsRoutes } from './analytics.routes.js';
import { inboxRoutes } from './inbox.routes.js';
import { sseRoutes } from './sse.routes.js';
import { saraRoutes } from './sara.routes.js';
import { assetRoutes } from './asset.routes.js';
import { verificationRoutes } from './verification.routes.js';
import { webhookRoutes } from './webhook.routes.js';
import { apikeyRoutes } from './apikey.routes.js';
import { domainRoutes } from './domain.routes.js';
import { templateRoutes } from './template.routes.js';
import { settingsRoutes } from './settings.routes.js';
import { suppressionRoutes } from './suppression.routes.js';
import { teamRoutes } from './team.routes.js';
import { campaignFoldersRoutes } from './campaign-folders.routes.js';
import { listFoldersRoutes } from './list-folders.routes.js';
import { sendingSchedulesRoutes } from './sending-schedules.routes.js';
import { billingRoutes } from './billing.routes.js';

export const routes = Router();

// API key middleware runs first - if request has sk_live_ token, it handles auth.
// Otherwise passes through to JWT auth middleware.
routes.use(apiKeyMiddleware);
routes.use(authMiddleware);

routes.use('/contacts', contactRoutes);
routes.use('/tags', tagRoutes);
routes.use('/lists', listsRoutes);
routes.use('/segments', segmentsRoutes);
routes.use('/campaigns', campaignRoutes);
routes.use('/smtp-accounts', smtpRoutes);
routes.use('/analytics', analyticsRoutes);
routes.use('/inbox', inboxRoutes);
routes.use('/sse', sseRoutes);
routes.use('/sara', saraRoutes);
routes.use('/assets', assetRoutes);
routes.use('/verification', verificationRoutes);
routes.use('/webhooks', webhookRoutes);
routes.use('/api-keys', apikeyRoutes);
routes.use('/domains', domainRoutes);
routes.use('/templates', templateRoutes);
routes.use('/settings', settingsRoutes);
routes.use('/suppression', suppressionRoutes);
routes.use('/team', teamRoutes);
routes.use('/campaign-folders', campaignFoldersRoutes);
routes.use('/list-folders', listFoldersRoutes);
routes.use('/sending-schedules', sendingSchedulesRoutes);
routes.use('/billing', billingRoutes);
