import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';

export const listFoldersService = {
  async list(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('list_folders')
      .select('*')
      .eq('user_id', userId)
      .order('position', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw new AppError(error.message, 500);

    const folders = data || [];
    if (folders.length === 0) return [];

    const { data: lists } = await supabaseAdmin
      .from('contact_lists')
      .select('id, folder_id')
      .eq('user_id', userId)
      .eq('is_trashed', false)
      .not('folder_id', 'is', null);

    const counts: Record<string, number> = {};
    for (const l of lists || []) {
      if (l.folder_id) counts[l.folder_id] = (counts[l.folder_id] || 0) + 1;
    }

    return folders.map((f: any) => ({ ...f, list_count: counts[f.id] || 0 }));
  },

  async create(userId: string, input: { name: string; color?: string; icon?: string }) {
    const { data, error } = await supabaseAdmin
      .from('list_folders')
      .insert({ user_id: userId, ...input })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new AppError('Folder name already exists', 409);
      throw new AppError(error.message, 500);
    }
    return { ...data, list_count: 0 };
  },

  async update(userId: string, id: string, input: { name?: string; color?: string; icon?: string; position?: number }) {
    const { data, error } = await supabaseAdmin
      .from('list_folders').update(input).eq('id', id).eq('user_id', userId).select().maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Folder not found', 404);
    return data;
  },

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('list_folders').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  async moveList(userId: string, listId: string, folderId: string | null) {
    if (folderId) {
      const { data: folder } = await supabaseAdmin
        .from('list_folders').select('id').eq('id', folderId).eq('user_id', userId).single();
      if (!folder) throw new AppError('Folder not found', 404);
    }
    const { error } = await supabaseAdmin
      .from('contact_lists').update({ folder_id: folderId }).eq('id', listId).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  async trashList(userId: string, listId: string) {
    const { data: list } = await supabaseAdmin
      .from('contact_lists').select('is_default').eq('id', listId).eq('user_id', userId).single();
    if (!list) throw new AppError('List not found', 404);
    if (list.is_default) throw new AppError('Cannot trash the default list', 400);

    const { error } = await supabaseAdmin
      .from('contact_lists')
      .update({ is_trashed: true, trashed_at: new Date().toISOString() })
      .eq('id', listId).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  async restoreList(userId: string, listId: string) {
    const { error } = await supabaseAdmin
      .from('contact_lists')
      .update({ is_trashed: false, trashed_at: null })
      .eq('id', listId).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  async listTrashed(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('contact_lists')
      .select('*')
      .eq('user_id', userId)
      .eq('is_trashed', true)
      .order('trashed_at', { ascending: false });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },
};
