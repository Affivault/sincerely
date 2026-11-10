import { Router } from 'express';
import { integrationsController } from '../controllers/integrations.controller.js';
import { crmSyncController } from '../controllers/crm-sync.controller.js';

export const integrationsRoutes = Router();

integrationsRoutes.get('/', integrationsController.list);
// Which providers offer one-click OAuth (depends on server env config).
integrationsRoutes.get('/oauth-availability', integrationsController.oauthAvailability);
// Authorize URL for a one-click OAuth connect (browser then navigates there).
integrationsRoutes.get('/oauth-url/:provider', integrationsController.oauthUrl);
// Live resource lists (Notion databases, Airtable bases/tables) for pickers.
integrationsRoutes.post('/:provider/resources', integrationsController.resources);
// Connect (or reconnect) a provider — validates + live-tests before storing.
integrationsRoutes.post('/:provider/connect', integrationsController.connect);
integrationsRoutes.patch('/:id', integrationsController.update);
integrationsRoutes.delete('/:id', integrationsController.delete);
integrationsRoutes.post('/:id/test', integrationsController.test);
integrationsRoutes.get('/:id/activity', integrationsController.activity);

// Two-way HubSpot / Pipedrive sync: settings, live choices, status, log and retry, lists.
integrationsRoutes.get('/:id/sync', crmSyncController.overview);
integrationsRoutes.patch('/:id/sync', crmSyncController.updateSettings);
integrationsRoutes.get('/:id/sync/options', crmSyncController.options);
integrationsRoutes.post('/:id/sync/run', crmSyncController.run);
integrationsRoutes.get('/:id/sync/log', crmSyncController.log);
integrationsRoutes.post('/:id/sync/log/:logId/retry', crmSyncController.retry);
integrationsRoutes.post('/:id/sync/retry-failed', crmSyncController.retryAll);
integrationsRoutes.post('/:id/sync/lists', crmSyncController.addList);
integrationsRoutes.patch('/:id/sync/lists/:listSyncId', crmSyncController.updateList);
integrationsRoutes.delete('/:id/sync/lists/:listSyncId', crmSyncController.removeList);
integrationsRoutes.post('/:id/sync/lists/:listSyncId/run', crmSyncController.runList);
