import { apiClient } from './client';
import type { InboxMessage, InboxMessageWithContext, InboxCounts, PaginatedResponse } from '@lemlist/shared';

export const inboxApi = {
  unreadCount: async (): Promise<number> => {
    const { data } = await apiClient.get<{ count: number }>('/inbox/unread-count');
    return data.count;
  },

  /** Full-mailbox unread + per-intent counts for the sidebar badges. */
  counts: async (): Promise<InboxCounts> => {
    const { data } = await apiClient.get<InboxCounts>('/inbox/counts');
    return data;
  },

  list: async (params?: {
    page?: number;
    limit?: number;
    is_read?: boolean;
    is_starred?: boolean;
    folder?: string;
    sara_status?: string;
    sara_intent?: string;
    search?: string;
    contact_email?: string;
  }) => {
    const { data } = await apiClient.get<PaginatedResponse<InboxMessageWithContext>>('/inbox', { params });
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<InboxMessageWithContext>(`/inbox/${id}`);
    return data;
  },

  getThread: async (id: string) => {
    const { data } = await apiClient.get<InboxMessageWithContext[]>(`/inbox/${id}/thread`);
    return data;
  },

  markRead: async (id: string) => {
    await apiClient.put(`/inbox/${id}/read`);
  },

  markUnread: async (id: string) => {
    await apiClient.put(`/inbox/${id}/unread`);
  },

  markAllRead: async () => {
    await apiClient.put('/inbox/mark-all-read');
  },

  toggleStar: async (id: string) => {
    const { data } = await apiClient.put<{ is_starred: boolean }>(`/inbox/${id}/star`);
    return data;
  },

  setTag: async (id: string, tag: string) => {
    const { data } = await apiClient.put<{ sara_intent: string | null }>(`/inbox/${id}/tag`, { tag });
    return data;
  },

  archive: async (id: string) => {
    await apiClient.put(`/inbox/${id}/archive`);
  },

  unarchive: async (id: string) => {
    await apiClient.put(`/inbox/${id}/unarchive`);
  },

  archiveThread: async (id: string) => {
    await apiClient.put(`/inbox/${id}/archive-thread`);
  },

  unarchiveThread: async (id: string) => {
    await apiClient.put(`/inbox/${id}/unarchive-thread`);
  },

  markThreadRead: async (id: string) => {
    await apiClient.put(`/inbox/${id}/read-thread`);
  },

  reply: async (id: string, body: string, smtp_account_id?: string, body_html?: string) => {
    const { data } = await apiClient.post<{ success: boolean; message_id: string }>(`/inbox/${id}/reply`, { body, body_html, smtp_account_id });
    return data;
  },

  forward: async (id: string, to: string, note?: string, smtp_account_id?: string, body_html?: string) => {
    const { data } = await apiClient.post<{ success: boolean; message_id: string }>(`/inbox/${id}/forward`, { to, note, body_html, smtp_account_id });
    return data;
  },

  aiReplyAssist: async (id: string, prompt: string) => {
    const { data } = await apiClient.post<{ html: string; text: string }>(`/inbox/${id}/ai-reply-assist`, { prompt });
    return data;
  },

  compose: async (input: { to: string; subject: string; body: string; body_html?: string; smtp_account_id?: string }) => {
    const { data } = await apiClient.post<{ success: boolean; message_id: string }>('/inbox/compose', input);
    return data;
  },

  scheduleSend: async (input: { to: string; subject: string; body: string; body_html?: string; smtp_account_id?: string; scheduled_at: string }) => {
    const { data } = await apiClient.post<{ success: boolean; message_id: string; id: string; scheduled_at: string }>('/inbox/schedule-send', input);
    return data;
  },

  scheduleReply: async (id: string, body: string, scheduled_at: string, smtp_account_id?: string, body_html?: string) => {
    const { data } = await apiClient.post<{ success: boolean; message_id: string; id: string; scheduled_at: string }>(`/inbox/${id}/schedule-reply`, { body, body_html, smtp_account_id, scheduled_at });
    return data;
  },

  cancelScheduled: async (id: string) => {
    const { data } = await apiClient.delete<{ success: boolean }>(`/inbox/${id}/schedule`);
    return data;
  },

  listScheduled: async () => {
    const { data } = await apiClient.get<(InboxMessage & { scheduled_at: string; smtp_email: string | null; smtp_label: string | null })[]>('/inbox/scheduled');
    return data;
  },

  syncInbox: async () => {
    const { data } = await apiClient.post<{ synced: number; newMessages: number; errors?: string[] }>('/inbox/sync');
    return data;
  },
};
