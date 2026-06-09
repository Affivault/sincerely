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
      // Strip ILIKE wildcard characters so user input can't match unintended rows
      const safeSearch = params.search.replace(/[%_]/g, '');
      if (safeSearch) {
        query = query.or(`email.ilike.%${safeSearch}%,first_name.ilike.%${safeSearch}%,last_name.ilike.%${safeSearch}%,company.ilike.%${safeSearch}%`);
      }
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

    // Apply tag updates when tag_ids is explicitly provided
    if (Array.isArray(tag_ids)) {
      await supabaseAdmin.from('contact_tags').delete().eq('contact_id', id);
      if (tag_ids.length > 0) {
        const tagRows = tag_ids.map((tagId: string) => ({ contact_id: id, tag_id: tagId }));
        await supabaseAdmin.from('contact_tags').insert(tagRows);
      }
    }

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

  async bulkCreate(
    userId: string,
    contacts: Array<Record<string, any>>,
    listId?: string
  ): Promise<{
    total: number;
    imported: number;
    errors: number;
    duplicates_collapsed?: number;
    error_details: { email: string; reason: string }[];
  }> {
    const total = contacts.length;
    const errorDetails: { email: string; reason: string }[] = [];
    const valid: any[] = [];
    const ALLOWED_FIELDS = new Set([
      'email', 'first_name', 'last_name', 'company',
      'job_title', 'phone', 'linkedin_url', 'website',
    ]);
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (const c of contacts) {
      const rawEmail = typeof c.email === 'string' ? c.email.trim() : '';
      if (!rawEmail) {
        errorDetails.push({ email: '(missing)', reason: 'Email is required' });
        continue;
      }
      const email = rawEmail.toLowerCase();
      if (!EMAIL_RE.test(email)) {
        errorDetails.push({ email: rawEmail, reason: 'Invalid email format' });
        continue;
      }

      const row: Record<string, any> = {
        user_id: userId,
        source: 'csv_import',
        email,
      };
      for (const [k, v] of Object.entries(c)) {
        if (!ALLOWED_FIELDS.has(k) || k === 'email') continue;
        if (v == null) continue;
        const trimmed = typeof v === 'string' ? v.trim() : v;
        if (trimmed === '') continue;
        row[k] = trimmed;
      }
      valid.push(row);
    }

    if (valid.length === 0) {
      return { total, imported: 0, errors: errorDetails.length, error_details: errorDetails.slice(0, 200) };
    }

    // Deduplicate within the batch — PostgreSQL upsert errors on multiple rows
    // matching the same conflict key. Last occurrence wins so later CSV rows
    // can fill missing fields from earlier ones.
    const uniqueByEmail = new Map<string, any>();
    for (const row of valid) uniqueByEmail.set(row.email, row);
    const uniqueValid = Array.from(uniqueByEmail.values());
    const duplicatesCollapsed = valid.length - uniqueValid.length;

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .upsert(uniqueValid, { onConflict: 'user_id,email' })
      .select('id, email');

    if (error) {
      return {
        total,
        imported: 0,
        errors: total,
        error_details: [{ email: '(batch)', reason: error.message }],
      };
    }

    const importedRows = data || [];

    if (listId && importedRows.length > 0) {
      // Verify the list belongs to this user before attaching members
      const { data: list } = await supabaseAdmin
        .from('contact_lists')
        .select('id')
        .eq('id', listId)
        .eq('user_id', userId)
        .maybeSingle();

      if (list) {
        const memberships = importedRows.map((r: any) => ({
          list_id: listId,
          contact_id: r.id,
        }));
        const { error: memErr } = await supabaseAdmin
          .from('list_contacts')
          .upsert(memberships, { onConflict: 'list_id,contact_id' });
        if (memErr) {
          // Don't fail the whole import — record as soft error
          errorDetails.push({ email: '(list assignment)', reason: memErr.message });
        }
      }
    }

    // Failures = rows we tried to upsert (after collapsing duplicates) but
    // didn't get back. Duplicates collapsed in-batch are not failures —
    // they're legitimate consolidations the user expects.
    const upsertFailures = Math.max(0, uniqueValid.length - importedRows.length);
    return {
      total,
      imported: importedRows.length,
      errors: errorDetails.length + upsertFailures,
      duplicates_collapsed: duplicatesCollapsed,
      error_details: errorDetails.slice(0, 200),
    };
  },

  async importCsv(userId: string, filePath: string, columnMapping: Record<string, string>) {
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(filePath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Failed to read upload file: ${err.message}`);
    } finally {
      try { fs.unlinkSync(filePath); } catch { /* ignore cleanup errors */ }
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

      // Normalize email consistently with bulkCreate to ensure deduplication works
      contact.email = String(contact.email).trim().toLowerCase();

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
    if (!tagIds || tagIds.length === 0) return;

    const { data: contacts } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('user_id', userId)
      .in('id', contactIds);

    const validIds = (contacts || []).map((c: any) => c.id);
    if (validIds.length === 0) return;

    const { error } = await supabaseAdmin
      .from('contact_tags')
      .delete()
      .in('contact_id', validIds)
      .in('tag_id', tagIds);
    if (error) throw new AppError(error.message, 500);
  },

  async bulkDelete(userId: string, contactIds: string[]) {
    // Verify contacts belong to user before deleting
    const { data: owned } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('user_id', userId)
      .in('id', contactIds);

    const validIds = (owned || []).map((c: any) => c.id as string);
    if (validIds.length === 0) return { deleted: 0 };

    const { error } = await supabaseAdmin
      .from('contacts')
      .delete()
      .eq('user_id', userId)
      .in('id', validIds);

    if (error) throw new AppError(error.message, 500);

    for (const id of validIds) {
      fireEvent(userId, 'contact.deleted', { contact_id: id }).catch(() => {});
    }

    return { deleted: validIds.length };
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
      active: Math.max(0, (total || 0) - (unsubscribed || 0) - (bounced || 0)),
    };
  },
};
