import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { importHistoryService } from '../services/import-history.service.js';
import { sheetSyncService } from '../services/sheet-sync.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function badId(req: AuthRequest, res: Response): boolean {
  if (UUID_RE.test(String(req.params.id || ''))) return false;
  res.status(400).json({ error: 'Id must be a UUID' });
  return true;
}

/** Import history (with undo) and Google Sheets syncs - migration 111. */
export const importsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, string>;
      res.json(await importHistoryService.list(req.userId!, { page: Number(q.page) || 1, limit: Number(q.limit) || 25, sheetSyncId: q.sheet_sync_id || undefined }));
    } catch (err) { next(err); }
  },

  async start(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const b = req.body || {};
      const run = await importHistoryService.start(req.userId!, {
        source: typeof b.source === 'string' ? b.source : null,
        origin: b.origin === 'paste' ? 'paste' : 'file',
        listId: typeof b.list_id === 'string' ? b.list_id : null,
        kind: b.kind === 'contact' ? 'contact' : 'lead',
        total: Number(b.total) || 0,
      });
      res.json(run ? { id: run.id } : { id: null, unavailable: true });
    } catch (err) { next(err); }
  },

  async finish(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      const b = req.body || {};
      const held = Math.max(0, Math.round(Number(b.held) || 0));
      if (held) await importHistoryService.record(req.userId!, req.params.id, { held, created: 0 });
      await importHistoryService.finish(req.userId!, req.params.id, b.cancelled ? 'cancelled' : 'done');
      res.json({ ok: true });
    } catch (err) { next(err); }
  },

  async undo(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      res.json(await importHistoryService.undo(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },

  /* ── Google Sheets ─────────────────────────────────────────────── */

  async sheetPreview(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await sheetSyncService.preview(String(req.body?.sheet_url || '')));
    } catch (err) { next(err); }
  },

  async sheetList(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await sheetSyncService.list(req.userId!)); } catch (err) { next(err); }
  },

  /** Saves the sync and runs it once straight away. */
  async sheetCreate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const sync = await sheetSyncService.create(req.userId!, req.body || {});
      let first: Awaited<ReturnType<typeof sheetSyncService.run>> | null = null;
      let firstError: string | null = null;
      try { first = await sheetSyncService.run(req.userId!, sync.id); } catch (e: any) { firstError = e?.message || 'The first sync failed'; }
      res.json({ sync, first, first_error: firstError });
    } catch (err) { next(err); }
  },

  async sheetUpdate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      res.json(await sheetSyncService.update(req.userId!, req.params.id, req.body || {}));
    } catch (err) { next(err); }
  },

  async sheetRun(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      res.json(await sheetSyncService.run(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },

  async sheetDelete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (badId(req, res)) return;
      res.json(await sheetSyncService.remove(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },
};
