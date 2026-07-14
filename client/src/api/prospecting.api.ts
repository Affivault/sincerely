import { apiClient } from './client';
import type {
  ProspectorStatus,
  ProspectSearchFilters,
  ProspectSearchResponse,
  RevealProspectInput,
  RevealProspectResponse,
} from '@lemlist/shared';

export const prospectingApi = {
  status: async () => (await apiClient.get<ProspectorStatus>('/prospecting/status')).data,

  search: async (filters: ProspectSearchFilters, page = 1) =>
    (await apiClient.post<ProspectSearchResponse>('/prospecting/search', { filters, page })).data,

  reveal: async (input: RevealProspectInput) =>
    (await apiClient.post<RevealProspectResponse>('/prospecting/reveal', input)).data,
};
