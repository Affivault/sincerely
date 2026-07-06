import { Router } from 'express';
import { crmController } from '../controllers/crm.controller.js';

export const crmRoutes = Router();

// Deals
crmRoutes.get('/deals', crmController.listDeals);
crmRoutes.post('/deals', crmController.createDeal);
crmRoutes.put('/deals/:id', crmController.updateDeal);
crmRoutes.delete('/deals/:id', crmController.deleteDeal);

// Tasks
crmRoutes.get('/tasks', crmController.listTasks);
crmRoutes.post('/tasks', crmController.createTask);
crmRoutes.put('/tasks/:id', crmController.updateTask);
crmRoutes.delete('/tasks/:id', crmController.deleteTask);

// Events (calendar)
crmRoutes.get('/events', crmController.listEvents);
crmRoutes.post('/events', crmController.createEvent);
crmRoutes.put('/events/:id', crmController.updateEvent);
crmRoutes.delete('/events/:id', crmController.deleteEvent);
