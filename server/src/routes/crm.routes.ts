import { Router } from 'express';
import { crmController } from '../controllers/crm.controller.js';

export const crmRoutes = Router();

// Deals
crmRoutes.get('/deals', crmController.listDeals);
crmRoutes.post('/deals', crmController.createDeal);
crmRoutes.put('/deals/:id', crmController.updateDeal);
crmRoutes.delete('/deals/:id', crmController.deleteDeal);
crmRoutes.get('/deals/:id/history', crmController.dealStageHistory);
crmRoutes.get('/deals/:id/detail', crmController.dealDetail);
crmRoutes.get('/deals/:id/participants', crmController.listParticipants);
crmRoutes.post('/deals/:id/participants', crmController.addParticipant);
crmRoutes.put('/deals/:id/participants/:participantId', crmController.updateParticipant);
crmRoutes.delete('/deals/:id/participants/:participantId', crmController.removeParticipant);

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

// Notes
crmRoutes.get('/notes', crmController.listNotes);
crmRoutes.post('/notes', crmController.createNote);
crmRoutes.put('/notes/:id', crmController.updateNote);
crmRoutes.delete('/notes/:id', crmController.deleteNote);

// Everything CRM holds about one contact, in one request
crmRoutes.get('/contact/:contactId/summary', crmController.contactSummary);
