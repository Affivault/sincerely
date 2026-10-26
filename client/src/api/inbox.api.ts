import { apiClient } from './client';
import type { BulkTriageResult, TriageInput, TriageResult } from '@lemlist/shared';
import type { MailKind, RelayReviewItem } from '@lemlist/shared';
import type { InboxMessage, InboxMessageWithContext, InboxCounts, PaginatedResponse, InboxSyncResult, InboxSyncProgress, InboxTeammate, OutgoingAttachment } from '@lemlist/shared';

/** Files and a "remind me if no reply" that ride along with a send. */
export interface SendExtras {
  attachments?: OutgoingAttachment[];
  nudge_days?: number | null;
}

/** Sending with files can take a while on a slow uplink; the default 30s is for JSON. */
const SEND_TIMEOUT_MS = 120_000;

export const inboxApi = {
  /**
   * Decide what a reply is. One call, because "interested" is not one write:
   * it makes a lead, promotes a lifecycle and carries the campaign across.
   */
  /** Take a decision back, removing whatever it created. */
  untriage: async (messageId: string) => {
    const { data } = await apiClient.delete<{ message: string }>(`/inbox/${messageId}/triage`);
    return data;
  },

  triage: async (messageId: string, input: TriageInput) => {
    const { data } = await apiClient.post<TriageResult>(`/inbox/${messageId}/triage`, input);
    return data;
  },

  /**
   * One decision about a stack of replies — what a queue is actually for.
   * Partial success is normal and reported per message, so a selection with
   * one unlinked thread in it still clears the other thirty-nine.
   */
  triageMany: async (messageIds: string[], input: TriageInput) => {
    const { data } = await apiClient.post<BulkTriageResult>('/inbox/triage/bulk', {
      ...input,
      message_ids: messageIds,
    });
    return data;
  },

  /** Take a whole bulk run back. */
  untriageMany: async (messageIds: string[]) => {
    const { data } = await apiClient.post<{ undone: number; failed: number; message: string }>(
      '/inbox/triage/bulk-undo',
      { message_ids: messageIds },
    );
    return data;
  },

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
    /** One contact's mail by id (linked rows), alongside contact_email. */
    contact_id?: string;
    /** With folder 'other': just newsletters, notifications, receipts... */
    mail_kind?: string;
  }) => {
    const { data } = await apiClient.get<PaginatedResponse<InboxMessageWithContext>>('/inbox', { params });
    return data;
  },

  /** Whether Relay reads with Claude, and anyone it may have wrongly unsubscribed. */
  /** The intro to somebody a reply pointed you to: Claude's, or a plain template. */
  referralDraft: async (messageId: string, to: { email: string; first_name?: string | null }) =>
    (await apiClient.post<{ subject: string; body: string; engine: 'ai' | 'template' }>(`/inbox/${messageId}/referral/draft`, to, { timeout: 60_000 })).data,
  referralSend: async (messageId: string, input: {
    email: string; first_name?: string | null; last_name?: string | null;
    subject: string; body: string; smtp_account_id?: string | null; follow_up: boolean;
  }) => (await apiClient.post<{ sent: boolean; contact_id: string; enrolled: boolean; campaign_name: string | null; campaign_running: boolean | null }>(`/inbox/${messageId}/referral`, input, { timeout: 45_000 })).data,
  relayStatus: async () => {
    const { data } = await apiClient.get<{ ai: boolean; review: RelayReviewItem[] }>('/inbox/relay-status');
    return data;
  },

  relayRestore: async (contactId: string) => {
    const { data } = await apiClient.post<{ restored: boolean }>(`/inbox/relay-review/${contactId}/restore`);
    return data;
  },

  relayDismiss: async (contactId: string) => {
    const { data } = await apiClient.post<{ dismissed: boolean }>(`/inbox/relay-review/${contactId}/dismiss`);
    return data;
  },

  /** File a sender as a person, or as mail. Moves everything from them. */
  setMailKind: async (id: string, kind: MailKind) => {
    const { data } = await apiClient.put<{ moved: number; kind: MailKind }>(`/inbox/${id}/mail-kind`, { kind });
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

  reply: async (id: string, body: string, smtp_account_id?: string, body_html?: string, extras: SendExtras = {}) => {
    const { data } = await apiClient.post<{ success: boolean; message_id: string; warnings?: string[] }>(
      `/inbox/${id}/reply`,
      { body, body_html, smtp_account_id, ...extras },
      extras.attachments?.length ? { timeout: SEND_TIMEOUT_MS } : undefined,
    );
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

  compose: async (input: { to: string; subject: string; body: string; body_html?: string; smtp_account_id?: string } & SendExtras) => {
    const { data } = await apiClient.post<{ success: boolean; message_id: string; recorded?: boolean; warnings?: string[] }>(
      '/inbox/compose',
      input,
      input.attachments?.length ? { timeout: SEND_TIMEOUT_MS } : undefined,
    );
    return data;
  },

  /**
   * One attachment, fetched from the mailbox it is in and saved. Through the
   * API client rather than a plain link, because the request has to carry
   * the session's bearer token.
   */
  downloadAttachment: async (id: string, index: number, filename: string) => {
    let res;
    try {
      res = await apiClient.get<Blob>(`/inbox/${id}/attachments/${index}`, { responseType: 'blob', timeout: 90_000 });
    } catch (err: any) {
      // A blob request gets its error body as a blob too; read the reason
      // out of it so the person sees "moved in your mailbox", not "Error".
      const body = err?.response?.data;
      if (body instanceof Blob) {
        const text = await body.text().catch(() => '');
        let message = '';
        try { message = JSON.parse(text)?.error || ''; } catch { /* not JSON */ }
        throw new Error(message || 'Could not download that attachment');
      }
      throw err;
    }
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on the next tick: revoking at once can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },

  /** Snooze the conversation until a time; null brings it back now. */
  snooze: async (id: string, until: string | null) => {
    const { data } = await apiClient.put<{ snoozed_until: string | null; messages: number }>(`/inbox/${id}/snooze`, { until });
    return data;
  },

  /** "Remind me if no reply in N days" on a sent message; null clears it. */
  nudge: async (id: string, days: number | null) => {
    const { data } = await apiClient.put<{ nudge_at: string | null }>(`/inbox/${id}/nudge`, { days });
    return data;
  },

  /** Hand the conversation to a teammate; null unassigns. */
  assign: async (id: string, assignee: string | null) => {
    const { data } = await apiClient.put<{ assigned_to: string | null; messages: number }>(`/inbox/${id}/assign`, { assignee });
    return data;
  },

  /** Who a conversation can be assigned to. Empty for a solo account. */
  teammates: async () => {
    const { data } = await apiClient.get<InboxTeammate[]>('/inbox/teammates');
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

  rescheduleScheduled: async (id: string, scheduled_at: string) => {
    const { data } = await apiClient.put<{ success: boolean; scheduled_at: string }>(`/inbox/${id}/schedule`, { scheduled_at });
    return data;
  },

  listScheduled: async () => {
    const { data } = await apiClient.get<(InboxMessage & { scheduled_at: string; smtp_email: string | null; smtp_label: string | null })[]>('/inbox/scheduled');
    return data;
  },

  syncInbox: async () => {
    const { data } = await apiClient.post<InboxSyncResult>('/inbox/sync');
    return data;
  },

  /** How far back each mailbox reaches, and whether history is still loading. */
  syncProgress: async () => {
    const { data } = await apiClient.get<InboxSyncProgress[]>('/inbox/sync/progress');
    return data;
  },
};
