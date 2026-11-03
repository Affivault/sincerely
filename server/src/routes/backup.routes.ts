import { Router } from 'express';
import { backupController } from '../controllers/backup.controller.js';

export const backupRoutes = Router();

backupRoutes.get('/', backupController.status);
backupRoutes.get('/authorize', backupController.authorize);
backupRoutes.post('/enabled', backupController.setEnabled);
backupRoutes.post('/now', backupController.backupNow);
backupRoutes.delete('/', backupController.disconnect);
