/* ═══════════════════════════════════════════════════════════════════════
   Prospects and contacts are not the same thing.

   This app manufactures thousands of records nobody has ever spoken to. A
   CRM built the other way round never faces that, because a human typed
   every contact in — so mixing scraped strangers with real relationships
   in one list is a problem specific to being an outreach tool with a CRM
   attached, and it is not a small one. It makes the contact list mostly
   noise, search mostly junk, and a contact count mean nothing at all.

   The promotion between the first two is not a judgement call. It is a
   fact: they replied, they met you, somebody put them on a deal. So it
   happens automatically, and the trigger is recorded.
   ═══════════════════════════════════════════════════════════════════════ */

export type Lifecycle = 'prospect' | 'contact' | 'customer';

export const LIFECYCLES: { id: Lifecycle; label: string; hint: string }[] = [
  { id: 'prospect', label: 'Prospects', hint: 'Sourced but never engaged. These are who campaigns are for.' },
  { id: 'contact', label: 'Contacts', hint: 'Replied, met, or added deliberately. These are your relationships.' },
  { id: 'customer', label: 'Customers', hint: 'Won a deal. Kept out of cold outreach by default.' },
];

/**
 * Singular, for labelling one person rather than a filter holding many.
 *
 * "Prospects 386" is a bucket; "Prospect" on somebody's row is a fact about
 * them. Same words, and keeping both spellings here stops a row badge and the
 * filter above it drifting apart into two vocabularies.
 */
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  prospect: 'Prospect',
  contact: 'Contact',
  customer: 'Customer',
};

/**
 * What caused a promotion.
 *
 * Recorded so the answer to "why is this person in my CRM" is never a
 * shrug. Every one of these is an event that happened, not an opinion.
 */
export type PromotionTrigger =
  | 'reply'
  | 'meeting'
  | 'lead'
  | 'deal'
  | 'manual'
  | 'import'
  | 'backfill_engaged'
  | 'backfill_won_deal';

export const PROMOTION_LABEL: Record<PromotionTrigger, string> = {
  reply: 'replied to a campaign',
  meeting: 'a meeting was booked',
  lead: 'made a lead',
  deal: 'added to a deal',
  manual: 'added by hand',
  import: 'imported as a contact',
  backfill_engaged: 'had history when lifecycle was introduced',
  backfill_won_deal: 'was on a won deal when lifecycle was introduced',
};

const RANK: Record<Lifecycle, number> = { prospect: 0, contact: 1, customer: 2 };

/**
 * Whether a promotion is actually a promotion.
 *
 * Only ever moves forward. Winning a deal and then replying to a nurture
 * campaign must not demote a customer back to a contact, and an automatic
 * trigger must never undo a deliberate manual choice — going backwards is
 * something a person does on purpose, never something an event does.
 */
export function shouldPromote(current: Lifecycle | null | undefined, next: Lifecycle): boolean {
  const from = RANK[(current || 'prospect') as Lifecycle] ?? 0;
  return RANK[next] > from;
}

/** Everybody who is not a stranger. What the CRM list means by "contacts". */
export function isEngaged(lifecycle: Lifecycle | null | undefined): boolean {
  return lifecycle === 'contact' || lifecycle === 'customer';
}

export interface LifecycleCounts {
  prospect: number;
  contact: number;
  customer: number;
  total: number;
  /**
   * Prospects who became contacts, as a percentage of everybody sourced.
   *
   * The real top-of-funnel number, and one that was unanswerable while the
   * two lived in the same undifferentiated pile. Says whether the
   * targeting works, which no open rate ever will.
   */
  engagementRate: number | null;
}

export function countLifecycles(
  contacts: { lifecycle?: Lifecycle | null }[],
): LifecycleCounts {
  const out: LifecycleCounts = { prospect: 0, contact: 0, customer: 0, total: 0, engagementRate: null };
  for (const c of contacts) {
    const key = (c.lifecycle || 'prospect') as Lifecycle;
    if (key in out) (out as any)[key] += 1;
    out.total += 1;
  }
  const engaged = out.contact + out.customer;
  out.engagementRate = out.total > 0 ? Math.round((engaged / out.total) * 100) : null;
  return out;
}
