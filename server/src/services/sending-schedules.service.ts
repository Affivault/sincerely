import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';

export interface SendingScheduleInput {
  name: string;
  timezone?: string;
  send_window_start?: string;
  send_window_end?: string;
  send_days?: string[];
  is_default?: boolean;
}

export const sendingSchedulesService = {
  async list(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('sending_schedules')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async getDefault(userId: string) {
    const { data } = await supabaseAdmin
      .from('sending_schedules')
      .select('*')
      .eq('user_id', userId)
      .eq('is_default', true)
      .maybeSingle();
    return data;
  },

  async create(userId: string, input: SendingScheduleInput) {
    // If marking as default, unset any existing default
    if (input.is_default) {
      await supabaseAdmin
        .from('sending_schedules')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('is_default', true);
    }

    const { data, error } = await supabaseAdmin
      .from('sending_schedules')
      .insert({ user_id: userId, ...input })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new AppError('Schedule with this name already exists', 409);
      throw new AppError(error.message, 500);
    }
    return data;
  },

  async update(userId: string, id: string, input: Partial<SendingScheduleInput>) {
    if (input.is_default) {
      await supabaseAdmin
        .from('sending_schedules')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('is_default', true)
        .neq('id', id);
    }
    const { data, error } = await supabaseAdmin
      .from('sending_schedules')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Schedule not found', 404);
    return data;
  },

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('sending_schedules').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },
};
