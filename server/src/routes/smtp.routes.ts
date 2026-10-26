import { Router } from 'express';
import { smtpController } from '../controllers/smtp.controller.js';

export const smtpRoutes = Router();

// Static/specific paths must precede the '/:id' matchers so they aren't
// captured as an account id.
smtpRoutes.get('/', smtpController.list);
smtpRoutes.get('/warmup', smtpController.warmupSummary);
smtpRoutes.get('/health', smtpController.health);
// One sending pace on many mailboxes; a POST so '/:id' never sees it.
smtpRoutes.post('/pace', smtpController.applyPace);
smtpRoutes.post('/verify', smtpController.verify);
smtpRoutes.post('/check-domain', smtpController.checkDomain);
smtpRoutes.post('/diagnose', smtpController.diagnose);
// Correcting a mail server address the app itself filled in wrongly.
smtpRoutes.post('/repair-hosts', smtpController.repairHosts);
smtpRoutes.post('/', smtpController.create);

smtpRoutes.get('/:id', smtpController.get);
smtpRoutes.put('/:id', smtpController.update);
smtpRoutes.delete('/:id', smtpController.delete);
smtpRoutes.post('/:id/warmup', smtpController.setWarmup);
smtpRoutes.post('/:id/test', smtpController.test);
smtpRoutes.post('/:id/send-test', smtpController.sendTestEmail);
