import { apiClient } from './client';
import type {
  AdminAccountDetail, AdminAccountsResponse, AdminAuditResponse, AdminStats, AdminUsageReport, AdminUserRow, AdminUsersResponse,
} from '@lemlist/shared';

export const adminApi = {
  users: async (search?: string) =>
    (await apiClient.get<AdminUsersResponse>('/admin/users', { params: search ? { search } : undefined })).data,

  stats: async () => (await apiClient.get<AdminStats>('/admin/stats')).data,

  usage: async (month?: string) =>
    (await apiClient.get<AdminUsageReport>('/admin/usage', { params: month ? { month } : undefined })).data,

  grantLifetime: async (email: string) =>
    (await apiClient.post<AdminUserRow>('/admin/grant-lifetime', { email })).data,

  revokeLifetime: async (userId: string) => {
    await apiClient.post('/admin/revoke-lifetime', { user_id: userId });
  },

  accounts: async (month?: string) =>
    (await apiClient.get<AdminAccountsResponse>('/admin/accounts', { params: month ? { month } : undefined })).data,

  account: async (id: string) =>
    (await apiClient.get<AdminAccountDetail>(`/admin/accounts/${encodeURIComponent(id)}`)).data,

  setPlan: async (id: string, plan: string, status?: string) =>
    (await apiClient.post<{ stripe: 'changed' | 'canceled' | null }>(`/admin/accounts/${encodeURIComponent(id)}/plan`, { plan, status })).data,

  syncStripe: async (id: string) =>
    (await apiClient.post<{ synced: boolean }>(`/admin/accounts/${encodeURIComponent(id)}/stripe-sync`)).data,

  syncAll: async () => (await apiClient.post<{ synced: boolean }>('/admin/sync')).data,

  setAllowance: async (id: string, creditAllowance: number | null) => {
    await apiClient.post(`/admin/accounts/${encodeURIComponent(id)}/allowance`, { credit_allowance: creditAllowance });
  },

  adjustCredits: async (id: string, amount: number, note: string) => {
    await apiClient.post(`/admin/accounts/${encodeURIComponent(id)}/credits`, { amount, note });
  },

  suspend: async (id: string, reason?: string) => {
    await apiClient.post(`/admin/accounts/${encodeURIComponent(id)}/suspend`, { reason });
  },

  unsuspend: async (id: string) => {
    await apiClient.post(`/admin/accounts/${encodeURIComponent(id)}/unsuspend`);
  },

  setNote: async (id: string, note: string) => {
    await apiClient.post(`/admin/accounts/${encodeURIComponent(id)}/note`, { note });
  },

  audit: async (limit = 200) =>
    (await apiClient.get<AdminAuditResponse>('/admin/audit', { params: { limit } })).data,
};
