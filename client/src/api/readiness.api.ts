import { apiClient } from './client';
import type { ReadinessReport } from '@lemlist/shared';

export const readinessApi = {
  get: async () => {
    const { data } = await apiClient.get<ReadinessReport>('/readiness');
    return data;
  },
};

export type { ReadinessReport };
