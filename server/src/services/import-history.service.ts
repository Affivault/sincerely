/* ═══════════════════════════════════════════════════════════════════════
   Import history, and undoing an import days later (migration 111).

   An import is many requests - the page sends a file 100 rows at a time,
   a sheet sync 500 - so a run is opened first, each batch adds to it, and
   it is closed at the end. What each batch ADDED is remembered, person by
   person, so Undo removes exactly those and never someone who was already
   here before the import touched them.

   Undo keeps anyone who has since been put in a campaign: deleting them
   would rewrite that campaign's history. The page says how many stayed.

   Everything here degrades to "no history" before migration 111 is run,
   so an import never fails because its history could not be written.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { selectInChunks } from '../utils/batch.js';

export type ImportOrigin = 'file' | 'paste' | 'sheet' | 'api';

export interface ImportRunRow {
  id: string;
  source: string | null;
  origin: ImportOrigin;
  list_id: string | null;
  list_name: string | null;
  sheet_sync_id: string | null;
  kind: 'lead' | 'contact';
  status: 'running' | 'done' | 'cancelled' | 'failed' | 'undone';
  total: number;
  created: number;
  updated: number;
  held: number;
  errors: number;
  /** Of `created`, how many are still here (not deleted since, not undone). */
  still_here: number;
  undone_count: number;
  started_at: string;
  finished_at: string | null;
  undone_at: string | null;
}

const MISSING = /import_runs|import_run_contacts|import_run_tally|schema cache|PGRST20[25]|42P01/i;
const missing = (e: any) => !!e && MISSING.test(`${e.message || ''} ${e.code || ''}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const importHistoryService = {
  /** Open a run. Null (not an error) when history is not available yet. */
  async start(userId: string, init: {
    source?: string | null; origin?: ImportOrigin; listId?: string | null;
    kind?: 'lead' | 'contact'; total?: number; sheetSyncId?: string | null;
  }): Promise<{ id: string } | null> {
    let listId = init.listId && UUID.test(init.listId) ? init.listId : null;
    if (listId) {
      const { data: list } = await supabaseAdmin.from('contact_lists').select('id').eq('id', listId).eq('user_id', userId).maybeSingle();
      if (!list) listId = null;
    }
    const { data, error } = await supabaseAdmin.from('import_runs').insert({
      user_id: userId,
      source: (init.source || '').trim().slice(0, 200) || null,
      origin: (['file', 'paste', 'sheet', 'api'] as const).includes(init.origin as any) ? init.origin : 'file',
      list_id: listId,
      sheet_sync_id: init.sheetSyncId || null,
      kind: init.kind === 'contact' ? 'contact' : 'lead',
      total: Math.max(0, Math.round(Number(init.total) || 0)),
    }).select('id').single();
    if (error) {
      if (missing(error)) return null;
      throw new AppError(error.message, 500);
    }
    return { id: data.id };
  },

  /** Add one batch's outcome. Never throws: history must not fail an import. */
  async record(userId: string, importId: string, batch: {
    createdIds?: string[]; created?: number; updated?: number; errors?: number; held?: number;
  }): Promise<void> {
    if (!UUID.test(importId)) return;
    try {
      // Only into the caller's own, still-open import.
      const { data: own, error: ownErr } = await supabaseAdmin.from('import_runs')
        .select('id').eq('id', importId).eq('user_id', userId).eq('status', 'running').maybeSingle();
      if (ownErr || !own) return;
      const ids = [...new Set((batch.createdIds || []).filter((x) => typeof x === 'string' && UUID.test(x)))];
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await supabaseAdmin.from('import_run_contacts').upsert(
          ids.slice(i, i + 500).map((contact_id) => ({ import_id: importId, contact_id, user_id: userId })),
          { onConflict: 'import_id,contact_id', ignoreDuplicates: true },
        );
        if (error) { if (!missing(error)) console.warn('[ImportHistory] record ids:', error.message); return; }
      }
      const { error } = await supabaseAdmin.rpc('import_run_tally', {
        p_id: importId, p_user_id: userId,
        p_created: batch.created ?? ids.length, p_updated: batch.updated ?? 0,
        p_errors: batch.errors ?? 0, p_held: batch.held ?? 0,
      });
      if (error && !missing(error)) console.warn('[ImportHistory] tally:', error.message);
    } catch (err: any) {
      console.warn('[ImportHistory] record failed:', err?.message || err);
    }
  },

  async finish(userId: string, importId: string, status: 'done' | 'cancelled' | 'failed' = 'done'): Promise<void> {
    if (!UUID.test(importId)) return;
    const { error } = await supabaseAdmin.from('import_runs')
      .update({ status, finished_at: new Date().toISOString() })
      .eq('id', importId).eq('user_id', userId).eq('status', 'running');
    if (error && !missing(error)) console.warn('[ImportHistory] finish:', error.message);
  },

  async list(userId: string, opts: { page?: number; limit?: number; sheetSyncId?: string } = {}): Promise<{ data: ImportRunRow[]; total: number; unavailable?: boolean }> {
    const limit = Math.min(100, Math.max(1, opts.limit || 25));
    const page = Math.max(1, opts.page || 1);
    let q = supabaseAdmin.from('import_runs')
      .select('*, contact_lists(name), import_run_contacts(count)', { count: 'exact' })
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (opts.sheetSyncId && UUID.test(opts.sheetSyncId)) q = q.eq('sheet_sync_id', opts.sheetSyncId);
    const { data, error, count } = await q;
    if (error) {
      if (missing(error)) return { data: [], total: 0, unavailable: true };
      throw new AppError(error.message, 500);
    }
    return {
      total: count || 0,
      data: (data || []).map((r: any) => {
        const { contact_lists, import_run_contacts, user_id: _u, ...rest } = r;
        return {
          ...rest,
          list_name: contact_lists?.name ?? null,
          still_here: Array.isArray(import_run_contacts) ? Number(import_run_contacts[0]?.count) || 0 : 0,
        } as ImportRunRow;
      }),
    };
  },

  /**
   * Remove the people an import added. People who were already here are
   * not touched (the fields it filled on them stay), and anyone since put
   * in a campaign is kept.
   */
  async undo(userId: string, importId: string): Promise<{ deleted: number; kept_in_campaigns: number }> {
    if (!UUID.test(importId)) throw new AppError('Not found', 404);
    const { data: run, error } = await supabaseAdmin.from('import_runs')
      .select('id, status').eq('id', importId).eq('user_id', userId).maybeSingle();
    if (error) {
      if (missing(error)) throw new AppError('Import history needs the latest database update (migration 111).', 503);
      throw new AppError(error.message, 500);
    }
    if (!run) throw new AppError('Not found', 404);
    if (run.status === 'running') throw new AppError('That import is still running. Stop it first.', 409);

    const ids: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error: e } = await supabaseAdmin.from('import_run_contacts')
        .select('contact_id').eq('import_id', importId).eq('user_id', userId)
        .order('contact_id').range(from, from + 999);
      if (e) throw new AppError(e.message, 500);
      ids.push(...(page || []).map((r: any) => r.contact_id));
      if (!page || page.length < 1000) break;
    }

    const enrolled = new Set<string>();
    if (ids.length) {
      const rows = await selectInChunks(ids, (slice) =>
        supabaseAdmin.from('campaign_contacts').select('contact_id').in('contact_id', slice));
      for (const r of rows as any[]) enrolled.add(r.contact_id);
    }
    const doomed = ids.filter((id) => !enrolled.has(id));
    let deleted = 0;
    for (let i = 0; i < doomed.length; i += 500) {
      const { data: gone, error: delErr } = await supabaseAdmin.from('contacts')
        .delete().eq('user_id', userId).in('id', doomed.slice(i, i + 500)).select('id');
      if (delErr) throw new AppError(delErr.message, 500);
      deleted += gone?.length || 0;
    }
    await supabaseAdmin.from('import_runs')
      .update({ status: 'undone', undone_at: new Date().toISOString(), undone_count: deleted })
      .eq('id', importId).eq('user_id', userId);
    return { deleted, kept_in_campaigns: enrolled.size };
  },
};
