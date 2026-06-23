import { Router } from 'express';
import { campaignsController } from '../controllers/campaigns.controller.js';

export const campaignRoutes = Router();

// Campaign CRUD
campaignRoutes.get('/', campaignsController.list);
campaignRoutes.get('/:id', campaignsController.get);
campaignRoutes.post('/', campaignsController.create);
campaignRoutes.put('/:id', campaignsController.update);
campaignRoutes.delete('/:id', campaignsController.delete);

// Clone
campaignRoutes.post('/:id/clone', campaignsController.clone);

// Lifecycle
campaignRoutes.post('/:id/launch', campaignsController.launch);
campaignRoutes.post('/:id/pause', campaignsController.pause);
campaignRoutes.post('/:id/resume', campaignsController.resume);
campaignRoutes.post('/:id/cancel', campaignsController.cancel);
campaignRoutes.post('/:id/retry-errors', campaignsController.retryErrors);

// Steps
campaignRoutes.get('/:id/steps', campaignsController.getSteps);
campaignRoutes.post('/:id/steps', campaignsController.addStep);
campaignRoutes.put('/:id/steps/reorder', campaignsController.reorderSteps);
campaignRoutes.put('/:id/steps/:stepId', campaignsController.updateStep);
campaignRoutes.delete('/:id/steps/:stepId', campaignsController.deleteStep);

// Campaign contacts
campaignRoutes.get('/:id/contacts', campaignsController.getContacts);
campaignRoutes.post('/:id/contacts', campaignsController.addContacts);
campaignRoutes.delete('/:id/contacts', campaignsController.removeContacts);

// Test email
campaignRoutes.post('/:id/test-email', campaignsController.sendTest);

// Sender pool (rotation)
campaignRoutes.get('/:id/sender-pool', campaignsController.getSenderPool);
campaignRoutes.put('/:id/sender-pool', campaignsController.setSenderPool);
