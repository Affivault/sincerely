import { Router } from 'express';
import { adminOnly } from '../middleware/admin.middleware.js';
import { jwtOnly } from '../middleware/apikey.middleware.js';
import { adminController } from '../controllers/admin.controller.js';

export const adminRoutes = Router();

// Every admin route sits behind the owner-only gate (checked first so a
// non-admin caller gets an existence-hiding 404, not a 403). Since these
// endpoints can dump every account's email/plan or grant lifetime access,
// jwtOnly follows: an API key must never reach them, even one minted by the
// admin account itself.
adminRoutes.use(adminOnly);
adminRoutes.use(jwtOnly);

adminRoutes.get('/users', adminController.listUsers);
adminRoutes.get('/stats', adminController.stats);
adminRoutes.get('/usage', adminController.usage);
adminRoutes.get('/health', adminController.health);
adminRoutes.post('/sync', adminController.sync);
adminRoutes.post('/grant-lifetime', adminController.grantLifetime);
adminRoutes.post('/revoke-lifetime', adminController.revokeLifetime);

adminRoutes.get('/accounts', adminController.accounts);
adminRoutes.get('/accounts/:id', adminController.account);
adminRoutes.post('/accounts/:id/plan', adminController.setPlan);
adminRoutes.post('/accounts/:id/stripe-sync', adminController.syncStripe);
adminRoutes.post('/accounts/:id/allowance', adminController.setAllowance);
adminRoutes.post('/accounts/:id/credits', adminController.adjustCredits);
adminRoutes.post('/accounts/:id/suspend', adminController.suspend);
adminRoutes.post('/accounts/:id/unsuspend', adminController.unsuspend);
adminRoutes.post('/accounts/:id/note', adminController.setNote);
adminRoutes.get('/audit', adminController.audit);
