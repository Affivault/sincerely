import { apiClient } from './client';
import type {
  UserIntegration,
  ConnectIntegrationInput,
  UpdateIntegrationInput,
  IntegrationActivity,
  IntegrationTestResult,
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
};
