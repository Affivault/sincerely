import { apiClient } from './client';
import type { AiUsage } from '@lemlist/shared';

export const aiApi = {
  usage: async () => (await apiClient.get<AiUsage>('/ai/usage')).data,
  /** null = back to the server's allowance. */
  setCap: async (cap_tokens: number | null) => (await apiClient.put<AiUsage>('/ai/usage/cap', { cap_tokens })).data,
};
