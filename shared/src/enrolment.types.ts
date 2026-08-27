/* ═══════════════════════════════════════════════════════════════════════
   What actually happened when you added people to a campaign.

   Adding used to answer with two numbers, and one of them was wrong: the
   "added" count included people who were already enrolled, so re-importing
   a list reported the full count and inserted nothing. The other number,
   "skipped", carried no reason at all, so the interface guessed one and
   always guessed the same one.

   A skip is not a failure. Most of them are the product doing its job —
   refusing to email someone twice, honouring an unsubscribe, keeping a
   suppressed address suppressed. But the person who pressed the button is
   owed the reason, and owed the names, because "60 skipped" is where they
   stop trusting the number.
   ═══════════════════════════════════════════════════════════════════════ */

export type EnrolSkipReason =
  /** Already in this campaign. Their progress is untouched. */
  | 'already_enrolled'
  /** In another active campaign on a different lead list. */
  | 'in_other_campaign'
  /** Not a member of the lead list this campaign is bound to. */
  | 'not_in_list'
  /** On the suppression list. */
  | 'suppressed'
  /** Unsubscribed from this account. */
  | 'unsubscribed'
  /** Previously hard-bounced. */
  | 'bounced'
  /** No email address to send to. */
  | 'no_email'
  /** Not this account's contact. */
  | 'not_yours';

export interface EnrolSkip {
  contact_id: string;
  email: string | null;
  name: string | null;
  reason: EnrolSkipReason;
  /** Which other campaign, which list — whatever makes the reason concrete. */
  detail: string | null;
}

export interface EnrolResult {
  /** Rows actually created. Never counts anyone who was already there. */
  added: number;
  /** Everyone asked for who did not become a new row. */
  skipped: number;
  /** The campaign's enrolment after this call. */
  total: number;
  /** How the skips break down. Only non-zero reasons appear. */
  reasons: Partial<Record<EnrolSkipReason, number>>;
  /**
   * Who was skipped, capped at ENROL_SKIP_SAMPLE. Enough to recognise the
   * pattern without turning a 10,000-contact import into a 10,000-row
   * response.
   */
  skips: EnrolSkip[];
}

/** How many named skips a result carries back. */
export const ENROL_SKIP_SAMPLE = 100;

export const ENROL_SKIP_LABEL: Record<EnrolSkipReason, string> = {
  already_enrolled: 'already in this campaign',
  in_other_campaign: 'in another active campaign',
  not_in_list: 'not in this campaign’s lead list',
  suppressed: 'on your suppression list',
  unsubscribed: 'unsubscribed',
  bounced: 'previously bounced',
  no_email: 'no email address',
  not_yours: 'not in this account',
};

/** Longest first, so the biggest reason leads the sentence. */
export function enrolSkipBreakdown(result: EnrolResult): Array<{ reason: EnrolSkipReason; count: number; label: string }> {
  return (Object.entries(result.reasons) as Array<[EnrolSkipReason, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count, label: ENROL_SKIP_LABEL[reason] }));
}

/**
 * One sentence for a toast.
 *
 * "0 added" is worth saying out loud rather than dressing up: a re-import
 * that changes nothing should read as changing nothing.
 */
export function summariseEnrolment(result: EnrolResult): string {
  const parts: string[] = [];
  parts.push(result.added === 0
    ? 'Nobody new added'
    : `${result.added.toLocaleString()} contact${result.added === 1 ? '' : 's'} added`);

  const breakdown = enrolSkipBreakdown(result);
  if (breakdown.length > 0) {
    const top = breakdown.slice(0, 2).map((b) => `${b.count.toLocaleString()} ${b.label}`);
    const rest = breakdown.length - top.length;
    if (rest > 0) top.push(`${breakdown.slice(2).reduce((n, b) => n + b.count, 0).toLocaleString()} other`);
    parts.push(`${result.skipped.toLocaleString()} skipped — ${top.join(', ')}`);
  }
  return parts.join(' · ');
}

/** An empty result, for callers with nothing to do. */
export function emptyEnrolResult(total = 0): EnrolResult {
  return { added: 0, skipped: 0, total, reasons: {}, skips: [] };
}
