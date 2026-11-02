import fs from 'node:fs';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { contactsService } from '../services/contacts.service.js';
import { heldPeopleService } from '../services/held-people.service.js';
import { OutOfCreditsError } from '../services/credits.service.js';
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

  /** Before an import: how many of these addresses exist, and how many are suppressed. */
  async importPreflight(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const emails = Array.isArray(req.body?.emails) ? req.body.emails : [];
      if (emails.length > 50_000) {
        res.status(413).json({ error: 'At most 50,000 addresses per check' });
        return;
      }
      const counts = await contactsService.importPreflight(req.userId!, emails);
      res.json(counts);
    } catch (err) { next(err); }
  },

  async lightCounts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const ids = Array.isArray(req.body?.contact_ids) ? req.body.contact_ids : [];
      if (ids.length > 100_000) { res.status(413).json({ error: 'Too many contacts' }); return; }
      res.json(await contactsService.lightCounts(req.userId!, ids));
    } catch (err) { next(err); }
  },

  /* ── People held without an email (migration 110) ─────────────── */

  async heldList(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, string>;
      res.json(await heldPeopleService.list(req.userId!, { listId: q.list_id || undefined, lifecycle: q.lifecycle || undefined, page: Number(q.page) || 1, limit: Number(q.limit) || 50, search: q.search || undefined }));
    } catch (err) { next(err); }
  },

  async heldCreate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const b = req.body || {};
      if (!Array.isArray(b.people)) { res.status(400).json({ error: 'people must be an array' }); return; }
      if (b.people.length > 5000) { res.status(413).json({ error: 'At most 5,000 people per request' }); return; }
      res.json(await heldPeopleService.hold(req.userId!, b.people, {
        listId: typeof b.list_id === 'string' ? b.list_id : undefined,
        importSource: typeof b.import_source === 'string' ? b.import_source : undefined,
        kind: b.kind === 'contact' ? 'contact' : 'lead',
      }));
    } catch (err) { next(err); }
  },

  async heldAddEmail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      res.json(await heldPeopleService.addEmail(req.userId!, req.params.id, String(req.body?.email || '')));
    } catch (err) { next(err); }
  },

  async heldDelete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await heldPeopleService.remove(req.userId!, Array.isArray(req.body?.ids) ? req.body.ids : []));
    } catch (err) { next(err); }
  },

  /**
   * Enrich several contacts, one after another, stopping at the first
   * "out of credits". Each costs what Enrich on a contact's page costs and
   * is refunded the same way when nothing is found.
   */
  async bulkEnrich(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const ids: string[] = (Array.isArray(req.body?.contact_ids) ? req.body.contact_ids : []).filter((x: unknown) => typeof x === 'string');
      if (ids.length === 0) { res.json({ results: [], enriched: 0, out_of_credits: false }); return; }
      if (ids.length > 25) { res.status(413).json({ error: 'At most 25 contacts per request' }); return; }
      const results: Array<{ contact_id: string; ok: boolean; filled: number; error?: string }> = [];
      let outOfCredits = false;
      for (const id of ids) {
        if (outOfCredits) { results.push({ contact_id: id, ok: false, filled: 0, error: 'Out of credits' }); continue; }
        try {
          const r = await contactEnrichmentService.enrich(req.userId!, id);
          results.push({ contact_id: id, ok: true, filled: r.filled.length + r.company_filled.length });
        } catch (e: any) {
          if (e instanceof OutOfCreditsError) outOfCredits = true;
          if (e?.statusCode === 503) { res.status(503).json({ error: e.message }); return; }
          results.push({ contact_id: id, ok: false, filled: 0, error: e?.message || 'Enrich failed' });
        }
      }
      res.json({ results, enriched: results.filter((r) => r.ok).length, out_of_credits: outOfCredits });
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
        lights: Array.isArray(b.lights) ? b.lights : undefined,
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
