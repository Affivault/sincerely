/* ═══════════════════════════════════════════════════════════════════════
   Whether a running campaign is actually running.

   A campaign keeps its green "running" badge whether it is sending or not.
   If a mailbox password expires, if the bounce guard trips, if the domain
   throttle backs off, if every remaining contact sits outside the sending
   window — the badge does not change, the number of sends quietly goes to
   zero, and the first anyone hears of it is a week of silence.

   Everything here is already computed somewhere: the bounce guard, the
   domain throttle, the sender pool, the schedule. None of it reaches the
   person who needs it. This is the assembly, and nothing more.
   ═══════════════════════════════════════════════════════════════════════ */

export type CampaignHealthLevel = 'ok' | 'attention' | 'stalled';

export type CampaignIssueId =
  | 'no_sender'
  | 'sender_failing'
  | 'bounce_guard'
  | 'capacity_exhausted'
  | 'domain_unauthenticated'
  | 'all_errored'
  | 'nothing_left'
  | 'outside_schedule'
  | 'no_schedule';

export interface CampaignIssue {
  id: CampaignIssueId;
  /** `stalled` means nothing is going out. `attention` means it still is. */
  level: Exclude<CampaignHealthLevel, 'ok'>;
  /** What is true, in one line, in plain words. */
  headline: string;
  /** What to do about it. */
  detail: string;
  fix: { label: string; href: string } | null;
}

export interface CampaignHealth {
  level: CampaignHealthLevel;
  /** One sentence, readable on its own. */
  summary: string;
  issues: CampaignIssue[];
  /** Sends this campaign made in the last 24 hours. */
  sent_24h: number;
  /** Contacts still waiting for their next step. */
  pending: number;
  /** Contacts stuck on an error. */
  errored: number;
  /**
   * Real sends still available today across this campaign's senders. Null
   * when a mailbox is uncapped — there is no number then, and inventing one
   * would be a guess wearing a fact's clothes.
   */
  capacity_today: number | null;
  /**
   * Working days to reach everyone still pending at the current daily rate.
   * Null when there is no rate to divide by, or nobody left to reach.
   */
  days_to_clear: number | null;
  generated_at: string;
}

export const CAMPAIGN_HEALTH_LABEL: Record<CampaignHealthLevel, string> = {
  ok: 'Sending',
  attention: 'Needs attention',
  stalled: 'Not sending',
};

/**
 * What one campaign can reach, for anywhere that needs the number before an
 * add rather than after it — the extension's panel, most of all.
 */
export interface CampaignReach {
  campaign_id: string;
  campaign_name: string;
  /** Contacts enrolled and not yet finished. */
  pending: number;
  /** Sends still available today. Null when uncapped. */
  capacity_today: number | null;
  /** The steady daily allowance across this campaign's senders. Null when uncapped. */
  daily_capacity: number | null;
  /** Working days to clear the queue. Null when uncapped or empty. */
  days_to_clear: number | null;
  /** Whether the campaign is in a state that sends at all. */
  sending: boolean;
}
