import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { calendarSync } from './calendar-sync.service.js';
import {
  EVENT_LOCATION_KINDS, DEFAULT_EVENT_COLOUR, isHexColour,
  computeSlots, isSlotBookable, resolveEnd,
  DEFAULT_SCHEDULING_PREFS, DEFAULT_WORKING_WEEK, SLOT_INTERVALS,
  type CalendarEventType, type CreateEventTypeInput,
  type AvailabilityWindow, type SchedulingPrefs, type BusyInterval, type Slot,
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
  async readTypes(userId: string, includeArchived: boolean): Promise<CalendarEventType[]> {
    let query = supabaseAdmin
      .from('calendar_event_types')
      .select(TYPE_SELECT)
      .eq('user_id', userId);
    if (!includeArchived) query = query.is('archived_at', null);
    const { data, error } = await query
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    return (data || []) as CalendarEventType[];
  },

  /**
   * `includeArchived` is what keeps the promise retiring one makes.
   *
   * Retiring a kind says, in its own confirmation, "the N meetings already
   * booked keep it" - and it was not true on the grid. The calendar draws an
   * event's colour and its usual length by looking its kind up in this list,
   * and a retired kind was simply absent: those meetings fell back to the
   * default indigo and to thirty minutes, so retiring the Demo colour
   * recoloured and reshaped every demo in the past.
   *
   * A picker must still only offer live ones, so the flag is the caller's
   * choice: lists that are being CHOSEN FROM ask for live, lists that are
   * being LOOKED UP IN ask for all.
   */
  async listTypes(userId: string, includeArchived = false): Promise<CalendarEventType[]> {
    const data = await this.readTypes(userId, includeArchived);
    // Seeded on the absence of LIVE types, whichever list was asked for. An
    // account whose every kind is retired still needs something to book with.
    if (data.some((t) => !t.archived_at)) return data;

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

    return this.readTypes(userId, includeArchived);
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


/* ═══════════════════════════════════════════════════════════════════════
   When you are free, and which of those moments may be offered.

   The rules themselves are arithmetic and live in shared/availability;
   this is the part that talks to the database. The division matters: the
   booking page and the settings screen must agree exactly about what is
   bookable, and the only way to guarantee that is for both to run the
   same function rather than two implementations of the same paragraph.
   ═══════════════════════════════════════════════════════════════════════ */

const WINDOW_SELECT = 'id, user_id, weekday, start_minute, end_minute';
const PREFS_SELECT = 'user_id, timezone, buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, max_bookings_per_day, slot_interval_minutes, booking_horizon_days';

/** A timezone string the runtime actually recognises. */
function assertRealTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new AppError(`"${tz}" is not a timezone this system knows.`, 400);
  }
}

export const availabilityService = {
  /**
   * The working week.
   *
   * Seeded Monday-to-Friday on first read rather than left empty: a
   * scheduler that offers nothing until somebody finds a settings page they
   * have no reason to know about reads as broken, not as unconfigured.
   */
  async listWindows(userId: string): Promise<AvailabilityWindow[]> {
    const { data, error } = await supabaseAdmin
      .from('calendar_availability')
      .select(WINDOW_SELECT)
      .eq('user_id', userId)
      .order('weekday', { ascending: true })
      .order('start_minute', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    if (data && data.length > 0) return data as AvailabilityWindow[];

    const { error: seedError } = await supabaseAdmin
      .from('calendar_availability')
      .upsert(
        DEFAULT_WORKING_WEEK.map((w) => ({ ...w, user_id: userId })),
        { onConflict: 'user_id,weekday,start_minute', ignoreDuplicates: true },
      );
    if (seedError) throw new AppError(seedError.message, 500);
    return DEFAULT_WORKING_WEEK.map((w) => ({ ...w }));
  },

  /**
   * Replace the whole week in one call.
   *
   * Whole-week rather than per-window edits because the UI is a grid of
   * days and a partial save is how somebody ends up with Tuesday deleted
   * and Wednesday duplicated after a failed request. Validated in full
   * before anything is written.
   */
  async replaceWindows(userId: string, windows: AvailabilityWindow[]): Promise<AvailabilityWindow[]> {
    if (!Array.isArray(windows)) throw new AppError('Expected a list of working hours.', 400);
    if (windows.length > 50) throw new AppError('That is more windows than a week has room for.', 400);

    const clean = windows.map((w) => {
      const weekday = Number(w.weekday);
      const start = Number(w.start_minute);
      const end = Number(w.end_minute);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        throw new AppError('A working day is 0 (Sunday) through 6 (Saturday).', 400);
      }
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || end <= start) {
        throw new AppError('A window runs forwards, inside one day.', 400);
      }
      return { user_id: userId, weekday, start_minute: start, end_minute: end };
    });

    /*
     * Overlapping windows on one day would offer the same slot twice.
     * Caught here rather than by the database, which cannot express it.
     */
    const byDay = new Map<number, { start_minute: number; end_minute: number }[]>();
    for (const w of clean) {
      const list = byDay.get(w.weekday) || [];
      list.push(w);
      byDay.set(w.weekday, list);
    }
    for (const [weekday, list] of byDay) {
      const sorted = list.slice().sort((a, b) => a.start_minute - b.start_minute);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start_minute < sorted[i - 1].end_minute) {
          throw new AppError(
            `Two windows overlap on ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][weekday]}.`,
            400,
          );
        }
      }
    }

    const { error: clearError } = await supabaseAdmin
      .from('calendar_availability').delete().eq('user_id', userId);
    if (clearError) throw new AppError(clearError.message, 500);

    if (clean.length > 0) {
      const { error } = await supabaseAdmin.from('calendar_availability').insert(clean);
      if (error) throw new AppError(error.message, 500);
    }
    return clean.map(({ user_id, ...w }) => w);
  },

  /** The rules around a booking. Defaults until somebody changes them. */
  async getPrefs(userId: string): Promise<SchedulingPrefs> {
    const { data, error } = await supabaseAdmin
      .from('calendar_scheduling_prefs')
      .select(PREFS_SELECT)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (data) return data as unknown as SchedulingPrefs;
    return { ...DEFAULT_SCHEDULING_PREFS };
  },

  async updatePrefs(userId: string, input: Partial<SchedulingPrefs>): Promise<SchedulingPrefs> {
    const patch: Record<string, any> = {};

    if (input.timezone !== undefined) {
      const tz = String(input.timezone);
      assertRealTimezone(tz);
      patch.timezone = tz;
    }
    const bounded = (key: keyof SchedulingPrefs, min: number, max: number, label: string) => {
      if (input[key] === undefined) return;
      const n = Number(input[key]);
      if (!Number.isFinite(n) || n < min || n > max) {
        throw new AppError(`${label} is between ${min} and ${max}.`, 400);
      }
      patch[key] = Math.round(n);
    };
    bounded('buffer_before_minutes', 0, 240, 'A buffer');
    bounded('buffer_after_minutes', 0, 240, 'A buffer');
    bounded('minimum_notice_minutes', 0, 43200, 'Notice');
    bounded('booking_horizon_days', 1, 365, 'A booking horizon');

    if (input.slot_interval_minutes !== undefined) {
      const n = Number(input.slot_interval_minutes);
      if (!SLOT_INTERVALS.includes(n)) {
        throw new AppError(`Slots are offered every ${SLOT_INTERVALS.join(', ')} minutes.`, 400);
      }
      patch.slot_interval_minutes = n;
    }

    if (input.max_bookings_per_day !== undefined) {
      const raw = input.max_bookings_per_day;
      if (raw === null || (raw as any) === '') patch.max_bookings_per_day = null;
      else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 1 || n > 50) {
          throw new AppError('A daily cap is between 1 and 50, or none at all.', 400);
        }
        patch.max_bookings_per_day = Math.round(n);
      }
    }

    if (Object.keys(patch).length === 0) return this.getPrefs(userId);

    const { data, error } = await supabaseAdmin
      .from('calendar_scheduling_prefs')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
      .select(PREFS_SELECT)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    return data as unknown as SchedulingPrefs;
  },

  /**
   * Everything already in the diary across a window.
   *
   * Reaches back a day for the same reason the calendar grid does: a
   * meeting that began last night and is still running occupies this
   * morning, and filtering on starts_at alone would not see it. Cancelled
   * meetings free their slot again.
   */
  async busyBetween(userId: string, from: Date, to: Date): Promise<BusyInterval[]> {
    const { data, error } = await supabaseAdmin
      .from('crm_events')
      .select('id, starts_at, ends_at, all_day, status, event_type_id')
      .eq('user_id', userId)
      .neq('status', 'cancelled')
      .gte('starts_at', new Date(from.getTime() - CALENDAR_WINDOW_BACKSTOP_MS).toISOString())
      .lte('starts_at', to.toISOString())
      .order('starts_at', { ascending: true })
      .limit(2000);
    if (error) throw new AppError(error.message, 500);

    // An event's length may only be implied by its kind, so the durations
    // have to be to hand before the ends can be resolved.
    const { data: types } = await supabaseAdmin
      .from('calendar_event_types')
      .select('id, duration_minutes')
      .eq('user_id', userId);
    const minutesById = new Map<string, number>(
      (types || []).map((t: any) => [t.id, t.duration_minutes]),
    );

    /*
     * A meeting in a calendar Sincerely does not own is still a meeting.
     * Without this the page offers times the account is already busy in,
     * which is the one way this feature can be actively wrong rather than
     * merely incomplete. Never throws: see calendar-sync for why an outage
     * degrades to stale rather than to "free".
     */
    const external = await calendarSync.externalBusy(userId, from, to);

    return external.concat((data || []).map((e: any) => {
      const start = new Date(e.starts_at);
      /*
       * An all-day event blocks the whole day rather than a moment. Treating
       * it as a zero-length marker would leave the day bookable, which is
       * the opposite of what somebody meant by blocking it out.
       */
      if (e.all_day) {
        const dayStart = new Date(start);
        dayStart.setHours(0, 0, 0, 0);
        return { start: dayStart, end: new Date(dayStart.getTime() + 86_400_000) };
      }
      return { start, end: resolveEnd(e, minutesById.get(e.event_type_id) ?? null) };
    }));
  },

  /**
   * Every moment a meeting of this length could be offered.
   *
   * The one place the booking page, the preview in settings and the booking
   * itself all agree, because they all call this.
   */
  async slots(userId: string, input: {
    from: Date; to: Date; durationMinutes: number;
  }): Promise<Slot[]> {
    const [windows, prefs, busy] = await Promise.all([
      this.listWindows(userId),
      this.getPrefs(userId),
      this.busyBetween(userId, input.from, input.to),
    ]);
    return computeSlots({
      from: input.from,
      to: input.to,
      durationMinutes: input.durationMinutes,
      windows,
      prefs,
      busy,
    });
  },

  /**
   * Is this exact moment still free?
   *
   * What a booking must ask, because the list it was offered was computed
   * when the page loaded and somebody may have taken the slot since.
   */
  async canBook(userId: string, start: Date, durationMinutes: number): Promise<boolean> {
    const [windows, prefs, busy] = await Promise.all([
      this.listWindows(userId),
      this.getPrefs(userId),
      this.busyBetween(userId, new Date(start.getTime() - 86_400_000), new Date(start.getTime() + 86_400_000)),
    ]);
    return isSlotBookable(start, { durationMinutes, windows, prefs, busy });
  },
};
