import { Router } from 'express';
import { leadsController } from '../controllers/leads.controller.js';

export const leadsRoutes = Router();

leadsRoutes.get('/', leadsController.list);
leadsRoutes.post('/', leadsController.create);
leadsRoutes.put('/:id', leadsController.update);
leadsRoutes.delete('/:id', leadsController.remove);
leadsRoutes.post('/:id/archive', leadsController.archive);
leadsRoutes.post('/:id/reopen', leadsController.reopen);
/* Qualifying a lead creates a deal, so it is a POST that returns both. */
leadsRoutes.post('/:id/convert', leadsController.convert);
