import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { getPagination, formatPaginatedResponse } from '../utils/pagination.js';

export type SuppressionReason = 'unsubscribed' | 'bounced' | 'complained' | 'manual';

export const suppressionService = {
  async list(userId: string, params: { page?: number; limit?: number; search?: string; reason?: string }) {
    const { page, limit, from, to } = getPagination(params);

    let query = supabaseAdmin
      .from('suppression_list')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    if (params.search) {
      query = query.ilike('email', `%${params.search}%`);
    }
    if (params.reason) {
      query = query.eq('reason', params.reason);
    }

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data, count, error } = await query;
    if (error) throw new AppError(error.message, 500);

    return formatPaginatedResponse(data || [], count || 0, page, limit);
  },

  async add(userId: string, email: string, reason: SuppressionReason = 'manual', notes?: string) {
    const normalised = email.toLowerCase().trim();
    const { data, error } = await supabaseAdmin
      .from('suppression_list')
      .upsert(
        { user_id: userId, email: normalised, reason, notes, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,email', ignoreDuplicates: false }
      )
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Suppression entry not returned after upsert', 500);
    return data;
  },

  async addBulk(userId: string, emails: string[], reason: SuppressionReason = 'manual') {
    // Dedup within the batch (last occurrence wins), same rule bulkCreate
    // uses — Postgres upsert errors ("ON CONFLICT DO UPDATE command cannot
    // affect row a second time") if two rows in one call share a conflict key.
    const rowsByEmail = new Map<string, { user_id: string; email: string; reason: SuppressionReason; updated_at: string }>();
    for (const e of emails) {
      const email = e.toLowerCase().trim();
      if (!email) continue;
      rowsByEmail.set(email, { user_id: userId, email, reason, updated_at: new Date().toISOString() });
    }
    const rows = Array.from(rowsByEmail.values());
    if (rows.length === 0) return { added: 0, duplicates_collapsed: 0 };

    const { error } = await supabaseAdmin
      .from('suppression_list')
      .upsert(rows, { onConflict: 'user_id,email', ignoreDuplicates: false });
    if (error) throw new AppError(error.message, 500);
    return { added: rows.length, duplicates_collapsed: emails.length - rows.length };
  },

  async remove(userId: string, email: string) {
    const { error } = await supabaseAdmin
      .from('suppression_list')
      .delete()
      .eq('user_id', userId)
      .eq('email', email.toLowerCase().trim());
    if (error) throw new AppError(error.message, 500);
  },

  async isSuppressed(userId: string, email: string): Promise<boolean> {
    const { data } = await supabaseAdmin
      .from('suppression_list')
      .select('id')
      .eq('user_id', userId)
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();
    return !!data;
  },
};
