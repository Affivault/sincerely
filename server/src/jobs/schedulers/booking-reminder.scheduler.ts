import { supabaseAdmin } from '../../config/supabase.js';
import { bookingMail } from '../../services/booking-mail.service.js';
import { availabilityService } from '../../services/calendar.service.js';
import { organiserName } from '../../services/booking.service.js';

/**
 * The nudge before a booked meeting.
 *
 * No-shows are the tax on a scheduler that does nothing after the booking,
 * and a reminder the day before is the single biggest lever on them. It is
 * also the one piece of this that somebody actively wants to receive: a
 * meeting booked three weeks ago has fallen out of everybody's head.
 *
 * The claim is atomic. `claim_booking_reminders` marks the rows sent and
 * returns them in one statement, under FOR UPDATE SKIP LOCKED, so however
 * many instances a deploy is running no invitee gets the same reminder
 * twice. A naive read-then-send here would give every worker every meeting;
 * with six instances that is six emails, which reads as six meetings.
 *
 * The consequence of claiming first is that a send which then fails is not
 * retried. That is the right way round: a reminder that never arrives costs
 * a possible no-show, and one that arrives six times costs the account its
 * credibility.
 *
 * Cross-tenant, so it is a scheduler and never an authenticated route.
 */

const SWEEP_MS = 15 * 60 * 1000;

/**
 * How far ahead to look.
 *
 * A meeting is reminded about once, roughly a day before. The window is
 * wider than the sweep interval so nothing falls between two ticks, and
 * anything booked inside the window is caught on the next sweep rather than
 * being reminded about a meeting that has already started.
 */
const WINDOW_MINUTES = 24 * 60 + 30;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runBookingReminderSweep(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .rpc('claim_booking_reminders', { p_within_minutes: WINDOW_MINUTES, p_limit: 200 });

  if (error) {
    // The function arrives with migration 066. Until it is applied there is
    // nothing to claim, which is not worth logging every quarter hour.
    if (/claim_booking_reminders/.test(error.message)) return 0;
    throw new Error(error.message);
  }

  const due = (data || []) as any[];
  if (due.length === 0) return 0;

  // Everything the mail needs beyond the event row: the link's settings and
  // the kind of meeting. Fetched per sweep rather than per meeting, because
  // a busy account's reminders nearly all point at the same few links.
  const linkIds = [...new Set(due.map((e) => e.booking_link_id).filter(Boolean))];
  const { data: links } = await supabaseAdmin
    .from('booking_links')
    .select('id, headline, confirmation_note, notify_organiser, event_type_id, event_type:calendar_event_types (location_kind)')
    .in('id', linkIds.length > 0 ? linkIds : ['00000000-0000-0000-0000-000000000000']);
  const linkById = new Map((links || []).map((l: any) => [l.id, l]));

  // One prefs read and one name lookup per account, not per meeting.
  const prefsByUser = new Map<string, any>();
  const nameByUser = new Map<string, string>();

  let sent = 0;
  for (const event of due) {
    try {
      if (!event.contact_email || !event.manage_token) continue;

      const link = linkById.get(event.booking_link_id);
      if (!prefsByUser.has(event.user_id)) {
        prefsByUser.set(event.user_id, await availabilityService.getPrefs(event.user_id));
      }
      const prefs = prefsByUser.get(event.user_id);
      if (!nameByUser.has(event.user_id)) {
        nameByUser.set(event.user_id, await organiserName(event.user_id));
      }

      const start = new Date(event.starts_at);
      const end = event.ends_at
        ? new Date(event.ends_at)
        : new Date(start.getTime() + 30 * 60_000);

      const ok = await bookingMail.reminder({
        userId: event.user_id,
        eventId: event.id,
        manageToken: event.manage_token,
        start,
        end,
        durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
        headline: link?.headline || event.title || 'Your meeting',
        organiser: nameByUser.get(event.user_id) || 'your host',
        inviteeName: event.contact_name || '',
        inviteeEmail: event.contact_email,
        inviteeTimezone: event.invitee_timezone || prefs.timezone,
        organiserTimezone: prefs.timezone,
        locationKind: link?.event_type?.location_kind || 'video',
        confirmationNote: link?.confirmation_note ?? null,
        sequence: event.ics_sequence ?? 0,
        notifyOrganiser: false,
      });
      if (ok) sent++;
    } catch (err: any) {
      // One meeting's failure must not stop the sweep for everyone else.
      console.error(`[BookingReminder] ${event.id} failed:`, err?.message || err);
    }
  }
  return sent;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const n = await runBookingReminderSweep();
    if (n > 0) console.log(`[BookingReminder] sent ${n} reminder(s)`);
  } catch (err: any) {
    console.error('[BookingReminder] sweep failed:', err?.message || err);
  } finally {
    running = false;
  }
}

export function startBookingReminderScheduler() {
  if (timer) return { stop: () => {} };
  timer = setInterval(tick, SWEEP_MS);
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
