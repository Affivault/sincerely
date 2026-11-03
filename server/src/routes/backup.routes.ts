import { Router } from 'express';
import { backupController } from '../controllers/backup.controller.js';

export const backupRoutes = Router();

backupRoutes.get('/', backupController.status);
backupRoutes.get('/authorize', backupController.authorize);
backupRoutes.post('/enabled', backupController.setEnabled);
backupRoutes.post('/now', backupController.backupNow);
backupRoutes.delete('/', backupController.disconnect);

// OneDrive, Dropbox and S3-compatible storage (migration 113).
backupRoutes.get('/files', backupController.filesStatus);
backupRoutes.post('/files/s3', backupController.filesSaveS3);
backupRoutes.get('/files/:provider/authorize', backupController.filesAuthorize);
backupRoutes.patch('/files/:provider', backupController.filesUpdate);
backupRoutes.post('/files/:provider/now', backupController.filesNow);
backupRoutes.delete('/files/:provider', backupController.filesDisconnect);
