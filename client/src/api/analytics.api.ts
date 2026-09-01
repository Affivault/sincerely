import { apiClient } from './client';
import type { CampaignAnalytics, OverviewAnalytics, ContactActivityItem, SequencePerformance } from '@lemlist/shared';

/** One row of the revenue report. Mirrors analyticsService.revenue(). */
export interface CampaignRevenueRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
  sent: number;
  replied: number;
  deals: number;
  won: number;
  lost: number;
  open: number;
  won_value: number;
  /** Won value counting only thread/reply evidence. */
  strong_won_value: number;
  weighted_open: number;
  win_rate: number | null;
  average_won: number | null;
  /** Null rather than zero when nothing has replied yet. */
  value_per_reply: number | null;
}

export type { OverviewAnalytics, SequencePerformance };

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
  /** Ahead *and* unlikely to be chance — the one worth acting on. */
  winner: 'a' | 'b' | null;
  /** Simply ahead. Shown, but never promoted on. */
  leading: 'a' | 'b' | null;
  significant: boolean;
  /** Two-sided p-value from a two-proportion z-test on open rate. */
  p_value: number | null;
  has_enough_data: boolean;
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

/** One step's share of what a campaign earned. */
export interface StepRevenueRow {
  id: string;
  step_order: number;
  step_type: string;
  subject: string | null;
  sent: number;
  replied: number;
  deals: number;
  won: number;
  won_value: number;
  value_per_reply: number | null;
}

export interface AttributedDealRow {
  id: string;
  title: string;
  stage: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  attribution: 'thread' | 'reply' | 'enrolment' | 'manual' | null;
  source_step_id: string | null;
  value: number;
  closed_at: string | null;
  created_at: string;
}

export interface CampaignRevenueDetail {
  campaign: { id: string; name: string; status: string; created_at: string };
  funnel: { label: string; count: number; ofPrevious: number | null }[];
  totals: Omit<CampaignRevenueRow, 'id' | 'name' | 'status' | 'created_at'>;
  steps: StepRevenueRow[];
  /** Deals credited to the campaign but not to any one step. */
  unrecorded_step: { deals: number; won: number; won_value: number } | null;
  deals: AttributedDealRow[];
}

export const analyticsApi = {
  /**
   * What each campaign earned, not just what it sent.
   *
   * The one report a two-tool stack cannot produce, because the replies and
   * the revenue live in different companies' databases.
   */
  campaignRevenue: async (campaignId: string) => {
    const { data } = await apiClient.get<CampaignRevenueDetail>(`/analytics/revenue/${campaignId}`);
    return data;
  },

  revenue: async () => {
    const { data } = await apiClient.get<CampaignRevenueRow[]>('/analytics/revenue');
    return data;
  },

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

  /** Which step earns the replies, and where the sequence stops paying. */
  sequenceSteps: async (campaignId: string) => {
    const { data } = await apiClient.get<SequencePerformance>(`/analytics/campaigns/${campaignId}/steps`);
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

  // These hit an authenticated route, so they can't be plain hrefs (a bare
  // browser navigation sends no Authorization header and would always 401).
  // Fetch through apiClient — which attaches the bearer token — and hand the
  // caller a Blob to save via an object URL instead.
  exportOverviewReport: async (days?: number) => {
    const { data } = await apiClient.get('/analytics/export/overview', {
      params: days ? { days } : undefined,
      responseType: 'blob',
    });
    return data as Blob;
  },

  exportCampaignReport: async (campaignId: string) => {
    const { data } = await apiClient.get(`/analytics/export/campaigns/${campaignId}`, {
      responseType: 'blob',
    });
    return data as Blob;
  },
};
