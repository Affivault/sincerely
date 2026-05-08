import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { inboxService } from '../services/inbox.service.js';

export const inboxController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await inboxService.list(req.userId!, req.query as any);
      res.json(result);
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
      const { body: replyBody, body_html, smtp_account_id } = req.body;
      if (!replyBody && !body_html) return res.status(400).json({ error: 'Reply body is required' });
      const result = await inboxService.reply(req.userId!, req.params.id, replyBody || '', smtp_account_id, body_html);
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
      const { to, subject, body: composeBody, body_html, smtp_account_id } = req.body;
      if (!to || !subject || (!composeBody && !body_html)) return res.status(400).json({ error: 'To, subject, and body are required' });
      const result = await inboxService.compose(req.userId!, { to, subject, body: composeBody || '', body_html, smtp_account_id });
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
      res.json({ synced: 0, newMessages: 0, errors: [err.message || 'Sync failed'] });
    }
  },
};
