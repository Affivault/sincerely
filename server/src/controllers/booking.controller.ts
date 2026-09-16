import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { bookingService, publicBookingService } from '../services/booking.service.js';

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

export const publicBookingController = {
  async page(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await publicBookingService.page(req.params.slug));
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
      res.status(201).json(await publicBookingService.book(req.params.slug, req.body || {}));
    } catch (err) { next(err); }
  },

  /* ── One booking, held open by its token ── */

  async byToken(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await publicBookingService.byToken(req.params.token);
      // user_id is how the service reaches the diary. It is not the
      // visitor's business, and it is stripped on the way out.
      const { user_id: _omit, id: _also, ...safe } = booking as any;
      res.json(safe);
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
      const booking = await publicBookingService.reschedule(req.params.token, (req.body || {}).start);
      const { user_id: _omit, id: _also, ...safe } = booking as any;
      res.json(safe);
    } catch (err) { next(err); }
  },

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await publicBookingService.cancel(req.params.token, (req.body || {}).reason);
      const { user_id: _omit, id: _also, ...safe } = booking as any;
      res.json(safe);
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
