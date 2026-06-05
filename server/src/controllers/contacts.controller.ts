import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { contactsService } from '../services/contacts.service.js';

export const contactsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await contactsService.list(req.userId!, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  },

  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const contact = await contactsService.get(req.userId!, req.params.id);
      res.json(contact);
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const contact = await contactsService.create(req.userId!, req.body);
      res.status(201).json(contact);
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const contact = await contactsService.update(req.userId!, req.params.id, req.body);
      res.json(contact);
    } catch (err) { next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await contactsService.delete(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async importCsv(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      let columnMapping: Record<string, string> = {};
      try {
        columnMapping = JSON.parse(req.body.columnMapping || '{}');
      } catch {
        res.status(400).json({ error: 'columnMapping must be valid JSON' });
        return;
      }
      const result = await contactsService.importCsv(req.userId!, file.path, columnMapping);
      res.json(result);
    } catch (err) { next(err); }
  },

  async bulkCreate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { contacts, list_id } = req.body || {};
      if (!Array.isArray(contacts)) {
        res.status(400).json({ error: 'Request body must include a contacts array' });
        return;
      }
      if (contacts.length === 0) {
        res.json({ total: 0, imported: 0, errors: 0, error_details: [] });
        return;
      }
      if (contacts.length > 1000) {
        res.status(413).json({ error: 'Batch too large — send at most 1000 contacts per request' });
        return;
      }
      const result = await contactsService.bulkCreate(req.userId!, contacts, list_id || undefined);
      res.json(result);
    } catch (err) { next(err); }
  },

  async bulkTag(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await contactsService.bulkTag(req.userId!, req.body.contact_ids, req.body.tag_ids);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async bulkUntag(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await contactsService.bulkUntag(req.userId!, req.body.contact_ids, req.body.tag_ids);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async bulkDelete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await contactsService.bulkDelete(req.userId!, req.body.contact_ids);
      res.json(result);
    } catch (err) { next(err); }
  },

  async export(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { contact_ids, format } = req.body;
      const result = await contactsService.export(req.userId!, contact_ids, format);

      if (result.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
        res.send(result.data);
      } else {
        res.json(result.data);
      }
    } catch (err) { next(err); }
  },

  async getStats(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const stats = await contactsService.getStats(req.userId!);
      res.json(stats);
    } catch (err) { next(err); }
  },
};
