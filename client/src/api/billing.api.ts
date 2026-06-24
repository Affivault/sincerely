import { apiClient } from './client';
import type { UsageSummary } from '@lemlist/shared';

export const billingApi = {
  /** Current plan, limits, and this period's usage for the signed-in user. */
  usage: async () => {
    const { data } = await apiClient.get<UsageSummary>('/billing/usage');
    return data;
  },
};
