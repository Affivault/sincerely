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
  { id: 'prospect', label: 'Leads', hint: 'Sourced but never engaged. These are who campaigns are for.' },
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
  // Stored as 'prospect', called a lead everywhere a person reads it: the
  // page they live on is Leads, and two words for one thing was half of
  // why Leads and Contacts felt like the same screen.
  prospect: 'Lead',
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
  reply: 'they replied',
  meeting: 'a meeting was booked',
  lead: 'made a lead',
  deal: 'added to a deal',
  manual: 'added or moved by hand',
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

/* ═══════════════════════════════════════════════════════════════════════
   Two pages, two populations.

   Leads is the outbound side: people being sourced, verified and sequenced.
   Contacts is the CRM: people you have a relationship with. They are one
   table with a lifecycle column (055), and each page shows exactly one side
   of it - never both, and never with a toggle that lets one page turn into
   the other. A lead becomes a contact by replying, meeting you or being put
   on a deal, or by somebody pressing Convert.
   ═══════════════════════════════════════════════════════════════════════ */

export type PeoplePage = 'lead' | 'contact';

/** The lifecycles each page shows. Nothing is on both. */
export const PEOPLE_PAGE_LIFECYCLES: Record<PeoplePage, Lifecycle[]> = {
  lead: ['prospect'],
  contact: ['contact', 'customer'],
};

/** Which page somebody belongs on. */
export function peoplePageFor(lifecycle: Lifecycle | null | undefined): PeoplePage {
  return isEngaged(lifecycle) ? 'contact' : 'lead';
}

/** Where to send somebody who wants to see this person among their kind. */
export function peoplePageHref(lifecycle: Lifecycle | null | undefined): '/leads' | '/contacts' {
  return peoplePageFor(lifecycle) === 'contact' ? '/contacts' : '/leads';
}

/* ── Where a lead is in the outbound cycle ───────────────────────────── */

/**
 * The Leads page's own filter: has anybody started on this person yet.
 *
 * none        - in no campaign at all: sourced, not yet worked
 * in_sequence - waiting for or receiving a step somewhere
 * finished    - every sequence they were in has ended without a reply
 * replied     - answered a campaign (usually promoted to Contacts already;
 *               shown for the ones parked here by hand or with promotion off)
 */
export type LeadOutreach = 'none' | 'in_sequence' | 'finished' | 'replied';

export const LEAD_OUTREACH_LABEL: Record<LeadOutreach, string> = {
  none: 'Not contacted',
  in_sequence: 'In sequence',
  finished: 'Sequence ended',
  replied: 'Replied',
};

export const LEAD_OUTREACH_HINT: Record<LeadOutreach, string> = {
  none: 'In no campaign yet. Ready to be put into one.',
  in_sequence: 'A campaign is sending to them, or about to.',
  finished: 'Their sequence ran out without a reply.',
  replied: 'They answered a campaign.',
};

/** campaign_contacts.status values that mean a sequence is still working. */
export const OUTREACH_LIVE_STATUSES = ['pending', 'active', 'paused'] as const;
/** ...that mean it ended without a human answer. */
export const OUTREACH_ENDED_STATUSES = ['completed', 'auto_reply', 'bounced', 'unsubscribed', 'suppressed', 'error'] as const;

export interface OutreachEnrolment {
  status: string;
  current_step_order?: number | null;
  updated_at?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
}

export interface OutreachSummary {
  state: LeadOutreach;
  /** The enrolment the state was read from: the live one, else the latest. */
  campaign_id: string | null;
  campaign_name: string | null;
  step: number | null;
  /** How many campaigns they have been in, ever. */
  campaigns: number;
}

/**
 * One line for a lead's whole campaign history.
 *
 * A reply anywhere wins (it is the event that matters), then a live
 * sequence, then an ended one. Nothing at all is "Not contacted".
 */
export function summariseOutreach(rows: OutreachEnrolment[] | null | undefined): OutreachSummary {
  const list = (rows || []).filter((r) => r && typeof r.status === 'string');
  if (list.length === 0) return { state: 'none', campaign_id: null, campaign_name: null, step: null, campaigns: 0 };
  const newest = (a: OutreachEnrolment, b: OutreachEnrolment) =>
    new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
  const sorted = [...list].sort(newest);
  const pick = (pred: (r: OutreachEnrolment) => boolean) => sorted.find(pred);
  const replied = pick((r) => r.status === 'replied');
  const live = pick((r) => (OUTREACH_LIVE_STATUSES as readonly string[]).includes(r.status));
  const chosen = replied || live || sorted[0];
  const state: LeadOutreach = replied ? 'replied' : live ? 'in_sequence' : 'finished';
  return {
    state,
    campaign_id: chosen.campaign_id ?? null,
    campaign_name: chosen.campaign_name ?? null,
    step: state === 'in_sequence' && typeof chosen.current_step_order === 'number' ? chosen.current_step_order : null,
    campaigns: new Set(list.map((r) => r.campaign_id || '')).size,
  };
}

/* ── Where a contact is with you ─────────────────────────────────────── */

export interface ContactDealSummary {
  open: number;
  /** Sum of open deal values. Only meaningful when currency is set. */
  open_value: number;
  /** The open deals' currency, or null when they are in more than one. */
  currency: string | null;
  won: number;
}

export function summariseDeals(
  rows: { stage?: string | null; value?: number | string | null; currency?: string | null }[] | null | undefined,
): ContactDealSummary {
  const out: ContactDealSummary = { open: 0, open_value: 0, currency: null, won: 0 };
  const currencies = new Set<string>();
  for (const d of rows || []) {
    if (!d) continue;
    if (d.stage === 'won') out.won += 1;
    else if (d.stage !== 'lost') {
      out.open += 1;
      currencies.add(d.currency || 'USD');
      const v = Number(d.value);
      if (Number.isFinite(v)) out.open_value += v;
    }
  }
  // Adding dollars to euros gives a number that means nothing; say none.
  out.currency = currencies.size === 1 ? [...currencies][0] : null;
  if (!out.currency) out.open_value = 0;
  return out;
}
