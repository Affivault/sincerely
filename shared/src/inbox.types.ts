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
  /**
   * What this reply was decided to be, if anybody has decided yet.
   *
   * Null is the queue: "needs triage" is exactly the inbound, non-automatic
   * mail with nothing here. Kept on the message rather than derived from
   * whether a lead exists, because "not interested" creates nothing and
   * would otherwise be indistinguishable from never having been looked at.
   */
  triage_decision: 'interested' | 'later' | 'not_interested' | null;
  triaged_at: string | null;
  /** The lead or follow-up the decision created, so undo removes exactly it. */
  triage_ref: string | null;
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
  /**
   * Inbound replies nobody has decided about yet.
   *
   * The number the inbox is actually for. Excludes auto-replies, because an
   * out-of-office is not a decision anybody owes, and a badge that counts
   * them is a badge people learn to ignore.
   */
  needs_triage: number;
  /** Count of inbox messages per SARA intent. Missing keys mean zero. */
  intents: Partial<Record<SaraIntent, number>>;
}
