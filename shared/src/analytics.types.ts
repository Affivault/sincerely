import { ActivityType } from './enums.js';

export interface CampaignActivity {
  id: string;
  campaign_id: string;
  campaign_contact_id: string;
  step_id: string | null;
  contact_id: string;
  activity_type: ActivityType;
  metadata: Record<string, unknown>;
  message_id: string | null;
  occurred_at: string;
}

export interface CampaignAnalytics {
  campaign_id: string;
  total_contacts: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  errors: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
}

export interface OverviewAnalytics {
  total_campaigns: number;
  active_campaigns: number;
  total_contacts: number;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  total_replied: number;
  avg_open_rate: number;
  avg_click_rate: number;
  avg_reply_rate: number;
  suppressed_count: number;
  avg_dcs_score: number;
  verified_contacts: number;
  bounced_contacts: number;
  sent_change: number | null;
  opened_change: number | null;
  clicked_change: number | null;
  replied_change: number | null;
}

export interface ContactActivityItem {
  id: string;
  activity_type: ActivityType;
  campaign_name: string;
  step_subject: string | null;
  /** Zero-based position of the step in its sequence, when known. */
  step_order?: number | null;
  campaign_id?: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
}
