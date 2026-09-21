import { apiClient } from './client';
import type { SegmentDimension, SegmentReport } from '@lemlist/shared';

export const segmentsApi = {
  report: async (dimension: SegmentDimension, campaignId?: string | null): Promise<SegmentReport> => {
    const { data } = await apiClient.get<SegmentReport>('/segments', {
      params: { dimension, ...(campaignId ? { campaign_id: campaignId } : {}) },
    });
    return data;
  },
};
