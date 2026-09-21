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
    // Insert without is_default first: the old default (if any) must stay
    // intact until this row exists, so a failed insert never leaves the
    // account with zero defaults.
    const { is_default, ...rest } = input;
    const { data, error } = await supabaseAdmin
      .from('sending_schedules')
      .insert({ user_id: userId, ...rest, is_default: false })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new AppError('Schedule with this name already exists', 409);
      throw new AppError(error.message, 500);
    }

    if (is_default) {
      // Clearing the old default and setting the new one happens in a
      // single atomic UPDATE (see migration 061) so there's never a moment
      // with zero, or two, default schedules for this user.
      const { error: swapError } = await supabaseAdmin.rpc('set_default_sending_schedule', {
        p_user_id: userId,
        p_schedule_id: data.id,
      });
      if (swapError) throw new AppError(swapError.message, 500);
      data.is_default = true;
    }
    return data;
  },

  async update(userId: string, id: string, input: Partial<SendingScheduleInput>) {
    const { is_default, ...rest } = input;
    // "Make default" sends { is_default: true } alone, so `rest` can be
    // empty here — PostgREST rejects a PATCH with no columns, so only issue
    // the field update when there's actually a field to change.
    let data: any;
    if (Object.keys(rest).length > 0) {
      const { data: updated, error } = await supabaseAdmin
        .from('sending_schedules')
        .update(rest)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .maybeSingle();
      if (error) {
        if (error.code === '23505') throw new AppError('Schedule with this name already exists', 409);
        throw new AppError(error.message, 500);
      }
      data = updated;
    } else {
      const { data: existing, error } = await supabaseAdmin
        .from('sending_schedules')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new AppError(error.message, 500);
      data = existing;
    }
    if (!data) throw new AppError('Schedule not found', 404);

    if (is_default === true) {
      const { error: swapError } = await supabaseAdmin.rpc('set_default_sending_schedule', {
        p_user_id: userId,
        p_schedule_id: id,
      });
      if (swapError) throw new AppError(swapError.message, 500);
      data.is_default = true;
    } else if (is_default === false) {
      // A schedule can only stop being default by another one taking its
      // place (see `set_default_sending_schedule`, migration 061) — turning
      // this flag off on its own would leave the account with zero
      // defaults, the exact bug that RPC exists to prevent.
      if (data.is_default) {
        throw new AppError(
          'Cannot unset the default schedule directly — set a different schedule as default instead',
          409,
        );
      }
    }
    return data;
  },

  async delete(userId: string, id: string) {
    // Deleting the default left the account with zero default schedules —
    // nothing here or in the database (migration 014's partial unique index
    // only enforces "at most one", not "at least one") ever promoted another
    // schedule to take its place. getDefault() then silently returns null,
    // which is indistinguishable from "this account has never set one up".
    const { data: existing } = await supabaseAdmin
      .from('sending_schedules')
      .select('is_default')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from('sending_schedules').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);

    if (existing?.is_default) {
      const { data: next } = await supabaseAdmin
        .from('sending_schedules')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (next) {
        // Same atomic RPC create()/update() use to swap the default — with
        // the old default already gone, this is just a plain set.
        const { error: promoteError } = await supabaseAdmin.rpc('set_default_sending_schedule', {
          p_user_id: userId,
          p_schedule_id: next.id,
        });
        if (promoteError) {
          console.error(`[SendingSchedules] Failed to promote a new default for ${userId} after deleting ${id}:`, promoteError.message);
        }
      }
    }
  },
};
