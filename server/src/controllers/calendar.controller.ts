import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { calendarService, availabilityService } from '../services/calendar.service.js';
import {
  calendarSync, googleConfigured,
  CALENDAR_OAUTH_COOKIE, CALENDAR_OAUTH_COOKIE_PATH, CALENDAR_OAUTH_TTL_MS,
} from '../services/calendar-sync.service.js';
import { env } from '../config/env.js';

export const calendarController = {
  /**
   * Every kind of meeting this account uses, seeded on first read.
   *
   * `?include_archived=1` for the calendar, which has to look up the kind of
   * a meeting booked months ago - including one whose kind has since been
   * retired. Pickers leave it off, because nothing new should be filed under
   * a kind that is no longer in use.
   */
  async listTypes(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const includeArchived = req.query.include_archived === '1'
        || req.query.include_archived === 'true';
      res.json(await calendarService.listTypes(req.userId!, includeArchived));
    } catch (err) { next(err); }
  },

  async createType(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.status(201).json(await calendarService.createType(req.userId!, req.body || {}));
    } catch (err) { next(err); }
  },

  async updateType(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await calendarService.updateType(req.userId!, req.params.id, req.body || {}));
    } catch (err) { next(err); }
  },

  /** Retired, not deleted — events already point at it. */
  async archiveType(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await calendarService.archiveType(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },

  /* ── When you are free ── */

  async getAvailability(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const [windows, prefs] = await Promise.all([
        availabilityService.listWindows(req.userId!),
        availabilityService.getPrefs(req.userId!),
      ]);
      res.json({ windows, prefs });
    } catch (err) { next(err); }
  },

  /** The whole week at once — a partial save is how a day goes missing. */
  async replaceAvailability(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await availabilityService.replaceWindows(req.userId!, (req.body || {}).windows));
    } catch (err) { next(err); }
  },

  async updatePrefs(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await availabilityService.updatePrefs(req.userId!, req.body || {}));
    } catch (err) { next(err); }
  },

  /* ── Calendars kept elsewhere ── */

  async listConnections(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json({
        // Said plainly rather than by an empty list, so the UI can explain
        // "not set up on this deployment" instead of "none connected".
        available: googleConfigured(),
        connections: await calendarSync.list(req.userId!),
      });
    } catch (err) { next(err); }
  },

  async authorizeGoogle(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { url, nonce } = calendarSync.authorizeUrl(req.userId!);
      /*
       * The other half of the state: this browser, and only this one, can
       * finish the connection. Set on the API's own host and scoped to the
       * callback path, which Google's redirect reaches as a top-level GET -
       * the one cross-site request SameSite=Lax still carries a cookie on.
       * The client asks for this with credentials so the cookie is kept.
       */
      res.cookie(CALENDAR_OAUTH_COOKIE, nonce, {
        httpOnly: true,
        secure: /^https:/i.test(env.API_BASE_URL),
        sameSite: 'lax',
        path: CALENDAR_OAUTH_COOKIE_PATH,
        maxAge: CALENDAR_OAUTH_TTL_MS,
      });
      res.json({ url });
    } catch (err) { next(err); }
  },

  async updateConnection(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await calendarSync.update(req.userId!, req.params.id, req.body || {}));
    } catch (err) { next(err); }
  },

  async disconnect(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await calendarSync.disconnect(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },

  /**
   * The moments a meeting of this length could be offered.
   *
   * Used by the preview in settings today and by the booking page when it
   * exists — both calling the same thing is what stops them disagreeing.
   */
  async slots(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { from, to, duration } = req.query as Record<string, string>;
      const start = from ? new Date(from) : new Date();
      const end = to ? new Date(to) : new Date(start.getTime() + 14 * 86_400_000);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: 'from and to must be dates' });
      }
      const minutes = Number(duration) || 30;
      res.json(await availabilityService.slots(req.userId!, {
        from: start, to: end, durationMinutes: minutes,
      }));
    } catch (err) { next(err); }
  },
};
