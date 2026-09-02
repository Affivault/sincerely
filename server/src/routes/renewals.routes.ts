import { Router } from 'express';
import { renewalsController } from '../controllers/renewals.controller.js';

export const renewalsRoutes = Router();

// Static routes first, so none of them is ever read as a deal id.
renewalsRoutes.get('/', renewalsController.list);
renewalsRoutes.get('/summary', renewalsController.summary);
renewalsRoutes.post('/run-triggers', renewalsController.runTriggers);

renewalsRoutes.patch('/:id', renewalsController.update);
renewalsRoutes.get('/:id/activity', renewalsController.activity);
renewalsRoutes.post('/:id/renewed', renewalsController.markRenewed);
renewalsRoutes.post('/:id/churned', renewalsController.markChurned);
