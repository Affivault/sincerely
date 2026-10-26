import { aiAvailable } from '../services/ai.service.js';
import { mailSortService } from '../services/mail-sort.service.js';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { triageService } from '../services/triage.service.js';
import { inboxService } from '../services/inbox.service.js';
import { inboxSyncService } from '../services/inbox-sync.service.js';
import { inboxAttachmentsService, contentDisposition } from '../services/inbox-attachments.service.js';
import { inboxRemindersService } from '../services/inbox-reminders.service.js';
import { inboxAssignService } from '../services/inbox-assign.service.js';

export const inboxController = {
  async unreadCount(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const count = await inboxService.unreadCount(req.userId!);
      res.json({ count });
    } catch (err) { next(err); }
  },

  async counts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inboxService.counts(req.userId!);
      res.json(result);
    } catch (err) { next(err); }
  },

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inboxService.list(req.userId!, req.query as any);
      res.json(result);
    } catch (err) { next(err); }
  },

  /** Whether Relay reads with Claude, and people it may have wrongly unsubscribed. */
  async relayStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json({ ai: aiAvailable(), review: await mailSortService.relayReview(req.userId!) });
    } catch (err) { next(err); }
  },

  async relayRestore(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await mailSortService.restore(req.userId!, req.params.contactId)); } catch (err) { next(err); }
  },

  async relayDismiss(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await mailSortService.dismiss(req.userId!, req.params.contactId)); } catch (err) { next(err); }
  },

  /** "This is a person" / "This is mail" - applies to everything from that sender. */
  async setMailKind(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await inboxService.setMailKind(req.userId!, req.params.id, String(req.body?.kind || '')));
    } catch (err) { next(err); }
  },

  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const message = await inboxService.get(req.userId!, req.params.id);
      res.json(message);
    } catch (err) { next(err); }
  },

  async getThread(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const thread = await inboxService.getThread(req.userId!, req.params.id);
      res.json(thread);
    } catch (err) { next(err); }
  },

  async markRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await inboxService.markRead(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async markUnread(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await inboxService.markUnread(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await inboxService.markAllRead(req.userId!);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async toggleStar(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inboxService.toggleStar(req.userId!, req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  },

  async setTag(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { tag } = req.body;
      if (tag === undefined) return res.status(400).json({ error: 'Tag value is required' });
      const result = await inboxService.setTag(req.userId!, req.params.id, tag);
      res.json(result);
    } catch (err) { next(err); }
  },

  async archive(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await inboxService.archive(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },
  /** Take a triage decision back, removing whatever it created. */
  async untriage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await triageService.undo(req.userId!, req.params.id));
    } catch (err) { next(err); }
  },

  /** Decide what a reply is, and do the work that follows. */
  async triage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await triageService.triage(req.userId!, req.params.id, req.body || {}));
    } catch (err) { next(err); }
  },

  /** The same decision about a selection of replies. */
  async triageMany(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { message_ids, ...input } = req.body || {};
      res.json(await triageService.triageMany(req.userId!, message_ids, input as any));
    } catch (err) { next(err); }
  },

  /** Take a whole bulk run back. */
  async untriageMany(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await triageService.undoMany(req.userId!, (req.body || {}).message_ids));
    } catch (err) { next(err); }
  },


  async unarchive(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await inboxService.unarchive(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async archiveThread(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await inboxService.archiveThread(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async unarchiveThread(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await inboxService.unarchiveThread(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async markThreadRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await inboxService.markThreadRead(req.userId!, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async reply(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { body: replyBody, body_html, smtp_account_id, attachments, nudge_days } = req.body;
      if (!replyBody && !body_html) return res.status(400).json({ error: 'Reply body is required' });
      const result = await inboxService.reply(req.userId!, req.params.id, replyBody || '', smtp_account_id, body_html, { attachments, nudge_days });
      res.json(result);
    } catch (err) { next(err); }
  },

  async forward(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { to, note, body_html, smtp_account_id } = req.body;
      if (!to) return res.status(400).json({ error: 'Recipient email is required' });
      const result = await inboxService.forward(req.userId!, req.params.id, to, note, smtp_account_id, body_html);
      res.json(result);
    } catch (err) { next(err); }
  },

  async aiReplyAssist(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
      const result = await inboxService.generateReplyAssist(req.userId!, req.params.id, prompt);
      res.json(result);
    } catch (err) { next(err); }
  },

  async compose(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { to, subject, body: composeBody, body_html, smtp_account_id, attachments, nudge_days } = req.body;
      if (!to || !subject || (!composeBody && !body_html)) return res.status(400).json({ error: 'To, subject, and body are required' });
      const result = await inboxService.compose(req.userId!, { to, subject, body: composeBody || '', body_html, smtp_account_id, attachments, nudge_days });
      res.json(result);
    } catch (err) { next(err); }
  },

  async scheduleSend(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { to, subject, body: composeBody, body_html, smtp_account_id, scheduled_at } = req.body;
      if (!to || !subject || (!composeBody && !body_html)) return res.status(400).json({ error: 'To, subject, and body are required' });
      if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });
      const result = await inboxService.scheduleSend(req.userId!, { to, subject, body: composeBody || '', body_html, smtp_account_id, scheduled_at });
      res.json(result);
    } catch (err) { next(err); }
  },

  async scheduleReply(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { body: replyBody, body_html, smtp_account_id, scheduled_at } = req.body;
      if (!replyBody && !body_html) return res.status(400).json({ error: 'Reply body is required' });
      if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });
      const result = await inboxService.scheduleReply(req.userId!, req.params.id, replyBody || '', scheduled_at, smtp_account_id, body_html);
      res.json(result);
    } catch (err) { next(err); }
  },

  async cancelScheduled(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inboxService.cancelScheduledEmail(req.userId!, req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  },

  async rescheduleScheduled(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { scheduled_at } = req.body;
      if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });
      const result = await inboxService.rescheduleScheduledEmail(req.userId!, req.params.id, scheduled_at);
      res.json(result);
    } catch (err) { next(err); }
  },

  async listScheduled(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inboxService.listScheduledEmails(req.userId!);
      res.json(result);
    } catch (err) { next(err); }
  },

  async syncInbox(req: AuthRequest, res: Response, _next: NextFunction) {
    try {
      const result = await inboxService.syncInbox(req.userId!);
      res.json(result);
    } catch (err: any) {
      // Sync should never fail hard — always return a usable response
      console.error('[InboxSync] Controller error:', err.message);
      res.json({ synced: 0, newMessages: 0, backfilled: 0, more: false, errors: [err.message || 'Sync failed'] });
    }
  },

  /**
   * One attachment of one of the caller's messages, fetched from their
   * mailbox and streamed back as a download.
   */
  async downloadAttachment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const index = Number(req.params.index);
      const file = await inboxAttachmentsService.download(req.userId!, req.params.id, index);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Length', String(file.content.length));
      // Always a download, never rendered: an HTML or SVG attachment shown
      // inline would run with this API's origin.
      res.setHeader('Content-Disposition', contentDisposition(file.filename));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.end(file.content);
    } catch (err) { next(err); }
  },

  /** Snooze the conversation until a time; until: null wakes it now. */
  async snooze(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { until } = req.body ?? {};
      if (until !== null && typeof until !== 'string') {
        return res.status(400).json({ error: 'until must be an ISO timestamp, or null to wake it' });
      }
      res.json(await inboxRemindersService.snoozeThread(req.userId!, req.params.id, until || null));
    } catch (err) { next(err); }
  },

  /** "Remind me if no reply in N days" on a sent message; days: null clears it. */
  async nudge(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { days } = req.body ?? {};
      if (days !== null && typeof days !== 'number') {
        return res.status(400).json({ error: 'days must be a number, or null to clear the reminder' });
      }
      res.json(await inboxRemindersService.setNudge(req.userId!, req.params.id, days));
    } catch (err) { next(err); }
  },

  /** Hand the conversation to a teammate (or yourself); assignee: null unassigns. */
  async assign(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { assignee } = req.body ?? {};
      if (assignee !== null && typeof assignee !== 'string') {
        return res.status(400).json({ error: 'assignee must be a user id, or null to unassign' });
      }
      res.json(await inboxAssignService.assignThread(req.userId!, req.params.id, assignee));
    } catch (err) { next(err); }
  },

  /** Who a conversation can be assigned to. Empty for a solo account. */
  async teammates(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await inboxAssignService.teammates(req.userId!));
    } catch (err) { next(err); }
  },

  /** How far back each mailbox reaches, and whether it is still fetching. */
  async syncProgress(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json(await inboxSyncService.progress(req.userId!));
    } catch (err) { next(err); }
  },
};
