import { apiClient } from './client';
import type { ReadinessReport } from '@lemlist/shared';

export const readinessApi = {
  /** With a campaign, the report also reads that campaign's emails. */
  get: async (campaignId?: string | null) => {
    const { data } = await apiClient.get<ReadinessReport>('/readiness', { params: campaignId ? { campaign_id: campaignId } : undefined });
    return data;
  },
};

export type { ReadinessReport };
