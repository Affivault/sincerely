import { apiClient } from './client';
import type {
  LifecycleRunReport,
  RenewalBandId,
  RenewalStatus,
  RenewalSummary,
} from '@lemlist/shared';

/** A deal in the renewals book, with the arithmetic already done server-side. */
export interface RenewalRow {
  id: string;
  title: string;
  company: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  stage: string;
  value: number | null;
  currency: string | null;
  closed_at: string | null;
  term_months: number | null;
  recurring_amount: number | null;
  recurring_period: string | null;
  one_off_amount: number | null;
  renewal_date: string | null;
  renewal_status: RenewalStatus | null;
  renewal_notice_days: number | null;
  renewed_to_deal_id: string | null;
  source_campaign_id: string | null;
  attribution: string | null;
  /** Computed on the server so the rows and the totals cannot disagree. */
  band: RenewalBandId | null;
  renewal_value: number;
  action_by: string | null;
}

export interface RenewalActivity {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  campaign_status: string | null;
  contact_id: string;
  trigger_event: string;
  cycle_key: string;
  enrolled_at: string;
}

export const renewalsApi = {
  list: async (params?: { band?: RenewalBandId; status?: string }) =>
    (await apiClient.get<RenewalRow[]>('/renewals', { params })).data,

  summary: async () => (await apiClient.get<RenewalSummary>('/renewals/summary')).data,

  update: async (id: string, input: {
    renewal_date?: string | null;
    renewal_notice_days?: number | null;
    renewal_status?: string | null;
  }) => (await apiClient.patch<RenewalRow>(`/renewals/${id}`, input)).data,

  /** They renewed. The next term becomes its own deal, linked to this one. */
  markRenewed: async (id: string, input?: {
    term_months?: number | null;
    recurring_amount?: number | null;
    value?: number | null;
    closed_at?: string | null;
  }) => (await apiClient.post<{ deal: RenewalRow; renewal: RenewalRow | null; created: boolean }>(
    `/renewals/${id}/renewed`, input || {})).data,

  /** They did not. Recorded with a reason, and nobody is suppressed for it. */
  markChurned: async (id: string, reason?: string) =>
    (await apiClient.post<RenewalRow>(`/renewals/${id}/churned`, { reason })).data,

  /** Which post-sale sequences this deal has actually been put into. */
  activity: async (id: string) =>
    (await apiClient.get<RenewalActivity[]>(`/renewals/${id}/activity`)).data,

  /**
   * Run the trigger pass now rather than waiting for the worker's tick.
   * Exists so somebody who has just switched a renewal sequence on can watch
   * it work, instead of wondering for thirty seconds if they set it up wrong.
   */
  runTriggers: async () =>
    (await apiClient.post<LifecycleRunReport>('/renewals/run-triggers')).data,
};
