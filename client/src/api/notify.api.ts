import { apiClient } from './client';

export const notifyApi = {
  test: async () => (await apiClient.post<{ sent: boolean; to: string | null; from: string | null }>('/notifications/test', {}, { timeout: 45_000 })).data,
  digest: async () => (await apiClient.post<{ sent: boolean; subject: string }>('/notifications/digest', {}, { timeout: 60_000 })).data,
};
