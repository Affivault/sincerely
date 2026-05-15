import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { getPagination, formatPaginatedResponse } from '../utils/pagination.js';
import { fireEvent } from './webhook.service.js';
import Papa from 'papaparse';
import fs from 'node:fs';

interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  tag_ids?: string[];
  list_id?: string;
  is_unsubscribed?: boolean;
  is_bounced?: boolean;
  dcs_min?: number;
  dcs_max?: number;
  sort_by?: string;
  sort_order?: string;
}

export const contactsService = {
  async list(userId: string, params: ListParams) {
    const { page, limit, from, to } = getPagination(params);

    // If filtering by list_id, get contact IDs in that list first
    let listContactIds: string[] | null = null;
    if (params.list_id) {
      const { data: listContacts } = await supabaseAdmin
        .from('list_contacts')
        .select('contact_id')
        .eq('list_id', params.list_id);
      listContactIds = (listContacts || []).map((lc: any) => lc.contact_id);
      if (listContactIds.length === 0) {
        return formatPaginatedResponse([], 0, page, limit);
      }
    }

    // If filtering by tag_ids, resolve to contact IDs first (keeps DB count accurate)
    let tagFilterContactIds: string[] | null = null;
    if (params.tag_ids && params.tag_ids.length > 0) {
      const { data: tagContacts } = await supabaseAdmin
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', params.tag_ids);
      tagFilterContactIds = [...new Set((tagContacts || []).map((tc: any) => tc.contact_id as string))];
      if (tagFilterContactIds.length === 0) {
        return formatPaginatedResponse([], 0, page, limit);
      }
    }

    let query = supabaseAdmin
      .from('contacts')
      .select('*, contact_tags(tag_id, tags(*))', { count: 'exact' })
      .eq('user_id', userId);

    // Filter by list contacts if specified
    if (listContactIds) {
      query = query.in('id', listContactIds);
    }

    // Filter by tag contacts if specified
    if (tagFilterContactIds) {
      query = query.in('id', tagFilterContactIds);
    }

    if (params.search) {
      query = query.or(`email.ilike.%${params.search}%,first_name.ilike.%${params.search}%,last_name.ilike.%${params.search}%,company.ilike.%${params.search}%`);
    }

    if (params.is_unsubscribed !== undefined) {
      query = query.eq('is_unsubscribed', params.is_unsubscribed);
    }

    if (params.is_bounced !== undefined) {
      query = query.eq('is_bounced', params.is_bounced);
    }

    if (params.dcs_min !== undefined) {
      query = query.gte('dcs_score', params.dcs_min);
    }

    if (params.dcs_max !== undefined) {
      query = query.lte('dcs_score', params.dcs_max);
    }

    const sortBy = params.sort_by || 'created_at';
    const sortOrder = params.sort_order === 'asc';
    query = query.order(sortBy, { ascending: sortOrder }).range(from, to);

    const { data, count, error } = await query;
    if (error) throw new AppError(error.message, 500);

    const contacts = (data || []).map((c: any) => ({
      ...c,
      tags: (c.contact_tags || []).map((ct: any) => ct.tags).filter(Boolean),
      contact_tags: undefined,
    }));

    return formatPaginatedResponse(contacts, count || 0, page, limit);
  },

  async get(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('*, contact_tags(tag_id, tags(*))')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Contact not found', 404);

    return {
      ...data,
      tags: (data.contact_tags || []).map((ct: any) => ct.tags).filter(Boolean),
      contact_tags: undefined,
    };
  },

  async create(userId: string, input: any) {
    const { tag_ids, ...contactData } = input;

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({ ...contactData, user_id: userId, source: 'manual' })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new AppError('Contact with this email already exists', 409);
      throw new AppError(error.message, 500);
    }

    if (tag_ids && tag_ids.length > 0) {
      const tagRows = tag_ids.map((tagId: string) => ({ contact_id: data.id, tag_id: tagId }));
      await supabaseAdmin.from('contact_tags').insert(tagRows);
    }

    fireEvent(userId, 'contact.created', { contact: data }).catch(() => {});
    return data;
  },

  async update(userId: string, id: string, input: any) {
    const { tag_ids, ...contactData } = input;

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .update(contactData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Contact not found', 404);
    fireEvent(userId, 'contact.updated', { contact: data }).catch(() => {});
    return data;
  },

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('contacts')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
    fireEvent(userId, 'contact.deleted', { contact_id: id }).catch(() => {});
  },

  async importCsv(userId: string, filePath: string, columnMapping: Record<string, string>) {
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(filePath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Failed to read upload file: ${err.message}`);
    }
    const parsed = Papa.parse(fileContent, { header: true, skipEmptyLines: true });

    let imported = 0;
    let errors = 0;

    for (const row of parsed.data as Record<string, string>[]) {
      const contact: Record<string, any> = { user_id: userId, source: 'csv_import' };

      for (const [csvCol, dbField] of Object.entries(columnMapping)) {
        if (row[csvCol] !== undefined && row[csvCol] !== '') {
          contact[dbField] = row[csvCol];
        }
      }

      if (!contact.email) {
        errors++;
        continue;
      }

      const { error } = await supabaseAdmin.from('contacts').upsert(
        contact,
        { onConflict: 'user_id,email' }
      );

      if (error) {
        errors++;
      } else {
        imported++;
      }
    }

    return { imported, errors };
  },

  async bulkTag(userId: string, contactIds: string[], tagIds: string[]) {
    // Verify contacts belong to user
    const { data: contacts } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('user_id', userId)
      .in('id', contactIds);

    const validIds = (contacts || []).map((c: any) => c.id);
    const rows = validIds.flatMap((cId: string) =>
      tagIds.map((tId: string) => ({ contact_id: cId, tag_id: tId }))
    );

    if (rows.length > 0) {
      await supabaseAdmin.from('contact_tags').upsert(rows, { onConflict: 'contact_id,tag_id' });
    }
  },

  async bulkUntag(userId: string, contactIds: string[], tagIds: string[]) {
    const { data: contacts } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('user_id', userId)
      .in('id', contactIds);

    const validIds = (contacts || []).map((c: any) => c.id);

    for (const contactId of validIds) {
      await supabaseAdmin
        .from('contact_tags')
        .delete()
        .eq('contact_id', contactId)
        .in('tag_id', tagIds);
    }
  },

  async bulkDelete(userId: string, contactIds: string[]) {
    // Verify contacts belong to user and delete them
    const { error, count } = await supabaseAdmin
      .from('contacts')
      .delete()
      .eq('user_id', userId)
      .in('id', contactIds);

    if (error) throw new AppError(error.message, 500);

    for (const id of contactIds) {
      fireEvent(userId, 'contact.deleted', { contact_id: id }).catch(() => {});
    }

    return { deleted: count || 0 };
  },

  async export(userId: string, contactIds?: string[], format: 'csv' | 'json' = 'csv') {
    let query = supabaseAdmin
      .from('contacts')
      .select('email, first_name, last_name, company, job_title, phone, linkedin_url, website, source, is_unsubscribed, is_bounced, dcs_score, created_at')
      .eq('user_id', userId);

    if (contactIds && contactIds.length > 0) {
      query = query.in('id', contactIds);
    }

    const { data, error } = await query;
    if (error) throw new AppError(error.message, 500);

    if (format === 'json') {
      return { data, format: 'json' };
    }

    // CSV format
    const csv = Papa.unparse(data || []);
    return { data: csv, format: 'csv' };
  },

  async getStats(userId: string) {
    const { count: total } = await supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const { count: unsubscribed } = await supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_unsubscribed', true);

    const { count: bounced } = await supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_bounced', true);

    const { count: verified } = await supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('dcs_score', 'is', null);

    return {
      total: total || 0,
      unsubscribed: unsubscribed || 0,
      bounced: bounced || 0,
      verified: verified || 0,
      active: (total || 0) - (unsubscribed || 0) - (bounced || 0),
    };
  },
};
