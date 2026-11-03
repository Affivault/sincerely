import { Router } from 'express';
import { importsController } from '../controllers/imports.controller.js';

export const importsRoutes = Router();

// Google Sheets syncs. Before '/:id'.
importsRoutes.post('/sheets/preview', importsController.sheetPreview);
importsRoutes.get('/sheets', importsController.sheetList);
importsRoutes.post('/sheets', importsController.sheetCreate);
importsRoutes.patch('/sheets/:id', importsController.sheetUpdate);
importsRoutes.post('/sheets/:id/run', importsController.sheetRun);
importsRoutes.delete('/sheets/:id', importsController.sheetDelete);

// Import history.
importsRoutes.get('/', importsController.list);
importsRoutes.post('/', importsController.start);
importsRoutes.post('/:id/finish', importsController.finish);
importsRoutes.post('/:id/undo', importsController.undo);
