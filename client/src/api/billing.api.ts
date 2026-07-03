import { apiClient } from './client';
import type { UsageSummary } from '@lemlist/shared';

export const billingApi = {
  /** Current plan, limits, and this period's usage for the signed-in user. */
  usage: async () => {
    const { data } = await apiClient.get<UsageSummary>('/billing/usage');
    return data;
  },

  /** Start a Stripe Checkout session; returns the URL to redirect to. */
  checkout: async (plan: 'starter' | 'growth', interval: 'monthly' | 'annual') => {
    const { data } = await apiClient.post<{ url: string }>('/billing/checkout', { plan, interval });
    return data;
  },

  /**
   * Re-sync plan state straight from Stripe (safety net for missed webhooks);
   * returns the fresh usage summary.
   */
  refresh: async () => {
    const { data } = await apiClient.post<UsageSummary>('/billing/refresh', {});
    return data;
  },

  /** Open the Stripe Customer Portal; returns the URL to redirect to. */
  portal: async () => {
    const { data } = await apiClient.post<{ url: string }>('/billing/portal', {});
    return data;
  },
};
