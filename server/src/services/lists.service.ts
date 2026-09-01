import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { writable } from '../utils/writable-fields.js';
import type { CreateContactListInput, UpdateContactListInput, BulkActionResult, ListKind } from '@lemlist/shared';

/**
 * `is_default` is absent deliberately: exactly one list is the default, and
 * that is moved by the dedicated path, not by whatever a request body says.
 *
 * `kind` IS writable, so a list created in the wrong place can be converted
 * rather than rebuilt. Converting one that a campaign still sends to is
 * refused by the database, not here - see migration 058.
 */
const LIST_FIELDS = ['name', 'description', 'color', 'icon', 'folder_id', 'kind'] as const;

export const listsService = {
  /**
   * @param kind Restrict to lead or contact lists. Omitted returns both,
   *   which is what the campaign-agnostic callers (a contact's memberships,
   *   the trash) want.
   */
  async list(userId: string, kind?: ListKind) {
    // Get lists with contact counts
    let query = supabaseAdmin
      .from('contact_lists')
      .select('*')
      .eq('user_id', userId)
      .eq('is_trashed', false);

    if (kind) query = query.eq('kind', kind);

    const { data: lists, error } = await query
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw new AppError(error.message, 500);

    // Get contact counts for each list
    const listIds = (lists || []).map((l: any) => l.id);

    if (listIds.length === 0) return [];

    // Page through every membership — Supabase caps a single select at ~1000
    // rows, so lists whose combined memberships exceed that (common once a
    // user has several imported lists) would otherwise silently undercount.
    const countMap: Record<string, number> = {};
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data: counts, error: countError } = await supabaseAdmin
        .from('list_contacts')
        .select('list_id')
        .in('list_id', listIds)
        .range(from, from + pageSize - 1);

      if (countError) throw new AppError(countError.message, 500);

      const rows = counts || [];
      for (const row of rows) {
        countMap[row.list_id] = (countMap[row.list_id] || 0) + 1;
      }
      if (rows.length < pageSize) break;
    }

    return (lists || []).map((list: any) => ({
      ...list,
      contact_count: countMap[list.id] || 0,
    }));
  },

  async get(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('contact_lists')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .eq('is_trashed', false)
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('List not found', 404);

    // Get contact count
    const { count } = await supabaseAdmin
      .from('list_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('list_id', id);

    return { ...data, contact_count: count || 0 };
  },

  async create(userId: string, input: CreateContactListInput) {
    const { data, error } = await supabaseAdmin
      .from('contact_lists')
      .insert({ ...writable(input, LIST_FIELDS), user_id: userId })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new AppError('List with this name already exists', 409);
      throw new AppError(error.message, 500);
    }

    return { ...data, contact_count: 0 };
  },

  async update(userId: string, id: string, input: UpdateContactListInput) {
    // Don't allow renaming the default list
    const existing = await this.get(userId, id);
    if (existing.is_default && input.name && input.name !== existing.name) {
      throw new AppError('Cannot rename the default list', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('contact_lists')
      .update(writable(input, LIST_FIELDS))
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('List not found', 404);

    return data;
  },

  async delete(userId: string, id: string) {
    // Don't allow deleting the default list
    const existing = await this.get(userId, id);
    if (existing.is_default) {
      throw new AppError('Cannot delete the default list', 400);
    }

    const { error } = await supabaseAdmin
      .from('contact_lists')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
  },

  async addContacts(userId: string, listId: string, contactIds: string[]): Promise<BulkActionResult> {
    if (!Array.isArray(contactIds) || contactIds.length === 0) return { success: 0, failed: 0 };

    // Verify list belongs to user
    await this.get(userId, listId);

    // Verify contacts belong to user
    const { data: contacts } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('user_id', userId)
      .in('id', contactIds);

    const validIds = (contacts || []).map((c: any) => c.id);
    const rows = validIds.map((contactId: string) => ({ list_id: listId, contact_id: contactId }));

    let success = 0;
    let failed = 0;

    for (const row of rows) {
      const { error } = await supabaseAdmin
        .from('list_contacts')
        .upsert(row, { onConflict: 'list_id,contact_id' });

      if (error) {
        failed++;
      } else {
        success++;
      }
    }

    return { success, failed };
  },

  async removeContacts(userId: string, listId: string, contactIds: string[]): Promise<BulkActionResult> {
    if (!Array.isArray(contactIds) || contactIds.length === 0) return { success: 0, failed: 0 };

    // Verify list belongs to user
    await this.get(userId, listId);

    const { error, count } = await supabaseAdmin
      .from('list_contacts')
      .delete()
      .eq('list_id', listId)
      .in('contact_id', contactIds);

    if (error) throw new AppError(error.message, 500);

    return { success: count || 0, failed: 0 };
  },

  async getContactsInList(userId: string, listId: string) {
    // Verify list belongs to user
    await this.get(userId, listId);

    // Page through every membership — Supabase caps a single select at ~1000
    // rows, so a large list would otherwise silently return only its first
    // 1000 contacts when "Add from list" is used in the campaign builder.
    const pageSize = 1000;
    const ids: string[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabaseAdmin
        .from('list_contacts')
        .select('contact_id')
        .eq('list_id', listId)
        .range(from, from + pageSize - 1);
      if (error) throw new AppError(error.message, 500);
      const rows = data || [];
      for (const row of rows) ids.push(row.contact_id);
      if (rows.length < pageSize) break;
    }
    return ids;
  },

  async getListsForContact(userId: string, contactId: string) {
    // Get all list_ids this contact is on
    const { data: memberships, error: memError } = await supabaseAdmin
      .from('list_contacts')
      .select('list_id')
      .eq('contact_id', contactId);

    if (memError) throw new AppError(memError.message, 500);

    const memberListIds = (memberships || []).map((m: any) => m.list_id);

    // Get all lists for user
    const { data: lists, error } = await supabaseAdmin
      .from('contact_lists')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (error) throw new AppError(error.message, 500);

    return (lists || []).map((list: any) => ({
      ...list,
      is_member: memberListIds.includes(list.id),
    }));
  },

  async moveContact(userId: string, contactId: string, fromListId: string, toListId: string) {
    // Validate the target list up front — addContacts() would do this too,
    // but only after removeContacts() below has already committed, which
    // would leave the contact removed from the source list and never added
    // to an invalid target (vanishing from both).
    await this.get(userId, toListId);
    // Remove from source list
    await this.removeContacts(userId, fromListId, [contactId]);
    // Add to target list
    await this.addContacts(userId, toListId, [contactId]);
    return { success: true };
  },

  async createDefaultList(userId: string) {
    // Check if default list already exists
    const { data: existing } = await supabaseAdmin
      .from('contact_lists')
      .select('id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .single();

    if (existing) return existing;

    const { data, error } = await supabaseAdmin
      .from('contact_lists')
      .insert({
        user_id: userId,
        name: 'All Contacts',
        description: 'Default list containing all your contacts',
        is_default: true,
        icon: 'users',
        color: '#10B981',
      })
      .select()
      .single();

    if (error && error.code !== '23505') {
      throw new AppError(error.message, 500);
    }

    return data;
  },

  /**
   * Of the contacts asked about, the ones filed only in the CRM.
   *
   * "Only" is the whole rule. Being in a contact list does not by itself put
   * somebody out of reach - plenty of people sit in both, and putting a
   * customer into a lead list is a deliberate act that says "pitch this one
   * anyway". What must never happen is a cold sequence reaching somebody
   * whose only presence in this account is a CRM record.
   *
   * Contacts on no list at all are not returned. They are unfiled, not
   * protected, and refusing them here would break importing straight into a
   * campaign - which is how most people start.
   *
   * Throws rather than returning empty. Like the open-deal guard, a filter
   * that fails quietly reads as "nobody is protected" and sends anyway.
   */
  async contactsOnlyInCrmLists(userId: string, contactIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (contactIds.length === 0) return out;

    const onLead = new Set<string>();
    const onContact = new Set<string>();

    // Chunked on the way in (a long `in` list is a long URL) and paged on the
    // way out (PostgREST caps a select at ~1000 rows, and a popular list
    // blows past that on its own).
    const CHUNK = 200;
    const PAGE = 1000;
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const slice = contactIds.slice(i, i + CHUNK);
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from('list_contacts')
          .select('contact_id, contact_lists!inner(kind, user_id, is_trashed)')
          .in('contact_id', slice)
          .eq('contact_lists.user_id', userId)
          .eq('contact_lists.is_trashed', false)
          .range(from, from + PAGE - 1);

        if (error) throw new AppError(`Could not read list membership: ${error.message}`, 500);

        const rows = data || [];
        for (const row of rows as any[]) {
          const kind = row.contact_lists?.kind;
          if (kind === 'contact') onContact.add(row.contact_id);
          else if (kind === 'lead') onLead.add(row.contact_id);
        }
        if (rows.length < PAGE) break;
      }
    }

    for (const id of onContact) if (!onLead.has(id)) out.add(id);
    return out;
  },
};
