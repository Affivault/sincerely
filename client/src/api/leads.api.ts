import { apiClient } from './client';
import type { Deal, Lead, CreateLeadInput, UpdateLeadInput } from '@lemlist/shared';

export const leadsApi = {
  list: async (params?: { status?: string; contact_id?: string }) =>
    (await apiClient.get<Lead[]>('/leads', { params })).data,
  create: async (input: CreateLeadInput) => (await apiClient.post<Lead>('/leads', input)).data,
  update: async (id: string, input: UpdateLeadInput) =>
    (await apiClient.put<Lead>(`/leads/${id}`, input)).data,
  remove: async (id: string) => { await apiClient.delete(`/leads/${id}`); },
  archive: async (id: string, reason?: string | null) =>
    (await apiClient.post<Lead>(`/leads/${id}/archive`, { reason })).data,
  reopen: async (id: string) => (await apiClient.post<Lead>(`/leads/${id}/reopen`)).data,
  /** Qualify a lead into a deal. Returns both, already linked. */
  convert: async (id: string, input?: Record<string, unknown>) =>
    (await apiClient.post<{ lead: Lead; deal: Deal }>(`/leads/${id}/convert`, input || {})).data,
};
