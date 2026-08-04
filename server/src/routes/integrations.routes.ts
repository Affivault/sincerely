import { Router } from 'express';
import { integrationsController } from '../controllers/integrations.controller.js';

export const integrationsRoutes = Router();

integrationsRoutes.get('/', integrationsController.list);
// Connect (or reconnect) a provider — validates + live-tests before storing.
integrationsRoutes.post('/:provider/connect', integrationsController.connect);
integrationsRoutes.patch('/:id', integrationsController.update);
integrationsRoutes.delete('/:id', integrationsController.delete);
integrationsRoutes.post('/:id/test', integrationsController.test);
integrationsRoutes.get('/:id/activity', integrationsController.activity);
