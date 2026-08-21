import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { inferTimezone, emptyEnrolResult, ENROL_SKIP_SAMPLE } from '@lemlist/shared';
import type { EnrolResult, EnrolSkip, EnrolSkipReason } from '@lemlist/shared';
import { getPagination, formatPaginatedResponse } from '../utils/pagination.js';

export const campaignContactsService = {
  async list(campaignId: string, params: { page?: number; limit?: number }) {
    const { page, limit, from, to } = getPagination(params);

    const { data, count, error } = await supabaseAdmin
      .from('campaign_contacts')
      .select('*, contacts(email, first_name, last_name)', { count: 'exact' })
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw new AppError(error.message, 500);

    const formatted = (data || []).map((cc: any) => ({
      ...cc,
      contact: cc.contacts,
      contacts: undefined,
    }));

    return formatPaginatedResponse(formatted, count || 0, page, limit);
  },

  /**
   * Put contacts into a campaign, and say what actually happened.
   *
   * Every filter below existed already; what did not exist was any account
   * of them. The old version returned two numbers, and the first was wrong
   * — it counted people who were already enrolled as newly added, so
   * re-importing a list reported the full count and inserted nothing. The
   * second was a bare total with no reason, so the interface guessed, and
   * always guessed "already in other active campaigns".
   *
   * Two filters are new, and they matter more than the reporting: a contact
   * with no address, and a contact who unsubscribed or is suppressed, used
   * to be enrolled and then fail one at a time at send time. Refusing them
   * at the door is both kinder and quieter.
   */
  async add(campaignId: string, contactIds: string[]): Promise<EnrolResult> {
    if (!contactIds || contactIds.length === 0) return emptyEnrolResult();

    // 1. Look up the campaign's bound lead list
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id, user_id, list_id')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign) throw new AppError('Campaign not found', 404);

    const requested = Array.from(new Set(contactIds));
    const skips: EnrolSkip[] = [];
    const identify = new Map<string, { email: string | null; name: string | null }>();
    const drop = (id: string, reason: EnrolSkipReason, detail: string | null = null) => {
      const who = identify.get(id);
      skips.push({
        contact_id: id,
        email: who?.email ?? null,
        name: who?.name ?? null,
        reason,
        detail,
      });
    };

    // 2. Restrict to contacts actually owned by the campaign's user — never trust
    //    caller-supplied contact IDs across tenants.
    const { data: ownedContacts } = await supabaseAdmin
      .from('contacts')
      .select('id, email, first_name, last_name, is_unsubscribed, is_bounced')
      .eq('user_id', campaign.user_id)
      .in('id', requested);

    for (const c of ownedContacts || []) {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
      identify.set(c.id, { email: c.email || null, name: name || null });
    }

    const ownedById = new Map<string, any>((ownedContacts || []).map((c: any) => [c.id, c]));
    for (const id of requested) if (!ownedById.has(id)) drop(id, 'not_yours');

    let allowedContactIds = [...ownedById.keys()];
    if (allowedContactIds.length === 0) {
      throw new AppError('None of the selected contacts belong to this account', 400);
    }

    // 3. Nobody worth enrolling is missing an address, unsubscribed or bounced.
    //    These used to be enrolled and then fail at send time, one send at a
    //    time, which is how a campaign ends up with a bounce rate it did not
    //    have to have.
    allowedContactIds = allowedContactIds.filter((id) => {
      const c = ownedById.get(id);
      if (!c.email || !String(c.email).trim()) { drop(id, 'no_email'); return false; }
      if (c.is_unsubscribed) { drop(id, 'unsubscribed'); return false; }
      if (c.is_bounced) { drop(id, 'bounced'); return false; }
      return true;
    });

    // 4. And nobody on the suppression list, which is the same promise made
    //    once and kept everywhere.
    if (allowedContactIds.length > 0) {
      const emails = allowedContactIds
        .map((id) => String(ownedById.get(id).email).trim().toLowerCase())
        .filter(Boolean);
      const suppressed = new Set<string>();
      const PAGE = 200;
      for (let from = 0; from < emails.length; from += PAGE) {
        const { data: rows } = await supabaseAdmin
          .from('suppression_list')
          .select('email')
          .eq('user_id', campaign.user_id)
          .in('email', emails.slice(from, from + PAGE));
        for (const row of rows || []) if (row.email) suppressed.add(String(row.email).toLowerCase());
      }
      if (suppressed.size > 0) {
        allowedContactIds = allowedContactIds.filter((id) => {
          const email = String(ownedById.get(id).email).trim().toLowerCase();
          if (suppressed.has(email)) { drop(id, 'suppressed'); return false; }
          return true;
        });
      }
    }

    // 5. If the campaign is bound to a list, restrict to contacts in that list
    if (campaign.list_id && allowedContactIds.length > 0) {
      const { data: members } = await supabaseAdmin
        .from('list_contacts')
        .select('contact_id')
        .eq('list_id', campaign.list_id)
        .in('contact_id', allowedContactIds);
      const memberIds = new Set((members || []).map((m: any) => m.contact_id));
      allowedContactIds = allowedContactIds.filter((id) => {
        if (memberIds.has(id)) return true;
        drop(id, 'not_in_list');
        return false;
      });
    }

    // 6. Block contacts that are already in any OTHER active campaign of the same user
    //    if the other campaign is bound to a *different* list. (Same-list reuse is allowed.)
    const blockedBy = new Map<string, string | null>();
    if (allowedContactIds.length > 0) {
      const { data: otherEnrolments } = await supabaseAdmin
        .from('campaign_contacts')
        .select('contact_id, campaign_id, campaigns!inner(name, user_id, list_id, status)')
        .in('contact_id', allowedContactIds)
        .neq('campaign_id', campaignId);

      for (const row of otherEnrolments || []) {
        const otherCampaign: any = (row as any).campaigns;
        if (!otherCampaign) continue;
        // Only block if the other campaign is still active and bound to a different list
        const sameList = otherCampaign.list_id && campaign.list_id && otherCampaign.list_id === campaign.list_id;
        const otherActive = ['draft', 'scheduled', 'running', 'paused'].includes(otherCampaign.status);
        if (!sameList && otherActive && !blockedBy.has(row.contact_id)) {
          blockedBy.set(row.contact_id, otherCampaign.name || null);
        }
      }
    }

    const finalIds = allowedContactIds.filter((id) => {
      if (!blockedBy.has(id)) return true;
      drop(id, 'in_other_campaign', blockedBy.get(id) ?? null);
      return false;
    });

    // 7. Never overwrite a contact who's already enrolled in THIS campaign — an
    //    upsert on (campaign_id, contact_id) would silently reset their real
    //    progress (status/current_step_order) back to pending/0, e.g. when the
    //    same list is re-imported after some contacts already ran the sequence.
    let newIds: string[] = [];
    if (finalIds.length > 0) {
      const { data: alreadyEnrolled } = await supabaseAdmin
        .from('campaign_contacts')
        .select('contact_id')
        .eq('campaign_id', campaignId)
        .in('contact_id', finalIds);
      const alreadyEnrolledIds = new Set((alreadyEnrolled || []).map((r: any) => r.contact_id as string));
      newIds = finalIds.filter((id) => {
        if (!alreadyEnrolledIds.has(id)) return true;
        drop(id, 'already_enrolled');
        return false;
      });
    }

    if (newIds.length > 0) {
      // Place each contact on a clock at enrolment, so the campaign page can
      // say how much of the audience it can reach in local time *before* the
      // campaign runs, rather than discovering the coverage one send at a time.
      // Contacts it can't place are left null and fall back to the campaign's
      // own timezone, exactly as they did before this existed.
      const { data: locations } = await supabaseAdmin
        .from('contacts')
        .select('id, location')
        .in('id', newIds);
      const zoneByContact = new Map<string, string | null>(
        (locations || []).map((c: any) => [c.id, inferTimezone(c.location)]),
      );

      const rows = newIds.map((contactId) => ({
        campaign_id: campaignId,
        contact_id: contactId,
        status: 'pending',
        current_step_order: 0,
        contact_timezone: zoneByContact.get(contactId) ?? null,
      }));

      const { error } = await supabaseAdmin
        .from('campaign_contacts')
        .insert(rows);

      if (error) {
        // Pre-042 databases have no contact_timezone column. Enrolling people
        // matters more than placing them — retry without it.
        if (/contact_timezone/.test(error.message)) {
          const { error: retryError } = await supabaseAdmin
            .from('campaign_contacts')
            .insert(rows.map(({ contact_timezone, ...rest }) => rest));
          if (retryError) throw new AppError(retryError.message, 500);
        } else {
          throw new AppError(error.message, 500);
        }
      }
    }

    // Update campaign total_contacts
    const { count, error: countError } = await supabaseAdmin
      .from('campaign_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    if (!countError) {
      const { error: updateErr } = await supabaseAdmin
        .from('campaigns')
        .update({ total_contacts: count || 0 })
        .eq('id', campaignId);
      if (updateErr) {
        console.error('[CampaignContacts] Failed to update total_contacts for campaign', campaignId, ':', updateErr.message);
      }
    }

    const reasons: Partial<Record<EnrolSkipReason, number>> = {};
    for (const skip of skips) reasons[skip.reason] = (reasons[skip.reason] || 0) + 1;

    return {
      added: newIds.length,
      skipped: skips.length,
      total: count || 0,
      reasons,
      skips: skips.slice(0, ENROL_SKIP_SAMPLE),
    };
  },

  /**
   * One-call funnel: put contacts into the campaign's bound lead list (when
   * it has one) and enroll them. This is what "Add to campaign" from the
   * contacts page / prospector uses — callers shouldn't need to know that
   * campaigns are list-bound.
   */
  async enroll(campaignId: string, contactIds: string[]): Promise<EnrolResult> {
    if (!contactIds || contactIds.length === 0) {
      throw new AppError('No contacts selected', 400);
    }

    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id, user_id, list_id, status')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign) throw new AppError('Campaign not found', 404);
    if (['completed', 'cancelled'].includes(campaign.status)) {
      throw new AppError('This campaign has finished — pick an active or draft campaign.', 400);
    }

    // Only the campaign owner's contacts can ever be enrolled.
    const { data: ownedContacts } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('user_id', campaign.user_id)
      .in('id', contactIds);
    const ownedIds = (ownedContacts || []).map((c: any) => c.id as string);
    if (ownedIds.length === 0) {
      throw new AppError('None of the selected contacts belong to this account', 400);
    }

    // Membership first, so add()'s list restriction passes.
    if (campaign.list_id) {
      const rows = ownedIds.map((contactId) => ({ list_id: campaign.list_id, contact_id: contactId }));
      const { error: listError } = await supabaseAdmin
        .from('list_contacts')
        .upsert(rows, { onConflict: 'list_id,contact_id' });
      if (listError) throw new AppError(listError.message, 500);
    }

    // The full request goes on to add(), not just the owned slice, so that
    // anything belonging to another account is reported rather than vanishing.
    return this.add(campaignId, contactIds);
  },

  /**
   * Add every contact from the campaign's bound lead list. Use this when the
   * user clicks "Import from list" in the campaign builder.
   */
  async addAllFromBoundList(campaignId: string): Promise<EnrolResult> {
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id, list_id')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign) throw new AppError('Campaign not found', 404);
    if (!campaign.list_id) throw new AppError('This campaign is not bound to a lead list', 400);

    const { data: members } = await supabaseAdmin
      .from('list_contacts')
      .select('contact_id')
      .eq('list_id', campaign.list_id);
    const ids = (members || []).map((m: any) => m.contact_id);
    if (ids.length === 0) return emptyEnrolResult();

    return this.add(campaignId, ids);
  },

  async remove(campaignId: string, contactIds: string[]) {
    if (!Array.isArray(contactIds) || contactIds.length === 0) return;

    const { error } = await supabaseAdmin
      .from('campaign_contacts')
      .delete()
      .eq('campaign_id', campaignId)
      .in('contact_id', contactIds);

    if (error) throw new AppError(error.message, 500);

    const { count, error: countError } = await supabaseAdmin
      .from('campaign_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    if (!countError) {
      const { error: updateErr } = await supabaseAdmin
        .from('campaigns')
        .update({ total_contacts: count || 0 })
        .eq('id', campaignId);
      if (updateErr) {
        console.error('[CampaignContacts] Failed to update total_contacts for campaign', campaignId, ':', updateErr.message);
      }
    }
  },
};
