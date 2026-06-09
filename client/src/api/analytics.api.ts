import { apiClient } from './client';
import type { CampaignAnalytics, OverviewAnalytics, ContactActivityItem } from '@lemlist/shared';

export type { OverviewAnalytics };

export interface TrendDataPoint {
  date: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced?: number;
}

export interface CampaignListItem {
  id: string;
  name: string;
  status: string;
  created_at: string;
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

export interface FunnelStep {
  step_number: number;
  step_id: string;
  subject: string;
  delay_days: number;
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
  step_number: number;
  step_id: string;
  subject_a: string;
  subject_b: string;
  variant_a: AbVariantStats;
  variant_b: AbVariantStats;
  winner: 'a' | 'b' | null;
  significant: boolean;
  min_sample: number;
}

export interface CampaignAbTestResult {
  has_ab_test: boolean;
  steps: AbTestStep[];
}

export interface CampaignContact {
  contact_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  dcs_score: number | null;
  is_bounced: boolean;
  status: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: boolean;
}

export interface HeatmapDay {
  day: string;
  hours: number[];
}

export interface CampaignHeatmapResult {
  grid: HeatmapDay[];
  max_value: number;
}

export const analyticsApi = {
  overview: async (days?: number) => {
    const { data } = await apiClient.get<OverviewAnalytics>('/analytics/overview', {
      params: days ? { days } : undefined,
    });
    return data;
  },

  trend: async (days: number = 30) => {
    const { data } = await apiClient.get<TrendDataPoint[]>('/analytics/trend', {
      params: { days },
    });
    return data;
  },

  campaignList: async () => {
    const { data } = await apiClient.get<CampaignListItem[]>('/analytics/campaigns');
    return data;
  },

  campaign: async (campaignId: string) => {
    const { data } = await apiClient.get<CampaignAnalytics>(`/analytics/campaigns/${campaignId}`);
    return data;
  },

  campaignTrend: async (campaignId: string, days: number = 14) => {
    const { data } = await apiClient.get<TrendDataPoint[]>(`/analytics/campaigns/${campaignId}/trend`, {
      params: { days },
    });
    return data;
  },

  campaignContacts: async (campaignId: string) => {
    const { data } = await apiClient.get<{ contacts: CampaignContact[] }>(`/analytics/campaigns/${campaignId}/contacts`);
    return data;
  },

  campaignFunnel: async (campaignId: string) => {
    const { data } = await apiClient.get<FunnelStep[]>(`/analytics/campaigns/${campaignId}/funnel`);
    return data;
  },

  campaignAbTest: async (campaignId: string) => {
    const { data } = await apiClient.get<CampaignAbTestResult>(`/analytics/campaigns/${campaignId}/ab-test`);
    return data;
  },

  campaignHeatmap: async (campaignId: string) => {
    const { data } = await apiClient.get<CampaignHeatmapResult>(`/analytics/campaigns/${campaignId}/heatmap`);
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
