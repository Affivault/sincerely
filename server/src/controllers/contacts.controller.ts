import fs from 'node:fs';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { contactsService } from '../services/contacts.service.js';
import { importEmailFinder } from '../services/import-email-finder.service.js';
import { creditsService } from '../services/credits.service.js';
import { contactHygieneService } from '../services/contact-hygiene.service.js';
import { engagementService } from '../services/engagement.service.js';
import { contactEnrichmentService } from '../services/contact-enrichment.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A malformed :id is the caller's mistake, so it is a 400 - left to
 * Postgres it came back as "invalid input syntax for type uuid", a 500.
 */
function badId(req: AuthRequest, res: Response): boolean {
  if (UUID_RE.test(String(req.params.id || ''))) return false;
  res.status(400).json({ error: 'Contact id must be a UUID' });
  return true;
}

export const contactsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await contactsService.list(req.userId!, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  },

  async lifecycleCounts(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await contactsService.lifecycleCounts(req.userId!)); } catch (err) { next(err); }
  },

  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      const contact = await contactsService.get(req.userId!, req.params.id);
      res.json(contact);
    } catch (err) { next(err); }
  },

  async campaignsForContact(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      const campaigns = await contactsService.getCampaignsForContact(req.userId!, req.params.id);
      res.json(campaigns);
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
      if (badId(req, res)) return;
      const contact = await contactsService.update(req.userId!, req.params.id, req.body);
      res.json(contact);
    } catch (err) { next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
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
        const parsed = JSON.parse(req.body.columnMapping || '{}');
        // "null", "[]" or "5" are valid JSON but not a mapping; Object.entries
        // on null would throw a 500 mid-import.
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        columnMapping = parsed;
      } catch {
        // Multer already wrote the upload to disk before this handler ran;
        // the service's own cleanup never runs on this early-return path,
        // so without this the temp file is orphaned permanently.
        fs.unlink(file.path, () => {});
        res.status(400).json({ error: 'columnMapping must be a valid JSON object' });
        return;
      }
      const result = await contactsService.importCsv(req.userId!, file.path, columnMapping);
      res.json(result);
    } catch (err) { next(err); }
  },

  async bulkCreate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { contacts, list_id, import_source, context, mode, tag_ids } = req.body || {};
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
      const result = await contactsService.bulkCreate(
        req.userId!, contacts, list_id || undefined, import_source || undefined,
        context === 'contacts' ? 'contacts' : undefined,
        {
          mode: typeof mode === 'string' ? (mode as any) : undefined,
          tagIds: Array.isArray(tag_ids) ? tag_ids.filter((t: unknown) => typeof t === 'string') : undefined,
        },
      );
      res.json(result);
    } catch (err) { next(err); }
  },

  /** Before an import: how many of these addresses exist, how many are suppressed, and can missing emails be searched for. */
  async importPreflight(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const emails = Array.isArray(req.body?.emails) ? req.body.emails : [];
      if (emails.length > 50_000) {
        res.status(413).json({ error: 'At most 50,000 addresses per check' });
        return;
      }
      const counts = await contactsService.importPreflight(req.userId!, emails);
      res.json({ ...counts, finder: importEmailFinder.paidAvailable() });
    } catch (err) { next(err); }
  },

  /** Find addresses for imported rows that have a name and a company but no email. */
  async importFindEmails(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const people = Array.isArray(req.body?.people) ? req.body.people : [];
      if (people.length > 25) {
        res.status(413).json({ error: 'At most 25 people per request' });
        return;
      }
      const clean = people
        .filter((p: any) => p && typeof p === 'object' && (typeof p.key === 'string' || typeof p.key === 'number'))
        .map((p: any) => {
          const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : undefined);
          return {
            key: String(p.key), first_name: str(p.first_name), last_name: str(p.last_name), full_name: str(p.full_name),
            company: str(p.company), domain: str(p.domain), linkedin_url: str(p.linkedin_url),
          };
        });
      const result = await importEmailFinder.find(req.userId!, clean, req.body?.allow_paid !== false);
      res.json({ ...result, credits: await creditsService.summary(req.userId!).catch(() => null) });
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

  async setLifecycle(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await contactsService.setLifecycle(req.userId!, req.body?.contact_ids, req.body?.lifecycle));
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
      const b = req.body || {};
      const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
      const result = await contactsService.export(req.userId!, {
        contactIds: Array.isArray(b.contact_ids) ? b.contact_ids : undefined,
        format: b.format,
        listId: str(b.list_id),
        segmentId: str(b.segment_id),
        lifecycle: str(b.lifecycle),
        search: str(b.search),
        company: str(b.company),
        outreach: str(b.outreach),
        verificationStatus: str(b.verification_status),
        tagIds: Array.isArray(b.tag_ids) ? b.tag_ids : undefined,
        columns: Array.isArray(b.columns) ? b.columns : undefined,
      });

      if (result.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
        // A byte-order mark, so Excel reads accented names as UTF-8.
        res.send('\uFEFF' + result.data);
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

  async verificationBreakdown(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const listId = typeof req.query.list_id === 'string' ? req.query.list_id : undefined;
      const lifecycle = typeof req.query.lifecycle === 'string' ? req.query.lifecycle : undefined;
      const breakdown = await contactsService.verificationBreakdown(req.userId!, listId, lifecycle);
      res.json(breakdown);
    } catch (err) { next(err); }
  },

  async companies(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const companies = await contactsService.companies(req.userId!);
      res.json(companies);
    } catch (err) { next(err); }
  },

  /* -- Duplicates and merging (096) -- */
  async duplicates(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const limit = Number(req.query.limit);
      res.json(await contactHygieneService.duplicates(req.userId!, { limit: Number.isFinite(limit) ? limit : undefined }));
    } catch (err) { next(err); }
  },

  async duplicatesFor(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      res.json(await contactHygieneService.duplicates(req.userId!, { contactId: req.params.id }));
    } catch (err) { next(err); }
  },

  async dismissDuplicate(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await contactHygieneService.dismissDuplicate(req.userId!, req.body?.contact_ids)); } catch (err) { next(err); }
  },

  async merge(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { primary_id, other_ids, fields } = req.body || {};
      if (typeof primary_id !== 'string' || !UUID_RE.test(primary_id)) {
        res.status(400).json({ error: 'primary_id must be a contact id' });
        return;
      }
      if (!Array.isArray(other_ids) || other_ids.some((x: unknown) => typeof x !== 'string' || !UUID_RE.test(x))) {
        res.status(400).json({ error: 'other_ids must be a list of contact ids' });
        return;
      }
      res.json(await contactHygieneService.merge(req.userId!, primary_id, other_ids, fields || {}));
    } catch (err) { next(err); }
  },

  /* -- Saved views (096) -- */
  async listViews(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const page = req.query.page === 'lead' ? 'lead' : 'contact';
      res.json(await contactHygieneService.listViews(req.userId!, page));
    } catch (err) { next(err); }
  },

  async createView(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await contactHygieneService.createView(req.userId!, req.body || {})); } catch (err) { next(err); }
  },

  async updateView(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      res.json(await contactHygieneService.updateView(req.userId!, req.params.id, req.body || {}));
    } catch (err) { next(err); }
  },

  async deleteView(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      await contactHygieneService.deleteView(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  /* -- Bulk edit -- */
  async bulkEdit(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { contact_ids, ...edit } = req.body || {};
      res.json(await contactHygieneService.bulkEdit(req.userId!, contact_ids, edit as any));
    } catch (err) { next(err); }
  },

  /* -- Engagement -- */
  async engagement(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      res.json(await engagementService.forContact(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },

  /* -- Enrich: the 360 profile, only ever on a button press -- */
  async enrich(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      res.json(await contactEnrichmentService.enrich(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },
};
