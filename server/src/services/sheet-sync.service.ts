/* ═══════════════════════════════════════════════════════════════════════
   Google Sheets sync (migration 111).

   A sheet a team keeps adding leads to, imported into a list on a
   schedule with the column mapping saved once. Each run reads the whole
   sheet and imports it the way a re-import does: new people are added,
   people already here only have blanks filled (or whatever mode was
   chosen), nobody is ever deleted or blanked. People without an email are
   held in the list as "No email", like a file import.

   The sheet is read as CSV through Google's own export link, so it has to
   be shared as "Anyone with the link can view" - no Google sign-in, no
   tokens to store. Only docs.google.com links are accepted: this fetch
   runs on the server, and it must not be pointable at anything else.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { contactsService } from './contacts.service.js';
import { heldPeopleService } from './held-people.service.js';
import { importHistoryService } from './import-history.service.js';
import { sheetCsvUrl, parseSheetCsv } from '../utils/sheet-csv.js';
import { planImport, prepareImport, IMPORT_MODES, type ImportMode } from '@lemlist/shared';

const MAX_BYTES = 8 * 1024 * 1024;
const BATCH = 500;
const MISSING = /sheet_syncs|schema cache|PGRST20[25]|42P01/i;
const missing = (e: any) => !!e && MISSING.test(`${e.message || ''} ${e.code || ''}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchSheet(sheetUrl: string): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const csvUrl = sheetCsvUrl(sheetUrl);
  if (!csvUrl) throw new AppError('That is not a Google Sheets link. Copy the link from the sheet\'s Share button.', 400);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(csvUrl, { signal: ctrl.signal, redirect: 'follow' });
    // Google sends the CSV from its own content host after a redirect; a
    // private sheet answers with its sign-in page instead.
    const host = (() => { try { return new URL(res.url).hostname; } catch { return ''; } })();
    if (!/(^|\.)google\.com$|(^|\.)googleusercontent\.com$/.test(host)) throw new AppError('The sheet could not be read.', 502);
    const type = res.headers.get('content-type') || '';
    if (res.status === 401 || res.status === 403 || /text\/html/.test(type) || host === 'accounts.google.com') {
      throw new AppError('Sincerely cannot open that sheet. In Google Sheets, Share it as "Anyone with the link can view" and try again.', 400);
    }
    if (res.status === 404) throw new AppError('That sheet (or tab) was not found.', 400);
    if (!res.ok) throw new AppError(`Google Sheets answered ${res.status}.`, 502);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new AppError('That sheet is too big to sync (over 8 MB).', 413);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new AppError('That sheet is too big to sync (over 8 MB).', 413);
    return parseSheetCsv(text);
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    if (err?.name === 'AbortError') throw new AppError('Google Sheets took too long to answer.', 504);
    throw new AppError('The sheet could not be read.', 502);
  } finally {
    clearTimeout(timer);
  }
}

function cleanMapping(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && k.length <= 200 && v.length <= 60) out[k] = v;
  }
  return out;
}

const SELECT = 'id, name, sheet_url, list_id, kind, mapping, mode, keep_held, enabled, every_hours, next_run_at, last_run_at, last_status, last_error, last_import_id, created_at, updated_at, contact_lists(name)';

function shape(r: any) {
  const { contact_lists, ...rest } = r;
  return { ...rest, list_name: contact_lists?.name ?? null };
}

const running = new Set<string>();

export const sheetSyncService = {
  /** Read the sheet and suggest a mapping, before anything is saved. */
  async preview(sheetUrl: string) {
    const { headers, rows } = await fetchSheet(sheetUrl);
    if (headers.length === 0) throw new AppError('That sheet is empty.', 400);
    const plan = planImport(headers, rows);
    return { headers, sample: rows.slice(0, 5), total: rows.length, mapping: plan.mapping, email_column: plan.emailColumn };
  },

  async list(userId: string) {
    const { data, error } = await supabaseAdmin.from('sheet_syncs').select(SELECT).eq('user_id', userId).order('created_at', { ascending: false });
    if (error) {
      if (missing(error)) return { data: [], unavailable: true };
      throw new AppError(error.message, 500);
    }
    return { data: (data || []).map(shape) };
  },

  async create(userId: string, input: any) {
    const sheetUrl = String(input?.sheet_url || '').trim();
    if (!sheetCsvUrl(sheetUrl)) throw new AppError('That is not a Google Sheets link.', 400);
    const mapping = cleanMapping(input?.mapping);
    if (!Object.values(mapping).includes('email')) throw new AppError('Choose which column holds the email.', 400);
    let listId: string | null = typeof input?.list_id === 'string' && UUID.test(input.list_id) ? input.list_id : null;
    let kind: 'lead' | 'contact' = input?.kind === 'contact' ? 'contact' : 'lead';
    if (listId) {
      const { data: list } = await supabaseAdmin.from('contact_lists').select('id, kind').eq('id', listId).eq('user_id', userId).maybeSingle();
      if (!list) listId = null;
      else if ((list as any).kind === 'contact') kind = 'contact';
    }
    const every = Math.min(168, Math.max(1, Math.round(Number(input?.every_hours) || 24)));
    const { data, error } = await supabaseAdmin.from('sheet_syncs').insert({
      user_id: userId,
      name: String(input?.name || '').trim().slice(0, 120) || 'Google Sheet',
      sheet_url: sheetUrl,
      list_id: listId,
      kind,
      mapping,
      mode: IMPORT_MODES.includes(input?.mode) ? input.mode : 'fill',
      keep_held: input?.keep_held !== false,
      every_hours: every,
      // The first run happens straight away (the route runs it); the
      // schedule takes over from there.
      next_run_at: new Date(Date.now() + every * 3_600_000).toISOString(),
    }).select(SELECT).single();
    if (error) {
      if (missing(error)) throw new AppError('Google Sheets sync needs the latest database update (migration 111).', 503);
      throw new AppError(error.message, 500);
    }
    return shape(data);
  },

  async update(userId: string, id: string, input: any) {
    const patch: Record<string, any> = {};
    if (typeof input?.name === 'string' && input.name.trim()) patch.name = input.name.trim().slice(0, 120);
    if (typeof input?.enabled === 'boolean') patch.enabled = input.enabled;
    if (input?.every_hours != null) {
      patch.every_hours = Math.min(168, Math.max(1, Math.round(Number(input.every_hours) || 24)));
      patch.next_run_at = new Date(Date.now() + patch.every_hours * 3_600_000).toISOString();
    }
    if (input?.mapping) {
      const mapping = cleanMapping(input.mapping);
      if (!Object.values(mapping).includes('email')) throw new AppError('Choose which column holds the email.', 400);
      patch.mapping = mapping;
    }
    if (IMPORT_MODES.includes(input?.mode)) patch.mode = input.mode;
    if (typeof input?.keep_held === 'boolean') patch.keep_held = input.keep_held;
    if (patch.enabled === true && !patch.next_run_at) patch.next_run_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('sheet_syncs').update(patch).eq('id', id).eq('user_id', userId).select(SELECT).maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Not found', 404);
    return shape(data);
  },

  async remove(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('sheet_syncs').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    return { deleted: true };
  },

  /** Run one sync now. Recorded in Import history like any import. */
  async run(userId: string, id: string): Promise<{ import_id: string | null; total: number; created: number; updated: number; held: number; errors: number }> {
    const { data: sync, error } = await supabaseAdmin.from('sheet_syncs').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) {
      if (missing(error)) throw new AppError('Google Sheets sync needs the latest database update (migration 111).', 503);
      throw new AppError(error.message, 500);
    }
    if (!sync) throw new AppError('Not found', 404);
    const key = `${userId}:${id}`;
    if (running.has(key)) throw new AppError('That sheet is already syncing.', 409);
    running.add(key);
    const now = new Date();
    const next = new Date(now.getTime() + (Number(sync.every_hours) || 24) * 3_600_000).toISOString();
    let importId: string | null = null;
    try {
      const { rows } = await fetchSheet(sync.sheet_url);
      const mapping = cleanMapping(sync.mapping);
      const prepared = prepareImport(rows, mapping);
      const asContacts = sync.kind === 'contact';
      const run = await importHistoryService.start(userId, {
        source: sync.name, origin: 'sheet', listId: sync.list_id, kind: sync.kind, total: rows.length, sheetSyncId: sync.id,
      });
      importId = run?.id ?? null;

      let created = 0; let updated = 0; let errors = 0;
      for (let i = 0; i < prepared.contacts.length; i += BATCH) {
        const r = await contactsService.bulkCreate(
          userId, prepared.contacts.slice(i, i + BATCH), sync.list_id || undefined, sync.name,
          asContacts ? 'contacts' : undefined, { mode: sync.mode as ImportMode },
        );
        created += r.created ?? 0;
        updated += r.updated ?? 0;
        errors += r.errors;
        if (importId) await importHistoryService.record(userId, importId, { createdIds: r.created_ids, created: r.created, updated: r.updated, errors: r.errors });
      }

      // People without a usable email, held in the list like a file import.
      let held = 0;
      const emailColumn = Object.entries(mapping).find(([, t]) => t === 'email')?.[0];
      if (sync.keep_held !== false && emailColumn) {
        const people = prepared.setAside
          .filter((s) => s.reason === 'no_email' || s.reason === 'invalid_email')
          .map((s) => {
            const c: Record<string, any> = prepareImport([{ ...s.row, [emailColumn]: 'held@example.invalid' }], mapping, { skipFlagged: false }).contacts[0] || {};
            const { email: _e, first_name, last_name, company, job_title, linkedin_url, ...rest } = c;
            return {
              first_name, last_name, company, job_title, linkedin_url,
              raw_email: String(s.row[emailColumn] ?? '').trim() || undefined,
              reason: s.reason, data: rest,
            };
          })
          .filter((p) => p.first_name || p.last_name || p.linkedin_url);
        for (let i = 0; i < people.length; i += 5000) {
          const r = await heldPeopleService.hold(userId, people.slice(i, i + 5000) as any, { listId: sync.list_id || undefined, importSource: sync.name, kind: sync.kind });
          if (r.unavailable) break;
          held += r.held;
        }
        if (importId && held) await importHistoryService.record(userId, importId, { held, created: 0 });
      }
      if (importId) await importHistoryService.finish(userId, importId, 'done');
      await supabaseAdmin.from('sheet_syncs').update({
        last_run_at: now.toISOString(), next_run_at: next, last_import_id: importId,
        last_status: `${created.toLocaleString('en-GB')} added, ${updated.toLocaleString('en-GB')} updated${held ? `, ${held.toLocaleString('en-GB')} without an email` : ''}`,
        last_error: null,
      }).eq('id', id).eq('user_id', userId);
      return { import_id: importId, total: rows.length, created, updated, held, errors };
    } catch (err: any) {
      if (importId) await importHistoryService.finish(userId, importId, 'failed');
      await supabaseAdmin.from('sheet_syncs').update({
        last_run_at: now.toISOString(), next_run_at: next, last_status: 'failed',
        last_error: String(err?.message || 'Sync failed').slice(0, 300),
      }).eq('id', id).eq('user_id', userId);
      throw err;
    } finally {
      running.delete(key);
    }
  },

  /** For the scheduler: syncs that are due, oldest first. Cross-tenant. */
  async due(limit = 5): Promise<Array<{ id: string; user_id: string }>> {
    const { data, error } = await supabaseAdmin.from('sheet_syncs')
      .select('id, user_id').eq('enabled', true).lte('next_run_at', new Date().toISOString())
      .order('next_run_at', { ascending: true }).limit(limit);
    if (error) { if (!missing(error)) console.warn('[SheetSync] due:', error.message); return []; }
    return data || [];
  },
};
