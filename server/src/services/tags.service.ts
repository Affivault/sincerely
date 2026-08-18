import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { writable } from '../utils/writable-fields.js';

const TAG_FIELDS = ['name', 'color'] as const;

export const tagsService = {
  async list(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('tags')
      .select('*')
      .eq('user_id', userId)
      .order('name');

    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async create(userId: string, input: { name: string; color?: string }) {
    const { data, error } = await supabaseAdmin
      .from('tags')
      .insert({ user_id: userId, name: input.name, color: input.color || '#6B7280' })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new AppError('Tag with this name already exists', 409);
      throw new AppError(error.message, 500);
    }
    return data;
  },

  async update(userId: string, id: string, input: { name?: string; color?: string }) {
    const { data, error } = await supabaseAdmin
      .from('tags')
      .update(writable(input, TAG_FIELDS))
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Tag not found', 404);
    return data;
  },

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('tags')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
  },
};
