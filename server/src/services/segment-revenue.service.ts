import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { chunk, selectInChunks } from '../utils/batch.js';
import {
  segmentRevenue, seniorityOf, sizeBandOf, dealValue, isOpen,
  type SegmentDimension, type SegmentMember,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   What the people who buy have in common.

   The revenue report answers "which campaign earned money". This answers
   the question that decides the next list: industry, size, seniority,
   where they came from. It is the closed loop, and it is the one thing a
   two-product stack cannot do - the replies live in one company's
   database and the revenue in another's.

   The shape of the query is the whole argument. It starts from CONTACTS
   REACHED rather than from deals, because a report built from deals
   alone has no denominator: "fintech won us 80k" means nothing without
   "out of how many fintech contacts we mailed", and the version without
   the denominator recommends whichever industry you happen to have
   mailed most.

   All the deciding - what may be reported as a rate, what may be called
   a lift, what the verdict says - is in shared/segment-revenue, where it
   can be asserted against plain numbers rather than by staring at a
   dashboard and hoping.
   ═══════════════════════════════════════════════════════════════════════ */

/** How far back to look. A win from two years ago is not this quarter's ICP. */
const WINDOW_DAYS = 365;
/** Guard the fan-out on a large account. */
const MAX_CONTACTS = 5000;

type ContactRow = {
  id: string;
  company_id: string | null;
  job_title: string | null;
  location: string | null;
  source: string | null;
};

type DealRow = {
  contact_id: string | null;
  stage: string;
  value: number | null;
  recurring_amount: number | null;
  recurring_period: string | null;
  one_off_amount: number | null;
  term_months: number | null;
};

/** Page through a filtered set without silently truncating at 1000. */
async function fetchAll<T>(
  build: (from: number, to: number) => any, pageSize = 1000, cap = MAX_CONTACTS,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new AppError(error.message, 500);
    const page = (data || []) as T[];
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

export const segmentRevenueService = {
  /**
   * Group everyone who was reached by one attribute, and see who bought.
   *
   * @param campaignId narrow to a single campaign, or null for the account
   */
  async report(userId: string, dimension: SegmentDimension, campaignId?: string | null) {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    /*
     * Who was actually mailed. This is the denominator, and it is the
     * reason this service exists rather than a GROUP BY over deals.
     */
    let enrolQuery = supabaseAdmin
      .from('campaign_contacts')
      .select('contact_id, campaign_id, status, campaigns!inner(user_id)')
      .eq('campaigns.user_id', userId)
      .gte('created_at', since);
    if (campaignId) enrolQuery = enrolQuery.eq('campaign_id', campaignId);

    const enrolments = await fetchAll<{ contact_id: string; status: string }>(
      (from, to) => enrolQuery.range(from, to),
    );

    /*
     * One row per contact, not per enrolment. Somebody in three campaigns
     * was reached once as far as "who buys" is concerned - counting them
     * three times would weight whoever is most mailed, which is the
     * opposite of what this is for.
     */
    const repliedBy = new Map<string, boolean>();
    for (const e of enrolments) {
      if (!e.contact_id) continue;
      const replied = e.status === 'replied';
      repliedBy.set(e.contact_id, (repliedBy.get(e.contact_id) || false) || replied);
    }
    const contactIds = [...repliedBy.keys()];

    if (contactIds.length === 0) {
      return segmentRevenue([], dimension);
    }

    /*
     * In slices. Five thousand ids in one `in` list is a URL of nearly
     * 200KB, which the gateway refuses long before the database sees it -
     * so this report failed for exactly the accounts with enough data to
     * make it worth reading.
     */
    const reached = contactIds.slice(0, MAX_CONTACTS);
    const contacts = await selectInChunks<string, ContactRow>(reached, (slice) =>
      supabaseAdmin
        .from('contacts')
        .select('id, company_id, job_title, location, source')
        .eq('user_id', userId)
        .in('id', slice));

    // Company attributes, for the dimensions that live there.
    const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean) as string[])];
    const companies = new Map<string, { industry: string | null; size: string | null; location: string | null }>();
    if (companyIds.length > 0 && (dimension === 'industry' || dimension === 'size' || dimension === 'location')) {
      const rows = await selectInChunks<string, { id: string; industry: string | null; size: string | null; location: string | null }>(
        companyIds, (slice) => supabaseAdmin
          .from('companies')
          .select('id, industry, size, location')
          .eq('user_id', userId)
          .in('id', slice));
      for (const r of rows) companies.set(r.id, r);
    }

    const deals: DealRow[] = [];
    for (const slice of chunk(reached)) {
      deals.push(...await fetchAll<DealRow>((from, to) =>
        supabaseAdmin
          .from('deals')
          .select('contact_id, stage, value, probability, recurring_amount, recurring_period, one_off_amount, term_months')
          .eq('user_id', userId)
          .in('contact_id', slice)
          .range(from, to)));
    }

    const dealsByContact = new Map<string, DealRow[]>();
    for (const d of deals) {
      if (!d.contact_id) continue;
      dealsByContact.set(d.contact_id, [...(dealsByContact.get(d.contact_id) ?? []), d]);
    }

    const members: SegmentMember[] = contacts.map((contact) => {
      const company = contact.company_id ? companies.get(contact.company_id) : undefined;
      const mine = dealsByContact.get(contact.id) ?? [];

      let won = 0, lost = 0, open = 0, wonValue = 0;
      for (const d of mine) {
        if (d.stage === 'won') {
          won++;
          // dealValue, so a deal shaped as recurring plus one-off is worth
          // what the pipeline board says it is worth. Two totals for one
          // deal is how a revenue report loses its reader.
          wonValue += dealValue(d as any);
        } else if (d.stage === 'lost') lost++;
        else if (isOpen(d.stage as any)) open++;
      }

      return {
        value: bucketFor(dimension, contact, company),
        replied: repliedBy.get(contact.id) || false,
        won, lost, open, wonValue,
      };
    });

    return segmentRevenue(members, dimension);
  },
};

/**
 * Which bucket one contact falls in.
 *
 * Returns null wherever the attribute is genuinely unknown, which the
 * shared roll-up counts separately rather than sweeping into an "Other"
 * row - a big confident segment made entirely of missing data is a
 * segment that then wins.
 */
function bucketFor(
  dimension: SegmentDimension,
  contact: ContactRow,
  company?: { industry: string | null; size: string | null; location: string | null },
): string | null {
  switch (dimension) {
    case 'industry':
      return (company?.industry || '').trim() || null;
    case 'size':
      return sizeBandOf(company?.size);
    case 'location':
      // The company's, falling back to the contact's own.
      return (company?.location || contact.location || '').trim() || null;
    case 'seniority':
      return seniorityOf(contact.job_title);
    case 'source':
      return (contact.source || '').trim() || null;
    default:
      return null;
  }
}
