import { Router } from 'express';
import { adminOnly } from '../middleware/admin.middleware.js';
import { adminController } from '../controllers/admin.controller.js';

export const adminRoutes = Router();

// Every admin route sits behind the owner-only gate.
adminRoutes.use(adminOnly);

adminRoutes.get('/users', adminController.listUsers);
adminRoutes.get('/stats', adminController.stats);
adminRoutes.post('/grant-lifetime', adminController.grantLifetime);
adminRoutes.post('/revoke-lifetime', adminController.revokeLifetime);
