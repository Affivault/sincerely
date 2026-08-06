import { Router } from 'express';
import { companiesController } from '../controllers/companies.controller.js';

export const companiesRoutes = Router();

companiesRoutes.get('/', companiesController.list);
companiesRoutes.post('/', companiesController.create);
companiesRoutes.post('/link-contact', companiesController.linkContact);
companiesRoutes.get('/:id/summary', companiesController.summary);
companiesRoutes.put('/:id', companiesController.update);
companiesRoutes.delete('/:id', companiesController.remove);
