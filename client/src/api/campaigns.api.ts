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
  PersonalizationAudit,
  CampaignHealth,
  CampaignReach,
  EnrolResult,
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

  /** What the copy asks for vs. what the audience can answer. */
  personalization: async (id: string) => {
    const { data } = await apiClient.get<PersonalizationAudit>(`/campaigns/${id}/personalization`);
    return data;
  },

  /** End an A/B test: the chosen variant becomes the step's only copy. */
  promoteAbVariant: async (id: string, stepId: string, variant: 'a' | 'b') => {
    const { data } = await apiClient.post(`/campaigns/${id}/steps/${stepId}/promote-variant`, { variant });
    return data;
  },

  health: async (id: string) => {
    const { data } = await apiClient.get<CampaignHealth>(`/campaigns/${id}/health`);
    return data;
  },

  reach: async (id: string) => {
    const { data } = await apiClient.get<CampaignReach>(`/campaigns/${id}/reach`);
    return data;
  },

  /**
   * Start it. `acknowledgeWarnings` is the answer to a 409 — the server
   * refuses a risky launch once, with the reasons, and accepts it on the
   * second ask. A 422 is never overridable: blocked means it cannot work.
   */
  launch: async (id: string, acknowledgeWarnings = false) => {
    const { data } = await apiClient.post(`/campaigns/${id}/launch`, {
      acknowledge_warnings: acknowledgeWarnings,
    });
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

  /** Add contacts to the campaign's bound list AND enroll them in one call. */
  enrollContacts: async (campaignId: string, contactIds: string[]): Promise<EnrolResult> => {
    const { data } = await apiClient.post<EnrolResult>(
      `/campaigns/${campaignId}/enroll`,
      { contact_ids: contactIds },
    );
    return data;
  },

  addContacts: async (campaignId: string, contactIds: string[]): Promise<EnrolResult> => {
    const { data } = await apiClient.post<EnrolResult>(
      `/campaigns/${campaignId}/contacts`,
      { contact_ids: contactIds },
    );
    return data;
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

  // Inbound webhook token (for webhook_wait steps)
  getWebhookToken: async (campaignId: string) => {
    const { data } = await apiClient.get<{ token: string; url: string }>(`/campaigns/${campaignId}/webhook-token`);
    return data;
  },
};
