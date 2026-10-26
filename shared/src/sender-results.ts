/* ═══════════════════════════════════════════════════════════════════════
   Campaigns side by side, and results by the mailbox that sent them.

   Both are the same numbers the rest of analytics shows, cut another
   way, so they use the same definitions (get_campaigns_stats, migration
   085): sent is emails; opened, clicked, replied and bounced are people,
   each counted once however many times they did it; open, click and
   reply rates are over the people reached; bounces are over everyone a
   send was attempted to. Opens are human opens - scanner and privacy-proxy
   hits are recorded as machine_open and never counted.
   ═══════════════════════════════════════════════════════════════════════ */

/** A percentage to one decimal, 0 when there is nothing to divide by. */
export function percentOf(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;

export interface CampaignComparisonRow {
  id: string;
  name: string;
  status: string;
  sent: number;
  /** People with at least one email sent: the denominator of the rates. */
  reached: number;
  /** People a send was attempted to, bounced included: the bounce denominator. */
  attempted: number;
  opened: number;
  clicked: number;
  replied: number;
  /** People whose reply read as interested or asking to meet. */
  positive: number;
  /** Meetings booked with this campaign as the source, not cancelled. */
  meetings: number;
  bounced: number;
  unsubscribed: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  positive_rate: number;
  meeting_rate: number;
  bounce_rate: number;
  unsubscribe_rate: number;
}

export interface SenderResultRow {
  /** smtp_account_id, a domain, or 'unrecorded'. */
  key: string;
  label: string;
  /** The mailbox address, on mailbox rows. */
  email: string | null;
  domain: string | null;
  sent: number;
  reached: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  complained: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
  complaint_rate: number;
}

export interface SenderResultsReport {
  /** Inclusive start and exclusive end, ISO. */
  from: string;
  to: string;
  mailboxes: SenderResultRow[];
  domains: SenderResultRow[];
  /** True when the read stopped at its row ceiling, so the figures are a floor. */
  truncated: boolean;
}

/** People counted per row, before rates. Shared so the server and any check agree. */
export function senderRow(
  base: { key: string; label: string; email: string | null; domain: string | null },
  n: { sent: number; reached: number; attempted: number; opened: number; clicked: number; replied: number; bounced: number; complained: number },
): SenderResultRow {
  return {
    ...base,
    sent: n.sent,
    reached: n.reached,
    opened: n.opened,
    clicked: n.clicked,
    replied: n.replied,
    bounced: n.bounced,
    complained: n.complained,
    open_rate: percentOf(n.opened, n.reached),
    click_rate: percentOf(n.clicked, n.reached),
    reply_rate: percentOf(n.replied, n.reached),
    bounce_rate: percentOf(n.bounced, n.attempted),
    complaint_rate: percentOf(n.complained, n.reached),
  };
}
