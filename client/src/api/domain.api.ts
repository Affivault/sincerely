import { apiClient } from './client';
import type { SendingDomain, DomainVerifyResponse } from '@lemlist/shared';

export const domainApi = {
  list: async () => {
    const { data } = await apiClient.get<SendingDomain[]>('/domains');
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<SendingDomain>(`/domains/${id}`);
    return data;
  },

  create: async (domain: string) => {
    const { data } = await apiClient.post<DomainVerifyResponse>('/domains', { domain });
    return data;
  },

  delete: async (id: string) => {
    await apiClient.delete(`/domains/${id}`);
  },

  verify: async (id: string) => {
    const { data } = await apiClient.post<DomainVerifyResponse>(`/domains/${id}/verify`);
    return data;
  },

  /**
   * Tell the check which DKIM selector to look at.
   *
   * DNS cannot be asked which selectors exist, so for the providers that use
   * unguessable names this is the only way the check can ever succeed.
   */
  setDkimSelector: async (id: string, selector: string | null) => {
    const { data } = await apiClient.put<DomainVerifyResponse>(
      `/domains/${id}/dkim-selector`, { selector },
    );
    return data;
  },

  getRecords: async (id: string) => {
    const { data } = await apiClient.get<DomainVerifyResponse>(`/domains/${id}/records`);
    return data;
  },
};
