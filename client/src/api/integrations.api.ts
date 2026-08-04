import { apiClient } from './client';
import type {
  UserIntegration,
  ConnectIntegrationInput,
  UpdateIntegrationInput,
  IntegrationActivity,
  IntegrationTestResult,
  IntegrationResourcesResult,
  OAuthAvailability,
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
};
