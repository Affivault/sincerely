import { apiClient } from './client';
import type {
  ProspectorStatus,
  ProspectSearchFilters,
  ProspectSearchResponse,
  RevealProspectInput,
  RevealProspectResponse,
  ProspectRule,
  ProspectRuleRunResult,
} from '@lemlist/shared';

export const prospectingApi = {
  status: async () => (await apiClient.get<ProspectorStatus>('/prospecting/status')).data,

  search: async (filters: ProspectSearchFilters, page = 1) =>
    (await apiClient.post<ProspectSearchResponse>('/prospecting/search', { filters, page })).data,

  reveal: async (input: RevealProspectInput) =>
    (await apiClient.post<RevealProspectResponse>('/prospecting/reveal', input)).data,

  buyCredits: async (packId: string) =>
    (await apiClient.post<{ url: string }>('/prospecting/credits/checkout', { pack_id: packId })).data,
};

export const prospectRulesApi = {
  list: async () => (await apiClient.get<ProspectRule[]>('/prospecting/rules')).data,
  create: async (input: Partial<ProspectRule>) => (await apiClient.post<ProspectRule>('/prospecting/rules', input)).data,
  update: async (id: string, input: Partial<ProspectRule>) => (await apiClient.put<ProspectRule>(`/prospecting/rules/${id}`, input)).data,
  remove: async (id: string) => { await apiClient.delete(`/prospecting/rules/${id}`); },
  run: async (id: string) => (await apiClient.post<ProspectRuleRunResult>(`/prospecting/rules/${id}/run`)).data,
};
