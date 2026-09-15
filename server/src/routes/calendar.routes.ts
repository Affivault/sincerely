import { Router } from 'express';
import { calendarController } from '../controllers/calendar.controller.js';

export const calendarRoutes = Router();

calendarRoutes.get('/types', calendarController.listTypes);
calendarRoutes.post('/types', calendarController.createType);
calendarRoutes.patch('/types/:id', calendarController.updateType);
calendarRoutes.delete('/types/:id', calendarController.archiveType);
