import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  renewalSummary,
  renewalBand,
  renewalValue,
  actionableDate,
  toIsoDate,
  type RenewalBandId,
  type RenewalDeal,
  type RenewalSummary,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The renewals book.

   Every B2B business runs one and almost none of them run it in software.
   It is a spreadsheet, or a set of calendar reminders, or somebody's
   memory - which is why the standard way to lose a customer is to notice
   the renewal a fortnight after it auto-renewed on their terms.

   Nothing here is new information. The term, the close date and the shape
   of the money were already recorded; this is the arithmetic nobody was
   doing, plus the two facts a renewals book actually needs and no deal
   pipeline stores: what happened when it came up, and what the renewal
   turned into.
   ═══════════════════════════════════════════════════════════════════════ */

/** Columns the renewals views read. Kept in one place so they cannot drift. */
const RENEWAL_SELECT = `
  id, title, company, contact_id, contact_name, contact_email,
  stage, value, currency, closed_at, term_months,
  recurring_amount, recurring_period, one_off_amount,
  renewal_date, renewal_status, renewal_notice_days, renewed_to_deal_id,
  source_campaign_id, attribution
`.replace(/\s+/g, ' ').trim();

/** Rows per page when walking the book. PostgREST caps around a thousand. */
const PAGE = 500;

async function ownedDeal(userId: string, dealId: string) {
  const { data } = await supabaseAdmin
    .from('deals')
    .select(RENEWAL_SELECT)
    .eq('id', dealId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw new AppError('Deal not found', 404);
  return data;
}

export const renewalsService = {
  /**
   * Every renewal still to be decided, oldest first.
   *
   * Paged through rather than capped, because a capped renewals book is a
   * renewals book that silently stops mentioning next year - and the whole
   * value of the page is that it is complete.
   */
  async list(userId: string, params: { band?: RenewalBandId; status?: string } = {}) {
    const status = params.status || 'upcoming';

    const all: any[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = supabaseAdmin
        .from('deals')
        .select(RENEWAL_SELECT)
        .eq('user_id', userId)
        .not('renewal_date', 'is', null)
        .order('renewal_date', { ascending: true })
        .range(from, from + PAGE - 1);

      query = status === 'all'
        ? query.not('renewal_status', 'is', null)
        : query.eq('renewal_status', status);

      const { data, error } = await query;
      if (error) throw new AppError(error.message, 500);
      all.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }

    const today = new Date();
    const rows = all.map((deal: any) => ({
      ...deal,
      band: renewalBand(deal as RenewalDeal, today),
      // Computed once, server-side, so the list and the totals can never
      // disagree about what one row is worth.
      renewal_value: renewalValue(deal as RenewalDeal),
      action_by: actionableDate(deal as RenewalDeal),
    }));

    return params.band ? rows.filter((r) => r.band === params.band) : rows;
  },

  /** What is coming up, when, and for how much. */
  async summary(userId: string): Promise<RenewalSummary> {
    const rows = await this.list(userId, { status: 'upcoming' });
    return renewalSummary(rows as RenewalDeal[], new Date());
  },

  /**
   * Correct the date, the notice period, or take the deal out of the book.
   *
   * A derived renewal date is a starting point, not a fact: contracts start
   * when they start, not when the paperwork was signed. Somebody has to be
   * able to say so, and saying so has to stick.
   */
  async update(userId: string, dealId: string, input: {
    renewal_date?: string | null;
    renewal_notice_days?: number | null;
    renewal_status?: string | null;
  }) {
    await ownedDeal(userId, dealId);

    const patch: Record<string, any> = {};

    if (input.renewal_date !== undefined) {
      const value = input.renewal_date;
      if (value === null || value === '') {
        patch.renewal_date = null;
        // A renewal with no date cannot be scheduled or chased, so it stops
        // being "upcoming" rather than sitting in the queue unactionable.
        patch.renewal_status = null;
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
          throw new AppError('A renewal date looks like 2027-01-15.', 400);
        }
        patch.renewal_date = value;
        patch.renewal_status = input.renewal_status ?? 'upcoming';
      }
    }

    if (input.renewal_notice_days !== undefined) {
      const notice = input.renewal_notice_days;
      if (notice === null || (notice as any) === '') {
        patch.renewal_notice_days = null;
      } else {
        const n = Number(notice);
        if (!Number.isFinite(n) || n < 0 || n > 365) {
          throw new AppError('A notice period is between 0 and 365 days.', 400);
        }
        patch.renewal_notice_days = Math.floor(n);
      }
    }

    if (input.renewal_status !== undefined && patch.renewal_status === undefined) {
      const known = ['upcoming', 'renewed', 'churned', 'not_applicable'];
      if (input.renewal_status !== null && !known.includes(input.renewal_status)) {
        throw new AppError(`Unknown renewal status "${input.renewal_status}"`, 400);
      }
      patch.renewal_status = input.renewal_status;
    }

    if (Object.keys(patch).length === 0) return ownedDeal(userId, dealId);

    const { error } = await supabaseAdmin
      .from('deals').update(patch).eq('id', dealId).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);

    return ownedDeal(userId, dealId);
  },

  /**
   * They renewed.
   *
   * Makes the next term as its own deal rather than moving the old one's
   * dates forward. Two reasons, and both of them are about not lying to the
   * reports: a deal that keeps being edited loses the history of what each
   * year was worth, and "won this quarter" would silently include a renewal
   * that closed two years ago.
   *
   * The new deal carries the attribution of the original, because revenue
   * from a customer the outreach won is still revenue that outreach won -
   * that is the whole argument for owning both halves, and dropping the
   * link at renewal is how every other tool loses it.
   */
  async markRenewed(userId: string, dealId: string, input: {
    term_months?: number | null;
    recurring_amount?: number | null;
    value?: number | null;
    closed_at?: string | null;
  } = {}) {
    const deal: any = await ownedDeal(userId, dealId);

    if (deal.renewal_status === 'renewed' && deal.renewed_to_deal_id) {
      // Already done. Pressing it twice must not make a second year's deal.
      const { data: existing } = await supabaseAdmin
        .from('deals').select(RENEWAL_SELECT)
        .eq('id', deal.renewed_to_deal_id).eq('user_id', userId).maybeSingle();
      return { deal, renewal: existing, created: false };
    }

    const closedAt = input.closed_at || deal.renewal_date || toIsoDate(new Date());
    const term = input.term_months ?? deal.term_months ?? null;
    const recurring = input.recurring_amount ?? deal.recurring_amount ?? null;

    const { data: createdRow, error } = await supabaseAdmin
      .from('deals')
      .insert({
        user_id: userId,
        title: `${deal.title} - renewal`,
        company: deal.company,
        contact_id: deal.contact_id,
        contact_name: deal.contact_name,
        contact_email: deal.contact_email,
        stage: 'won',
        closed_at: new Date(closedAt).toISOString(),
        currency: deal.currency,
        value: input.value ?? deal.value ?? 0,
        recurring_amount: recurring,
        recurring_period: deal.recurring_period,
        one_off_amount: null,
        term_months: term,
        // Where the relationship came from, carried forward. The renewal is
        // not a new opportunity that appeared from nowhere.
        source_campaign_id: deal.source_campaign_id ?? null,
        attribution: deal.attribution ?? null,
        source: 'Renewal',
      })
      .select(RENEWAL_SELECT)
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    // The select list is a string constant, so PostgREST cannot infer a row
    // shape for it and hands back a union that includes its error type.
    const created = createdRow as any;

    const { error: linkError } = await supabaseAdmin
      .from('deals')
      .update({ renewal_status: 'renewed', renewed_to_deal_id: created?.id ?? null })
      .eq('id', dealId)
      .eq('user_id', userId);
    if (linkError) throw new AppError(linkError.message, 500);

    return { deal: await ownedDeal(userId, dealId), renewal: created, created: true };
  },

  /**
   * They did not renew.
   *
   * Recorded rather than deleted, and the reason kept, because churn you
   * cannot count is churn you cannot fix. Deliberately does not suppress
   * anybody: a customer who left is the warmest lead most businesses have.
   */
  async markChurned(userId: string, dealId: string, reason?: string) {
    await ownedDeal(userId, dealId);

    const patch: Record<string, any> = { renewal_status: 'churned' };
    if (reason && String(reason).trim()) {
      patch.outcome_reason = String(reason).trim().slice(0, 200);
    }

    const { error } = await supabaseAdmin
      .from('deals').update(patch).eq('id', dealId).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);

    return ownedDeal(userId, dealId);
  },

  /**
   * What has actually been done about this renewal.
   *
   * A date with nothing next to it is a worry, not a plan. This is the
   * answer to "is anything running?" - the post-sale sequences this deal
   * has been enrolled into, and when.
   */
  async activity(userId: string, dealId: string) {
    await ownedDeal(userId, dealId);

    const { data, error } = await supabaseAdmin
      .from('lifecycle_enrolments')
      .select('id, campaign_id, contact_id, trigger_event, cycle_key, enrolled_at, campaigns(name, status)')
      .eq('deal_id', dealId)
      .eq('user_id', userId)
      .order('enrolled_at', { ascending: false })
      .limit(50);
    if (error) throw new AppError(error.message, 500);

    return (data || []).map((row: any) => ({
      id: row.id,
      campaign_id: row.campaign_id,
      campaign_name: row.campaigns?.name || null,
      campaign_status: row.campaigns?.status || null,
      contact_id: row.contact_id,
      trigger_event: row.trigger_event,
      cycle_key: row.cycle_key,
      enrolled_at: row.enrolled_at,
    }));
  },
};
