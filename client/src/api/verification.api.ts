import { apiClient } from './client';
import type { DcsVerificationResult, FindEmailInput, FindEmailResult } from '@lemlist/shared';

export const verificationApi = {
  findEmail: async (input: FindEmailInput) => {
    const { data } = await apiClient.post<FindEmailResult>('/verification/find-email', input);
    return data;
  },

  verifyContact: async (contactId: string) => {
    const { data } = await apiClient.post<DcsVerificationResult>(`/verification/contacts/${contactId}`);
    return data;
  },

  verifyEmail: async (email: string) => {
    const { data } = await apiClient.post<DcsVerificationResult>('/verification/email', { email });
    return data;
  },

  batchVerify: async (contactIds?: string[]) => {
    const { data } = await apiClient.post<{ verified: number; failed: number }>('/verification/batch', { contact_ids: contactIds });
    return data;
  },

  getStats: async () => {
    const { data } = await apiClient.get<{
      total: number;
      verified: number;
      unverified: number;
      avg_score: number;
      score_distribution: { range: string; count: number }[];
      /** Whether this server can reach mail servers at all; null until tried. */
      smtp: {
        available: boolean | null;
        consecutive_failures: number;
        last_reason: string;
        retry_after_seconds: number | null;
      };
    }>('/verification/stats');
    return data;
  },

  getSuppressed: async (campaignId: string, threshold: number) => {
    const { data } = await apiClient.get<{ contact_id: string; email: string; dcs_score: number }[]>(
      `/verification/campaigns/${campaignId}/suppressed?threshold=${threshold}`
    );
    return data;
  },
};
