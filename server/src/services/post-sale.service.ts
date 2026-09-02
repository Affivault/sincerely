import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { toIsoDate, type CampaignTrigger, type LifecycleRunReport } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Sequences that start themselves, from what happened to the deal.

   This is the half of the market nobody serves. An outreach tool stops at
   the reply because it has never heard of a deal. A CRM knows the deal and
   then hands you a list to export into something else, so the renewal
   becomes a diary note that gets snoozed. Here the deal and the sending are
   the same system, so the renewal can simply arrive.

   The hard part is not the scheduling. It is that every enrolment guard in
   this app was written for cold outreach and two of them refuse exactly the
   people a post-sale sequence is for:

     on_open_deal      - never pitch somebody mid-negotiation
     crm_contact_only  - never cold-email somebody filed as a relationship

   Both are right for a pitch and wrong for a renewal, where being a
   customer is the entry condition. They are opened here deliberately, for
   campaigns that have said in the database that they are post-sale, and
   nowhere else. What is NOT opened is the suppression list: somebody who
   asked not to be emailed is not emailed, customer or not. That is the one
   promise this app makes to people who are not its users, and a renewal is
   not a good enough reason to break it.
   ═══════════════════════════════════════════════════════════════════════ */

/** Why somebody on a deal did not get enrolled. Reported, never silent. */
export type PostSaleSkipReason =
  | 'no_email'
  | 'unsubscribed'
  | 'bounced'
  | 'suppressed'
  | 'already_enrolled'
  | 'in_other_post_sale';

export interface PostSaleEnrolResult {
  enrolled: number;
  skipped: number;
  reasons: Partial<Record<PostSaleSkipReason, number>>;
  /** The contacts actually put into the sequence. */
  contact_ids: string[];
}

/** Campaign statuses that mean "this sequence is live and should fire". */
const LIVE_STATUSES = ['running', 'scheduled'];

/**
 * Does this campaign fill its own audience from the CRM?
 *
 * Exported because `launch` has to know. Every campaign before this one had
 * to have at least one contact before it could start, which is right for a
 * list you built by hand and fatal for a sequence whose entire purpose is to
 * be empty until a deal is won. Without the exemption no post-sale campaign
 * can ever be launched, and the feature ships unusable with every test
 * still green.
 */
export function fillsItselfFromCrm(campaign: {
  audience?: string | null;
  trigger_event?: string | null;
}): boolean {
  return campaign.audience === 'post_sale'
    && !!campaign.trigger_event
    && campaign.trigger_event !== 'manual';
}

/**
 * Everybody this deal is about.
 *
 * The named contact plus every participant, because a renewal conversation
 * that only reaches the person who signed last year is a renewal
 * conversation that reaches somebody who has left.
 */
export async function contactsOnDeal(userId: string, dealId: string): Promise<string[]> {
  const ids = new Set<string>();

  const { data: deal } = await supabaseAdmin
    .from('deals')
    .select('contact_id')
    .eq('id', dealId)
    .eq('user_id', userId)
    .maybeSingle();
  if (deal?.contact_id) ids.add(deal.contact_id);

  const { data: participants } = await supabaseAdmin
    .from('deal_participants')
    .select('contact_id')
    .eq('deal_id', dealId)
    .eq('user_id', userId);
  for (const p of participants || []) if (p.contact_id) ids.add(p.contact_id);

  return [...ids];
}

/**
 * The date that identifies this occasion.
 *
 * A renewal recurs, so "have we done this already?" is only answerable
 * against a particular one. The renewal date is that key; for a won or lost
 * deal the close date is, because a deal is only won once.
 */
export function cycleKeyFor(trigger: CampaignTrigger, deal: any): string | null {
  if (trigger === 'renewal_due') return deal.renewal_date || null;
  if (!deal.closed_at) return null;
  return toIsoDate(new Date(deal.closed_at));
}

/**
 * Put the people on a deal into a post-sale sequence, once.
 *
 * Deliberately does not reuse campaignContactsService.add: that function is
 * the cold path and its guards are the cold guards. Calling it with a flag
 * to disable half of them would put the most consequential decision in this
 * app - does this sequence reach customers? - behind a boolean argument
 * somebody could pass by accident.
 */
export async function enrolFromDeal(
  userId: string,
  campaign: { id: string; audience?: string | null; trigger_event?: string | null },
  deal: { id: string },
  cycleKey: string,
): Promise<PostSaleEnrolResult> {
  if (campaign.audience !== 'post_sale') {
    throw new AppError('Only a customer campaign can be enrolled from a deal.', 400);
  }

  const reasons: Partial<Record<PostSaleSkipReason, number>> = {};
  const drop = (reason: PostSaleSkipReason) => { reasons[reason] = (reasons[reason] || 0) + 1; };

  const candidateIds = await contactsOnDeal(userId, deal.id);
  if (candidateIds.length === 0) {
    return { enrolled: 0, skipped: 0, reasons, contact_ids: [] };
  }

  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, email, is_unsubscribed, is_bounced')
    .eq('user_id', userId)
    .in('id', candidateIds);

  let allowed: any[] = [];
  for (const c of contacts || []) {
    if (!c.email || !String(c.email).trim()) { drop('no_email'); continue; }
    if (c.is_unsubscribed) { drop('unsubscribed'); continue; }
    if (c.is_bounced) { drop('bounced'); continue; }
    allowed.push(c);
  }

  /*
   * The suppression list is not opened for post-sale.
   *
   * It is tempting: somebody suppressed during a cold campaign two years
   * ago who then became a customer will never get their renewal email. But
   * the alternative is an app that quietly decides a "stop emailing me" has
   * expired, and there is no version of that which is defensible. Reported
   * as a skip so the person running it can see the cost and lift the
   * suppression themselves if it is genuinely stale.
   */
  if (allowed.length > 0) {
    const emails = allowed.map((c) => String(c.email).trim().toLowerCase());
    const { data: rows } = await supabaseAdmin
      .from('suppression_list')
      .select('email')
      .eq('user_id', userId)
      .in('email', emails);
    const suppressed = new Set((rows || []).map((r: any) => String(r.email).toLowerCase()));
    if (suppressed.size > 0) {
      allowed = allowed.filter((c) => {
        if (suppressed.has(String(c.email).trim().toLowerCase())) { drop('suppressed'); return false; }
        return true;
      });
    }
  }

  /*
   * Already done, for this occasion.
   *
   * The ledger rather than campaign_contacts, because campaign_contacts is
   * unique on (campaign, contact) and cannot tell this year's renewal from
   * last year's. Checked here as well as being enforced by the unique index,
   * so the ordinary case is a read rather than a caught constraint error.
   */
  if (allowed.length > 0) {
    const { data: already } = await supabaseAdmin
      .from('lifecycle_enrolments')
      .select('contact_id')
      .eq('campaign_id', campaign.id)
      .eq('deal_id', deal.id)
      .eq('cycle_key', cycleKey)
      .in('contact_id', allowed.map((c) => c.id));
    const done = new Set((already || []).map((r: any) => r.contact_id));
    if (done.size > 0) {
      allowed = allowed.filter((c) => {
        if (done.has(c.id)) { drop('already_enrolled'); return false; }
        return true;
      });
    }
  }

  /*
   * Not in two post-sale sequences about the same deal at once.
   *
   * The cold path blocks anybody in any other active campaign. That is far
   * too wide here - a customer sitting in some unrelated campaign must not
   * block their renewal - but "onboarding and renewal firing at the same
   * person in the same week" is a real way to look automated.
   */
  if (allowed.length > 0) {
    const { data: others } = await supabaseAdmin
      .from('lifecycle_enrolments')
      .select('contact_id, campaign_contact_id, campaigns!inner(status)')
      .eq('deal_id', deal.id)
      .neq('campaign_id', campaign.id)
      .in('contact_id', allowed.map((c) => c.id))
      .in('campaigns.status', LIVE_STATUSES);

    const busy = new Set<string>();
    for (const row of others || []) {
      if (row.contact_id) busy.add(row.contact_id);
    }
    if (busy.size > 0) {
      allowed = allowed.filter((c) => {
        if (busy.has(c.id)) { drop('in_other_post_sale'); return false; }
        return true;
      });
    }
  }

  const enrolledIds: string[] = [];
  for (const contact of allowed) {
    /*
     * A contact who ran this sequence for a previous cycle already has a
     * campaign_contacts row, and that table is unique on (campaign,
     * contact). Their finished run is reset so this year's can start; the
     * history is not lost, because campaign_activities keeps a row per send
     * and the ledger keeps a row per cycle.
     *
     * Only ever a run that has finished. Somebody mid-sequence is left
     * alone, and somebody who unsubscribed or bounced is never restarted -
     * resetting those would be the app un-remembering a "no".
     */
    const { data: existing } = await supabaseAdmin
      .from('campaign_contacts')
      .select('id, status')
      .eq('campaign_id', campaign.id)
      .eq('contact_id', contact.id)
      .maybeSingle();

    if (existing && !['completed', 'replied'].includes(existing.status)) {
      drop('already_enrolled');
      continue;
    }

    /*
     * The ledger row is claimed BEFORE anybody is put into the sequence,
     * and its unique index is what actually decides.
     *
     * Written the other way round first - enrol, then record - which read
     * more naturally and was wrong. Two workers ticking together both pass
     * the read check above, both enrol, and only then does one of them lose
     * on the index, having already reset a live contact back to step one.
     * Claiming first means the loser has touched nothing at all.
     */
    const { data: claimRow, error: ledgerError } = await supabaseAdmin
      .from('lifecycle_enrolments')
      .insert({
        user_id: userId,
        campaign_id: campaign.id,
        deal_id: deal.id,
        contact_id: contact.id,
        trigger_event: campaign.trigger_event || 'manual',
        cycle_key: cycleKey,
      })
      .select('id')
      .maybeSingle();

    if (ledgerError) {
      drop('already_enrolled');
      continue;
    }
    const claimId = (claimRow as any)?.id ?? null;

    let campaignContactId: string | null = null;

    if (existing) {
      const { data: reset } = await supabaseAdmin
        .from('campaign_contacts')
        .update({
          status: 'pending',
          current_step_order: 0,
          next_send_at: new Date().toISOString(),
          completed_at: null,
          error_message: null,
        })
        .eq('id', existing.id)
        .select('id')
        .maybeSingle();
      campaignContactId = (reset as any)?.id ?? existing.id;
    } else {
      const { data: created, error } = await supabaseAdmin
        .from('campaign_contacts')
        .insert({
          campaign_id: campaign.id,
          contact_id: contact.id,
          status: 'pending',
          current_step_order: 0,
          // Due immediately: the worker enrols when the offset says it is
          // time, so the wait has already happened. Scheduling it forward
          // again here would double the delay.
          next_send_at: new Date().toISOString(),
        })
        .select('id')
        .maybeSingle();

      if (error || !created) {
        // The claim is released rather than left behind: a ledger row with
        // nobody in the sequence would block this cycle forever.
        if (claimId) await supabaseAdmin.from('lifecycle_enrolments').delete().eq('id', claimId);
        throw new AppError(error?.message || 'Could not enrol into the sequence', 500);
      }
      campaignContactId = (created as any).id;
    }

    // Point the claim at the row it drove, so a send can be traced back.
    if (claimId && campaignContactId) {
      await supabaseAdmin
        .from('lifecycle_enrolments')
        .update({ campaign_contact_id: campaignContactId })
        .eq('id', claimId);
    }

    enrolledIds.push(contact.id);
  }

  const requested = candidateIds.length;
  return {
    enrolled: enrolledIds.length,
    skipped: requested - enrolledIds.length,
    reasons,
    contact_ids: enrolledIds,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   The pass that makes it automatic.
   ═══════════════════════════════════════════════════════════════════════ */

/** Deals that a trigger says are due, for one campaign. */
async function dueDealsFor(campaign: any): Promise<any[]> {
  const trigger = campaign.trigger_event as CampaignTrigger;
  const offset = Number(campaign.trigger_offset_days) || 0;

  if (trigger === 'renewal_due') {
    /*
     * "Renewals whose start date has arrived." The offset counts backwards
     * from the renewal, so a 90-day offset means every renewal dated within
     * the next 90 days is due to start now.
     *
     * Overdue renewals are included on purpose: a renewal that slipped past
     * without anybody noticing is the one that most needs an email, and
     * excluding it would mean the sequence silently never runs for exactly
     * the deals it would have helped most.
     */
    const through = new Date();
    through.setDate(through.getDate() + offset);
    const { data } = await supabaseAdmin
      .from('deals')
      .select('id, user_id, title, renewal_date, closed_at, renewal_status')
      .eq('user_id', campaign.user_id)
      .eq('renewal_status', 'upcoming')
      .not('renewal_date', 'is', null)
      .lte('renewal_date', toIsoDate(through))
      .order('renewal_date', { ascending: true })
      .limit(200);
    return data || [];
  }

  // deal_won / deal_lost: N days after the deal closed.
  const stage = trigger === 'deal_won' ? 'won' : 'lost';
  const since = new Date();
  since.setDate(since.getDate() - offset);
  /*
   * Bounded at the near end only. Without a far end, turning a win-back
   * campaign on would enrol every deal ever lost, all at once - which is
   * both a mailbomb and a very fast way to a spam complaint. Ninety days of
   * history is "recent enough to be about this", and anything older is a
   * deliberate act somebody can do by hand.
   */
  const floor = new Date(since);
  floor.setDate(floor.getDate() - 90);
  const { data } = await supabaseAdmin
    .from('deals')
    .select('id, user_id, title, renewal_date, closed_at, stage')
    .eq('user_id', campaign.user_id)
    .eq('stage', stage)
    .not('closed_at', 'is', null)
    .lte('closed_at', since.toISOString())
    .gte('closed_at', floor.toISOString())
    .order('closed_at', { ascending: false })
    .limit(200);
  return data || [];
}

/**
 * One pass of the trigger engine.
 *
 * Runs on the same heartbeat as the sequence worker. Deliberately reports
 * what it did rather than logging a count: "0 enrolled" with no reason is
 * the single most common way an automation is quietly broken for a month.
 */
export async function processLifecycleTriggers(): Promise<LifecycleRunReport> {
  const report: LifecycleRunReport = {
    campaigns: 0, matched: 0, enrolled: 0, skipped: 0, reasons: {},
  };

  const { data: campaigns, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, user_id, name, status, audience, trigger_event, trigger_offset_days')
    .eq('audience', 'post_sale')
    .in('trigger_event', ['deal_won', 'renewal_due', 'deal_lost'])
    .in('status', LIVE_STATUSES)
    .limit(100);

  if (error) {
    console.error('[Lifecycle] Could not read triggered campaigns:', error.message);
    return report;
  }

  for (const campaign of campaigns || []) {
    report.campaigns += 1;
    let deals: any[] = [];
    try {
      deals = await dueDealsFor(campaign);
    } catch (err: any) {
      console.error(`[Lifecycle] Could not find deals for "${campaign.name}":`, err?.message);
      continue;
    }

    for (const deal of deals) {
      const cycleKey = cycleKeyFor(campaign.trigger_event as CampaignTrigger, deal);
      if (!cycleKey) continue;
      report.matched += 1;

      try {
        const result = await enrolFromDeal(campaign.user_id, campaign, deal, cycleKey);
        report.enrolled += result.enrolled;
        report.skipped += result.skipped;
        for (const [reason, count] of Object.entries(result.reasons)) {
          report.reasons[reason] = (report.reasons[reason] || 0) + (count as number);
        }
      } catch (err: any) {
        // One deal that cannot be enrolled must not stop the other hundred.
        report.skipped += 1;
        report.reasons.error = (report.reasons.error || 0) + 1;
        console.error(`[Lifecycle] Deal ${deal.id} on "${campaign.name}":`, err?.message);
      }
    }
  }

  return report;
}
