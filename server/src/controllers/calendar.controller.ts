import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { calendarService, availabilityService } from '../services/calendar.service.js';

export const calendarController = {
  /** Every kind of meeting this account uses, seeded on first read. */
  async listTypes(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await calendarService.listTypes(req.userId!));
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
