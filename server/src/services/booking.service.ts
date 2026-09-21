import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { availabilityService } from './calendar.service.js';
import { bookingMail, type BookingMailContext } from './booking-mail.service.js';
import { readBookingIdentity, isStepId, signBookingIdentity, NO_STEP } from '../utils/booking-token.js';
import { calendarSync } from './calendar-sync.service.js';
import { inboxService } from './inbox.service.js';
import { env } from '../config/env.js';
import {
  slugify, looksLikeEmail, buildIcs,
  type BookingLink, type CreateBookingLinkInput,
  type PublicBookingPage, type CreateBookingInput, type BookingConfirmation,
  type EventLocationKind, type Slot,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Booking links.

   Two audiences, and the whole of this file is arranged around keeping
   them apart.

   The account gets `bookingService`: ordinary CRUD, scoped by user_id like
   everything else in the product.

   A stranger gets `publicBookingService`: no session, no user id in the
   request, nothing readable but what a page needs to render. Every method
   here starts from a slug and ends at a hand-written list of fields. There
   is no `select('*')` anywhere below this line, and that is deliberate -
   the difference between a booking page and a data breach is which columns
   you name.
   ═══════════════════════════════════════════════════════════════════════ */

const LINK_SELECT = `
  id, user_id, slug, event_type_id, duration_minutes, headline, blurb,
  collect_phone, collect_company, question, is_active, views, bookings,
  create_deal, deal_stage, notify_organiser, confirmation_note,
  created_at, updated_at, archived_at,
  event_type:calendar_event_types (id, name, colour, duration_minutes, location_kind)
`;

/** Half an hour is the fallback when neither the link nor its kind says. */
const FALLBACK_DURATION = 30;

/**
 * Addresses a link may not claim.
 *
 * 'manage' is the one that matters: the public router serves every
 * invitee's reschedule and cancel page under it, and a link that took the
 * name would shadow them. The rest are reserved because they are the paths
 * a booking page grows next, and a slug is permanent once somebody has sent
 * it to a prospect.
 */
const RESERVED_SLUGS = new Set([
  'manage', 'api', 'admin', 'app', 'www', 'book', 'booking', 'bookings',
  'cancel', 'reschedule', 'new', 'edit', 'login', 'signup', 'settings',
  'ics', 'slots', 'static', 'assets', 'health',
]);

function durationOf(link: any): number {
  return link.duration_minutes
    ?? link.event_type?.duration_minutes
    ?? FALLBACK_DURATION;
}

function validateLink(input: CreateBookingLinkInput, partial = false): Record<string, any> {
  const patch: Record<string, any> = {};

  if (input.headline !== undefined || !partial) {
    const headline = String(input.headline ?? '').trim();
    if (!headline) throw new AppError('A booking page needs a headline.', 400);
    if (headline.length > 120) throw new AppError('That headline is too long.', 400);
    patch.headline = headline;
  }

  if (input.slug !== undefined) {
    const slug = slugify(String(input.slug));
    /*
     * slugify() cannot fail, which is the point - but it can produce
     * something the account did not mean, and silently publishing a
     * different address from the one they typed is worse than refusing.
     */
    if (slug !== String(input.slug).toLowerCase().trim()) {
      throw new AppError(
        `A link address can only use lowercase letters, numbers and hyphens. Try "${slug}".`, 400,
      );
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new AppError(`"${slug}" is reserved. Pick another address.`, 400);
    }
    patch.slug = slug;
  }

  if (input.blurb !== undefined) {
    const blurb = input.blurb === null ? null : String(input.blurb).trim().slice(0, 600);
    patch.blurb = blurb || null;
  }

  if (input.question !== undefined) {
    const q = input.question === null ? null : String(input.question).trim().slice(0, 200);
    patch.question = q || null;
  }

  if (input.duration_minutes !== undefined) {
    if (input.duration_minutes === null) {
      patch.duration_minutes = null;
    } else {
      const n = Number(input.duration_minutes);
      if (!Number.isFinite(n) || n < 5 || n > 1440) {
        throw new AppError('A meeting is between 5 minutes and a day.', 400);
      }
      patch.duration_minutes = Math.round(n);
    }
  }

  if (input.confirmation_note !== undefined) {
    const note = input.confirmation_note === null
      ? null : String(input.confirmation_note).trim().slice(0, 2000);
    patch.confirmation_note = note || null;
  }

  if (input.deal_stage !== undefined) {
    const stage = input.deal_stage || null;
    if (stage && !['lead', 'qualified', 'proposal', 'won', 'lost'].includes(stage)) {
      throw new AppError('That is not a stage in the pipeline.', 400);
    }
    patch.deal_stage = stage;
  }

  if (input.create_deal !== undefined) patch.create_deal = !!input.create_deal;
  if (input.notify_organiser !== undefined) patch.notify_organiser = !!input.notify_organiser;
  if (input.event_type_id !== undefined) patch.event_type_id = input.event_type_id || null;
  if (input.collect_phone !== undefined) patch.collect_phone = !!input.collect_phone;
  if (input.collect_company !== undefined) patch.collect_company = !!input.collect_company;
  if (input.is_active !== undefined) patch.is_active = !!input.is_active;

  return patch;
}

/**
 * The address `{{booking_link}}` resolves to.
 *
 * The oldest live link, because that is the one an account thinks of as
 * "my link" - the seeded one, or the first they made. Null when nothing is
 * live, which blanks the tag rather than sending a dead URL to a prospect.
 */
export async function defaultBookingLinkUrl(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('booking_links')
    .select('slug')
    .eq('user_id', userId)
    .eq('is_active', true)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.slug) return null;
  const origin = (env.CLIENT_URL || 'https://app.usesincerely.com').replace(/\/+$/, '');
  return `${origin}/b/${data.slug}`;
}

export const bookingService = {
  async listLinks(userId: string): Promise<BookingLink[]> {
    const { data, error } = await supabaseAdmin
      .from('booking_links')
      .select(LINK_SELECT)
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('created_at', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    return (data || []) as unknown as BookingLink[];
  },

  async getLink(userId: string, id: string): Promise<BookingLink> {
    const { data, error } = await supabaseAdmin
      .from('booking_links')
      .select(LINK_SELECT)
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('No such booking link.', 404);
    return data as unknown as BookingLink;
  },

  /**
   * A new link.
   *
   * The slug is the one thing that can fail for a reason the account cannot
   * see - somebody else already has it - so an unspecified one is derived
   * from the headline and then made unique by trying, rather than by asking
   * the database what is free and racing between the answer and the insert.
   */
  async createLink(userId: string, input: CreateBookingLinkInput): Promise<BookingLink> {
    const patch = validateLink(input);
    if (!patch.event_type_id) {
      const { data: fallback } = await supabaseAdmin
        .from('calendar_event_types')
        .select('id')
        .eq('user_id', userId)
        .eq('is_default', true)
        .is('archived_at', null)
        .maybeSingle();
      patch.event_type_id = fallback?.id ?? null;
    }

    // A headline of "Book a call" derives the reserved slug "book", so the
    // derived one is checked too rather than only the typed one.
    let slug: string = patch.slug || slugify(patch.headline);
    if (RESERVED_SLUGS.has(slug)) slug = `${slug}-with-me`;

    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = attempt === 0 ? slug : `${slug}-${crypto.randomBytes(2).toString('hex')}`;
      const { data, error } = await supabaseAdmin
        .from('booking_links')
        .insert({ ...patch, slug: candidate, user_id: userId })
        .select(LINK_SELECT)
        .single();

      if (!error) return data as unknown as BookingLink;

      // 23505 is a unique violation, which here can only be the slug.
      if ((error as any).code !== '23505') throw new AppError(error.message, 500);
      // An address the account typed explicitly is not silently changed.
      if (patch.slug) {
        throw new AppError('That address is already taken. Try another.', 409);
      }
    }
    throw new AppError('Could not find a free address for that link.', 409);
  },

  async updateLink(userId: string, id: string, input: CreateBookingLinkInput): Promise<BookingLink> {
    const patch = validateLink(input, true);
    if (Object.keys(patch).length === 0) return this.getLink(userId, id);

    const { data, error } = await supabaseAdmin
      .from('booking_links')
      .update(patch)
      .eq('user_id', userId)
      .eq('id', id)
      .select(LINK_SELECT)
      .maybeSingle();
    if (error) {
      if ((error as any).code === '23505') {
        throw new AppError('That address is already taken. Try another.', 409);
      }
      throw new AppError(error.message, 500);
    }
    if (!data) throw new AppError('No such booking link.', 404);
    return data as unknown as BookingLink;
  },

  /**
   * Retired, not deleted.
   *
   * Meetings booked through it still point at it, and a link that vanishes
   * takes the answer to "where did this meeting come from" with it.
   */
  async archiveLink(userId: string, id: string): Promise<{ archived: boolean }> {
    const { data, error } = await supabaseAdmin
      .from('booking_links')
      .update({ archived_at: new Date().toISOString(), is_active: false })
      .eq('user_id', userId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('No such booking link.', 404);
    return { archived: true };
  },

  /**
   * Reply to somebody with your booking link, in one action.
   *
   * The loop this closes is the one that actually loses meetings. A prospect
   * writes "sure, when suits?", and answering it means leaving the inbox,
   * finding the link, writing three lines, and remembering to log it. Most
   * people do it eventually; the ones who do it four hours later book fewer
   * meetings than the ones who do it now.
   *
   * The link is personalised with a token naming this contact, so the
   * booking that comes back is attributed to the campaign the thread
   * belongs to - a reply is part of a sequence's result whether or not it
   * came from a step of it.
   */
  async sendLinkInReply(userId: string, messageId: string, note?: string): Promise<{
    sent: boolean; url: string;
  }> {
    const { data: message } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, user_id, from_email, campaign_id, contact_id, contacts(first_name)')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!message) throw new AppError('No such message.', 404);

    const base = await defaultBookingLinkUrl(userId);
    if (!base) {
      throw new AppError(
        'No booking link is live. Turn one on and it will be one click from here.', 409,
      );
    }

    // Name the send, when the thread belongs to a campaign and we know who.
    let url = base;
    if (message.campaign_id && message.contact_id) {
      const { data: cc } = await supabaseAdmin
        .from('campaign_contacts')
        .select('id')
        .eq('campaign_id', message.campaign_id)
        .eq('contact_id', message.contact_id)
        .maybeSingle();
      if (cc?.id) {
        url = `${base}?k=${signBookingIdentity(cc.id, NO_STEP)}`;
      }
    }

    const first = (message as any).contacts?.first_name?.trim();
    const greeting = first ? `Hi ${first},` : 'Hi,';
    const body = [
      greeting,
      '',
      (note || '').trim() || 'Here is my calendar - grab whatever time suits you:',
      '',
      url,
    ].join('\n');

    const html = `<p>${greeting}</p><p>${
      (note || '').trim() || 'Here is my calendar &mdash; grab whatever time suits you:'
    }</p><p><a href="${url}">${url}</a></p>`;

    await inboxService.reply(userId, messageId, body, undefined, html);
    return { sent: true, url };
  },

  /** Meetings booked through this link, newest first. */
  async linkBookings(userId: string, id: string, limit = 50) {
    const { data, error } = await supabaseAdmin
      .from('crm_events')
      .select(`
        id, title, starts_at, ends_at, status, contact_name, contact_email,
        invitee_message, booked_at, cancelled_at, cancelled_by,
        source_campaign_id,
        campaign:campaigns!crm_events_source_campaign_id_fkey (id, name)
      `)
      .eq('user_id', userId)
      .eq('booking_link_id', id)
      .order('starts_at', { ascending: false })
      .limit(Math.min(limit, 200));
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },
};

/* ═══════════════════════════════════════════════════════════════════════
   The public half. No session, no user id from the caller, ever.
   ═══════════════════════════════════════════════════════════════════════ */

/** Resolve a slug to the row plus its owner. Never returned to a visitor. */
async function linkBySlug(slug: string) {
  const clean = String(slug || '').toLowerCase().trim();
  if (!clean || clean.length > 50) throw new AppError('There is no booking page at this address.', 404);

  const { data, error } = await supabaseAdmin
    .from('booking_links')
    .select(`
      id, user_id, slug, headline, blurb, duration_minutes, is_active, archived_at,
      collect_phone, collect_company, question, event_type_id,
      create_deal, deal_stage, notify_organiser, confirmation_note,
      event_type:calendar_event_types (id, name, colour, duration_minutes, location_kind)
    `)
    .eq('slug', clean)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data || data.archived_at) throw new AppError('There is no booking page at this address.', 404);
  return data as any;
}

/** A display name, assembled from settings. Never the login email. */
export async function organiserName(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('user_settings')
    .select('first_name, last_name, company')
    .eq('user_id', userId)
    .maybeSingle();
  const name = [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim();
  return name || (data?.company || '').trim() || 'Your host';
}

/** The organiser's address, for the calendar file only. */
async function organiserEmail(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

/**
 * Who a token says this visitor is.
 *
 * Returns null for anything that does not verify, for a send belonging to
 * another account, or for a contact that has since been deleted - and the
 * page then treats them as a stranger, which is exactly what it does for
 * everybody arriving from a signature or a website. Nothing here may refuse
 * a booking; the token is worth a prefill and an attribution, never a gate.
 */
async function identify(token: string | undefined, linkUserId: string): Promise<{
  contactId: string | null;
  campaignId: string | null;
  stepId: string | null;
  name: string;
  email: string;
  company: string;
} | null> {
  const identity = readBookingIdentity(token);
  if (!identity) return null;

  try {
    const { data } = await supabaseAdmin
      .from('campaign_contacts')
      .select(`
        id, campaign_id, contact_id,
        campaigns (id, user_id),
        contacts (id, email, first_name, last_name, company)
      `)
      .eq('id', identity.campaignContactId)
      .maybeSingle();

    const row = data as any;
    if (!row) return null;

    /*
     * The token verifies, but it names a send in SOMEBODY's account - and
     * this page belongs to a particular one. A valid token from a different
     * account must not prefill a name here, or a link could be made to
     * greet a stranger with somebody else's contact.
     */
    if (row.campaigns?.user_id !== linkUserId) return null;

    const c = row.contacts;
    return {
      contactId: row.contact_id ?? null,
      campaignId: row.campaign_id ?? null,
      /*
       * A link sent by hand from the inbox belongs to a campaign but to no
       * step of it, and says so with a sentinel. Nulling anything that is
       * not a real id keeps it out of the foreign key rather than failing
       * the write and losing the attribution entirely.
       */
      stepId: isStepId(identity.stepId) ? identity.stepId : null,
      name: [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim(),
      email: c?.email || '',
      company: c?.company || '',
    };
  } catch {
    return null;
  }
}

export const publicBookingService = {
  /**
   * What the page renders.
   *
   * Counts a view on the way past, because a link that gets opened and not
   * booked is the single most useful thing the list of links can tell you,
   * and it is invisible otherwise.
   */
  async page(slug: string, visitorToken?: string): Promise<PublicBookingPage> {
    const link = await linkBySlug(slug);
    if (!link.is_active) throw new AppError('This booking page is not taking bookings at the moment.', 403);

    const [prefs, organiser, who] = await Promise.all([
      availabilityService.getPrefs(link.user_id),
      organiserName(link.user_id),
      identify(visitorToken, link.user_id),
    ]);

    // A visit from a campaign is worth recording; one from a signature is
    // not distinguishable from any other and is only a view count.
    if (who) {
      supabaseAdmin.from('booking_link_visits').insert({
        link_id: link.id,
        user_id: link.user_id,
        campaign_id: who.campaignId,
        step_id: who.stepId,
        contact_id: who.contactId,
      }).then(() => undefined, () => undefined);
    }

    // Fire and forget: a failed counter must never fail the page.
    supabaseAdmin.rpc('increment_link_views', { p_link_id: link.id }).then(
      () => undefined,
      () => undefined,
    );

    return {
      slug: link.slug,
      headline: link.headline,
      blurb: link.blurb,
      duration_minutes: durationOf(link),
      location_kind: (link.event_type?.location_kind ?? 'video') as EventLocationKind,
      colour: link.event_type?.colour ?? '#6366f1',
      organiser,
      timezone: prefs.timezone,
      collect_phone: link.collect_phone,
      collect_company: link.collect_company,
      question: link.question,
      horizon_days: prefs.booking_horizon_days,
      // Only ever a convenience. Everything on the form stays editable, and
      // a page reached without a token simply asks for all of it.
      invitee: who && who.email
        ? { name: who.name, email: who.email, company: who.company }
        : null,
    };
  },

  /**
   * The free times.
   *
   * Calls exactly what the settings preview calls, which is the only reason
   * the two can be trusted to agree.
   */
  async slots(slug: string, from: Date, to: Date): Promise<Slot[]> {
    const link = await linkBySlug(slug);
    if (!link.is_active) throw new AppError('This booking page is not taking bookings at the moment.', 403);
    return availabilityService.slots(link.user_id, {
      from, to, durationMinutes: durationOf(link),
    });
  },

  /**
   * Take a slot.
   *
   * Two checks, and they are not redundant. The first asks the policy
   * question - is this within working hours, past the notice period, inside
   * the horizon, under the daily cap - which lives in TypeScript because it
   * is a paragraph of rules. The second happens inside book_slot under an
   * advisory lock, and asks the only question that cannot be answered
   * early: is the diary still clear at the instant of writing.
   */
  async book(slug: string, input: CreateBookingInput, visitorToken?: string): Promise<BookingConfirmation> {
    const link = await linkBySlug(slug);
    if (!link.is_active) throw new AppError('This booking page is not taking bookings at the moment.', 403);

    const name = String(input.name || '').trim();
    const email = String(input.email || '').trim().toLowerCase();
    if (!name) throw new AppError('Please give a name.', 400);
    if (name.length > 120) throw new AppError('That name is too long.', 400);
    if (!looksLikeEmail(email)) throw new AppError('That email address does not look right.', 400);

    const start = new Date(input.start);
    if (Number.isNaN(start.getTime())) throw new AppError('That is not a time.', 400);

    const minutes = durationOf(link);
    const end = new Date(start.getTime() + minutes * 60_000);

    const free = await availabilityService.canBook(link.user_id, start, minutes);
    if (!free) {
      throw new AppError('That time is no longer being offered. Have another look at what is free.', 409);
    }

    const prefs = await availabilityService.getPrefs(link.user_id);
    const who = await identify(visitorToken, link.user_id);

    /*
     * The contact the token names is preferred over one matched by email,
     * but only when the addresses agree. Somebody forwarding a booking link
     * to a colleague is common and entirely legitimate, and crediting the
     * colleague's meeting to the original contact would quietly corrupt
     * both the CRM and the attribution.
     */
    const knownContactId = who && who.email.toLowerCase() === email ? who.contactId : null;
    const contactId = knownContactId
      ?? await this.upsertContact(link.user_id, {
        email, name, phone: input.phone, company: input.company,
      });

    // 32 bytes of randomness, url-safe. This stands in for a login.
    const token = crypto.randomBytes(24).toString('base64url');

    const { data, error } = await supabaseAdmin.rpc('book_slot', {
      p_user_id: link.user_id,
      p_link_id: link.id,
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_buffer_before: prefs.buffer_before_minutes,
      p_buffer_after: prefs.buffer_after_minutes,
      p_title: `${link.event_type?.name || link.headline} with ${name}`,
      p_contact_id: contactId,
      p_contact_name: name,
      p_contact_email: email,
      p_invitee_message: [input.answer, input.company ? `Company: ${input.company}` : null]
        .filter(Boolean).join('\n\n') || null,
      p_invitee_timezone: input.timezone || prefs.timezone,
      p_manage_token: token,
      p_event_type_id: link.event_type_id,
      p_location: link.event_type?.location_kind ?? 'video',
      p_exclude_event_id: null,
    });

    if (error) {
      if (/SLOT_TAKEN/.test(error.message)) {
        throw new AppError('Somebody just took that time. Pick another and it will be yours.', 409);
      }
      throw new AppError(error.message, 500);
    }

    /*
     * Everything after the booking itself is follow-through, and none of it
     * may take the meeting down with it. A deal that failed to open or an
     * SMTP host that timed out is a thing to fix later; a 500 here is a
     * prospect who thinks they have no meeting and goes elsewhere.
     */
    const eventId = String(data);
    const organiser = await organiserName(link.user_id);

    await Promise.allSettled([
      // Where it came from, recorded on the meeting itself so "this sequence
      // booked four meetings" is a count rather than a reconstruction.
      knownContactId && who
        ? supabaseAdmin.from('crm_events').update({
            source_campaign_id: who.campaignId,
            source_step_id: who.stepId,
          }).eq('id', eventId)
        : Promise.resolve(),
      knownContactId && who
        ? supabaseAdmin.from('booking_link_visits')
            .update({ booked_event_id: eventId })
            .eq('link_id', link.id)
            .eq('contact_id', who.contactId)
            .is('booked_event_id', null)
        : Promise.resolve(),
      this.logActivity(link.user_id, contactId, `Booked ${minutes} minutes via ${link.slug}`),
      link.create_deal
        ? this.openDeal(link, eventId, contactId, { name, email, company: input.company },
                        knownContactId ? who : null)
        : Promise.resolve(),
      // Put it in the account's real calendar too. Best effort by design:
      // the meeting exists here either way, and a booking refused because
      // Google was slow is a lost meeting nobody can explain.
      calendarSync.pushEvent(link.user_id, {
        id: eventId,
        title: `${link.event_type?.name || link.headline} with ${name}`,
        start, end,
        inviteeEmail: email,
        description: input.answer || null,
      }),
      bookingMail.confirmed({
        userId: link.user_id,
        eventId,
        manageToken: token,
        start, end,
        durationMinutes: minutes,
        headline: link.headline,
        organiser,
        inviteeName: name,
        inviteeEmail: email,
        inviteeTimezone: input.timezone || prefs.timezone,
        organiserTimezone: prefs.timezone,
        locationKind: link.event_type?.location_kind ?? 'video',
        confirmationNote: link.confirmation_note,
        inviteeMessage: input.answer || null,
        sequence: 0,
        notifyOrganiser: link.notify_organiser !== false,
      }).then(async (sent) => {
        if (sent.invitee) {
          await supabaseAdmin.from('crm_events')
            .update({ confirmation_sent_at: new Date().toISOString() })
            .eq('id', eventId);
        }
      }),
    ]);

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      headline: link.headline,
      organiser,
      duration_minutes: minutes,
      location_kind: (link.event_type?.location_kind ?? 'video') as EventLocationKind,
      timezone: input.timezone || prefs.timezone,
      invitee_name: name,
      invitee_email: email,
      manage_token: token,
      status: 'confirmed',
      slug: link.slug,
      ...(data ? {} : {}),
    };
  },

  /**
   * A booked meeting opens a deal, or moves the one that exists.
   *
   * This is the part a standalone scheduler cannot do. Somebody agreeing to
   * a meeting is the most meaningful thing that happens in a cold outreach
   * cycle, and leaving it as a note on a contact wastes it - the pipeline is
   * where the account looks to decide what to do tomorrow.
   *
   * An existing open deal for the same contact is reused rather than
   * duplicated; booking a second call does not mean a second opportunity.
   */
  async openDeal(link: any, eventId: string, contactId: string | null, who: {
    name: string; email: string; company?: string;
  }, source?: { campaignId: string | null; stepId: string | null } | null): Promise<void> {
    try {
      const stage = link.deal_stage || 'lead';

      /*
       * The strongest attribution this product can record.
       *
       * 'reply' and 'enrolment' are inferences - they say a contact was in a
       * sequence around the time a deal appeared. This one is not: they
       * clicked the link in a specific step and put a meeting in the diary.
       * The action IS the evidence, which is why 067 puts it above 'thread'.
       */
      const attribution = source?.campaignId
        ? {
            source_campaign_id: source.campaignId,
            source_step_id: source.stepId,
            attribution: 'booking',
            attributed_at: new Date().toISOString(),
          }
        : {};

      // Anything already open for this person, newest first.
      let existing: any = null;
      if (contactId) {
        const { data } = await supabaseAdmin
          .from('deals')
          .select('id, stage, attribution')
          .eq('user_id', link.user_id)
          .eq('contact_id', contactId)
          .not('stage', 'in', '(won,lost)')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        existing = data;
      }

      if (existing) {
        // Point the meeting at the deal it belongs to. The stage is only
        // moved forward, never back - a booking on a deal already at
        // proposal must not demote it to lead.
        const order = ['lead', 'qualified', 'proposal'];
        const shouldAdvance = order.indexOf(stage) > order.indexOf(existing.stage);
        if (shouldAdvance || Object.keys(attribution).length > 0) {
          /*
           * Attribution is only written onto a deal that does not have any.
           * A deal already credited to the reply that created it must not be
           * silently re-credited to whichever sequence happened to carry the
           * booking link - the first cause is the true one.
           */
          await supabaseAdmin.from('deals')
            .update({
              ...(shouldAdvance ? { stage } : {}),
              ...(existing.attribution ? {} : attribution),
            })
            .eq('id', existing.id);
        }
        await supabaseAdmin.from('crm_events')
          .update({ deal_id: existing.id }).eq('id', eventId);
        return;
      }

      const { data: deal } = await supabaseAdmin
        .from('deals')
        .insert({
          user_id: link.user_id,
          title: `${who.company || who.name} - ${link.headline}`,
          company: who.company || null,
          contact_id: contactId,
          contact_name: who.name,
          contact_email: who.email,
          stage,
          ...attribution,
        })
        .select('id')
        .single();

      if (deal) {
        await supabaseAdmin.from('crm_events')
          .update({ deal_id: deal.id }).eq('id', eventId);
      }
    } catch (err: any) {
      console.error(`[Booking] Could not open a deal: ${err?.message || err}`);
    }
  },

  /**
   * The contact behind a booking.
   *
   * Somebody who books a meeting is a real person in the CRM, not a string
   * on an event. Matched on email so booking twice does not create two of
   * them, and an existing contact is enriched rather than overwritten -
   * whatever the account already knows beats what a form just collected.
   */
  async upsertContact(userId: string, who: {
    email: string; name: string; phone?: string; company?: string;
  }): Promise<string | null> {
    const { data: existing } = await supabaseAdmin
      .from('contacts')
      .select('id, first_name, last_name, phone, company')
      .eq('user_id', userId)
      .ilike('email', who.email)
      .maybeSingle();

    const [first, ...rest] = who.name.split(/\s+/);
    const last = rest.join(' ') || null;

    if (existing) {
      const patch: Record<string, any> = {};
      if (!existing.first_name && first) patch.first_name = first;
      if (!existing.last_name && last) patch.last_name = last;
      if (!existing.phone && who.phone) patch.phone = who.phone;
      if (!existing.company && who.company) patch.company = who.company;
      // Somebody who booked a meeting is not a cold prospect any more.
      patch.lifecycle = 'engaged';
      patch.engaged_at = new Date().toISOString();
      await supabaseAdmin.from('contacts').update(patch).eq('id', existing.id);
      return existing.id;
    }

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        user_id: userId,
        email: who.email,
        first_name: first || null,
        last_name: last,
        phone: who.phone || null,
        company: who.company || null,
        source: 'booking_link',
        lifecycle: 'engaged',
        engaged_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    /*
     * A contact that could not be created must not sink the booking. The
     * meeting is the thing the visitor came for; the CRM row is bookkeeping,
     * and the event carries the name and email either way.
     */
    if (error) return null;
    return data.id;
  },

  /** Best effort. A missing note never costs somebody their meeting. */
  async logActivity(userId: string, contactId: string | null, body: string) {
    if (!contactId) return;
    try {
      await supabaseAdmin.from('crm_notes').insert({
        user_id: userId, contact_id: contactId, body,
      });
    } catch {
      /* bookkeeping */
    }
  },

  /**
   * What a manage link resolves to.
   *
   * The token is the entire authorisation. It is looked up on its own -
   * never combined with a user id from the request, because there isn't one
   * - and it returns one booking or nothing.
   */
  async byToken(token: string): Promise<BookingConfirmation & { id: string; user_id: string }> {
    const clean = String(token || '').trim();
    if (!clean || clean.length < 20) throw new AppError('That link is not valid.', 404);

    const { data, error } = await supabaseAdmin
      .from('crm_events')
      .select(`
        id, user_id, title, starts_at, ends_at, status, contact_name, contact_email,
        invitee_timezone, cancelled_at, cancel_reason, manage_token,
        ics_sequence, invitee_message,
        booking_link:booking_links (slug, headline, notify_organiser, confirmation_note),
        event_type:calendar_event_types (name, colour, duration_minutes, location_kind)
      `)
      .eq('manage_token', clean)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('That link is not valid.', 404);

    const row = data as any;
    const start = new Date(row.starts_at);
    const end = row.ends_at ? new Date(row.ends_at) : new Date(start.getTime() + 30 * 60_000);

    return {
      id: row.id,
      user_id: row.user_id,
      start: start.toISOString(),
      end: end.toISOString(),
      headline: row.booking_link?.headline || row.title,
      organiser: await organiserName(row.user_id),
      duration_minutes: Math.round((end.getTime() - start.getTime()) / 60_000),
      location_kind: (row.event_type?.location_kind ?? 'video') as EventLocationKind,
      timezone: row.invitee_timezone || 'UTC',
      invitee_name: row.contact_name || '',
      invitee_email: row.contact_email || '',
      manage_token: clean,
      status: row.status === 'cancelled' ? 'cancelled' : 'confirmed',
      cancelled_at: row.cancelled_at,
      cancel_reason: row.cancel_reason,
      slug: row.booking_link?.slug ?? null,
      // Carried for the notification path, which needs more than a visitor
      // is shown. The controller strips everything a visitor may not see.
      ics_sequence: row.ics_sequence ?? 0,
      invitee_message: row.invitee_message ?? null,
      notify_organiser: row.booking_link?.notify_organiser !== false,
      confirmation_note: row.booking_link?.confirmation_note ?? null,
    } as any;
  },

  /** Free times for moving an existing booking, excluding its own slot. */
  async rescheduleSlots(token: string, from: Date, to: Date): Promise<Slot[]> {
    const booking = await this.byToken(token);
    const slots = await availabilityService.slots(booking.user_id, {
      from, to, durationMinutes: booking.duration_minutes,
    });
    /*
     * The meeting being moved is in its own way: availabilityService sees it
     * as busy, so its current time is missing from the list of times it
     * could move to. Putting it back is what stops "no, actually, leave it"
     * looking like an error.
     */
    const current = new Date(booking.start).getTime();
    if (!slots.some((s) => s.start.getTime() === current)) {
      slots.push({ start: new Date(booking.start), end: new Date(booking.end) });
      slots.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    return slots;
  },

  async reschedule(token: string, startIso: string): Promise<BookingConfirmation> {
    const booking = await this.byToken(token);
    if (booking.status === 'cancelled') {
      throw new AppError('That meeting was cancelled. Book a new time instead.', 409);
    }

    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) throw new AppError('That is not a time.', 400);
    if (start.getTime() === new Date(booking.start).getTime()) return booking;

    const end = new Date(start.getTime() + booking.duration_minutes * 60_000);
    const prefs = await availabilityService.getPrefs(booking.user_id);

    const { error } = await supabaseAdmin.rpc('book_slot', {
      p_user_id: booking.user_id,
      p_link_id: null,
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_buffer_before: prefs.buffer_before_minutes,
      p_buffer_after: prefs.buffer_after_minutes,
      p_title: '', p_contact_id: null, p_contact_name: '', p_contact_email: '',
      p_invitee_message: null, p_invitee_timezone: null, p_manage_token: null,
      p_event_type_id: null, p_location: null,
      p_exclude_event_id: booking.id,
    });
    if (error) {
      if (/SLOT_TAKEN/.test(error.message)) {
        throw new AppError('Somebody just took that time. Pick another and it will be yours.', 409);
      }
      throw new AppError(error.message, 500);
    }

    const moved = await this.byToken(token);
    // Told after the move, not before: an email announcing a time the
    // database then refused is worse than one that arrives a second late.
    await this.notify(moved, (ctx) => bookingMail.rescheduled(ctx, new Date(booking.start)));
    return moved;
  },

  /**
   * Assemble the mail context from a booking and send something with it.
   *
   * Every notification needs the same dozen fields, gathered the same way,
   * and none of them may throw into a request somebody is waiting on.
   */
  async notify(
    booking: Record<string, any>,
    send: (ctx: BookingMailContext) => Promise<any>,
  ): Promise<void> {
    try {
      const prefs = await availabilityService.getPrefs(booking.user_id);
      await send({
        userId: booking.user_id,
        eventId: booking.id,
        manageToken: booking.manage_token,
        start: new Date(booking.start),
        end: new Date(booking.end),
        durationMinutes: booking.duration_minutes,
        headline: booking.headline,
        organiser: booking.organiser,
        inviteeName: booking.invitee_name,
        inviteeEmail: booking.invitee_email,
        inviteeTimezone: booking.timezone || prefs.timezone,
        organiserTimezone: prefs.timezone,
        locationKind: booking.location_kind,
        confirmationNote: booking.confirmation_note ?? null,
        inviteeMessage: booking.invitee_message ?? null,
        sequence: booking.ics_sequence ?? 0,
        notifyOrganiser: booking.notify_organiser !== false,
      });
    } catch (err: any) {
      console.error(`[Booking] Notification failed: ${err?.message || err}`);
    }
  },

  async cancel(token: string, reason: string | undefined, by: 'invitee' | 'organiser' = 'invitee') {
    const booking = await this.byToken(token);
    if (booking.status === 'cancelled') return booking;

    const { error } = await supabaseAdmin
      .from('crm_events')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: by,
        cancel_reason: (reason || '').trim().slice(0, 500) || null,
      })
      .eq('id', booking.id);
    if (error) throw new AppError(error.message, 500);

    const cancelled = await this.byToken(token);
    await Promise.allSettled([
      this.notify(cancelled, (ctx) => bookingMail.cancelled(ctx, by, reason)),
      // Take it back out of the real calendar, or the slot stays blocked
      // there forever and the account's own availability quietly shrinks.
      calendarSync.removeEvent(booking.user_id, booking.id),
    ]);
    return cancelled;
  },

  /** The calendar file for a booking, so it lands in whatever they use. */
  async ics(token: string): Promise<{ filename: string; body: string }> {
    const booking = await this.byToken(token);
    const email = await organiserEmail(booking.user_id);
    return {
      filename: 'meeting.ics',
      body: buildIcs({
        uid: `${booking.manage_token}@sincerely`,
        start: new Date(booking.start),
        end: new Date(booking.end),
        title: booking.headline,
        description: `With ${booking.organiser}.`,
        location: booking.location_kind === 'in_person' ? 'In person' : booking.location_kind,
        organiser: booking.organiser,
        organiserEmail: email || undefined,
        attendeeEmail: booking.invitee_email || undefined,
        cancelled: booking.status === 'cancelled',
        // A cancellation must outrank the invite it replaces, or the client
        // keeps whichever it saw first.
        sequence: booking.status === 'cancelled' ? 1 : 0,
      }),
    };
  },
};
