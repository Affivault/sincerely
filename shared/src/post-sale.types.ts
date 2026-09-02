/* ═══════════════════════════════════════════════════════════════════════
   Who a campaign is for, and what starts it.

   Every campaign in this app used to be cold, and the enrolment guards
   assume it: somebody on an open deal is refused, and so is somebody who
   lives only in a CRM contact list. Both are exactly right for a pitch and
   exactly wrong for a renewal, where being a customer is the entry
   condition rather than a reason to stay away.

   So a campaign says which it is, and the guards read it. The alternative -
   a flag passed per enrolment call - puts the most consequential decision
   in this app (does this sequence reach customers?) somewhere nobody can
   see it, and one wrong call away from pitching your own customers.
   ═══════════════════════════════════════════════════════════════════════ */

export type CampaignAudience = 'cold' | 'post_sale';

export const CAMPAIGN_AUDIENCES: {
  id: CampaignAudience;
  label: string;
  blurb: string;
}[] = [
  {
    id: 'cold',
    label: 'Cold outreach',
    blurb: 'People you have not sold to. Customers and anybody on an open deal are kept out automatically.',
  },
  {
    id: 'post_sale',
    label: 'Existing customers',
    blurb: 'People who have already bought. Starts itself from what happens to the deal.',
  },
];

/**
 * What starts a sequence.
 *
 * `manual` is every campaign that has ever existed here: a person picks an
 * audience and presses go. The other three are the point of this - the CRM
 * event fires and the sequence follows, with nobody exporting a list.
 */
export type CampaignTrigger = 'manual' | 'deal_won' | 'renewal_due' | 'deal_lost';

export const CAMPAIGN_TRIGGERS: {
  id: CampaignTrigger;
  label: string;
  /** What actually happens, said before it happens. */
  effect: string;
  /** How the offset reads for this trigger. */
  offsetLabel: string;
  /** A sensible starting point, so nobody has to invent one. */
  defaultOffsetDays: number;
  /** Post-sale only. `manual` is the one that works on a cold campaign. */
  postSaleOnly: boolean;
}[] = [
  {
    id: 'manual',
    label: 'I start it',
    effect: 'Nothing happens until you add people and press start.',
    offsetLabel: '',
    defaultOffsetDays: 0,
    postSaleOnly: false,
  },
  {
    id: 'deal_won',
    label: 'A deal is won',
    effect: 'Everyone on the deal is enrolled once it closes. Onboarding, welcome, first check-in.',
    offsetLabel: 'days after the deal closes',
    defaultOffsetDays: 1,
    postSaleOnly: true,
  },
  {
    id: 'renewal_due',
    label: 'A renewal is coming up',
    effect: 'Enrolled a set time before the renewal date, once per renewal, every year it comes round.',
    offsetLabel: 'days before the renewal',
    defaultOffsetDays: 90,
    postSaleOnly: true,
  },
  {
    id: 'deal_lost',
    label: 'A deal is lost',
    effect: 'A win-back, sent long enough afterwards that it does not read as a reflex.',
    offsetLabel: 'days after the deal is lost',
    defaultOffsetDays: 180,
    postSaleOnly: true,
  },
];

export function triggerSpec(id: CampaignTrigger | null | undefined) {
  return CAMPAIGN_TRIGGERS.find((t) => t.id === (id || 'manual')) ?? CAMPAIGN_TRIGGERS[0];
}

/** Triggers that the worker acts on. `manual` waits for a person. */
export const AUTOMATIC_TRIGGERS: CampaignTrigger[] = ['deal_won', 'renewal_due', 'deal_lost'];

export function isAutomatic(trigger: CampaignTrigger | null | undefined): boolean {
  return !!trigger && AUTOMATIC_TRIGGERS.includes(trigger);
}

/**
 * Is this campaign configured in a way the database will accept?
 *
 * Mirrored here so the form can say what is wrong while somebody is typing,
 * rather than letting them press save and reading back a constraint name.
 * The database is still the authority - this is a courtesy, not the rule.
 */
export function describeTriggerProblem(input: {
  audience?: CampaignAudience | null;
  trigger_event?: CampaignTrigger | null;
  trigger_offset_days?: number | null;
}): string | null {
  const trigger = input.trigger_event;
  if (!trigger || trigger === 'manual') return null;

  if (input.audience !== 'post_sale') {
    return 'Only a customer campaign can start itself. A cold sequence that fires off your own deals would pitch your customers.';
  }
  const offset = input.trigger_offset_days;
  if (offset === null || offset === undefined) return null;
  if (!Number.isFinite(offset) || offset < 0) {
    return 'The offset has to be a number of days, and it cannot be negative.';
  }
  if (offset > 365) {
    return 'More than a year is not an offset, it is a different campaign.';
  }
  return null;
}

/** The post-sale settings on a campaign, as stored. */
export interface CampaignLifecycle {
  audience: CampaignAudience;
  trigger_event: CampaignTrigger | null;
  trigger_offset_days: number;
}

/**
 * One automatic enrolment, recorded.
 *
 * Exists so "did we already do this?" has an answer that survives the
 * campaign_contacts row being reset for a second year.
 */
export interface LifecycleEnrolment {
  id: string;
  user_id: string;
  campaign_id: string;
  deal_id: string;
  contact_id: string;
  trigger_event: CampaignTrigger;
  /** The occasion: the renewal date, or the close date. */
  cycle_key: string;
  campaign_contact_id: string | null;
  enrolled_at: string;
}

/** What one pass of the trigger worker did, in words somebody can read. */
export interface LifecycleRunReport {
  /** Campaigns with an automatic trigger that were considered. */
  campaigns: number;
  /** Deals that matched a trigger and had not been enrolled for this cycle. */
  matched: number;
  enrolled: number;
  skipped: number;
  /** Grouped reasons, so a run that did nothing can explain itself. */
  reasons: Record<string, number>;
}
