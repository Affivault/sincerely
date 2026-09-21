import { apiClient } from './client';
import type { ReplyState, QueueCounts } from '@lemlist/shared';

export interface QueuedReply {
  id: string;
  contact_id: string | null;
  campaign_id: string | null;
  from_email: string;
  to_email: string;
  subject: string | null;
  body_text: string | null;
  received_at: string;
  is_read: boolean;
  sara_intent: string | null;
  sara_confidence: number | null;
  triage_decision: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  snoozed_until: string | null;
  snooze_note: string | null;
  /** Open pipeline value on the contact behind this reply. */
  deal_value: number | null;
  state: ReplyState;
  /** What to do first. Higher sorts earlier. */
  priority: number;
}

export interface ReplyQueue {
  counts: QueueCounts;
  items: QueuedReply[];
}

export type QueueFilter = 'all' | 'overdue' | 'mine' | 'unassigned' | 'parked';

export const replyQueueApi = {
  queue: async (filter: QueueFilter = 'all'): Promise<ReplyQueue> => {
    const { data } = await apiClient.get<ReplyQueue>('/reply-queue', { params: { filter } });
    return data;
  },

  counts: async (): Promise<QueueCounts> => {
    const { data } = await apiClient.get<QueueCounts>('/reply-queue/counts');
    return data;
  },

  /** Claim it, or hand it back. */
  assign: async (id: string, assigned: boolean) => {
    const { data } = await apiClient.patch(`/reply-queue/${id}/assign`, { assigned });
    return data;
  },

  /** Park until a time, or `null` to bring it back now. */
  snooze: async (id: string, until: string | null, note?: string) => {
    const { data } = await apiClient.patch(`/reply-queue/${id}/snooze`, { until, note });
    return data;
  },
};
