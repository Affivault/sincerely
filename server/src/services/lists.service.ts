import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import type { CreateContactListInput, UpdateContactListInput, BulkActionResult } from '@lemlist/shared';

export const listsService = {
  async list(userId: string) {
    // Get lists with contact counts
    const { data: lists, error } = await supabaseAdmin
      .from('contact_lists')
      .select('*')
      .eq('user_id', userId)
      .eq('is_trashed', false)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw new AppError(error.message, 500);

    // Get contact counts for each list
    const listIds = (lists || []).map((l: any) => l.id);

    if (listIds.length === 0) return [];

    const { data: counts, error: countError } = await supabaseAdmin
      .from('list_contacts')
      .select('list_id')
      .in('list_id', listIds);

    if (countError) throw new AppError(countError.message, 500);

    // Count contacts per list
    const countMap: Record<string, number> = {};
    for (const row of counts || []) {
      countMap[row.list_id] = (countMap[row.list_id] || 0) + 1;
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
      .single();

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
      .insert({ ...input, user_id: userId })
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
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

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

    const { data, error } = await supabaseAdmin
      .from('list_contacts')
      .select('contact_id')
      .eq('list_id', listId);

    if (error) throw new AppError(error.message, 500);

    return (data || []).map((row: any) => row.contact_id);
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
};
