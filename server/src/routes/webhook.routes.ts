import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller.js';

export const webhookRoutes = Router();

// Endpoint CRUD
webhookRoutes.get('/endpoints', webhookController.list);
webhookRoutes.get('/endpoints/:id', webhookController.get);
webhookRoutes.post('/endpoints', webhookController.create);
webhookRoutes.put('/endpoints/:id', webhookController.update);
webhookRoutes.delete('/endpoints/:id', webhookController.delete);

// Test endpoint
webhookRoutes.post('/endpoints/:id/test', webhookController.test);

// Rotate signing secret (shown once in the response)
webhookRoutes.post('/endpoints/:id/regenerate-secret', webhookController.regenerateSecret);

// Delivery logs
webhookRoutes.get('/deliveries', webhookController.deliveries);
webhookRoutes.post('/deliveries/:id/redeliver', webhookController.redeliver);
