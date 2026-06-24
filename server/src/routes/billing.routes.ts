import { Router } from 'express';
import { billingController } from '../controllers/billing.controller.js';

export const billingRoutes = Router();

billingRoutes.get('/usage', billingController.usage);
