import { Router } from 'express';
import { domainController } from '../controllers/domain.controller.js';

export const domainRoutes = Router();

domainRoutes.get('/', domainController.list);
domainRoutes.get('/:id', domainController.get);
domainRoutes.post('/', domainController.create);
domainRoutes.delete('/:id', domainController.delete);
domainRoutes.post('/:id/verify', domainController.verify);
domainRoutes.get('/:id/records', domainController.getRecords);
// DNS cannot be asked which DKIM selectors exist, so the account may say.
domainRoutes.put('/:id/dkim-selector', domainController.setDkimSelector);
