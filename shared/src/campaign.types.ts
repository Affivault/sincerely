import { CampaignStatus, StepType, ContactCampaignStatus, ConditionField, ConditionOperator } from './enums.js';

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
  /** End an A/B test on its own once a variant wins significantly. */
  ab_auto_promote: boolean;
  /** Measure the send window against each recipient's own clock. */
  send_in_recipient_timezone: boolean;
  /** Set when something stopped the campaign on the user's behalf. */
  paused_reason?: string | null;
  paused_at?: string | null;
  /** Why the engine currently cannot send. Cleared by the next send. */
  stall_reason?: string | null;
  stall_since?: string | null;
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
  /** Connection-request note (linkedin_connect only), max 300 chars. */
  linkedin_note?: string | null;
  condition_field: ConditionField | null;
  condition_operator: ConditionOperator | null;
  condition_value: string | null;
  true_branch_step: number | null;
  false_branch_step: number | null;
  /** Arbitrary external event name an inbound webhook must match — not one of our own WebhookEventType values. */
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
  /** Answered — the outcome a campaign exists to produce. */
  replied_contacts?: number;
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
  /** When set to a future ISO time, launch waits until then instead of sending immediately */
  scheduled_at?: string | null;
  send_window_start?: string;
  send_window_end?: string;
  send_days?: string[];
  dcs_threshold?: number;
  daily_limit?: number;
  delay_between_emails?: number;
  delay_between_emails_min?: number;
  delay_between_emails_max?: number;
  stop_on_reply?: boolean;
  ab_auto_promote?: boolean;
  send_in_recipient_timezone?: boolean;
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
  condition_field?: ConditionField;
  condition_operator?: ConditionOperator;
  condition_value?: string;
  true_branch_step?: number;
  false_branch_step?: number;
  webhook_event?: string;
  webhook_timeout_hours?: number;
  send_at_local_time?: string;
  /** Connection-request note (linkedin_connect only), max 300 chars. */
  linkedin_note?: string;
}

export interface UpdateStepInput extends Partial<CreateStepInput> {}

/**
 * One merge tag a campaign's copy uses, and how much of the audience can
 * answer it. `missing` is a count of contacts with no value for the field
 * behind the tag — except for `sender` scope, where the whole campaign is a
 * single subject and `total` is 1.
 */
export interface PersonalizationTag {
  name: string;
  label: string;
  /** Where the value comes from: the contact, the account, or nowhere. */
  scope: 'contact' | 'sender' | 'link' | 'unknown';
  /** Written as `{{tag | something}}`, so a gap degrades to readable copy. */
  has_fallback: boolean;
  missing: number;
  total: number;
}

/** How much of an audience could be placed on a clock of its own. */
/** What the bounce guard sees, so a threshold is never a surprise. */
export interface BounceVerdict {
  sent: number;
  bounced: number;
  /** Observed rate, 0-1. */
  rate: number;
  /** Lower bound of the 95% interval -- what the decision actually uses. */
  confidentRate: number;
  thresholdPercent: number;
  trip: boolean;
  note: string;
}

export interface TimezoneCoverage {
  placed: number;
  total: number;
}

export interface PersonalizationAudit {
  total_contacts: number;
  tags: PersonalizationTag[];
  /** null when the database predates migration 042. */
  timezone_coverage?: TimezoneCoverage | null;
}
