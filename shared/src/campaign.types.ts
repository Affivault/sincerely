import { CampaignStatus, StepType, ContactCampaignStatus } from './enums.js';

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  status: CampaignStatus;
  smtp_account_id: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  timezone: string;
  send_window_start: string | null;
  send_window_end: string | null;
  send_days: string[];
  total_contacts: number;
  dcs_threshold: number;
  daily_limit: number;
  delay_between_emails: number;
  delay_between_emails_min: number;
  delay_between_emails_max: number;
  stop_on_reply: boolean;
  track_opens: boolean;
  track_clicks: boolean;
  include_unsubscribe: boolean;
  created_at: string;
  updated_at: string;
}

export interface CampaignStep {
  id: string;
  campaign_id: string;
  step_order: number;
  step_type: StepType;
  subject: string | null;
  subject_b: string | null;
  body_html: string | null;
  body_html_b: string | null;
  body_text: string | null;
  delay_days: number;
  delay_hours: number;
  delay_minutes: number;
  skip_if_replied: boolean;
  condition_field: string | null;
  condition_operator: string | null;
  condition_value: string | null;
  true_branch_step: number | null;
  false_branch_step: number | null;
  webhook_event: string | null;
  webhook_timeout_hours: number | null;
  send_at_local_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignContact {
  id: string;
  campaign_id: string;
  contact_id: string;
  status: ContactCampaignStatus;
  current_step_order: number;
  next_send_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignWithStats extends Campaign {
  steps_count: number;
  contacts_count: number;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
  replied_count: number;
  bounced_count: number;
  active_contacts: number;
  completed_contacts: number;
  bounced_contacts: number;
  unsubscribed_contacts: number;
  suppressed_contacts: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
}

export interface CreateCampaignInput {
  name: string;
  smtp_account_id?: string;
  timezone?: string;
  send_window_start?: string;
  send_window_end?: string;
  send_days?: string[];
  dcs_threshold?: number;
  daily_limit?: number;
  delay_between_emails?: number;
  delay_between_emails_min?: number;
  delay_between_emails_max?: number;
  stop_on_reply?: boolean;
  track_opens?: boolean;
  track_clicks?: boolean;
  include_unsubscribe?: boolean;
}

export interface CreateStepInput {
  step_type: StepType;
  step_order: number;
  subject?: string;
  subject_b?: string;
  body_html?: string;
  body_html_b?: string;
  body_text?: string;
  delay_days?: number;
  delay_hours?: number;
  delay_minutes?: number;
  skip_if_replied?: boolean;
  condition_field?: string;
  condition_operator?: string;
  condition_value?: string;
  true_branch_step?: number;
  false_branch_step?: number;
  webhook_event?: string;
  webhook_timeout_hours?: number;
  send_at_local_time?: string;
}

export interface UpdateStepInput extends Partial<CreateStepInput> {}
