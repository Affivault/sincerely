import { apiClient } from './client';
import type {
  UserIntegration,
  ConnectIntegrationInput,
  UpdateIntegrationInput,
  IntegrationActivity,
  IntegrationTestResult,
  IntegrationResourcesResult,
  OAuthAvailability,
  CrmSyncOverview,
  CrmSyncSettings,
  CrmSyncOptions,
  CrmSyncLogEntry,
  CrmListSync,
  CrmBackfill,
  CrmBackfillInput,
  CrmContactStatus,
} from '@lemlist/shared';

export const integrationsApi = {
  list: async (): Promise<UserIntegration[]> => {
    const { data } = await apiClient.get('/integrations');
    return data;
  },

  /** Connect or reconnect a provider — the server live-tests before saving. */
  connect: async (
    provider: string,
    input: ConnectIntegrationInput
  ): Promise<{ integration: UserIntegration; test: IntegrationTestResult }> => {
    const { data } = await apiClient.post(`/integrations/${provider}/connect`, input);
    return data;
  },

  update: async (id: string, input: UpdateIntegrationInput): Promise<UserIntegration> => {
    const { data } = await apiClient.patch(`/integrations/${id}`, input);
    return data;
  },

  disconnect: async (id: string): Promise<void> => {
    await apiClient.delete(`/integrations/${id}`);
  },

  test: async (id: string): Promise<IntegrationTestResult> => {
    const { data } = await apiClient.post(`/integrations/${id}/test`);
    return data;
  },

  activity: async (id: string, limit = 30): Promise<IntegrationActivity[]> => {
    const { data } = await apiClient.get(`/integrations/${id}/activity`, { params: { limit } });
    return data;
  },

  /** Which providers offer one-click OAuth on this deployment. */
  oauthAvailability: async (): Promise<OAuthAvailability> => {
    const { data } = await apiClient.get('/integrations/oauth-availability');
    return data;
  },

  /** Authorize URL to navigate the browser to for one-click connect. */
  oauthUrl: async (provider: string): Promise<string> => {
    const { data } = await apiClient.get(`/integrations/oauth-url/${provider}`);
    return data.url;
  },

  /** Live pickable resources (Notion databases, Airtable bases/tables). */
  resources: async (
    provider: string,
    config: Record<string, string> = {}
  ): Promise<IntegrationResourcesResult> => {
    const { data } = await apiClient.post(`/integrations/${provider}/resources`, { config });
    return data;
  },

  // ── Two-way HubSpot / Pipedrive sync ─────────────────────────────
  sync: {
    overview: async (id: string): Promise<CrmSyncOverview> => {
      const { data } = await apiClient.get(`/integrations/${id}/sync`);
      return data;
    },
    saveSettings: async (id: string, settings: Partial<CrmSyncSettings>): Promise<CrmSyncSettings> => {
      const { data } = await apiClient.patch(`/integrations/${id}/sync`, settings);
      return data;
    },
    options: async (id: string): Promise<CrmSyncOptions> => {
      const { data } = await apiClient.get(`/integrations/${id}/sync/options`);
      return data;
    },
    run: async (id: string): Promise<{ people_updated: number; pushed: number; deals: number; error: string | null }> => {
      const { data } = await apiClient.post(`/integrations/${id}/sync/run`);
      return data;
    },
    log: async (
      id: string,
      params: { status?: string; direction?: string; before?: string; limit?: number } = {},
    ): Promise<{ data: CrmSyncLogEntry[]; has_more: boolean; unavailable?: boolean }> => {
      const { data } = await apiClient.get(`/integrations/${id}/sync/log`, { params });
      return data;
    },
    retry: async (id: string, logId: string): Promise<{ ok: boolean; error?: string }> => {
      const { data } = await apiClient.post(`/integrations/${id}/sync/log/${logId}/retry`);
      return data;
    },
    retryAll: async (id: string): Promise<{ retried: number; fixed: number }> => {
      const { data } = await apiClient.post(`/integrations/${id}/sync/retry-failed`);
      return data;
    },
    addList: async (
      id: string,
      input: { external_id: string; external_name: string; list_id?: string; new_list_name?: string },
    ): Promise<CrmListSync> => {
      const { data } = await apiClient.post(`/integrations/${id}/sync/lists`, input);
      return data;
    },
    updateList: async (id: string, listSyncId: string, input: { enabled?: boolean; list_id?: string }): Promise<CrmListSync> => {
      const { data } = await apiClient.patch(`/integrations/${id}/sync/lists/${listSyncId}`, input);
      return data;
    },
    removeList: async (id: string, listSyncId: string): Promise<void> => {
      await apiClient.delete(`/integrations/${id}/sync/lists/${listSyncId}`);
    },
    startFirstSync: async (id: string, input: CrmBackfillInput): Promise<CrmBackfill> => {
      const { data } = await apiClient.post(`/integrations/${id}/sync/first-sync`, input);
      return data;
    },
    stopFirstSync: async (id: string): Promise<CrmBackfill> => {
      const { data } = await apiClient.post(`/integrations/${id}/sync/first-sync/stop`);
      return data;
    },
    send: async (id: string, contactIds: string[]): Promise<{ queued: boolean; sent: number; failed: number; total: number }> => {
      const { data } = await apiClient.post(`/integrations/${id}/sync/send`, { contact_ids: contactIds });
      return data;
    },
    contactStatus: async (contactId: string): Promise<CrmContactStatus[]> => {
      const { data } = await apiClient.get(`/integrations/crm/contacts/${contactId}`);
      return data;
    },
    syncContact: async (id: string, contactId: string): Promise<CrmContactStatus | null> => {
      const { data } = await apiClient.post(`/integrations/${id}/sync/contacts/${contactId}`);
      return data;
    },
    runList: async (id: string, listSyncId: string): Promise<{ added: number; updated: number; total: number }> => {
      const { data } = await apiClient.post(`/integrations/${id}/sync/lists/${listSyncId}/run`);
      return data;
    },
  },
};
