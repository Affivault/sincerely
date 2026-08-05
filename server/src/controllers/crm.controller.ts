import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { crmService } from '../services/crm.service.js';

export const crmController = {
  // Deals
  async listDeals(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const contactId = typeof req.query.contact_id === 'string' ? req.query.contact_id : undefined;
      const contactEmail = typeof req.query.contact_email === 'string' ? req.query.contact_email : undefined;
      res.json(await crmService.listDeals(req.userId!, { contactId, contactEmail }));
    } catch (err) { next(err); }
  },
  async createDeal(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await crmService.createDeal(req.userId!, req.body)); } catch (err) { next(err); }
  },
  async updateDeal(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.updateDeal(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },
  async deleteDeal(req: AuthRequest, res: Response, next: NextFunction) {
    try { await crmService.deleteDeal(req.userId!, req.params.id); res.status(204).send(); } catch (err) { next(err); }
  },

  // Tasks
  async listTasks(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const contactId = typeof req.query.contact_id === 'string' ? req.query.contact_id : undefined;
      const dealId = typeof req.query.deal_id === 'string' ? req.query.deal_id : undefined;
      res.json(await crmService.listTasks(req.userId!, { contactId, dealId }));
    } catch (err) { next(err); }
  },
  async createTask(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await crmService.createTask(req.userId!, req.body)); } catch (err) { next(err); }
  },
  async updateTask(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.updateTask(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },
  async deleteTask(req: AuthRequest, res: Response, next: NextFunction) {
    try { await crmService.deleteTask(req.userId!, req.params.id); res.status(204).send(); } catch (err) { next(err); }
  },

  // Events
  async listEvents(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const contactId = typeof req.query.contact_id === 'string' ? req.query.contact_id : undefined;
      const dealId = typeof req.query.deal_id === 'string' ? req.query.deal_id : undefined;
      res.json(await crmService.listEvents(req.userId!, from, to, { contactId, dealId }));
    } catch (err) { next(err); }
  },
  async createEvent(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await crmService.createEvent(req.userId!, req.body)); } catch (err) { next(err); }
  },
  async updateEvent(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.updateEvent(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },
  async deleteEvent(req: AuthRequest, res: Response, next: NextFunction) {
    try { await crmService.deleteEvent(req.userId!, req.params.id); res.status(204).send(); } catch (err) { next(err); }
  },

  /* ── Notes ── */
  async listNotes(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const contactId = typeof req.query.contact_id === 'string' ? req.query.contact_id : undefined;
      const dealId = typeof req.query.deal_id === 'string' ? req.query.deal_id : undefined;
      res.json(await crmService.listNotes(req.userId!, { contactId, dealId }));
    } catch (err) { next(err); }
  },

  async createNote(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await crmService.createNote(req.userId!, req.body)); } catch (err) { next(err); }
  },

  async updateNote(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.updateNote(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },

  async deleteNote(req: AuthRequest, res: Response, next: NextFunction) {
    try { await crmService.deleteNote(req.userId!, req.params.id); res.status(204).send(); } catch (err) { next(err); }
  },

  /** Everything CRM knows about one contact, for the profile page. */
  async contactSummary(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.contactSummary(req.userId!, req.params.contactId)); } catch (err) { next(err); }
  },
};
