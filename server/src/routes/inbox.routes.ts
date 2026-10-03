import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import { inboxController } from '../controllers/inbox.controller.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { AppError } from '../middleware/error.middleware.js';
import { referralService } from '../services/referral.service.js';

export const inboxRoutes = Router();

// Static routes first (before parameterized /:id routes)
inboxRoutes.get('/unread-count', inboxController.unreadCount);
inboxRoutes.get('/counts', inboxController.counts);
inboxRoutes.get('/relay-status', inboxController.relayStatus);
inboxRoutes.post('/relay-review/:contactId/restore', inboxController.relayRestore);
inboxRoutes.post('/relay-review/:contactId/dismiss', inboxController.relayDismiss);
inboxRoutes.get('/', inboxController.list);
inboxRoutes.get('/scheduled', inboxController.listScheduled);
inboxRoutes.put('/mark-all-read', inboxController.markAllRead);
inboxRoutes.post('/compose', inboxController.compose);
inboxRoutes.post('/schedule-send', inboxController.scheduleSend);
inboxRoutes.post('/sync', inboxController.syncInbox);
inboxRoutes.get('/sync/progress', inboxController.syncProgress);
// Deciding about a stack of replies at once — registered with the static
// routes so it can never be read as an id called "triage".
inboxRoutes.post('/triage/bulk', inboxController.triageMany);
inboxRoutes.post('/triage/bulk-undo', inboxController.untriageMany);

// Parameterized routes
inboxRoutes.get('/:id', inboxController.get);
inboxRoutes.get('/:id/thread', inboxController.getThread);
// What a reply is: interested, later, or not interested.
inboxRoutes.post('/:id/triage', inboxController.triage);
inboxRoutes.delete('/:id/triage', inboxController.untriage);
inboxRoutes.put('/:id/read', inboxController.markRead);
inboxRoutes.put('/:id/unread', inboxController.markUnread);
inboxRoutes.put('/:id/star', inboxController.toggleStar);
inboxRoutes.put('/:id/tag', inboxController.setTag);
inboxRoutes.put('/:id/mail-kind', inboxController.setMailKind);
inboxRoutes.put('/:id/archive', inboxController.archive);
inboxRoutes.put('/:id/unarchive', inboxController.unarchive);
inboxRoutes.put('/:id/archive-thread', inboxController.archiveThread);
inboxRoutes.put('/:id/unarchive-thread', inboxController.unarchiveThread);
inboxRoutes.put('/:id/read-thread', inboxController.markThreadRead);
inboxRoutes.post('/:id/reply', inboxController.reply);
inboxRoutes.post('/:id/forward', inboxController.forward);
inboxRoutes.post('/:id/ai-reply-assist', inboxController.aiReplyAssist);
inboxRoutes.post('/:id/schedule-reply', inboxController.scheduleReply);
inboxRoutes.delete('/:id/schedule', inboxController.cancelScheduled);
inboxRoutes.put('/:id/schedule', inboxController.rescheduleScheduled);

/* ── A reply that hands you on to somebody else (services/referral) ── */
inboxRoutes.post('/:id/referral/draft', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = String(req.body?.email || '').trim();
    if (!email) throw new AppError('Who is it to?', 400);
    res.json(await referralService.draft(req.userId!, req.params.id, { email, first_name: req.body?.first_name ?? null }));
  } catch (err) { next(err); }
});

inboxRoutes.post('/:id/referral', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await referralService.send(req.userId!, req.params.id, {
      email: req.body?.email,
      first_name: req.body?.first_name ?? null,
      last_name: req.body?.last_name ?? null,
      subject: String(req.body?.subject || ''),
      body: String(req.body?.body || ''),
      smtp_account_id: req.body?.smtp_account_id ?? null,
      follow_up: req.body?.follow_up === true,
    }));
  } catch (err) { next(err); }
});
