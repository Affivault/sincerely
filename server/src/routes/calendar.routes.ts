import { Router } from 'express';
import { calendarController } from '../controllers/calendar.controller.js';

export const calendarRoutes = Router();

calendarRoutes.get('/types', calendarController.listTypes);
calendarRoutes.post('/types', calendarController.createType);
calendarRoutes.patch('/types/:id', calendarController.updateType);
calendarRoutes.delete('/types/:id', calendarController.archiveType);

// When you are free, and what may be offered from it.
calendarRoutes.get('/availability', calendarController.getAvailability);
calendarRoutes.put('/availability', calendarController.replaceAvailability);
calendarRoutes.patch('/availability/prefs', calendarController.updatePrefs);
calendarRoutes.get('/slots', calendarController.slots);

// Calendars kept elsewhere, so the page never offers a time already taken.
calendarRoutes.get('/connections', calendarController.listConnections);
calendarRoutes.get('/connections/authorize', calendarController.authorizeGoogle);
calendarRoutes.patch('/connections/:id', calendarController.updateConnection);
calendarRoutes.delete('/connections/:id', calendarController.disconnect);
