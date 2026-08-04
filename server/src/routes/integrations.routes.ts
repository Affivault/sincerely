import { Router } from 'express';
import { integrationsController } from '../controllers/integrations.controller.js';

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
