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
  /**
   * Where it arrived (095). Null or 'email' is a mailbox; 'linkedin' is a
   * LinkedIn message the browser agent read, which is answered on LinkedIn.
   */
  channel?: 'email' | 'linkedin' | null;
  /**
   * Whether a person wrote this, or it is mail: a newsletter, a
   * notification, a receipt, or something between your own mailboxes.
   * Only people reach the inbox, the counts and Relay. Null on rows stored
   * before this existed, until the backfill reaches them (treated as person).
   */
  mail_kind?: MailKind | null;
  /** The name the sender's mail client sent ("GO Markets"), if any. */
  sender_name?: string | null;
  /** Relay's one-line read of the reply, and what to do next. */
  relay_summary?: string | null;
  relay_next_step?: string | null;
  /** 'ai' when Claude read it, 'rules' when the keyword fallback did, 'manual' when a person tagged it. */
  relay_engine?: 'ai' | 'rules' | 'manual' | null;
  // Relay fields
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
  /** Names, types and sizes of what came (or went) attached (migration 090). */
  attachments?: Array<{ filename: string; content_type: string; size: number }> | null;
  /** Out of the inbox until then (071; the inbox reads it since 092). */
  snoozed_until?: string | null;
  /** On a message we sent: when to check for an answer (092). */
  nudge_at?: string | null;
  /** Set when that check found none - the "No reply yet" marker (092). */
  nudge_fired_at?: string | null;
  /** When a snooze ended or a nudge fired; holds the row at the top until read (092). */
  resurfaced_at?: string | null;
  resurfaced_reason?: 'snooze' | 'nudge' | null;
  /** The teammate answering this conversation (071). */
  assigned_to?: string | null;
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
  summary?: string | null;
  next_step?: string | null;
  engine?: 'ai' | 'rules';
}

export type MailKind = 'person' | 'bulk' | 'notification' | 'transactional' | 'internal';

export const MAIL_KIND_LABELS: Record<Exclude<MailKind, 'person'>, string> = {
  bulk: 'Newsletters',
  notification: 'Notifications',
  transactional: 'Receipts',
  internal: 'Your mailboxes',
};

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
  /** Count of inbox messages per Relay intent. Missing keys mean zero. */
  intents: Partial<Record<SaraIntent, number>>;
  /** Newsletters, notifications, receipts: kept, but out of the inbox. */
  other?: number;
  other_unread?: number;
  /** True while mail stored before sorting existed is being sorted. */
  sorting?: boolean;
  /** Conversations snoozed for later; out of every other count. */
  snoozed?: number;
  /** Conversations assigned to the caller, from their own or a teammate's mailbox. */
  assigned_to_me?: number;
}

/** A teammate a conversation can be handed to. Only sent when there is more than one. */
export interface InboxTeammate {
  user_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  is_me: boolean;
}

/** Someone Relay unsubscribed on a reading it has since changed its mind about. */
export interface RelayReviewItem {
  message_id: string;
  contact_id: string;
  email: string;
  name: string | null;
  company: string | null;
  subject: string | null;
  excerpt: string;
  /** What the message reads as now: an intent, or a mail kind. */
  now_reads_as: string | null;
  received_at: string;
}
