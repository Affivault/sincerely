import { apiClient } from './client';
import type { AutopilotStatus } from '@lemlist/shared';

export const autopilotApi = {
  status: async () => (await apiClient.get<AutopilotStatus>('/autopilot')).data,
  setEnabled: async (enabled: boolean) => (await apiClient.put<{ enabled: boolean }>('/autopilot/enabled', { enabled })).data,
  resume: async (mailboxId: string) => (await apiClient.post<{ resumed: boolean }>(`/autopilot/mailboxes/${mailboxId}/resume`)).data,
  releaseHold: async (provider: string) => (await apiClient.delete<{ released: boolean }>(`/autopilot/holds/${encodeURIComponent(provider)}`)).data,
};
