import { apiClient } from './client';
import type {
  Campaign,
  CampaignWithStats,
  CampaignStep,
  CampaignContact,
  CreateCampaignInput,
  CreateStepInput,
  UpdateStepInput,
  PaginatedResponse,
} from '@lemlist/shared';

export const campaignsApi = {
  list: async (params?: { page?: number; limit?: number; status?: string; search?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<CampaignWithStats>>('/campaigns', { params });
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<CampaignWithStats & { steps: CampaignStep[] }>(`/campaigns/${id}`);
    return data;
  },

  create: async (input: CreateCampaignInput) => {
    const { data } = await apiClient.post<Campaign>('/campaigns', input);
    return data;
  },

  update: async (id: string, input: Partial<CreateCampaignInput>) => {
    const { data } = await apiClient.put<Campaign>(`/campaigns/${id}`, input);
    return data;
  },

  delete: async (id: string) => {
    await apiClient.delete(`/campaigns/${id}`);
  },

  launch: async (id: string) => {
    const { data } = await apiClient.post<Campaign>(`/campaigns/${id}/launch`);
    return data;
  },

  pause: async (id: string) => {
    const { data } = await apiClient.post<Campaign>(`/campaigns/${id}/pause`);
    return data;
  },

  resume: async (id: string) => {
    const { data } = await apiClient.post<Campaign>(`/campaigns/${id}/resume`);
    return data;
  },

  cancel: async (id: string) => {
    const { data } = await apiClient.post<Campaign>(`/campaigns/${id}/cancel`);
    return data;
  },

  // Steps
  getSteps: async (campaignId: string) => {
    const { data } = await apiClient.get<CampaignStep[]>(`/campaigns/${campaignId}/steps`);
    return data;
  },

  addStep: async (campaignId: string, input: CreateStepInput) => {
    const { data } = await apiClient.post<CampaignStep>(`/campaigns/${campaignId}/steps`, input);
    return data;
  },

  updateStep: async (campaignId: string, stepId: string, input: UpdateStepInput) => {
    const { data } = await apiClient.put<CampaignStep>(`/campaigns/${campaignId}/steps/${stepId}`, input);
    return data;
  },

  deleteStep: async (campaignId: string, stepId: string) => {
    await apiClient.delete(`/campaigns/${campaignId}/steps/${stepId}`);
  },

  reorderSteps: async (campaignId: string, stepIds: string[]) => {
    await apiClient.put(`/campaigns/${campaignId}/steps/reorder`, { step_ids: stepIds });
  },

  // Campaign contacts
  getContacts: async (campaignId: string, params?: { page?: number; limit?: number }) => {
    const { data } = await apiClient.get<PaginatedResponse<CampaignContact & { contact: { email: string; first_name: string | null; last_name: string | null } }>>(`/campaigns/${campaignId}/contacts`, { params });
    return data;
  },

  addContacts: async (campaignId: string, contactIds: string[]) => {
    await apiClient.post(`/campaigns/${campaignId}/contacts`, { contact_ids: contactIds });
  },

  removeContacts: async (campaignId: string, contactIds: string[]) => {
    await apiClient.delete(`/campaigns/${campaignId}/contacts`, {
      data: { contact_ids: contactIds },
    });
  },

  // Test email
  sendTest: async (campaignId: string, input: { to: string; subject: string; body_html: string; smtp_account_id: string }) => {
    const { data } = await apiClient.post<{ success: boolean; message?: string; error?: string }>(`/campaigns/${campaignId}/test-email`, input);
    return data;
  },

  retryErrors: async (id: string) => {
    const { data } = await apiClient.post<{ retried: number }>(`/campaigns/${id}/retry-errors`);
    return data;
  },

  clone: async (id: string) => {
    const { data } = await apiClient.post<Campaign>(`/campaigns/${id}/clone`);
    return data;
  },

  // Sender pool (rotation)
  getSenderPool: async (campaignId: string) => {
    const { data } = await apiClient.get<string[]>(`/campaigns/${campaignId}/sender-pool`);
    return data;
  },

  setSenderPool: async (campaignId: string, smtpAccountIds: string[]) => {
    await apiClient.put(`/campaigns/${campaignId}/sender-pool`, { smtp_account_ids: smtpAccountIds });
  },
};
