import { Router } from 'express';
import { billingController } from '../controllers/billing.controller.js';
import { jwtOnly } from '../middleware/apikey.middleware.js';

export const billingRoutes = Router();

billingRoutes.get('/usage', billingController.usage);
// Checkout/portal mint live Stripe sessions (portal lets the caller change
// payment method, view invoices, cancel the subscription) — user-session only.
billingRoutes.post('/checkout', jwtOnly, billingController.checkout);
billingRoutes.post('/refresh', billingController.refresh);
billingRoutes.post('/portal', jwtOnly, billingController.portal);
