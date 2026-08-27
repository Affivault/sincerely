import { apiClient } from './client';
import type { PaginatedResponse } from '@lemlist/shared';

export interface SuppressionEntry {
  id: string;
  user_id: string;
  email: string;
  reason: 'unsubscribed' | 'bounced' | 'complained' | 'manual';
  notes?: string;
  created_at: string;
  updated_at: string;
}

export const suppressionApi = {
  list: async (params?: { page?: number; limit?: number; search?: string; reason?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<SuppressionEntry>>('/suppression', { params });
    return data;
  },

  add: async (email: string, reason = 'manual', notes?: string) => {
    const { data } = await apiClient.post<SuppressionEntry>('/suppression', { email, reason, notes });
    return data;
  },

  /**
   * Suppress a batch.
   *
   * `added_emails` names the ones that were not already suppressed, which
   * is what an undo has to remove — anything in `already_present` was
   * somebody's earlier decision and stays.
   */
  addBulk: async (emails: string[], reason = 'manual') => {
    const { data } = await apiClient.post<{
      added: number;
      duplicates_collapsed: number;
      added_emails: string[];
      already_present: string[];
    }>('/suppression/bulk', { emails, reason });
    return data;
  },

  remove: async (email: string) => {
    await apiClient.delete(`/suppression/${encodeURIComponent(email)}`);
  },
};
