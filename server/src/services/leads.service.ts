import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { crmService } from './crm.service.js';
import { promoteToContact } from './lifecycle.service.js';

/* ═══════════════════════════════════════════════════════════════════════
   Leads: the holding area between a reply and a forecast.

   The whole point is that a lead is NOT in the pipeline. Conversion rates,
   stage durations and weighted forecasts are only worth reading if the
   things being measured have all been qualified by somebody; the moment
   unqualified replies are allowed to sit in the first stage, every one of
   those numbers describes a business that does not exist.
   ═══════════════════════════════════════════════════════════════════════ */

const LEAD_SELECT =
  '*, contact:contacts(id, email, first_name, last_name, company, company_id, job_title)';

const LEAD_KEYS = ['title', 'company', 'company_id', 'value', 'currency', 'label', 'source', 'campaign_id', 'note'] as const;
const LABELS = ['hot', 'warm', 'cold'];

function pick(body: any, keys: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

function sanitize(input: Record<string, any>) {
  if (typeof input.title === 'string') input.title = input.title.trim().slice(0, 200);
  if (typeof input.company === 'string') input.company = input.company.trim().slice(0, 120) || null;
  if (typeof input.source === 'string') input.source = input.source.trim().slice(0, 80) || null;
  if (typeof input.note === 'string') input.note = input.note.trim().slice(0, 2000) || null;

  if (input.value === '' || input.value === null) {
    input.value = null;
  } else if (input.value !== undefined) {
    const n = Number(input.value);
    if (!Number.isFinite(n) || n < 0) throw new AppError('Lead value must be a non-negative number', 400);
    input.value = n;
  }

  if (input.label === '' || input.label === null) {
    input.label = null;
  } else if (input.label !== undefined && !LABELS.includes(input.label)) {
    throw new AppError(`Label must be one of ${LABELS.join(', ')}`, 400);
  }
}

async function assertOwned(userId: string, table: string, id: string, label: string) {
  const { data } = await supabaseAdmin.from(table).select('id').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!data) throw new AppError(`${label} not found`, 404);
}

export const leadsService = {
  /**
   * The inbox. Open by default, because that is the only status anybody
   * works from; the others are history and are asked for explicitly.
   */
  async list(userId: string, filters?: { status?: string; contactId?: string }) {
    let q = supabaseAdmin.from('leads').select(LEAD_SELECT).eq('user_id', userId);
    if (filters?.contactId) q = q.eq('contact_id', filters.contactId);
    if (filters?.status && filters.status !== 'all') q = q.eq('status', filters.status);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async create(userId: string, body: any) {
    const contactId = body?.contact_id;
    if (!contactId) throw new AppError('A contact is required to create a lead', 400);

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('id, email, first_name, last_name, company, company_id')
      .eq('id', contactId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!contact) throw new AppError('Contact not found', 404);

    const input = pick(body, LEAD_KEYS as any);
    sanitize(input);

    /*
     * A title nobody typed is better derived than left blank: an inbox of
     * rows all reading "Untitled" is an inbox nobody can scan. Company
     * first because that is what a lead is usually referred to as.
     */
    if (!input.title) {
      const person = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;
      input.title = contact.company ? `${contact.company} - ${person}` : person;
    }
    if (input.company === undefined) input.company = contact.company || null;
    if (input.company_id === undefined) input.company_id = contact.company_id || null;

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert({ ...input, user_id: userId, contact_id: contactId })
      .select(LEAD_SELECT)
      .single();

    /*
     * 23505 is the one-open-lead-per-person index. Two replies to two
     * campaigns from the same person is one opportunity, not two, and
     * silently creating a second would double the inbox and deflate the
     * conversion rate. Returning the existing one is more useful than an
     * error, because the caller almost always wants to go and look at it.
     */
    if (error?.code === '23505') {
      const { data: existing } = await supabaseAdmin
        .from('leads').select(LEAD_SELECT)
        .eq('user_id', userId).eq('contact_id', contactId).eq('status', 'open')
        .maybeSingle();
      throw new AppError(
        `That person is already an open lead${existing ? ` ("${(existing as any).title}")` : ''}`,
        409,
      );
    }
    if (error) throw new AppError(error.message, 500);
    // Somebody you have chosen to hold as a lead is not a stranger.
    promoteToContact(userId, [contactId], 'lead').catch(() => {});
    return data;
  },

  async update(userId: string, id: string, body: any) {
    const input = pick(body, LEAD_KEYS as any);
    sanitize(input);
    if (Object.keys(input).length === 0) throw new AppError('Nothing to update', 400);

    const { data, error } = await supabaseAdmin
      .from('leads').update(input)
      .eq('id', id).eq('user_id', userId)
      .select(LEAD_SELECT).maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Lead not found', 404);
    return data;
  },

  async remove(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('leads').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  /**
   * Drop a lead without deleting it.
   *
   * Archived rather than removed because "how many leads do we throw away,
   * and why" is the question that tells you whether the targeting is any
   * good, and it cannot be answered from rows that are gone.
   */
  async archive(userId: string, id: string, reason?: string | null) {
    const clean = typeof reason === 'string' ? reason.trim().slice(0, 200) || null : null;
    const { data, error } = await supabaseAdmin
      .from('leads')
      .update({ status: 'archived', archived_reason: clean, archived_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', userId).eq('status', 'open')
      .select(LEAD_SELECT).maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Lead not found, or it is not open', 404);
    return data;
  },

  /** Put an archived lead back in the inbox. */
  async reopen(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .update({ status: 'open', archived_reason: null, archived_at: null })
      .eq('id', id).eq('user_id', userId).eq('status', 'archived')
      .select(LEAD_SELECT).maybeSingle();
    // The one-open-lead-per-person index can refuse this: somebody became a
    // lead again while this one sat archived.
    if (error?.code === '23505') {
      throw new AppError('That person already has another open lead', 409);
    }
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Lead not found, or it is not archived', 404);
    return data;
  },

  /**
   * Qualify a lead into a deal.
   *
   * Everything the lead knows goes with it — the person, the company, the
   * estimate, the label, where it came from and the note — because the
   * alternative is somebody retyping it, and what actually happens then is
   * that they retype some of it.
   *
   * The lead is kept and marked converted rather than deleted, so the
   * lead-to-deal rate is answerable and so the deal can say where it came
   * from.
   */
  async convert(userId: string, id: string, body: any = {}) {
    const { data: lead } = await supabaseAdmin
      .from('leads').select('*')
      .eq('id', id).eq('user_id', userId).maybeSingle();
    if (!lead) throw new AppError('Lead not found', 404);
    if (lead.status === 'converted') throw new AppError('That lead has already been converted', 409);

    const deal = await crmService.createDeal(userId, {
      title: body.title || lead.title,
      company: lead.company,
      company_id: lead.company_id,
      contact_id: lead.contact_id,
      value: body.value !== undefined ? body.value : (lead.value ?? 0),
      currency: lead.currency || 'USD',
      stage: body.stage || 'lead',
      label: lead.label,
      // Where a deal came from is worth more than where a lead came from,
      // because it is the deal that eventually wins or loses and makes the
      // source answerable.
      source: lead.source,
      expected_close_date: body.expected_close_date || null,
      notes: lead.note,
      ...(body.recurring_amount !== undefined ? { recurring_amount: body.recurring_amount } : {}),
      ...(body.recurring_period !== undefined ? { recurring_period: body.recurring_period } : {}),
      ...(body.one_off_amount !== undefined ? { one_off_amount: body.one_off_amount } : {}),
      ...(body.term_months !== undefined ? { term_months: body.term_months } : {}),
    });

    /*
     * Link both ways, then mark the lead converted. If this fails the deal
     * still exists and is usable — an orphaned-but-correct deal is a far
     * better outcome than a lead that has silently vanished from the inbox
     * with nothing to show for it.
     */
    await supabaseAdmin.from('deals').update({ lead_id: lead.id }).eq('id', (deal as any).id).eq('user_id', userId);

    const { data: updated, error } = await supabaseAdmin
      .from('leads')
      .update({
        status: 'converted',
        converted_deal_id: (deal as any).id,
        converted_at: new Date().toISOString(),
      })
      .eq('id', id).eq('user_id', userId)
      .select(LEAD_SELECT).maybeSingle();
    if (error) throw new AppError(error.message, 500);

    return { lead: updated, deal };
  },

  /**
   * Contacts who are on an open deal, out of the ones asked about.
   *
   * Used to keep somebody you are mid-negotiation with out of a cold
   * campaign. Covers participants as well as the primary contact, because
   * emailing the security reviewer a cold pitch while their colleague is
   * signing a contract is the same mistake.
   */
  async contactsOnOpenDeals(userId: string, contactIds: string[]): Promise<Set<string>> {
    const on = new Set<string>();
    if (contactIds.length === 0) return on;

    const CHUNK = 200;
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const slice = contactIds.slice(i, i + CHUNK);

      const { data: primary, error: e1 } = await supabaseAdmin
        .from('deals').select('contact_id')
        .eq('user_id', userId)
        .in('contact_id', slice)
        .in('stage', ['lead', 'qualified', 'proposal']);
      if (e1) throw new AppError(e1.message, 500);
      for (const row of primary || []) if (row.contact_id) on.add(row.contact_id);

      const { data: joined, error: e2 } = await supabaseAdmin
        .from('deal_participants')
        .select('contact_id, deal:deals!inner(stage)')
        .eq('user_id', userId)
        .in('contact_id', slice)
        .in('deal.stage', ['lead', 'qualified', 'proposal']);
      if (e2) throw new AppError(e2.message, 500);
      for (const row of joined || []) if (row.contact_id) on.add(row.contact_id);
    }
    return on;
  },
};
