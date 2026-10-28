import { apiClient } from './client';
import type {
  ProspectorStatus,
  ProspectSearchFilters,
  ProspectSearchResponse,
  RevealProspectInput,
  RevealProspectResponse,
  ProspectRule,
  ProspectRuleRunResult,
  CompanySearchFilters,
  CompanySearchResponse,
  ProspectDestination,
  ProspectSuggestion,
  ProspectDetails,
} from '@lemlist/shared';

export const prospectingApi = {
  status: async () => (await apiClient.get<ProspectorStatus>('/prospecting/status')).data,

  search: async (filters: ProspectSearchFilters, page = 1) =>
    (await apiClient.post<ProspectSearchResponse>('/prospecting/search', { filters, page })).data,

  /** Free match count, shown live as filters change. Null when the provider can't say. */
  count: async (filters: ProspectSearchFilters, signal?: AbortSignal) =>
    (await apiClient.post<{ total: number | null }>('/prospecting/count', { filters }, { signal })).data,

  suggestLocations: async (q: string, signal?: AbortSignal) =>
    (await apiClient.get<ProspectSuggestion[]>('/prospecting/suggest/locations', { params: { q }, signal })).data,

  searchCompanies: async (filters: CompanySearchFilters, page = 1) =>
    (await apiClient.post<CompanySearchResponse>('/prospecting/companies/search', { filters, page })).data,

  /** The person panel: what a search row already holds. Never spends a credit. */
  details: async (personId: string, hint: { company?: string | null; domain?: string | null }) =>
    (await apiClient.get<ProspectDetails>(`/prospecting/people/${encodeURIComponent(personId)}/details`, {
      params: { company: hint.company || undefined, domain: hint.domain || undefined },
    })).data,

  destinations: async () => (await apiClient.get<ProspectDestination[]>('/prospecting/destinations')).data,

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
