import { Response, NextFunction } from 'express';
import { healthForDeals } from '../services/deal-health.service.js';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { crmService } from '../services/crm.service.js';
import { organiserBookingService } from '../services/booking.service.js';
import { noShowService } from '../services/no-show.service.js';
import { AppError } from '../middleware/error.middleware.js';
import { isValidTimezone } from '@lemlist/shared';

/**
 * An event's zone says which wall-clock day an all-day event means, and
 * the availability maths reads it. One it cannot parse would quietly turn
 * into UTC there, so it is refused here instead.
 */
function assertEventTimezone(body: any) {
  if (body && body.timezone != null && body.timezone !== '' && !isValidTimezone(body.timezone)) {
    throw new AppError('That is not a timezone this system knows.', 400);
  }
}
import { parseDayWindow } from '../utils/day-window.js';

export const crmController = {
  // Deals
  async listDeals(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const contactId = typeof req.query.contact_id === 'string' ? req.query.contact_id : undefined;
      const contactEmail = typeof req.query.contact_email === 'string' ? req.query.contact_email : undefined;
      res.json(await crmService.listDeals(req.userId!, { contactId, contactEmail }));
    } catch (err) { next(err); }
  },
  async dealHealth(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const ids = typeof req.query.ids === 'string' && req.query.ids ? req.query.ids.split(',').filter(Boolean) : undefined;
      res.json(await healthForDeals(req.userId!, ids));
    } catch (err) { next(err); }
  },
  async createDeal(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await crmService.createDeal(req.userId!, req.body)); } catch (err) { next(err); }
  },
  async updateDeal(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.updateDeal(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },
  async deleteDeal(req: AuthRequest, res: Response, next: NextFunction) {
    try { await crmService.deleteDeal(req.userId!, req.params.id); res.status(204).send(); } catch (err) { next(err); }
  },
  async dealStageHistory(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.dealStageHistory(req.userId!, req.params.id)); } catch (err) { next(err); }
  },
  async insights(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const days = parseDayWindow(req.query.days);
      res.json(await crmService.insights(req.userId!, days));
    } catch (err) { next(err); }
  },
  async dealDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.dealDetail(req.userId!, req.params.id)); } catch (err) { next(err); }
  },

  // Deal participants
  async listParticipants(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.listParticipants(req.userId!, req.params.id)); } catch (err) { next(err); }
  },
  async addParticipant(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await crmService.addParticipant(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },
  async updateParticipant(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await crmService.updateParticipant(req.userId!, req.params.id, req.params.participantId, req.body));
    } catch (err) { next(err); }
  },
  async removeParticipant(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await crmService.removeParticipant(req.userId!, req.params.id, req.params.participantId);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // Tasks
  async listTasks(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const contactId = typeof req.query.contact_id === 'string' ? req.query.contact_id : undefined;
      const dealId = typeof req.query.deal_id === 'string' ? req.query.deal_id : undefined;
      res.json(await crmService.listTasks(req.userId!, { contactId, dealId }));
    } catch (err) { next(err); }
  },
  async createTask(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await crmService.createTask(req.userId!, req.body)); } catch (err) { next(err); }
  },
  async updateTask(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.updateTask(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },
  async deleteTask(req: AuthRequest, res: Response, next: NextFunction) {
    try { await crmService.deleteTask(req.userId!, req.params.id); res.status(204).send(); } catch (err) { next(err); }
  },

  // Events
  async listEvents(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const contactId = typeof req.query.contact_id === 'string' ? req.query.contact_id : undefined;
      const dealId = typeof req.query.deal_id === 'string' ? req.query.deal_id : undefined;
      res.json(await crmService.listEvents(req.userId!, from, to, { contactId, dealId }));
    } catch (err) { next(err); }
  },
  async createEvent(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      assertEventTimezone(req.body);
      res.status(201).json(await crmService.createEvent(req.userId!, req.body));
    } catch (err) { next(err); }
  },
  async updateEvent(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      assertEventTimezone(req.body);
      /*
       * A meeting somebody booked through a link is moved and called off
       * the way its invitee would: they are emailed, their invite is
       * updated, and the Google copy follows. Whatever is left of the patch
       * (a title, a note) is an ordinary edit.
       */
      /*
       * A no-show is more than a status: it is logged on the contact and
       * may send (or offer) the rebook email. Routed through the same
       * service the dedicated endpoint uses, so the calendar's status menu
       * and the meeting dialog cannot disagree about what it does.
       */
      let noShow: any = null;
      let body = req.body || {};
      if (body.status === 'no_show') {
        noShow = await noShowService.mark(req.userId!, req.params.id);
        const { status: _status, ...withoutStatus } = body;
        body = withoutStatus;
      }
      const { rest, notified } = await organiserBookingService.beforeUpdate(req.userId!, req.params.id, body);
      const saved = Object.keys(rest).length > 0
        ? await crmService.updateEvent(req.userId!, req.params.id, rest)
        : await organiserBookingService.read(req.userId!, req.params.id);
      // Said back so the calendar can say who was told, rather than leave
      // the organiser wondering whether the person they moved knows.
      res.json({
        ...(saved as any),
        ...(notified ? { invitee_notified: true } : {}),
        ...(noShow ? { no_show: noShow } : {}),
      });
    } catch (err) { next(err); }
  },
  /* -- No-shows -- */
  async markNoShow(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await noShowService.mark(req.userId!, req.params.id)); } catch (err) { next(err); }
  },
  async noShowPreview(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await noShowService.preview(req.userId!, req.params.id)); } catch (err) { next(err); }
  },
  async sendNoShowFollowUp(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await noShowService.send(req.userId!, req.params.id, { subject: req.body?.subject, body: req.body?.body }));
    } catch (err) { next(err); }
  },
  async deleteEvent(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // The invitee is told before the row (and the manage link) is gone.
      await organiserBookingService.beforeDelete(req.userId!, req.params.id);
      await crmService.deleteEvent(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  /* ── Notes ── */
  async listNotes(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const contactId = typeof req.query.contact_id === 'string' ? req.query.contact_id : undefined;
      const dealId = typeof req.query.deal_id === 'string' ? req.query.deal_id : undefined;
      res.json(await crmService.listNotes(req.userId!, { contactId, dealId }));
    } catch (err) { next(err); }
  },

  async createNote(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.status(201).json(await crmService.createNote(req.userId!, req.body)); } catch (err) { next(err); }
  },

  async updateNote(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.updateNote(req.userId!, req.params.id, req.body)); } catch (err) { next(err); }
  },

  async deleteNote(req: AuthRequest, res: Response, next: NextFunction) {
    try { await crmService.deleteNote(req.userId!, req.params.id); res.status(204).send(); } catch (err) { next(err); }
  },

  /** Everything CRM knows about one contact, for the profile page. */
  async contactSummary(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await crmService.contactSummary(req.userId!, req.params.contactId)); } catch (err) { next(err); }
  },
};
