import { Router } from 'express';
import multer from 'multer';
import { contactsController } from '../controllers/contacts.controller.js';

// Cap CSV uploads so a single request can't exhaust memory/disk or tie up
// the DB with an unbounded number of sequential per-row upserts.
const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

export const contactRoutes = Router();

contactRoutes.get('/', contactsController.list);
contactRoutes.get('/stats', contactsController.getStats);
contactRoutes.get('/verification-breakdown', contactsController.verificationBreakdown);
contactRoutes.get('/companies', contactsController.companies);
contactRoutes.get('/:id', contactsController.get);
contactRoutes.post('/', contactsController.create);
contactRoutes.put('/:id', contactsController.update);
contactRoutes.delete('/:id', contactsController.delete);
contactRoutes.post('/import', upload.single('file'), contactsController.importCsv);
contactRoutes.post('/bulk', contactsController.bulkCreate);
contactRoutes.post('/export', contactsController.export);
contactRoutes.post('/bulk-tag', contactsController.bulkTag);
contactRoutes.delete('/bulk-tag', contactsController.bulkUntag);
contactRoutes.post('/bulk-delete', contactsController.bulkDelete);
