import { apiClient } from './client';
import type { EnrolResult, Signal, SignalSettings, SignalTopic } from '@lemlist/shared';

export interface MomentsResponse { moments: Signal[]; settings: SignalSettings; acted_this_week: number }
export interface MomentDraft { to: { id: string; email: string; name: string | null }; subject: string; body: string; engine: 'ai' | 'template' }

export const signalsApi = {
  list: async () => (await apiClient.get<MomentsResponse>('/signals', { timeout: 45_000 })).data,
  count: async () => (await apiClient.get<{ count: number }>('/signals/count')).data,
  configure: async (input: { web?: boolean; topics?: SignalTopic[] }) =>
    (await apiClient.put<SignalSettings>('/signals/settings', input)).data,
  suggest: async () =>
    (await apiClient.post<{ topics: string[]; engine: 'ai' | 'default' }>('/signals/settings/suggest', {}, { timeout: 60_000 })).data,
  dismiss: async (id: string) => (await apiClient.post(`/signals/${id}/dismiss`)).data,
  restore: async (id: string) => (await apiClient.post(`/signals/${id}/restore`)).data,
  done: async (id: string) => (await apiClient.post(`/signals/${id}/done`)).data,
  draft: async (id: string, contactId?: string | null) =>
    (await apiClient.post<MomentDraft>(`/signals/${id}/draft`, { contact_id: contactId || null }, { timeout: 90_000 })).data,
  send: async (id: string, input: { contact_id?: string | null; subject: string; body: string }) =>
    (await apiClient.post<{ sent: boolean; to: string }>(`/signals/${id}/send`, input)).data,
  enrol: async (id: string, input: { contact_id?: string | null; campaign_id: string }) =>
    (await apiClient.post<EnrolResult & { campaign_name: string; first_line: string | null }>(`/signals/${id}/enrol`, input)).data,
};
