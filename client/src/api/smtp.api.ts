import { apiClient } from './client';
import type { SendingHealthReport } from '@lemlist/shared';
import type { SmtpAccount, CreateSmtpAccountInput, UpdateSmtpAccountInput, VerifySmtpInput, VerifySmtpResult, WarmupSummary, SetWarmupInput, DiagnoseSmtpInput, MailboxDiagnostics } from '@lemlist/shared';

export const smtpApi = {
  list: async () => {
    const { data } = await apiClient.get<SmtpAccount[]>('/smtp-accounts');
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<SmtpAccount>(`/smtp-accounts/${id}`);
    return data;
  },

  /**
   * Connect a mailbox. With `verify`, the server tests sending (and IMAP,
   * when set) first and only saves a mailbox that works - saving it
   * verified. A failed test answers 422 with `verification` in the body.
   */
  create: async (input: CreateSmtpAccountInput, opts: { verify?: boolean } = {}) => {
    const { data } = await apiClient.post<SmtpAccount>('/smtp-accounts', input, {
      params: opts.verify ? { verify: 1 } : undefined,
      // Sending a probe and signing in to IMAP can take a while on a slow server.
      timeout: opts.verify ? 45_000 : undefined,
    });
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
    const { data } = await apiClient.post<MailboxDiagnostics>('/smtp-accounts/diagnose', input);
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

  /** Every mailbox's sending health, judged on the server in one read. */
  health: async () => {
    const { data } = await apiClient.get<SendingHealthReport>('/smtp-accounts/health');
    return data;
  },

  /** One daily limit and gap on the named mailboxes, or on all of them. */
  applyPace: async (input: {
    account_ids: string[] | 'all';
    daily_send_limit: number;
    send_gap_min_seconds: number;
    send_gap_max_seconds: number;
  }) => {
    const { data } = await apiClient.post<{
      matched: number;
      changed: number;
      unchanged: number;
      skipped: number;
      /** False when the database has no gap columns yet (migration 089). */
      gap_saved: boolean;
    }>('/smtp-accounts/pace', input);
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
