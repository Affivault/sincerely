import type { DealLabel } from './crm.types.js';

/* ═══════════════════════════════════════════════════════════════════════
   Somewhere for a lead to be before it is a deal.

   Somebody replies "interesting, send me more" and there were two options,
   both wrong. Leave them as a contact and they are invisible to the
   pipeline and forgotten about. Create a deal and the forecast now holds a
   tyre-kicker: the first stage fills with things nobody has qualified, and
   every conversion rate and stage duration measured against it becomes a
   lie about how the business is doing.

   So a lead sits outside the pipeline until somebody decides it is real.
   The distinction is not bureaucracy — it is what keeps the pipeline
   numbers worth reading.
   ═══════════════════════════════════════════════════════════════════════ */

export type LeadStatus = 'open' | 'converted' | 'archived';

export interface Lead {
  id: string;
  user_id: string;
  contact_id: string;
  title: string;
  company: string | null;
  company_id: string | null;
  /** An estimate at best, and deliberately optional. */
  value: number | null;
  currency: string;
  label: DealLabel | null;
  /** Where it came from: a campaign, LinkedIn, a referral, inbound. */
  source: string | null;
  /** The campaign that produced it, when one did. */
  campaign_id: string | null;
  note: string | null;
  status: LeadStatus;
  converted_deal_id: string | null;
  converted_at: string | null;
  archived_reason: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for display. */
  contact?: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    company_id: string | null;
    job_title: string | null;
  } | null;
}

export interface CreateLeadInput {
  contact_id: string;
  title?: string | null;
  company?: string | null;
  value?: number | string | null;
  label?: DealLabel | null;
  source?: string | null;
  campaign_id?: string | null;
  note?: string | null;
}

export type UpdateLeadInput = Partial<Omit<CreateLeadInput, 'contact_id'>>;

/**
 * Why a lead was dropped without becoming a deal.
 *
 * A fixed list for the same reason deal outcomes are: "not a fit" nine
 * times is a finding about who you are targeting; nine differently worded
 * sentences are nine sentences.
 */
export const LEAD_ARCHIVE_REASONS = [
  'Not a fit',
  'No budget',
  'Bad timing',
  'Went quiet',
  'Wrong person',
  'Already a customer',
  'Competitor',
] as const;

/** Sources offered in the picker. Free text is still allowed. */
export const LEAD_SOURCES = [
  'Campaign reply',
  'LinkedIn',
  'Inbound',
  'Referral',
  'Event',
  'Manual',
] as const;

export interface LeadFunnel {
  open: number;
  converted: number;
  archived: number;
  /** Converted over converted-plus-archived, as a percentage. */
  conversionRate: number | null;
  /** Estimated value sitting in open leads. */
  openValue: number;
}

/**
 * How the top of the funnel is doing.
 *
 * Deliberately measured over leads that have been *decided* — converted
 * plus archived. Including open leads in the denominator would make the
 * rate fall every time somebody adds a lead and rise every time they
 * archive a batch, which is the opposite of what it should do.
 */
export function summariseLeads(leads: Pick<Lead, 'status' | 'value'>[]): LeadFunnel {
  const out: LeadFunnel = { open: 0, converted: 0, archived: 0, conversionRate: null, openValue: 0 };
  for (const lead of leads) {
    if (lead.status === 'open') {
      out.open += 1;
      out.openValue += Number(lead.value) || 0;
    } else if (lead.status === 'converted') out.converted += 1;
    else if (lead.status === 'archived') out.archived += 1;
  }
  const decided = out.converted + out.archived;
  out.conversionRate = decided > 0 ? Math.round((out.converted / decided) * 100) : null;
  return out;
}

/**
 * How long a lead has been sitting undecided.
 *
 * A lead that arrived three weeks ago and has not been looked at is worse
 * than no lead: somebody answered, and nobody answered back.
 */
export const LEAD_STALE_DAYS = 7;

export function leadIsStale(lead: Pick<Lead, 'status' | 'created_at'>, now = Date.now()): boolean {
  if (lead.status !== 'open') return false;
  const at = new Date(lead.created_at).getTime();
  if (!Number.isFinite(at)) return false;
  return (now - at) / 86_400_000 > LEAD_STALE_DAYS;
}
