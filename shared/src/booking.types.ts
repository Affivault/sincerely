/* ═══════════════════════════════════════════════════════════════════════
   Booking links: the part of the calendar a stranger touches.

   Everything else in this product assumes a logged-in account. This does
   not, and that changes what the types have to be careful about. A booking
   link has an owner, a diary and a set of rules, none of which the visitor
   may see - so there are two shapes here rather than one:

     BookingLink        what the account sees. The whole row.
     PublicBookingPage  what the visitor sees. Deliberately, visibly less.

   Keeping them apart in the types is what stops a careless `select('*')`
   putting somebody's diary on the open internet. The public shape is a
   whitelist, and it is short enough to read in one go.
   ═══════════════════════════════════════════════════════════════════════ */

import type { EventLocationKind } from './calendar.types.js';

/** What the account sees and edits. */
export interface BookingLink {
  id: string;
  user_id: string;
  /** The whole of the public URL. Globally unique, lowercase. */
  slug: string;
  event_type_id: string | null;
  /** Overrides the kind's length when set. */
  duration_minutes: number | null;
  headline: string;
  blurb: string | null;
  collect_phone: boolean;
  collect_company: boolean;
  /** One free-text question, asked of everybody. Null means do not ask. */
  question: string | null;
  is_active: boolean;
  views: number;
  bookings: number;
  /** A booking opens a deal, because that is what a booking means. */
  create_deal: boolean;
  /** Which stage it opens in. Null means the pipeline's first. */
  deal_stage: string | null;
  /** Tell the account by email when somebody books. */
  notify_organiser: boolean;
  /** Appended to the confirmation email. Dial-in details, what to prepare. */
  confirmation_note: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  /** Joined in for the list, so a link can show its colour and length. */
  event_type?: {
    id: string; name: string; colour: string;
    duration_minutes: number; location_kind: EventLocationKind;
  } | null;
}

export interface CreateBookingLinkInput {
  slug?: string;
  event_type_id?: string | null;
  duration_minutes?: number | null;
  headline?: string;
  blurb?: string | null;
  collect_phone?: boolean;
  collect_company?: boolean;
  question?: string | null;
  is_active?: boolean;
  create_deal?: boolean;
  deal_stage?: string | null;
  notify_organiser?: boolean;
  confirmation_note?: string | null;
}

/**
 * What a visitor is allowed to know.
 *
 * No user id, no email, no diary, no rules beyond the length of the meeting
 * and the zone the times are quoted in. The organiser's name is here because
 * a page that will not say whose calendar it is does not get booked.
 */
export interface PublicBookingPage {
  slug: string;
  headline: string;
  blurb: string | null;
  duration_minutes: number;
  location_kind: EventLocationKind;
  colour: string;
  /** A display name, never the login email. */
  organiser: string;
  /** The zone the organiser keeps, shown so a visitor can sanity-check. */
  timezone: string;
  collect_phone: boolean;
  collect_company: boolean;
  question: string | null;
  /** How far ahead this page will offer anything. */
  horizon_days: number;
  /**
   * Who the page thinks this is, when the link arrived in a campaign email.
   *
   * A convenience only. Every field it fills stays editable, a page reached
   * without a token simply asks for all of it, and nothing about a booking
   * is gated on recognising somebody.
   */
  invitee?: { name: string; email: string; company: string } | null;
}

/** What a visitor sends to take a slot. */
export interface CreateBookingInput {
  /** ISO instant. Must be one of the offered slots, re-checked server-side. */
  start: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  /** The answer to the link's question, if it asks one. */
  answer?: string;
  /** The visitor's own zone, so the confirmation can be quoted back in it. */
  timezone?: string;
}

/**
 * What comes back after booking, and what the manage link resolves to.
 *
 * The token is in here because the page that just booked needs it to offer
 * "move" and "cancel" without a round trip. It is not in any list endpoint.
 */
export interface BookingConfirmation {
  start: string;
  end: string;
  headline: string;
  organiser: string;
  duration_minutes: number;
  location_kind: EventLocationKind;
  timezone: string;
  invitee_name: string;
  invitee_email: string;
  manage_token: string;
  status: 'confirmed' | 'cancelled';
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  /** The slug, so the manage page can offer a fresh booking after a cancel. */
  slug: string | null;
}

/** Only the reasons a booking may be refused that the visitor can act on. */
export const BOOKING_REFUSALS = {
  SLOT_TAKEN: 'Somebody just took that time. Pick another and it will be yours.',
  SLOT_STALE: 'That time is no longer being offered. Have another look at what is free.',
  NOT_ACTIVE: 'This booking page is not taking bookings at the moment.',
  NOT_FOUND: 'There is no booking page at this address.',
} as const;

/**
 * Is this a plausible email?
 *
 * Deliberately loose. A booking page is not the place to litigate RFC 5322,
 * and the cost of refusing a real address is somebody not booking a meeting.
 * The only things rejected are the ones that cannot be an address at all.
 */
export function looksLikeEmail(value: string): boolean {
  const v = String(value || '').trim();
  if (v.length < 6 || v.length > 254) return false;
  if (/\s/.test(v)) return false;
  const at = v.indexOf('@');
  if (at < 1 || at !== v.lastIndexOf('@')) return false;
  const domain = v.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/**
 * Turn anything into something the slug constraint will accept.
 *
 * Used when an account types a headline and has not chosen a slug. The
 * database check is the authority; this only exists so the common case
 * never meets it.
 */
export function slugify(value: string): string {
  const base = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  // The constraint wants at least three characters, starting and ending
  // alphanumeric. Anything shorter gets padded rather than rejected.
  return base.length >= 3 ? base : `${base ? `${base}-` : ''}meet`;
}

/** A calendar file, so the meeting lands in whatever the invitee actually uses. */
export function buildIcs(input: {
  uid: string;
  start: Date;
  end: Date;
  title: string;
  description?: string;
  location?: string;
  organiser?: string;
  organiserEmail?: string;
  attendeeEmail?: string;
  cancelled?: boolean;
  sequence?: number;
}): string {
  const stamp = (d: Date) => `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  /*
   * Escaping is not optional: a comma or a semicolon in a headline silently
   * truncates the field in most calendar clients, and a raw newline ends
   * the property. Backslash first, or it escapes its own escapes.
   */
  const esc = (s: string) => String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sincerely//Booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(input.end)}`,
    `SUMMARY:${esc(input.title)}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `STATUS:${input.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
  ];
  if (input.description) lines.push(`DESCRIPTION:${esc(input.description)}`);
  if (input.location) lines.push(`LOCATION:${esc(input.location)}`);
  if (input.organiserEmail) {
    lines.push(`ORGANIZER;CN=${esc(input.organiser || input.organiserEmail)}:mailto:${input.organiserEmail}`);
  }
  if (input.attendeeEmail) {
    lines.push(`ATTENDEE;RSVP=TRUE;CN=${esc(input.attendeeEmail)}:mailto:${input.attendeeEmail}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');

  // RFC 5545 wants CRLF, and the clients that care are the ones that break.
  return lines.join('\r\n');
}
