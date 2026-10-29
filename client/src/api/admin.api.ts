import { apiClient } from './client';
import type {
  AdminAccountDetail, AdminAccountsResponse, AdminBillingReport, AdminAuditResponse, AdminStats, AdminUsageReport, AdminUserRow, AdminUsersResponse,
} from '@lemlist/shared';

const acct = (id: string) => `/admin/accounts/${encodeURIComponent(id)}`;

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

  billing: async (month?: string) =>
    (await apiClient.get<AdminBillingReport>('/admin/billing', { params: month ? { month } : undefined })).data,

  /* Billing, changed in Stripe itself */
  cancelSubscription: async (id: string, when: 'now' | 'period_end') => { await apiClient.post(`${acct(id)}/cancel`, { when }); },
  resumeSubscription: async (id: string) => { await apiClient.post(`${acct(id)}/resume`); },
  extendTrial: async (id: string, days: number) => (await apiClient.post<{ until: string }>(`${acct(id)}/extend-trial`, { days })).data,
  stripeCredit: async (id: string, amountUsd: number, note: string) => { await apiClient.post(`${acct(id)}/stripe-credit`, { amount_usd: amountUsd, note }); },
  discount: async (id: string, percent: number, months: number) => { await apiClient.post(`${acct(id)}/discount`, { percent, months }); },
  removeDiscount: async (id: string) => { await apiClient.delete(`${acct(id)}/discount`); },
  refund: async (id: string, payment: string, amountUsd: number | null) =>
    (await apiClient.post<{ refunded_usd: number }>(`${acct(id)}/refund`, { payment, amount_usd: amountUsd })).data,

  /* The account */
  signInLink: async (id: string, kind: 'magiclink' | 'recovery') => (await apiClient.post<{ link: string }>(`${acct(id)}/sign-in-link`, { kind })).data,
  resetEmail: async (id: string) => { await apiClient.post(`${acct(id)}/reset-email`); },
  changeEmail: async (id: string, email: string) => { await apiClient.post(`${acct(id)}/email`, { email }); },
  verifyEmail: async (id: string) => { await apiClient.post(`${acct(id)}/verify-email`); },
  signOut: async (id: string) => { await apiClient.post(`${acct(id)}/sign-out`); },
  pauseCampaigns: async (id: string) => (await apiClient.post<{ paused: number }>(`${acct(id)}/pause-campaigns`)).data,
  sendingHold: async (id: string, hold: boolean) => { await apiClient.post(`${acct(id)}/sending-hold`, { hold }); },
  viewAs: async (id: string) => (await apiClient.post<{ token: string; expires_at: string; email: string }>(`${acct(id)}/view-as`)).data,
  deleteAccount: async (id: string, confirmEmail: string) => { await apiClient.post(`${acct(id)}/delete`, { confirm_email: confirmEmail }); },
};
