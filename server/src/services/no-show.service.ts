import {
  DEFAULT_NO_SHOW_BODY, DEFAULT_NO_SHOW_SUBJECT, renderNoShowTemplate,
  type NoShowOutcome, type NoShowPreview,
} from '@lemlist/shared';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { bookingMail, senderFor } from './booking-mail.service.js';
import { defaultBookingLinkUrl, organiserName } from './booking.service.js';
import { settingsService } from './settings.service.js';

/* ═══════════════════════════════════════════════════════════════════════
   Marking a meeting as a no-show, and the follow-up that goes with it.

   The follow-up is offered, not sent, unless the account switched on
   auto-send (user_settings.no_show_auto_send, off by default). Either way
   it goes through bookingMail, from the account's own mailbox, and the
   send is claimed on the row first (no_show_followup_sent_at) so a double
   click or an auto-send racing a click cannot email somebody twice.
   ═══════════════════════════════════════════════════════════════════════ */

const MIGRATION = '096_duplicates_views_engagement_noshow.sql';

const EVENT_SELECT = `
  id, user_id, title, status, starts_at, contact_id, contact_name, contact_email,
  booking_link_id, invitee_timezone, no_show_followup_sent_at,
  booking_link:booking_links (slug, headline, is_active, archived_at)
`;

function missing096(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return ['PGRST204', '42703', '23514'].includes(error.code || '')
    || /no_show|crm_events_status_known/.test(error.message || '');
}

function needs096(): AppError {
  return new AppError(`Marking no-shows needs database migration ${MIGRATION} - run it in Supabase, then reload.`, 503);
}

async function readEvent(userId: string, eventId: string): Promise<any> {
  const { data, error } = await supabaseAdmin
    .from('crm_events').select(EVENT_SELECT).eq('id', eventId).eq('user_id', userId).maybeSingle();
  if (error) {
    if (missing096(error)) throw needs096();
    throw new AppError(error.message, 500);
  }
  if (!data) throw new AppError('Meeting not found', 404);
  return data;
}

/** The page to rebook on: the one they booked through, else the account's own. */
async function rebookUrl(userId: string, event: any): Promise<string | null> {
  const link = event.booking_link;
  if (link?.slug && link.is_active !== false && !link.archived_at) {
    return `${(env.CLIENT_URL || 'https://app.usesincerely.com').replace(/\/+$/, '')}/b/${link.slug}`;
  }
  return defaultBookingLinkUrl(userId);
}

function firstName(event: any): string {
  return String(event.contact_name || '').trim().split(/\s+/)[0] || '';
}

function meetingDate(at: string, zone: string): string {
  try {
    return new Date(at).toLocaleString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: zone,
    });
  } catch {
    return new Date(at).toUTCString();
  }
}

/** Best effort. A missing history line never costs anybody the email. */
async function logOnContact(userId: string, contactId: string | null, body: string) {
  if (!contactId) return;
  try {
    await supabaseAdmin.from('crm_notes').insert({ user_id: userId, contact_id: contactId, body });
  } catch { /* bookkeeping */ }
}

export const noShowService = {
  /** The follow-up as it would go, from the account's template. */
  async preview(userId: string, eventId: string, overrides: { subject?: unknown; body?: unknown } = {}): Promise<NoShowPreview> {
    const event = await readEvent(userId, eventId);
    const settings = await settingsService.get(userId);
    const [organiser, link, prefsZone] = await Promise.all([
      organiserName(userId),
      rebookUrl(userId, event),
      Promise.resolve(event.invitee_timezone || settings.timezone || 'UTC'),
    ]);
    const values = {
      first_name: firstName(event),
      meeting: event.booking_link?.headline || event.title,
      meeting_date: meetingDate(event.starts_at, prefsZone),
      organiser,
      booking_link: link,
    };
    const subject = typeof overrides.subject === 'string' && overrides.subject.trim()
      ? overrides.subject : ((settings as any).no_show_subject || DEFAULT_NO_SHOW_SUBJECT);
    const body = typeof overrides.body === 'string' && overrides.body.trim()
      ? overrides.body : ((settings as any).no_show_body || DEFAULT_NO_SHOW_BODY);
    return {
      to: event.contact_email || '',
      subject: renderNoShowTemplate(subject, values).slice(0, 200),
      body: renderNoShowTemplate(body, values).slice(0, 5000),
      booking_link: link,
      already_sent_at: event.no_show_followup_sent_at ?? null,
    };
  },

  /** Why the follow-up cannot go, or null when it can. */
  async blocker(userId: string, event: any): Promise<string | null> {
    if (event.no_show_followup_sent_at) return null;
    if (!event.contact_email) return 'There is no email address on this meeting.';
    if (!(await rebookUrl(userId, event))) return 'You have no live booking page to send them to.';
    if (!(await senderFor(userId))) return 'No verified mailbox to send it from.';
    return null;
  },

  /**
   * Mark it, log it, and either send the follow-up (auto-send on, booked
   * through a link) or say it can be offered.
   */
  async mark(userId: string, eventId: string): Promise<NoShowOutcome> {
    const event = await readEvent(userId, eventId);
    if (event.status === 'cancelled') throw new AppError('A cancelled meeting cannot be a no-show. Reinstate it first.', 409);
    if (new Date(event.starts_at).getTime() > Date.now()) throw new AppError('It has not started yet.', 400);

    if (event.status !== 'no_show') {
      const { error } = await supabaseAdmin
        .from('crm_events')
        .update({ status: 'no_show', no_show_at: new Date().toISOString() })
        .eq('id', eventId)
        .eq('user_id', userId);
      if (error) {
        if (missing096(error)) throw needs096();
        throw new AppError(error.message, 500);
      }
      await logOnContact(userId, event.contact_id, `Did not turn up to "${event.title}".`);
    }

    if (event.no_show_followup_sent_at) return { event_id: eventId, followup: 'already' };
    const blocked = await this.blocker(userId, event);
    if (blocked) return { event_id: eventId, followup: 'unavailable', reason: blocked };

    const settings = await settingsService.get(userId);
    // Auto-send is for meetings booked through a link: the person chose
    // the time themselves, so offering them the page again is in keeping.
    // A meeting typed in by hand may have been arranged any number of ways.
    if ((settings as any).no_show_auto_send === true && event.booking_link_id) {
      try {
        await this.send(userId, eventId);
        return { event_id: eventId, followup: 'sent' };
      } catch (err: any) {
        return { event_id: eventId, followup: 'unavailable', reason: err?.message || 'The follow-up could not be sent.' };
      }
    }
    return { event_id: eventId, followup: 'offer' };
  },

  /** Send the follow-up now, once. */
  async send(userId: string, eventId: string, overrides: { subject?: unknown; body?: unknown } = {}) {
    const event = await readEvent(userId, eventId);
    if (event.status !== 'no_show') throw new AppError('Mark the meeting as a no-show first.', 409);
    if (event.no_show_followup_sent_at) throw new AppError('A follow-up was already sent for this meeting.', 409);
    const blocked = await this.blocker(userId, event);
    if (blocked) throw new AppError(blocked, 422);

    const message = await this.preview(userId, eventId, overrides);

    // Claimed before sending: only one caller gets the row back.
    const sentAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('crm_events')
      .update({ no_show_followup_sent_at: sentAt })
      .eq('id', eventId)
      .eq('user_id', userId)
      .is('no_show_followup_sent_at', null)
      .select('id');
    if (claimErr) {
      if (missing096(claimErr)) throw needs096();
      throw new AppError(claimErr.message, 500);
    }
    if (!claimed || claimed.length === 0) throw new AppError('A follow-up was already sent for this meeting.', 409);

    const ok = await bookingMail.noShowFollowUp(userId, {
      to: message.to, subject: message.subject, body: message.body, bookingLink: message.booking_link,
    });
    if (!ok) {
      // Released, so trying again is possible once the mailbox is fixed.
      await supabaseAdmin.from('crm_events')
        .update({ no_show_followup_sent_at: null })
        .eq('id', eventId).eq('user_id', userId).eq('no_show_followup_sent_at', sentAt);
      throw new AppError('The follow-up could not be sent from your mailbox. Check it in Settings and try again.', 502);
    }
    await logOnContact(userId, event.contact_id, `Sent a no-show follow-up: "${message.subject}".`);
    return { sent: true, sent_at: sentAt, to: message.to };
  },
};
