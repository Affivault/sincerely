import { Router } from 'express';
import multer from 'multer';
import { contactsController } from '../controllers/contacts.controller.js';

// Cap CSV uploads so a single request can't exhaust memory/disk or tie up
// the DB with an unbounded number of sequential per-row upserts.
const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

export const contactRoutes = Router();

contactRoutes.get('/', contactsController.list);
/* Before any '/:id' route, or "lifecycle-counts" is read as a contact id. */
contactRoutes.get('/lifecycle-counts', contactsController.lifecycleCounts);
contactRoutes.get('/stats', contactsController.getStats);
contactRoutes.get('/verification-breakdown', contactsController.verificationBreakdown);
contactRoutes.get('/companies', contactsController.companies);
// Possible duplicates across the account, and merging them (096).
contactRoutes.get('/duplicates', contactsController.duplicates);
contactRoutes.post('/duplicates/dismiss', contactsController.dismissDuplicate);
contactRoutes.post('/merge', contactsController.merge);
// Saved filters on the contacts and leads pages (096).
contactRoutes.get('/views', contactsController.listViews);
contactRoutes.post('/views', contactsController.createView);
contactRoutes.put('/views/:id', contactsController.updateView);
contactRoutes.delete('/views/:id', contactsController.deleteView);
contactRoutes.get('/:id', contactsController.get);
// Which campaigns is this contact enrolled in, and where in each sequence?
contactRoutes.get('/:id/campaigns', contactsController.campaignsForContact);
contactRoutes.get('/:id/duplicates', contactsController.duplicatesFor);
// The 0-100 score, recounted live, with what it is made of.
contactRoutes.get('/:id/engagement', contactsController.engagement);
contactRoutes.post('/', contactsController.create);
contactRoutes.put('/:id', contactsController.update);
contactRoutes.delete('/:id', contactsController.delete);
contactRoutes.post('/import', upload.single('file'), contactsController.importCsv);
contactRoutes.post('/bulk', contactsController.bulkCreate);
contactRoutes.post('/export', contactsController.export);
contactRoutes.post('/bulk-tag', contactsController.bulkTag);
contactRoutes.delete('/bulk-tag', contactsController.bulkUntag);
contactRoutes.post('/bulk-delete', contactsController.bulkDelete);
contactRoutes.post('/lifecycle', contactsController.setLifecycle);
contactRoutes.post('/bulk-edit', contactsController.bulkEdit);
