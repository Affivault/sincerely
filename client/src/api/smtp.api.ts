import { apiClient } from './client';
import type { SmtpAccount, CreateSmtpAccountInput, UpdateSmtpAccountInput, VerifySmtpInput, VerifySmtpResult, WarmupSummary, SetWarmupInput, DiagnoseSmtpInput, SmtpDiagnostics } from '@lemlist/shared';

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

  /** Staged probe that pinpoints where a connection fails (and whether the host blocks SMTP). */
  diagnose: async (input: DiagnoseSmtpInput) => {
    const { data } = await apiClient.post<SmtpDiagnostics>('/smtp-accounts/diagnose', input);
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

  /**
   * Correct IMAP server addresses that do not exist in DNS.
   *
   * Only names that are definitively absent are replaced — a host that
   * resolves is left alone even if it looks wrong, because wrong-looking is
   * not the same as impossible.
   */
  repairHosts: async () => {
    const { data } = await apiClient.post<{
      repaired: number;
      results: Array<{
        email_address: string;
        repaired: boolean;
        from: string | null;
        to: string | null;
        note: string;
      }>;
    }>('/smtp-accounts/repair-hosts');
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
      /**
       * Mail servers that were shown to exist in DNS.
       *
       * Null where nothing could be established. Absent entirely from an
       * older API build, which is why every read of it is optional: an app
       * deployed ahead of its server must fall back, not crash.
       */
      hosts?: {
        imap: { host: string; port: number; secure: boolean; via: 'srv' | 'provider' | 'domain' } | null;
        smtp: { host: string; port: number; secure: boolean; via: 'srv' | 'provider' | 'domain' } | null;
        mail_provider: string | null;
        note: string;
      };
    }>('/smtp-accounts/check-domain', { domain });
    return data;
  },
};
