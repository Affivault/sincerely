import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
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

  async add(campaignId: string, contactIds: string[]) {
    if (!contactIds || contactIds.length === 0) return;

    // 1. Look up the campaign's bound lead list
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id, user_id, list_id')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign) throw new AppError('Campaign not found', 404);

    // 2. Restrict to contacts actually owned by the campaign's user — never trust
    //    caller-supplied contact IDs across tenants.
    const { data: ownedContacts } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('user_id', campaign.user_id)
      .in('id', contactIds);
    let allowedContactIds = (ownedContacts || []).map((c: any) => c.id as string);
    if (allowedContactIds.length === 0) {
      throw new AppError('None of the selected contacts belong to this account', 400);
    }

    // 3. If the campaign is bound to a list, restrict to contacts in that list
    if (campaign.list_id) {
      const { data: members } = await supabaseAdmin
        .from('list_contacts')
        .select('contact_id')
        .eq('list_id', campaign.list_id)
        .in('contact_id', allowedContactIds);
      const memberIds = new Set((members || []).map((m: any) => m.contact_id));
      allowedContactIds = allowedContactIds.filter((id) => memberIds.has(id));
      if (allowedContactIds.length === 0) {
        throw new AppError(
          'Selected contacts are not in this campaign\'s lead list. Add them to the list first.',
          400
        );
      }
    }

    // 4. Block contacts that are already in any OTHER active campaign of the same user
    //    if the other campaign is bound to a *different* list. (Same-list reuse is allowed.)
    const { data: otherEnrolments } = await supabaseAdmin
      .from('campaign_contacts')
      .select('contact_id, campaign_id, campaigns!inner(user_id, list_id, status)')
      .in('contact_id', allowedContactIds)
      .neq('campaign_id', campaignId);

    const blockedIds = new Set<string>();
    for (const row of otherEnrolments || []) {
      const otherCampaign: any = (row as any).campaigns;
      if (!otherCampaign) continue;
      // Only block if the other campaign is still active and bound to a different list
      const sameList = otherCampaign.list_id && campaign.list_id && otherCampaign.list_id === campaign.list_id;
      const otherActive = ['draft', 'scheduled', 'running', 'paused'].includes(otherCampaign.status);
      if (!sameList && otherActive) blockedIds.add(row.contact_id);
    }

    const finalIds = allowedContactIds.filter((id) => !blockedIds.has(id));
    if (finalIds.length === 0) {
      throw new AppError(
        'All selected contacts are already enrolled in other active campaigns with different lead lists.',
        400
      );
    }

    // 5. Never overwrite a contact who's already enrolled in THIS campaign — an
    //    upsert on (campaign_id, contact_id) would silently reset their real
    //    progress (status/current_step_order) back to pending/0, e.g. when the
    //    same list is re-imported after some contacts already ran the sequence.
    const { data: alreadyEnrolled } = await supabaseAdmin
      .from('campaign_contacts')
      .select('contact_id')
      .eq('campaign_id', campaignId)
      .in('contact_id', finalIds);
    const alreadyEnrolledIds = new Set((alreadyEnrolled || []).map((r: any) => r.contact_id as string));
    const newIds = finalIds.filter((id) => !alreadyEnrolledIds.has(id));

    if (newIds.length > 0) {
      const rows = newIds.map((contactId) => ({
        campaign_id: campaignId,
        contact_id: contactId,
        status: 'pending',
        current_step_order: 0,
      }));

      const { error } = await supabaseAdmin
        .from('campaign_contacts')
        .insert(rows);

      if (error) throw new AppError(error.message, 500);
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

    return { added: finalIds.length, skipped: contactIds.length - finalIds.length, total: count || 0 };
  },

  /**
   * Add every contact from the campaign's bound lead list. Use this when the
   * user clicks "Import from list" in the campaign builder.
   */
  async addAllFromBoundList(campaignId: string) {
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
    if (ids.length === 0) return { added: 0, skipped: 0, total: 0 };

    return this.add(campaignId, ids);
  },

  async remove(campaignId: string, contactIds: string[]) {
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
