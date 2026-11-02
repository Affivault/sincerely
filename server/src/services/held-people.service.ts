/* ═══════════════════════════════════════════════════════════════════════
   People held without an email (migration 110).

   An import used to drop everyone with no usable address. They are kept
   here instead, in the list they were imported into, and shown on the
   Leads / Contacts page as the "No email" light. From there:

     - an address is typed in, and they become an ordinary lead (or
       contact) in that list, with everything the row carried;
     - or the fixed file is re-imported, and anyone it now has an email
       for is released from here automatically (releaseMatches);
     - or they are deleted.

   Held people are never sent anything - they have no address - and never
   appear in campaigns, suppression or duplicate checks, all of which are
   keyed by email. That is why they are a table of their own.

   Every read here tolerates the table not existing yet: until 110 is run
   the counts are zero and the import keeps them in the download instead.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { chunk } from '../utils/batch.js';
import { heldMatchKey, normalizeLinkedinUrl, UNLISTED_LIST_ID, type HeldPerson } from '@lemlist/shared';

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
const MISSING = /held_people|relation .* does not exist|schema cache|PGRST205/i;

/** Which held people a page means: Leads shows leads, Contacts shows contacts. */
function kindFor(lifecycle?: string): 'lead' | 'contact' | null {
  if (lifecycle === 'prospect') return 'lead';
  if (lifecycle === 'engaged' || lifecycle === 'contact' || lifecycle === 'customer') return 'contact';
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scope(q: any, userId: string, listId?: string, lifecycle?: string): any {
  q = q.eq('user_id', userId);
  if (listId === UNLISTED_LIST_ID) q = q.is('list_id', null);
  else if (listId) q = q.eq('list_id', listId);
  const kind = kindFor(lifecycle);
  if (kind) q = q.eq('kind', kind);
  return q;
}

export interface HoldInput {
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  linkedin_url?: string;
  raw_email?: string;
  reason?: 'no_email' | 'invalid_email';
  /** Everything else, in the shape the import sends a contact. */
  data?: Record<string, any>;
}

const str = (v: unknown, n = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

export const heldPeopleService = {
  async count(userId: string, listId?: string, lifecycle?: string): Promise<number> {
    try {
      const { count, error } = await scope(
        supabaseAdmin.from('held_people').select('id', { count: 'exact', head: true }), userId, listId, lifecycle);
      if (error) return 0;
      return count || 0;
    } catch {
      return 0;
    }
  },

  async list(userId: string, params: { listId?: string; lifecycle?: string; page?: number; limit?: number; search?: string }) {
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 50));
    const page = Math.max(1, Number(params.page) || 1);
    let q = scope(supabaseAdmin.from('held_people').select('*', { count: 'exact' }), userId, params.listId, params.lifecycle);
    const term = String(params.search || '').replace(/[,()"%_\\]/g, ' ').trim();
    if (term) q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,company.ilike.%${term}%`);
    const { data, count, error } = await q.order('created_at', { ascending: false }).order('id').range((page - 1) * limit, page * limit - 1);
    if (error) {
      if (MISSING.test(error.message || '')) return { data: [] as HeldPerson[], total: 0, page, limit, unavailable: true };
      throw new AppError(error.message, 500);
    }
    return { data: (data || []) as HeldPerson[], total: count || 0, page, limit };
  },

  /** Keep import rows that have no usable email. Returns how many are now held. */
  async hold(userId: string, people: HoldInput[], opts: { listId?: string; importSource?: string; kind?: 'lead' | 'contact' }): Promise<{ held: number; unavailable?: boolean }> {
    let listId: string | null = opts.listId || null;
    if (listId) {
      const { data: list } = await supabaseAdmin.from('contact_lists').select('id').eq('id', listId).eq('user_id', userId).maybeSingle();
      if (!list) listId = null;
    }
    const byKey = new Map<string, Record<string, any>>();
    for (const p of people.slice(0, 5000)) {
      if (!p || typeof p !== 'object') continue;
      const linkedin = str(p.linkedin_url) ? normalizeLinkedinUrl(str(p.linkedin_url)!) : null;
      const row = {
        user_id: userId,
        list_id: listId,
        first_name: str(p.first_name, 100),
        last_name: str(p.last_name, 100),
        company: str(p.company, 200),
        job_title: str(p.job_title, 200),
        linkedin_url: linkedin,
        data: p.data && typeof p.data === 'object' && !Array.isArray(p.data) ? p.data : {},
        raw_email: str(p.raw_email, 200),
        reason: p.reason === 'invalid_email' ? 'invalid_email' : 'no_email',
        kind: opts.kind === 'contact' ? 'contact' : 'lead',
        import_source: str(opts.importSource, 200),
      };
      const key = heldMatchKey(row);
      if (!key) continue; // nothing to recognise them by: not worth holding
      byKey.set(key, { ...row, match_key: key });
    }
    const rows = [...byKey.values()];
    let held = 0;
    for (const slice of chunk(rows, 500)) {
      const { data, error } = await supabaseAdmin.from('held_people').upsert(slice, { onConflict: 'user_id,match_key' }).select('id');
      if (error) {
        if (MISSING.test(error.message || '')) return { held: 0, unavailable: true };
        throw new AppError(error.message, 500);
      }
      held += (data || []).length;
    }
    return { held };
  },

  /**
   * Give a held person an email: they become a lead (or contact) in the
   * list they were held in, with everything their row carried.
   */
  async addEmail(userId: string, id: string, rawEmail: string): Promise<{ contact_id: string | null }> {
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AppError('That is not an email address', 400);
    const { data: person, error } = await supabaseAdmin.from('held_people').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!person) throw new AppError('Not found', 404);
    // Imported lazily: contacts.service imports this module too.
    const { contactsService } = await import('./contacts.service.js');
    const contact = {
      ...(person.data || {}),
      first_name: person.first_name || undefined,
      last_name: person.last_name || undefined,
      company: person.company || undefined,
      job_title: person.job_title || undefined,
      linkedin_url: person.linkedin_url || undefined,
      email,
    };
    const result = await contactsService.bulkCreate(
      userId, [contact], person.list_id || undefined, person.import_source || undefined,
      person.kind === 'contact' ? 'contacts' : undefined,
    );
    if (!result.imported) throw new AppError(result.error_details?.[0]?.reason || 'Could not add them', 400);
    // bulkCreate releases the match itself; this makes sure, whatever the key.
    await supabaseAdmin.from('held_people').delete().eq('id', id).eq('user_id', userId);
    const { data: c } = await supabaseAdmin.from('contacts').select('id').eq('user_id', userId).eq('email', email).maybeSingle();
    return { contact_id: (c as any)?.id ?? null };
  },

  async remove(userId: string, ids: string[]): Promise<{ deleted: number }> {
    const clean = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string').slice(0, 5000);
    let deleted = 0;
    for (const slice of chunk(clean)) {
      const { data, error } = await supabaseAdmin.from('held_people').delete().eq('user_id', userId).in('id', slice).select('id');
      if (error) throw new AppError(error.message, 500);
      deleted += (data || []).length;
    }
    return { deleted };
  },

  /**
   * After an import: anyone held who has now arrived with an email - the
   * same LinkedIn profile, or the same name at the same company - is no
   * longer held. Never throws; a stale held row is the state before this.
   */
  async releaseMatches(userId: string, rows: Array<{ linkedin_url?: string | null; first_name?: string | null; last_name?: string | null; company?: string | null }>): Promise<void> {
    try {
      const keys = new Set<string>();
      for (const r of rows) {
        const li = heldMatchKey({ linkedin_url: r.linkedin_url });
        if (li) keys.add(li);
        const n = heldMatchKey({ first_name: r.first_name, last_name: r.last_name, company: r.company });
        if (n) keys.add(n);
      }
      for (const slice of chunk([...keys])) {
        await supabaseAdmin.from('held_people').delete().eq('user_id', userId).in('match_key', slice);
      }
    } catch { /* the table may not exist yet */ }
  },
};
