import type { ImproveStatus } from '@lemlist/shared';
import { apiClient } from './client';
import type {
  Campaign,
  CampaignWithStats,
  CampaignForecast,
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

export interface WrittenSequence {
  name: string;
  rationale: string;
  engine: 'ai' | 'template';
  steps: Array<{ delay_days: number; subject: string; body_html: string; body_text: string }>;
  leads: number;
  personalized: number;
  personalize_requested: boolean;
}

export const campaignsApi = {
  /** Relay drafts a sequence for a list. Saves nothing to a campaign. */
  writeSequence: async (input: {
    list_id?: string | null;
    contact_ids?: string[];
    offer?: string;
    audience?: string;
    goal?: string;
    tone?: 'friendly' | 'direct' | 'formal';
    steps?: number;
    personalize?: boolean;
  }) => {
    const { data } = await apiClient.post<WrittenSequence>('/campaigns/write-sequence', input, { timeout: 180_000 });
    return data;
  },

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
  /** Let Relay improve this campaign (shared/experiments). */
  improve: async (id: string) => (await apiClient.get<ImproveStatus>(`/campaigns/${id}/improve`)).data,
  setImprove: async (id: string, patch: { enabled?: boolean; auto?: boolean }) =>
    (await apiClient.put<ImproveStatus>(`/campaigns/${id}/improve`, patch, { timeout: 60_000 })).data,
  approveTest: async (id: string, testId: string, edits?: { subject?: string; body_html?: string }) =>
    (await apiClient.post<ImproveStatus>(`/campaigns/${id}/improve/${testId}/approve`, edits || {})).data,
  stopTest: async (id: string, testId: string) => (await apiClient.post<ImproveStatus>(`/campaigns/${id}/improve/${testId}/stop`)).data,
  undoTest: async (id: string, testId: string) => (await apiClient.post<ImproveStatus>(`/campaigns/${id}/improve/${testId}/undo`)).data,
  /** Plain words for the spam-trigger phrases the launch review found. */
  applyContentFixes: async (id: string) =>
    (await apiClient.post<{ changed: number; steps: number }>(`/campaigns/${id}/content-fixes`)).data,
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

  /** Put contacts held back because a colleague replied back to work. No ids = all of them. */
  resumePaused: async (id: string, ids?: string[]) => {
    const { data } = await apiClient.post<{ resumed: number }>(`/campaigns/${id}/resume-paused`, { ids });
    return data;
  },

  /** Day-by-day simulation of what launching now would do. */
  forecast: async (id: string) => (await apiClient.get<CampaignForecast>(`/campaigns/${id}/forecast`)).data,

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
