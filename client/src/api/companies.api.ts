import { apiClient } from './client';
import type { Company, CompanySummary, CreateCompanyInput, UpdateCompanyInput } from '@lemlist/shared';

export const companiesApi = {
  list: async (search?: string) =>
    (await apiClient.get<Company[]>('/companies', { params: search ? { search } : undefined })).data,

  /** The company, its people and its deals in one request. */
  summary: async (id: string) =>
    (await apiClient.get<CompanySummary>(`/companies/${id}/summary`)).data,

  /** Returns the existing company when the name matches one already there. */
  create: async (input: CreateCompanyInput) =>
    (await apiClient.post<Company>('/companies', input)).data,

  update: async (id: string, input: UpdateCompanyInput) =>
    (await apiClient.put<Company>(`/companies/${id}`, input)).data,

  remove: async (id: string) => { await apiClient.delete(`/companies/${id}`); },

  linkContact: async (contactId: string, companyId: string | null) =>
    (await apiClient.post<{ id: string; company_id: string | null }>('/companies/link-contact', {
      contact_id: contactId, company_id: companyId,
    })).data,
};
