import {
  freeMailDomains, duplicateGroupKey, sanitizeViewConfig, cleanCustomFieldKey,
  BULK_EDIT_FIELDS, BULK_EDIT_MAX, MERGE_FIELDS,
  type DuplicateGroup, type DuplicateReason, type SavedView, type SavedViewPage, type BulkEditInput,
} from '@lemlist/shared';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { chunk, selectInChunks } from '../utils/batch.js';
import { fireEvent } from './webhook.service.js';
import { contactsService } from './contacts.service.js';
import { engagementService } from './engagement.service.js';

/* ═══════════════════════════════════════════════════════════════════════
   Duplicates and merging, saved views, and bulk edit.

   All three arrive with migration 096. A database without it still runs
   the rest of the app; these say plainly that they need it rather than
   failing with a Postgres message about a function nobody has heard of.
   ═══════════════════════════════════════════════════════════════════════ */

const MIGRATION = '096_duplicates_views_engagement_noshow.sql';

/** Postgres or PostgREST saying an object from 096 is not there. */
function missing096(error: { message?: string; code?: string } | null | undefined, names: RegExp): boolean {
  if (!error) return false;
  return ['PGRST202', 'PGRST205', 'PGRST204', '42P01', '42883', '42703'].includes(error.code || '')
    || (names.test(error.message || '') && /does not exist|could not find|schema cache/i.test(error.message || ''));
}

function needs096(what: string): AppError {
  return new AppError(`${what} needs database migration ${MIGRATION} - run it in Supabase, then reload.`, 503);
}

const DUPLICATE_SELECT =
  'id, email, first_name, last_name, company, job_title, phone, linkedin_url, website, location, lifecycle, custom_fields, created_at, updated_at';

/** Join groups that share a contact, so one person is one card. */
function cluster(rows: { reason: DuplicateReason; contact_ids: string[] }[]) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(x, p);
    return p;
  };
  for (const r of rows) {
    for (const id of r.contact_ids) if (!parent.has(id)) parent.set(id, id);
    for (const id of r.contact_ids.slice(1)) {
      const a = find(r.contact_ids[0]);
      const b = find(id);
      if (a !== b) parent.set(b, a);
    }
  }
  const groups = new Map<string, { ids: Set<string>; reasons: Set<DuplicateReason> }>();
  for (const r of rows) {
    const root = find(r.contact_ids[0]);
    const g = groups.get(root) ?? { ids: new Set(), reasons: new Set() };
    r.contact_ids.forEach((id) => g.ids.add(id));
    g.reasons.add(r.reason);
    groups.set(root, g);
  }
  return [...groups.values()];
}

export const contactHygieneService = {
  /* ── Duplicates ─────────────────────────────────────────────────────── */

  /**
   * Likely duplicates across the account, or only the ones involving one
   * contact. Groups somebody has already said are different people are
   * left out.
   */
  async duplicates(userId: string, opts: { contactId?: string; limit?: number } = {}): Promise<{ groups: DuplicateGroup[]; total: number }> {
    const { data, error } = await supabaseAdmin.rpc('find_contact_duplicates', {
      p_user_id: userId,
      p_contact_id: opts.contactId ?? null,
      p_free_domains: freeMailDomains(),
      p_limit: 500,
    });
    if (error) {
      if (missing096(error, /find_contact_duplicates/)) throw needs096('Finding duplicates');
      throw new AppError(error.message, 500);
    }
    const clusters = cluster(((data || []) as any[]).map((r) => ({ reason: r.reason, contact_ids: r.contact_ids || [] })));
    if (clusters.length === 0) return { groups: [], total: 0 };

    const { data: dismissed } = await supabaseAdmin
      .from('contact_duplicate_dismissals').select('group_key').eq('user_id', userId);
    const gone = new Set((dismissed || []).map((d: any) => d.group_key));
    const live = clusters.filter((c) => !gone.has(duplicateGroupKey([...c.ids])));
    const limited = live.slice(0, Math.max(1, Math.min(opts.limit ?? 50, 200)));

    const ids = [...new Set(limited.flatMap((c) => [...c.ids]))];
    const contacts = await selectInChunks(ids, (slice) =>
      supabaseAdmin.from('contacts').select(DUPLICATE_SELECT).eq('user_id', userId).in('id', slice));
    const byId = new Map((contacts as any[]).map((c) => [c.id, c]));

    // What a merge would carry across, so the card can say which record
    // holds the history. Counted per contact, a slice at a time.
    const count = async (table: string, col = 'contact_id') => {
      const rows = await selectInChunks(ids, (slice) => {
        const q = supabaseAdmin.from(table).select(col).in(col, slice);
        return table === 'campaign_contacts' ? q : q.eq('user_id', userId);
      });
      const m = new Map<string, number>();
      for (const r of rows as any[]) m.set(r[col], (m.get(r[col]) || 0) + 1);
      return m;
    };
    const owned = new Set(ids.filter((id) => byId.has(id)));
    const [campaigns, meetings, notes, deals] = await Promise.all([
      count('campaign_contacts'), count('crm_events'), count('crm_notes'), count('deals'),
    ]);

    const groups: DuplicateGroup[] = limited
      .map((c) => ({
        key: duplicateGroupKey([...c.ids]),
        reasons: [...c.reasons],
        contacts: [...c.ids].filter((id) => owned.has(id)).map((id) => ({
          ...byId.get(id),
          activity: {
            campaigns: campaigns.get(id) || 0,
            meetings: meetings.get(id) || 0,
            notes: notes.get(id) || 0,
            deals: deals.get(id) || 0,
          },
        })),
      }))
      .filter((g) => g.contacts.length > 1);
    return { groups, total: live.length };
  },

  /** "These are different people": stop offering this group. */
  async dismissDuplicate(userId: string, contactIds: string[]) {
    const ids = [...new Set((Array.isArray(contactIds) ? contactIds : []).filter((x) => typeof x === 'string'))];
    if (ids.length < 2) throw new AppError('Pick at least two contacts', 400);
    const { data: owned, error: ownErr } = await supabaseAdmin
      .from('contacts').select('id').eq('user_id', userId).in('id', ids);
    if (ownErr) throw new AppError(ownErr.message, 500);
    if ((owned || []).length !== ids.length) throw new AppError('Contact not found', 404);
    const { error } = await supabaseAdmin
      .from('contact_duplicate_dismissals')
      .upsert({ user_id: userId, group_key: duplicateGroupKey(ids) }, { onConflict: 'user_id,group_key' });
    if (error) {
      if (missing096(error, /contact_duplicate_dismissals/)) throw needs096('Dismissing duplicates');
      throw new AppError(error.message, 500);
    }
    return { dismissed: true };
  },

  /**
   * Fold `otherIds` into `primaryId`.
   *
   * All of it happens in merge_contacts, one transaction: a merge that
   * stopped half way would leave a person's enrolments on one record and
   * their replies on another, which is the problem a merge exists to fix.
   * Ownership is checked here first as well, so a stranger's id is a 404
   * before anything reaches the database function.
   */
  async merge(userId: string, primaryId: string, otherIds: string[], fields: Record<string, unknown> = {}) {
    const others = [...new Set((Array.isArray(otherIds) ? otherIds : []).filter((x) => typeof x === 'string' && x !== primaryId))];
    if (!primaryId || others.length === 0) throw new AppError('Choose a contact to keep and at least one to merge into it', 400);
    if (others.length > 20) throw new AppError('Up to 20 contacts can be merged at a time', 400);

    const all = [primaryId, ...others];
    const { data: owned, error: ownErr } = await supabaseAdmin
      .from('contacts').select('id, email').eq('user_id', userId).in('id', all);
    if (ownErr) throw new AppError(ownErr.message, 500);
    if ((owned || []).length !== all.length) throw new AppError('Contact not found', 404);

    // Only the fields a person chooses between; anything else in the body
    // never reaches the function.
    const picked: Record<string, string | null> = {};
    const input = fields && typeof fields === 'object' ? fields as Record<string, unknown> : {};
    for (const f of MERGE_FIELDS) {
      if (input[f] === undefined) continue;
      picked[f] = input[f] === null ? null : String(input[f]).slice(0, 500);
    }
    if (picked.email !== undefined) {
      const email = String(picked.email ?? '').trim().toLowerCase();
      if (!(owned || []).some((c: any) => c.email === email)) {
        throw new AppError('The merged contact keeps one of these contacts\' addresses', 400);
      }
      picked.email = email;
    }

    const { data, error } = await supabaseAdmin.rpc('merge_contacts', {
      p_user_id: userId, p_primary_id: primaryId, p_other_ids: others, p_fields: picked,
    });
    if (error) {
      if (missing096(error, /merge_contacts/)) throw needs096('Merging contacts');
      if ((error as any).code === 'P0002') throw new AppError('Contact not found', 404);
      if ((error as any).code === '22023') throw new AppError(error.message.replace(/^merge_contacts: /, ''), 400);
      throw new AppError(error.message, 500);
    }

    // A score from before the merge describes half a person.
    engagementService.forContact(userId, primaryId).catch(() => {});
    fireEvent(userId, 'contact.updated', { contact_id: primaryId, merged: others }).catch(() => {});
    return { ...(data as any), contact: await contactsService.get(userId, primaryId) };
  },

  /* ── Saved views ────────────────────────────────────────────────────── */

  async listViews(userId: string, page: SavedViewPage): Promise<SavedView[] | { unavailable: string }> {
    const { data, error } = await supabaseAdmin
      .from('contact_saved_views')
      .select('id, page, name, config, position, created_at, updated_at')
      .eq('user_id', userId)
      .eq('page', page)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      // Listed as unavailable rather than failed: the page still works,
      // it just has no views to show.
      if (missing096(error, /contact_saved_views/)) return { unavailable: `Saved views need database migration ${MIGRATION}.` };
      throw new AppError(error.message, 500);
    }
    return (data || []).map((v: any) => ({ ...v, config: sanitizeViewConfig(v.config) }));
  },

  async createView(userId: string, input: { page?: unknown; name?: unknown; config?: unknown }) {
    const page = input?.page === 'lead' ? 'lead' : 'contact';
    const name = String(input?.name ?? '').trim();
    if (!name || name.length > 60) throw new AppError('Give the view a name of up to 60 characters', 400);
    const { count } = await supabaseAdmin
      .from('contact_saved_views').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('page', page);
    if ((count || 0) >= 30) throw new AppError('Up to 30 saved views per page', 400);
    const { data, error } = await supabaseAdmin
      .from('contact_saved_views')
      .insert({ user_id: userId, page, name, config: sanitizeViewConfig(input?.config), position: count || 0 })
      .select('id, page, name, config, position, created_at, updated_at')
      .single();
    if (error) {
      if (missing096(error, /contact_saved_views/)) throw needs096('Saving views');
      if ((error as any).code === '23505') throw new AppError('You already have a view with that name', 409);
      throw new AppError(error.message, 500);
    }
    return data;
  },

  async updateView(userId: string, id: string, input: { name?: unknown; config?: unknown }) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input?.name !== undefined) {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > 60) throw new AppError('Give the view a name of up to 60 characters', 400);
      patch.name = name;
    }
    if (input?.config !== undefined) patch.config = sanitizeViewConfig(input.config);
    const { data, error } = await supabaseAdmin
      .from('contact_saved_views')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, page, name, config, position, created_at, updated_at')
      .maybeSingle();
    if (error) {
      if (missing096(error, /contact_saved_views/)) throw needs096('Saving views');
      if ((error as any).code === '23505') throw new AppError('You already have a view with that name', 409);
      throw new AppError(error.message, 500);
    }
    if (!data) throw new AppError('View not found', 404);
    return data;
  },

  async deleteView(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('contact_saved_views').delete().eq('id', id).eq('user_id', userId);
    if (error) {
      if (missing096(error, /contact_saved_views/)) throw needs096('Saved views');
      throw new AppError(error.message, 500);
    }
  },

  /* ── Bulk edit ──────────────────────────────────────────────────────── */

  /**
   * One change applied to many contacts.
   *
   * The field is checked against BULK_EDIT_FIELDS, never taken as a column
   * name from the body, and the ids are re-checked against the caller's
   * own contacts. Writes go 200 at a time, the same slice size every other
   * bulk path here uses, and stop at BULK_EDIT_MAX.
   */
  async bulkEdit(userId: string, contactIds: unknown, input: BulkEditInput) {
    const ids = [...new Set((Array.isArray(contactIds) ? contactIds : []).filter((x): x is string => typeof x === 'string'))];
    if (ids.length === 0) throw new AppError('No contacts given', 400);
    if (ids.length > BULK_EDIT_MAX) throw new AppError(`Up to ${BULK_EDIT_MAX.toLocaleString()} contacts at a time`, 400);
    const op = (input as any)?.op;

    if (op === 'add_tags' || op === 'remove_tags') {
      const tagIds = Array.isArray((input as any).tag_ids) ? (input as any).tag_ids.filter((t: unknown) => typeof t === 'string') : [];
      if (tagIds.length === 0) throw new AppError('Choose at least one tag', 400);
      if (op === 'add_tags') await contactsService.bulkTag(userId, ids, tagIds);
      else await contactsService.bulkUntag(userId, ids, tagIds);
      return { updated: ids.length, op };
    }

    if (op === 'set_custom' || op === 'clear_custom') {
      const key = cleanCustomFieldKey((input as any).key);
      if (!key) throw new AppError('Name the custom field (up to 64 characters)', 400);
      const value = op === 'set_custom' ? String((input as any).value ?? '').trim().slice(0, 1000) : null;
      if (op === 'set_custom' && !value) throw new AppError('Give a value, or clear the field instead', 400);
      let updated = 0;
      for (const slice of chunk(ids)) {
        const { data, error } = await supabaseAdmin.rpc('contacts_set_custom_field', {
          p_user_id: userId, p_contact_ids: slice, p_key: key, p_value: value,
        });
        if (error) {
          if (missing096(error, /contacts_set_custom_field/)) throw needs096('Editing custom fields in bulk');
          throw new AppError(error.message, 500);
        }
        updated += Number(data) || 0;
      }
      fireEvent(userId, 'contacts.bulk_updated', { count: updated, field: `custom:${key}` }).catch(() => {});
      return { updated, op };
    }

    if (op !== 'set' && op !== 'clear') throw new AppError('Unknown bulk edit', 400);
    const field = (input as any).field;
    if (!(BULK_EDIT_FIELDS as readonly string[]).includes(field)) {
      throw new AppError(`Only ${BULK_EDIT_FIELDS.join(', ')} can be edited in bulk`, 400);
    }
    let value: string | null = null;
    if (op === 'set') {
      value = String((input as any).value ?? '').trim().slice(0, 500);
      if (!value) throw new AppError('Give a value, or clear the field instead', 400);
    }

    let updated = 0;
    for (const slice of chunk(ids)) {
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .update({ [field]: value })
        .eq('user_id', userId)
        .in('id', slice)
        .select('id');
      if (error) throw new AppError(error.message, 500);
      updated += data?.length || 0;
    }
    fireEvent(userId, 'contacts.bulk_updated', { count: updated, field }).catch(() => {});
    return { updated, op };
  },
};
