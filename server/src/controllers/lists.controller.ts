import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { listsService } from '../services/lists.service.js';

export const listsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Anything that is not one of the two kinds is ignored rather than
      // rejected, so a stale bookmark shows both rather than an error.
      const raw = req.query.kind;
      const kind = raw === 'lead' || raw === 'contact' ? raw : undefined;
      const lists = await listsService.list(req.userId!, kind);
      res.json(lists);
    } catch (err) { next(err); }
  },

  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const list = await listsService.get(req.userId!, req.params.id);
      res.json(list);
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const list = await listsService.create(req.userId!, req.body);
      res.status(201).json(list);
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const list = await listsService.update(req.userId!, req.params.id, req.body);
      res.json(list);
    } catch (err) { next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await listsService.delete(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async addContacts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await listsService.addContacts(req.userId!, req.params.id, req.body.contact_ids);
      res.json(result);
    } catch (err) { next(err); }
  },

  async removeContacts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await listsService.removeContacts(req.userId!, req.params.id, req.body.contact_ids);
      res.json(result);
    } catch (err) { next(err); }
  },

  async getContacts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const contactIds = await listsService.getContactsInList(req.userId!, req.params.id);
      res.json({ contact_ids: contactIds });
    } catch (err) { next(err); }
  },

  async getListsForContact(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const lists = await listsService.getListsForContact(req.userId!, req.params.contactId);
      res.json(lists);
    } catch (err) { next(err); }
  },

  async moveContact(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { contact_id, from_list_id, to_list_id } = req.body;
      if (!contact_id || !from_list_id || !to_list_id) {
        return res.status(400).json({ error: 'contact_id, from_list_id, and to_list_id are required' });
      }
      const result = await listsService.moveContact(req.userId!, contact_id, from_list_id, to_list_id);
      res.json(result);
    } catch (err) { next(err); }
  },
};
