import { Router } from 'express';
import { inboxController } from '../controllers/inbox.controller.js';

export const inboxRoutes = Router();

// Static routes first (before parameterized /:id routes)
inboxRoutes.get('/', inboxController.list);
inboxRoutes.get('/scheduled', inboxController.listScheduled);
inboxRoutes.put('/mark-all-read', inboxController.markAllRead);
inboxRoutes.post('/compose', inboxController.compose);
inboxRoutes.post('/schedule-send', inboxController.scheduleSend);
inboxRoutes.post('/sync', inboxController.syncInbox);

// Parameterized routes
inboxRoutes.get('/:id', inboxController.get);
inboxRoutes.get('/:id/thread', inboxController.getThread);
inboxRoutes.put('/:id/read', inboxController.markRead);
inboxRoutes.put('/:id/unread', inboxController.markUnread);
inboxRoutes.put('/:id/star', inboxController.toggleStar);
inboxRoutes.put('/:id/tag', inboxController.setTag);
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
