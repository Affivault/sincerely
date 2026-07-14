import { apiClient } from './client';
import type { AdminStats, AdminUserRow, AdminUsersResponse } from '@lemlist/shared';

export const adminApi = {
  users: async (search?: string) =>
    (await apiClient.get<AdminUsersResponse>('/admin/users', { params: search ? { search } : undefined })).data,

  stats: async () => (await apiClient.get<AdminStats>('/admin/stats')).data,

  grantLifetime: async (email: string) =>
    (await apiClient.post<AdminUserRow>('/admin/grant-lifetime', { email })).data,

  revokeLifetime: async (userId: string) => {
    await apiClient.post('/admin/revoke-lifetime', { user_id: userId });
  },
};
