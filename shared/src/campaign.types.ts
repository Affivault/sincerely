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
  /** Which guard paused it, when one did (091). Null for a pause you made. */
  paused_signal?: AutoPauseSignal | null;
  /**
   * Days this campaign never sends, on top of the account's own list (091).
   * YYYY-MM-DD for one day, MM-DD for that day every year - see shared/blackout.
   */
  blackout_dates?: string[];
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
  /** linkedin_message only (095): wait up to this many days for the invite to be accepted. */
  linkedin_wait_days?: number | null;
  /** How a follow-up email goes out (089). Unset: a reply when its subject is blank. */
  thread_mode?: ThreadMode | null;
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
  /** Enrolments held with status 'paused'. */
  paused_contacts?: number;
  /** People sent at least one email: the denominator of open/click/reply rates. */
  contacts_reached?: number;
  /** People a send was attempted to, refusals included: the bounce-rate denominator. */
  contacts_attempted?: number;
  /** The figures could not be loaded; show that rather than zeros. */
  stats_unavailable?: boolean;
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
  blackout_dates?: string[];
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
  /** linkedin_message only: wait up to this many days for a connection. 0 or unset sends at once. */
  linkedin_wait_days?: number | null;
  thread_mode?: ThreadMode | null;
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

/** What paused a campaign on the user's behalf. */
export type AutoPauseSignal = 'bounce_rate' | 'complaint_rate' | 'open_collapse';

/* ── Preview as a real contact ─────────────────────────────────────── */

/** One email of the sequence, exactly as this contact would get it. */
export interface PreviewEmail {
  /** Null for a step the builder has not saved yet. */
  step_id: string | null;
  step_order: number;
  /** 1-based position among the email steps. */
  position: number;
  subject: string;
  html: string;
  /** A reply in the first email's thread ("Re: ..."), or a new email. */
  thread: ThreadMode;
  /** Which arm of an A/B test this contact is in; null when it is not a test. */
  variant: 'a' | 'b' | null;
  /** Tags that come out blank for this contact - no value and no fallback. */
  blanks: string[];
  /** When it already went to them; the subject shown is then the one sent. */
  sent_at: string | null;
  /** Why the send would refuse this step, in plain words. */
  problem: string | null;
}

export interface CampaignPreview {
  contact: { id: string; email: string; name: string; company: string | null };
  /** In the campaign already. When not, wording variants can differ at enrolment. */
  enrolled: boolean;
  sender: {
    from_name: string;
    email: string;
    /** How many mailboxes the campaign rotates through. 1 = always this one. */
    rotation: number;
    /** Follow-ups come from the mailbox that sent the first email. */
    pinned: boolean;
  } | null;
  emails: PreviewEmail[];
  /** Across the whole audience: who would get a gap, by tag. */
  audience: {
    total: number;
    with_gaps: number;
    tags: Array<{ name: string; label: string; missing: number }>;
    /** Counted over the first `total` only - the audience is larger. */
    capped: boolean;
  };
  has_booking_link: boolean;
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

/** A follow-up as a reply in the same thread, or as a new email with its own subject. */
export type ThreadMode = 'reply' | 'new';

/** A subject without its "Re:" / "Fwd:" prefixes. */
export function baseSubject(subject: string | null | undefined): string {
  return String(subject || '').replace(/^\s*((re|fwd?|aw|sv|tr)\s*:\s*)+/i, '').trim();
}

/**
 * The mode a follow-up actually goes out in: the one set, or - for steps
 * saved before there was a choice - what the sender infers: a reply when
 * the subject is blank or repeats the earlier email's ("Re: Quick
 * question" after "Quick question").
 */
export function effectiveThreadMode(
  step: { thread_mode?: ThreadMode | null; subject?: string | null },
  earlierSubject?: string | null,
): ThreadMode {
  if (step.thread_mode === 'reply' || step.thread_mode === 'new') return step.thread_mode;
  const own = baseSubject(step.subject);
  if (!own) return 'reply';
  return earlierSubject && own.toLowerCase() === baseSubject(earlierSubject).toLowerCase() ? 'reply' : 'new';
}
