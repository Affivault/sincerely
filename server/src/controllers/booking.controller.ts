import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { bookingService, publicBookingService } from '../services/booking.service.js';
import { bookingMail } from '../services/booking-mail.service.js';

/* The account's own links. Ordinary authenticated CRUD. */
export const bookingController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await bookingService.listLinks(req.userId!));
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.status(201).json(await bookingService.createLink(req.userId!, req.body || {}));
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await bookingService.updateLink(req.userId!, req.params.id, req.body || {}));
    } catch (err) { next(err); }
  },

  async archive(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await bookingService.archiveLink(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },

  async bookings(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await bookingService.linkBookings(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },

  /** Reply to a thread with the account's booking link, in one action. */
  async sendLinkInReply(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await bookingService.sendLinkInReply(
        req.userId!, req.params.messageId, (req.body || {}).note,
      ));
    } catch (err) { next(err); }
  },

  /**
   * Whether a booking can actually send anything.
   *
   * Asked by the links page so it can say so up front. A link that takes
   * bookings but silently sends no confirmation is the worst of both: the
   * account believes it is working, and the prospect thinks they were
   * ignored.
   */
  async readiness(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json({ can_email: await bookingMail.canSend(req.userId!) });
    } catch (err) { next(err); }
  },
};

/* ═══════════════════════════════════════════════════════════════════════
   The public half.

   Nothing here reads req.userId, because there is no session. Identity is
   the slug (for a page) or the manage token (for one booking), and both are
   resolved inside the service against hand-written column lists.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A window to compute slots over.
 *
 * Clamped rather than validated: a visitor cannot be trusted to ask for a
 * sensible range, and a booking page asking for ten years of slots is a way
 * to make the server do a great deal of arithmetic on request. The horizon
 * is enforced again inside computeSlots; this only stops the work happening.
 */
function range(req: Request): { from: Date; to: Date } | null {
  const { from, to } = req.query as Record<string, string>;
  const start = from ? new Date(from) : new Date();
  if (Number.isNaN(start.getTime())) return null;
  const asked = to ? new Date(to) : new Date(start.getTime() + 14 * 86_400_000);
  if (Number.isNaN(asked.getTime())) return null;
  const capped = new Date(Math.min(asked.getTime(), start.getTime() + 62 * 86_400_000));
  if (capped.getTime() <= start.getTime()) return null;
  return { from: start, to: capped };
}

/**
 * What a visitor may see of their own booking.
 *
 * byToken carries more than a visitor needs - the owning account, the row
 * id, the ics sequence, whether the organiser wants emails - because the
 * notification path is built from the same object. A whitelist rather than
 * a blacklist, so a field added later is invisible by default rather than
 * public by accident.
 */
function strip(booking: any) {
  return {
    start: booking.start,
    end: booking.end,
    headline: booking.headline,
    organiser: booking.organiser,
    duration_minutes: booking.duration_minutes,
    location_kind: booking.location_kind,
    timezone: booking.timezone,
    invitee_name: booking.invitee_name,
    invitee_email: booking.invitee_email,
    manage_token: booking.manage_token,
    status: booking.status,
    cancelled_at: booking.cancelled_at ?? null,
    cancel_reason: booking.cancel_reason ?? null,
    slug: booking.slug ?? null,
  };
}

export const publicBookingController = {
  async page(req: Request, res: Response, next: NextFunction) {
    try {
      // `k` is the signed token a campaign email puts on the link. It is
      // never required, and a bad one is indistinguishable from none.
      res.json(await publicBookingService.page(req.params.slug, req.query.k as string | undefined));
    } catch (err) { next(err); }
  },

  async slots(req: Request, res: Response, next: NextFunction) {
    try {
      const window = range(req);
      if (!window) return res.status(400).json({ error: 'from and to must be dates.' });
      res.json(await publicBookingService.slots(req.params.slug, window.from, window.to));
    } catch (err) { next(err); }
  },

  async book(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(201).json(await publicBookingService.book(
        req.params.slug, req.body || {}, req.query.k as string | undefined,
      ));
    } catch (err) { next(err); }
  },

  /* ── One booking, held open by its token ── */

  async byToken(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(strip(await publicBookingService.byToken(req.params.token)));
    } catch (err) { next(err); }
  },

  async rescheduleSlots(req: Request, res: Response, next: NextFunction) {
    try {
      const window = range(req);
      if (!window) return res.status(400).json({ error: 'from and to must be dates.' });
      res.json(await publicBookingService.rescheduleSlots(req.params.token, window.from, window.to));
    } catch (err) { next(err); }
  },

  async reschedule(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(strip(await publicBookingService.reschedule(req.params.token, (req.body || {}).start)));
    } catch (err) { next(err); }
  },

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(strip(await publicBookingService.cancel(req.params.token, (req.body || {}).reason)));
    } catch (err) { next(err); }
  },

  async ics(req: Request, res: Response, next: NextFunction) {
    try {
      const file = await publicBookingService.ics(req.params.token);
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.body);
    } catch (err) { next(err); }
  },
};
