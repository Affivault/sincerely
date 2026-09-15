import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  EVENT_LOCATION_KINDS, DEFAULT_EVENT_COLOUR, isHexColour,
  type CalendarEventType, type CreateEventTypeInput,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Kinds of meeting.

   A calendar you can read at a glance is a calendar where colour means
   something, and colour can only mean something if the kinds are the
   account's own rather than two strings baked into the client.

   This is also the object a booking link will eventually be: "a kind of
   meeting other people may put in your diary" is the whole of what
   Calendly sells. Nothing here reaches for that yet - no availability, no
   slugs, no public anything - but it is the same row when it arrives.
   ═══════════════════════════════════════════════════════════════════════ */

const TYPE_SELECT = 'id, user_id, name, colour, duration_minutes, location_kind, is_default, archived_at, created_at, updated_at';

/**
 * What a brand-new account starts with.
 *
 * An empty list means the first thing somebody meets is a form asking them
 * to invent a taxonomy before they can book anything. Migration 062 seeds
 * these for accounts that already existed; this covers everybody after.
 */
const STARTER_TYPES: CreateEventTypeInput[] = [
  { name: 'Intro call', colour: '#6366f1', duration_minutes: 30, location_kind: 'video', is_default: true },
  { name: 'Discovery',  colour: '#0ea5e9', duration_minutes: 45, location_kind: 'video' },
  { name: 'Demo',       colour: '#10b981', duration_minutes: 60, location_kind: 'video' },
  { name: 'Follow-up',  colour: '#f59e0b', duration_minutes: 15, location_kind: 'phone' },
];

const LOCATION_IDS = EVENT_LOCATION_KINDS.map((k) => k.id) as string[];

function validate(input: CreateEventTypeInput, partial = false): Record<string, any> {
  const patch: Record<string, any> = {};

  if (input.name !== undefined || !partial) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new AppError('A kind of meeting needs a name.', 400);
    if (name.length > 80) throw new AppError('That name is too long for a calendar chip.', 400);
    patch.name = name;
  }

  if (input.colour !== undefined) {
    if (!isHexColour(input.colour)) {
      throw new AppError('A colour looks like #6366f1.', 400);
    }
    patch.colour = String(input.colour).toLowerCase();
  }

  if (input.duration_minutes !== undefined) {
    const n = Number(input.duration_minutes);
    if (!Number.isFinite(n) || n < 5 || n > 1440) {
      throw new AppError('A meeting runs between 5 minutes and a day.', 400);
    }
    patch.duration_minutes = Math.round(n);
  }

  if (input.location_kind !== undefined) {
    if (!LOCATION_IDS.includes(String(input.location_kind))) {
      throw new AppError(`Unknown location "${input.location_kind}".`, 400);
    }
    patch.location_kind = input.location_kind;
  }

  if (input.is_default !== undefined) patch.is_default = !!input.is_default;

  return patch;
}

export const calendarService = {
  /**
   * Every kind of meeting this account uses.
   *
   * Seeds the starter set on first read rather than at signup, so accounts
   * created before this existed are not left with a blank calendar and
   * nothing to book.
   */
  async listTypes(userId: string): Promise<CalendarEventType[]> {
    const { data, error } = await supabaseAdmin
      .from('calendar_event_types')
      .select(TYPE_SELECT)
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    if (data && data.length > 0) return data as CalendarEventType[];

    /*
     * Nothing yet. Seeded with ignoreDuplicates so two tabs opening the
     * calendar at the same moment cannot race into a unique violation on
     * (user_id, name) and show one of them an error on a page they only
     * looked at.
     */
    const { error: seedError } = await supabaseAdmin
      .from('calendar_event_types')
      .upsert(
        STARTER_TYPES.map((t) => ({
          user_id: userId,
          name: t.name,
          colour: t.colour ?? DEFAULT_EVENT_COLOUR,
          duration_minutes: t.duration_minutes ?? 30,
          location_kind: t.location_kind ?? 'video',
          is_default: !!t.is_default,
        })),
        { onConflict: 'user_id,name', ignoreDuplicates: true },
      );
    if (seedError) throw new AppError(seedError.message, 500);

    const { data: seeded, error: reread } = await supabaseAdmin
      .from('calendar_event_types')
      .select(TYPE_SELECT)
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (reread) throw new AppError(reread.message, 500);
    return (seeded || []) as CalendarEventType[];
  },

  async createType(userId: string, input: CreateEventTypeInput): Promise<CalendarEventType> {
    const patch = validate(input);

    // Only one default can exist, enforced by a partial unique index. Clear
    // the old one first rather than letting the insert fail on it.
    if (patch.is_default) await this.clearDefault(userId);

    const { data, error } = await supabaseAdmin
      .from('calendar_event_types')
      .insert({
        user_id: userId,
        colour: DEFAULT_EVENT_COLOUR,
        duration_minutes: 30,
        location_kind: 'video',
        ...patch,
      })
      .select(TYPE_SELECT)
      .maybeSingle();

    if (error) {
      if ((error as any).code === '23505') {
        throw new AppError(`You already have a kind of meeting called "${patch.name}".`, 409);
      }
      throw new AppError(error.message, 500);
    }
    return data as CalendarEventType;
  },

  async updateType(userId: string, id: string, input: CreateEventTypeInput): Promise<CalendarEventType> {
    const patch = validate(input, true);
    if (Object.keys(patch).length === 0) return this.getType(userId, id);

    if (patch.is_default) await this.clearDefault(userId, id);

    const { data, error } = await supabaseAdmin
      .from('calendar_event_types')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
      .select(TYPE_SELECT)
      .maybeSingle();

    if (error) {
      if ((error as any).code === '23505') {
        throw new AppError(`You already have a kind of meeting called "${patch.name}".`, 409);
      }
      throw new AppError(error.message, 500);
    }
    if (!data) throw new AppError('That kind of meeting was not found.', 404);
    return data as CalendarEventType;
  },

  async getType(userId: string, id: string): Promise<CalendarEventType> {
    const { data, error } = await supabaseAdmin
      .from('calendar_event_types')
      .select(TYPE_SELECT)
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('That kind of meeting was not found.', 404);
    return data as CalendarEventType;
  },

  /**
   * Retire a kind of meeting without losing the ones already booked.
   *
   * Archived rather than deleted: events point at it, and a calendar whose
   * history turns grey because somebody tidied up a list is worse than one
   * carrying a type nobody books any more.
   */
  async archiveType(userId: string, id: string): Promise<{ archived: boolean; events: number }> {
    const existing = await this.getType(userId, id);

    const { count } = await supabaseAdmin
      .from('crm_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('event_type_id', id);

    const { error } = await supabaseAdmin
      .from('calendar_event_types')
      .update({ archived_at: new Date().toISOString(), is_default: false })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);

    // Losing the only default leaves a quick-add with nothing to book, so
    // the oldest survivor takes over.
    if (existing.is_default) await this.promoteADefault(userId);

    return { archived: true, events: count || 0 };
  },

  async clearDefault(userId: string, except?: string): Promise<void> {
    let q = supabaseAdmin
      .from('calendar_event_types')
      .update({ is_default: false })
      .eq('user_id', userId)
      .eq('is_default', true);
    if (except) q = q.neq('id', except);
    await q;
  },

  async promoteADefault(userId: string): Promise<void> {
    const { data } = await supabaseAdmin
      .from('calendar_event_types')
      .select('id')
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      await supabaseAdmin
        .from('calendar_event_types')
        .update({ is_default: true })
        .eq('id', data.id)
        .eq('user_id', userId);
    }
  },
};

/**
 * How far back a calendar window has to reach to be complete.
 *
 * The events query filters on `starts_at`, so asking for Tuesday returns
 * nothing that began on Monday evening and is still running - a meeting
 * from 23:00 to 01:00 simply vanishes from the day it spills into. The grid
 * already knows how to clip an event to the day it is drawing; it just
 * never got the chance, because the row never arrived.
 *
 * Reaching back a day is the cheap fix and covers everything short of a
 * meeting longer than 24 hours, which is not a meeting.
 */
export const CALENDAR_WINDOW_BACKSTOP_MS = 24 * 60 * 60 * 1000;

export function widenWindowStart(from: string): string {
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return from;
  return new Date(start.getTime() - CALENDAR_WINDOW_BACKSTOP_MS).toISOString();
}
