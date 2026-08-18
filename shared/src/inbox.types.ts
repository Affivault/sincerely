import { SaraIntent, SaraAction, SaraStatus } from './enums.js';

export interface InboxMessage {
  id: string;
  user_id: string;
  campaign_id: string | null;
  campaign_contact_id: string | null;
  contact_id: string | null;
  smtp_account_id: string | null;
  from_email: string;
  to_email: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  in_reply_to: string | null;
  message_id: string | null;
  is_read: boolean;
  /**
   * Set when the message came from a machine rather than a person —
   * 'out_of_office' or 'auto_reply'. These are never counted as replies.
   */
  auto_reply_kind: 'out_of_office' | 'auto_reply' | null;
  // SARA fields
  sara_intent: SaraIntent | null;
  sara_confidence: number | null;
  sara_draft_reply: string | null;
  sara_action: SaraAction | null;
  sara_status: SaraStatus;
  sara_reviewed_at: string | null;
  sara_reviewed_by: string | null;
  received_at: string;
  created_at: string;
}

export interface InboxMessageWithContext extends InboxMessage {
  contact_name: string | null;
  campaign_name: string | null;
}

export interface SaraClassificationResult {
  intent: string;
  confidence: number;
  action: string;
  draft_reply: string | null;
  reasoning: string;
}

export interface SaraReviewAction {
  message_id: string;
  action: 'approve' | 'dismiss' | 'edit_and_approve';
  edited_reply?: string;
}

export interface SaraQueueStats {
  pending_review: number;
  approved_today: number;
  dismissed_today: number;
  sent_today: number;
  top_intents: { intent: string; count: number }[];
}

/**
 * Inbox sidebar counts — computed server-side over the full mailbox (not a
 * capped page) so smart-view / tag badges stay accurate at scale.
 */
export interface InboxCounts {
  /** Unread conversations in the Inbox folder. */
  unread: number;
  /** Count of inbox messages per SARA intent. Missing keys mean zero. */
  intents: Partial<Record<SaraIntent, number>>;
}
