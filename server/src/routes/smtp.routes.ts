import { Router } from 'express';
import { smtpController } from '../controllers/smtp.controller.js';

export const smtpRoutes = Router();

smtpRoutes.get('/', smtpController.list);
smtpRoutes.get('/:id', smtpController.get);
smtpRoutes.post('/', smtpController.create);
smtpRoutes.put('/:id', smtpController.update);
smtpRoutes.delete('/:id', smtpController.delete);
smtpRoutes.post('/verify', smtpController.verify);
smtpRoutes.post('/:id/test', smtpController.test);
smtpRoutes.post('/:id/send-test', smtpController.sendTestEmail);
smtpRoutes.post('/check-domain', smtpController.checkDomain);
