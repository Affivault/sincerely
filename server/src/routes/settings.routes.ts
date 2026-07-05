import { Router } from 'express';
import { settingsController } from '../controllers/settings.controller.js';
import { jwtOnly } from '../middleware/apikey.middleware.js';

export const settingsRoutes = Router();

settingsRoutes.get('/', settingsController.get);
settingsRoutes.put('/', settingsController.update);
// Account-security actions: never reachable via API key, even a full-scope one.
settingsRoutes.post('/change-password', jwtOnly, settingsController.changePassword);
settingsRoutes.post('/delete-account', jwtOnly, settingsController.deleteAccount);
