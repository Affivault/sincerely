import { apiClient } from './client';
import type { CampaignAnalytics, OverviewAnalytics, ContactActivityItem } from '@lemlist/shared';

export interface TrendDataPoint {
  date: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

export interface CampaignListItem {
  id: string;
  name: string;
  status: string;
  created_at: string;
  sent: number;
  open_rate: number;
  reply_rate: number;
}

export interface FunnelStep {
  step_id: string;
  step_order: number;
  subject: string;
  has_ab: boolean;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
}

export interface AbVariantStats {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
}

export interface AbTestStep {
  step_id: string;
  step_order: number;
  subject_a: string;
  subject_b: string;
  winner: 'a' | 'b' | null;
  significant: boolean;
  min_sample: number;
  variant_a: AbVariantStats;
  variant_b: AbVariantStats;
}

export interface CampaignContact {
  contact_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  dcs_score: number | null;
  is_bounced: boolean;
  is_unsubscribed: boolean;
  sent: number;
  opened: number;
  clicked: number;
  replied: boolean;
}

export const analyticsApi = {
  overview: async (days?: number) => {
    const { data } = await apiClient.get<OverviewAnalytics>('/analytics/overview', {
      params: days ? { days } : undefined,
    });
    return data;
  },

  trend: async (days: number = 30) => {
    const { data } = await apiClient.get<TrendDataPoint[]>('/analytics/trend', { params: { days } });
    return data;
  },

  campaign: async (campaignId: string) => {
    const { data } = await apiClient.get<CampaignAnalytics>(`/analytics/campaigns/${campaignId}`);
    return data;
  },

  campaignList: async () => {
    const { data } = await apiClient.get<CampaignListItem[]>('/analytics/campaigns');
    return data;
  },

  campaignFunnel: async (campaignId: string) => {
    const { data } = await apiClient.get<FunnelStep[]>(`/analytics/campaigns/${campaignId}/funnel`);
    return data;
  },

  campaignAbTest: async (campaignId: string) => {
    const { data } = await apiClient.get<AbTestStep[]>(`/analytics/campaigns/${campaignId}/ab-test`);
    return data;
  },

  campaignTrend: async (campaignId: string, days: number = 30) => {
    const { data } = await apiClient.get<TrendDataPoint[]>(`/analytics/campaigns/${campaignId}/trend`, { params: { days } });
    return data;
  },

  campaignContacts: async (campaignId: string) => {
    const { data } = await apiClient.get<{ contacts: CampaignContact[] }>(`/analytics/campaigns/${campaignId}/contacts`);
    return data;
  },

  contactTimeline: async (contactId: string) => {
    const { data } = await apiClient.get<ContactActivityItem[]>(`/analytics/contacts/${contactId}/timeline`);
    return data;
  },

  deliverability: async () => {
    const { data } = await apiClient.get<{
      dcs_distribution: { label: string; value: number; color: string }[];
      bounced_contacts: number;
      suppression_by_reason: { label: string; value: number; color: string }[];
    }>('/analytics/deliverability');
    return data;
  },

  exportOverviewReport: (days?: number) => {
    const params = new URLSearchParams();
    if (days) params.set('days', String(days));
    return `${apiClient.defaults.baseURL}/analytics/export/overview${params.toString() ? '?' + params.toString() : ''}`;
  },

  exportCampaignReport: (campaignId: string) => {
    return `${apiClient.defaults.baseURL}/analytics/export/campaigns/${campaignId}`;
  },
};
