import { apiClient } from './client';
import type { ApiKey, ApiKeyCreatedResponse } from '@lemlist/shared';

export const apikeyApi = {
  list: async () => {
    const { data } = await apiClient.get<ApiKey[]>('/api-keys');
    return data;
  },

  create: async (input: { name: string; scopes?: string[]; rate_limit?: number; expires_at?: string }) => {
    const { data } = await apiClient.post<ApiKeyCreatedResponse>('/api-keys', input);
    return data;
  },

  rotate: async (id: string) => {
    const { data } = await apiClient.post<ApiKeyCreatedResponse>(`/api-keys/${id}/rotate`);
    return data;
  },

  revoke: async (id: string) => {
    await apiClient.post(`/api-keys/${id}/revoke`);
  },

  delete: async (id: string) => {
    await apiClient.delete(`/api-keys/${id}`);
  },
};
