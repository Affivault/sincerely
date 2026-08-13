/* ═══════════════════════════════════════════════════════════════════════
   "Am I safe to send?"

   Everything needed to answer that already existed, spread across five
   pages: domain authentication on one, mailbox health on another, warm-up
   on a third, the bounce guard buried in settings, the tracking domain
   somewhere else again. Nobody assembles that in their head before hitting
   Launch, so nobody ever did — the answer arrived afterwards, as a bounce
   rate.

   One report, one verdict, and every check carries the link that fixes it.
   ═══════════════════════════════════════════════════════════════════════ */

export type ReadinessStatus = 'pass' | 'warn' | 'fail';

/**
 * `blocked` means a send cannot succeed or would do real damage.
 * `risky` means it will go out, with a cost worth knowing about first.
 */
export type ReadinessVerdict = 'ready' | 'risky' | 'blocked';

export type ReadinessGroup = 'identity' | 'reputation' | 'capacity' | 'safeguards';

export interface ReadinessFact {
  label: string;
  value: string;
}

export interface ReadinessCheck {
  id: string;
  group: ReadinessGroup;
  label: string;
  status: ReadinessStatus;
  /** What is true right now, in one line. */
  headline: string;
  /** What to do about it. Null on a pass, where there is nothing to do. */
  detail: string | null;
  /** Where to go to fix it. */
  fix: { label: string; href: string } | null;
  /** Supporting numbers, shown beside the check. */
  facts: ReadinessFact[];
}

export interface ReadinessReport {
  verdict: ReadinessVerdict;
  /** One sentence, written to be read on its own. */
  summary: string;
  checks: ReadinessCheck[];
  /**
   * Real campaign emails that can still go out today across every mailbox.
   * Null when a mailbox is uncapped, because then there is no number — and
   * reporting one would be a guess presented as a fact.
   */
  capacity_today: number | null;
  /** The same day's total allowance. Null for the same reason. */
  capacity_ceiling: number | null;
  generated_at: string;
}

export const READINESS_GROUP_LABELS: Record<ReadinessGroup, string> = {
  identity: 'Who you are',
  reputation: 'How you are seen',
  capacity: 'What you can send',
  safeguards: 'What protects you',
};

/** The worse of two statuses — how a report's verdict is rolled up. */
export function worseStatus(a: ReadinessStatus, b: ReadinessStatus): ReadinessStatus {
  const rank: Record<ReadinessStatus, number> = { pass: 0, warn: 1, fail: 2 };
  return rank[a] >= rank[b] ? a : b;
}
