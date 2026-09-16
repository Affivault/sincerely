import { Router, Request, Response, NextFunction } from 'express';
import { bookingController, publicBookingController } from '../controllers/booking.controller.js';

/* The account's own links, mounted under the authenticated /api/v1. */
export const bookingRoutes = Router();

bookingRoutes.get('/', bookingController.list);
// Declared before '/:id/...' so 'readiness' is never read as a link id.
bookingRoutes.get('/readiness', bookingController.readiness);
bookingRoutes.post('/', bookingController.create);
bookingRoutes.patch('/:id', bookingController.update);
bookingRoutes.delete('/:id', bookingController.archive);
bookingRoutes.get('/:id/bookings', bookingController.bookings);
// Replying to a thread with the link, from the inbox.
bookingRoutes.post('/reply/:messageId', bookingController.sendLinkInReply);

/* ═══════════════════════════════════════════════════════════════════════
   The public booking pages. Mounted outside /api/v1, before any auth.

   Everything here is reachable by anybody who knows a URL, which makes two
   things matter that do not matter anywhere else in this server.

   Rate limiting, because slot computation is real arithmetic over a real
   diary and the endpoint takes a date range. Without a limit, one visitor
   with a loop is a way to make the database busy on somebody else's behalf.

   Uniform 404s, because a booking page that answers "not found" differently
   from "not active" tells a stranger which slugs exist. That distinction is
   drawn in the service, where the account's own API can still see it; the
   difference a visitor sees is only whether the page renders.
   ═══════════════════════════════════════════════════════════════════════ */

const WINDOW_MS = 60_000;
const READ_BUDGET = 60;   // a page load plus browsing a few weeks
const WRITE_BUDGET = 8;   // booking, moving, cancelling

const hits = new Map<string, { count: number; windowStart: number }>();

// The map is keyed by caller and only grows; sweep closed windows so a busy
// page does not leak memory for the life of the process.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, entry] of hits) {
    if (entry.windowStart < cutoff) hits.delete(key);
  }
}, WINDOW_MS).unref();

function limit(budget: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    /*
     * req.ip behind a proxy is the proxy unless Express is told to trust it,
     * so the forwarded header is preferred where present. It is spoofable,
     * which is why this is a courtesy limit on a public endpoint and not an
     * access control - the real guard on a booking is book_slot.
     */
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const who = `${forwarded || req.ip || 'anon'}:${budget}`;
    const now = Date.now();
    const entry = hits.get(who);

    if (!entry || now - entry.windowStart > WINDOW_MS) {
      hits.set(who, { count: 1, windowStart: now });
      return next();
    }
    entry.count += 1;
    if (entry.count > budget) {
      const retry = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests. Give it a moment.' });
    }
    return next();
  };
}

export const publicBookingRoutes = Router();

/*
 * The manage routes are declared first, and 'manage' is a reserved slug (see
 * RESERVED_SLUGS in the service). Either alone would do; both are here
 * because the failure is silent - an account that named its link "manage"
 * would shadow every invitee's cancel link, and nothing would look wrong
 * until somebody could not get out of a meeting.
 */
publicBookingRoutes.get('/manage/:token', limit(READ_BUDGET), publicBookingController.byToken);
publicBookingRoutes.get('/manage/:token/slots', limit(READ_BUDGET), publicBookingController.rescheduleSlots);
publicBookingRoutes.get('/manage/:token/ics', limit(READ_BUDGET), publicBookingController.ics);
publicBookingRoutes.post('/manage/:token/reschedule', limit(WRITE_BUDGET), publicBookingController.reschedule);
publicBookingRoutes.post('/manage/:token/cancel', limit(WRITE_BUDGET), publicBookingController.cancel);

publicBookingRoutes.get('/:slug', limit(READ_BUDGET), publicBookingController.page);
publicBookingRoutes.get('/:slug/slots', limit(READ_BUDGET), publicBookingController.slots);
publicBookingRoutes.post('/:slug', limit(WRITE_BUDGET), publicBookingController.book);
