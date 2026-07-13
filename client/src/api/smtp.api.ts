import { apiClient } from './client';
import type { SmtpAccount, CreateSmtpAccountInput, UpdateSmtpAccountInput, VerifySmtpInput, VerifySmtpResult, WarmupSummary, SetWarmupInput } from '@lemlist/shared';

export const smtpApi = {
  list: async () => {
    const { data } = await apiClient.get<SmtpAccount[]>('/smtp-accounts');
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<SmtpAccount>(`/smtp-accounts/${id}`);
    return data;
  },

  create: async (input: CreateSmtpAccountInput) => {
    const { data } = await apiClient.post<SmtpAccount>('/smtp-accounts', input);
    return data;
  },

  update: async (id: string, input: UpdateSmtpAccountInput) => {
    const { data } = await apiClient.put<SmtpAccount>(`/smtp-accounts/${id}`, input);
    return data;
  },

  delete: async (id: string) => {
    await apiClient.delete(`/smtp-accounts/${id}`);
  },

  test: async (id: string) => {
    const { data } = await apiClient.post<{ success: boolean; message: string }>(`/smtp-accounts/${id}/test`);
    return data;
  },

  verify: async (input: VerifySmtpInput) => {
    const { data } = await apiClient.post<VerifySmtpResult>('/smtp-accounts/verify', input);
    return data;
  },

  getWarmup: async () => {
    const { data } = await apiClient.get<WarmupSummary>('/smtp-accounts/warmup');
    return data;
  },

  setWarmup: async (id: string, input: SetWarmupInput) => {
    const { data } = await apiClient.post<SmtpAccount>(`/smtp-accounts/${id}/warmup`, input);
    return data;
  },

  sendTestEmail: async (smtpAccountId: string, input: { to: string; subject: string; body_html?: string }) => {
    const { data } = await apiClient.post<{ success: boolean; message?: string; error?: string }>(`/smtp-accounts/${smtpAccountId}/send-test`, input);
    return data;
  },

  checkDomain: async (domain: string) => {
    const { data } = await apiClient.post<{
      domain: string;
      mx: { found: boolean; records: Array<{ exchange: string; priority: number }> };
      spf: { found: boolean; record: string | null; valid: boolean };
      dkim: { found: boolean; note: string };
      dmarc: { found: boolean; record: string | null; policy: string | null };
      provider_hint: string | null;
    }>('/smtp-accounts/check-domain', { domain });
    return data;
  },
};
