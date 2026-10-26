import { REPLY_CHECK_CONTACT_DOMAIN, normalizeLinkedinUrl } from '@lemlist/shared';
import { enrichmentService } from './enrichment.service.js';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { getPagination, formatPaginatedResponse } from '../utils/pagination.js';
import { fireEvent } from './webhook.service.js';
import { segmentsService } from './segments.service.js';
import { UNLISTED_LIST_ID } from '@lemlist/shared';
import { chunk, fetchAllPages, selectInChunks } from '../utils/batch.js';
import { promoteToContact } from './lifecycle.service.js';
import Papa from 'papaparse';
import fs from 'node:fs';

/**
 * Columns a client is allowed to write on a contact.
 *
 * The update used to forward the whole request body to Postgres, which meant
 * `user_id` was writable — a caller could hand their own contact to another
 * account, and `id`, `list_count` and the verification columns were equally
 * open. Anything not named here is dropped rather than rejected, so a client
 * sending back a whole contact record still works.
 */
const UPDATABLE_CONTACT_FIELDS = [
  'email', 'first_name', 'last_name', 'company', 'company_id', 'job_title',
  'phone', 'linkedin_url', 'website', 'location', 'custom_fields',
  'is_unsubscribed', 'is_bounced',
] as const;

function pickUpdatable(input: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of UPDATABLE_CONTACT_FIELDS) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  // A profile saved without its scheme is read as a relative link by every
  // page that renders it, and the LinkedIn agent cannot open it at all.
  if (out.linkedin_url !== undefined) out.linkedin_url = normalizeLinkedinUrl(out.linkedin_url);
  return out;
}

interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  company?: string;
  tag_ids?: string[];
  list_id?: string;
  is_unsubscribed?: boolean;
  is_bounced?: boolean;
  dcs_min?: number;
  dcs_max?: number;
  verification_status?: string;
  /**
   * Which population to show.
   *
   * 'engaged' is contacts plus customers — the CRM's idea of a contact
   * list, and the default for the contacts page. 'all' includes prospects,
   * which is what campaign audiences and lead lists operate over. A single
   * lifecycle can also be named directly.
   */
  lifecycle?: string;
  sort_by?: string;
  sort_order?: string;
}

/**
 * The "Not in Lists" view is resolved against contacts.list_count (migration
 * 036), which a trigger keeps equal to the number of non-trashed lists a
 * contact belongs to. Doing it that way — rather than fetching every listed
 * contact id and negating — keeps it a single indexed predicate that composes
 * with search, sort, status filters and pagination, at any list size.
 */
function isUnlisted(listId?: string): boolean {
  return listId === UNLISTED_LIST_ID;
}

/** Turn the "column doesn't exist" error into an instruction, once. */
function assertListCountColumn(error: { message?: string } | null): void {
  if (error?.message && /list_count/.test(error.message) && /column/i.test(error.message)) {
    throw new AppError(
      '"Not in Lists" needs database migration 036_contact_list_count.sql — run it in Supabase, then reload.',
      503,
    );
  }
}

/** The one address check every way in shares: manual create, CSV, API. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Escape LIKE wildcards so a search for "john_doe" means that literally. */
function likeEscape(text: string): string {
  return text.replace(/([%_\\])/g, '\\$1');
}

/**
 * Which of these addresses are on the user's suppression list.
 *
 * Never throws: a badge is not worth failing the page for, and a missing
 * badge is the state the page was in before this existed.
 */
async function suppressedEmails(userId: string, emails: string[]): Promise<Set<string>> {
  const wanted = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))];
  if (wanted.length === 0) return new Set();
  try {
    const rows = await selectInChunks(wanted, (slice) =>
      supabaseAdmin.from('suppression_list').select('email').eq('user_id', userId).in('email', slice));
    return new Set(rows.map((r: any) => String(r.email).toLowerCase()));
  } catch (e: any) {
    console.warn('[Contacts] suppression lookup failed:', e?.message || e);
    return new Set();
  }
}

/** Which of these ids are this user's contacts, asked a slice at a time. */
async function ownedContactIds(userId: string, contactIds: string[]): Promise<string[]> {
  const rows = await selectInChunks([...new Set(contactIds)], (slice) =>
    supabaseAdmin.from('contacts').select('id').eq('user_id', userId).in('id', slice));
  return rows.map((c: any) => c.id as string);
}

export const contactsService = {
  async list(userId: string, params: ListParams): Promise<ReturnType<typeof formatPaginatedResponse<any>> & { sort_unavailable?: string }> {
    const { page, limit, from, to } = getPagination(params);
    // Anything added without a company or website gets what its address says.
    enrichmentService.ensure(userId);

    /*
     * List and tag filters are joins, not id lists.
     *
     * Both used to fetch the matching ids first and hand them back as an
     * `in` filter. That fetch was unpaged, so it stopped at 1,000 rows -
     * a list of 3,000 showed a total of 1,000 and pages that ran out early
     * - and the ids went into the URL, which a list of a few hundred was
     * already enough to make the gateway refuse. An inner-joined embed
     * filters in the database instead, at any size, and still composes
     * with search, sort, status filters and pagination.
     */
    const tagIds = Array.isArray(params.tag_ids)
      ? params.tag_ids.filter(Boolean)
      : params.tag_ids ? [String(params.tag_ids)] : [];
    const listScoped = !!params.list_id && !isUnlisted(params.list_id);

    const select = [
      '*, contact_tags(tag_id, tags(*)), list_contacts(contact_lists(id, name))',
      listScoped ? 'in_list:list_contacts!inner(list_id)' : null,
      tagIds.length > 0 ? 'has_tag:contact_tags!inner(tag_id)' : null,
    ].filter(Boolean).join(', ');

    let query = supabaseAdmin
      .from('contacts')
      .select(select, { count: 'exact' })
      .eq('user_id', userId)
      // A running reply check's placeholder (shared/reply-check).
      .not('email', 'like', `%@${REPLY_CHECK_CONTACT_DOMAIN}`);

    if (listScoped) {
      query = query.eq('in_list.list_id', params.list_id!);
    }

    // "Not in Lists" — everyone with no live list membership.
    if (isUnlisted(params.list_id)) {
      query = query.eq('list_count', 0);
    }

    if (tagIds.length > 0) {
      query = query.in('has_tag.tag_id', tagIds);
    }

    if (params.search) {
      // Strip PostgREST filter-syntax characters (comma separates .or()
      // conditions, parens group them, quotes delimit values) so user input
      // can't break out of the ilike value and inject extra clauses. LIKE
      // wildcards are escaped rather than stripped: removing "_" meant
      // "john_doe" searched for "johndoe" and never found john_doe@x.com.
      const cleaned = String(params.search).replace(/[,()"]/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned) {
        const t = likeEscape(cleaned);
        const clauses = [
          `email.ilike.%${t}%`, `first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`, `company.ilike.%${t}%`,
        ];
        // "Ada Lovelace" is a first name and a last name, which no single
        // column contains.
        const cut = cleaned.indexOf(' ');
        if (cut > 0) {
          const first = likeEscape(cleaned.slice(0, cut));
          const last = likeEscape(cleaned.slice(cut + 1));
          clauses.push(`and(first_name.ilike.%${first}%,last_name.ilike.%${last}%)`);
        }
        query = query.or(clauses.join(','));
      }
    }

    /*
     * Prospects are excluded unless asked for. Sourcing produces thousands
     * of people nobody has spoken to, and mixing them into the CRM list is
     * what made search useless and a contact count meaningless. Campaign
     * audiences pass no filter at all, because reaching strangers is their
     * job — which is also why the default here is to include everybody.
     */
    if (params.lifecycle === 'engaged') {
      query = query.in('lifecycle', ['contact', 'customer']);
    } else if (params.lifecycle && params.lifecycle !== 'all') {
      query = query.eq('lifecycle', params.lifecycle);
    }

    // Exact-company filter (chosen from the distinct-companies picker)
    if (params.company) {
      query = query.eq('company', params.company);
    }

    if (params.is_unsubscribed !== undefined) {
      query = query.eq('is_unsubscribed', params.is_unsubscribed);
    }

    if (params.is_bounced !== undefined) {
      query = query.eq('is_bounced', params.is_bounced);
    }

    if (params.dcs_min !== undefined) {
      query = query.gte('dcs_score', params.dcs_min);
    }

    if (params.dcs_max !== undefined) {
      query = query.lte('dcs_score', params.dcs_max);
    }

    // Verification status — mirrors the client's derived states so the summary
    // pills filter the whole list (not just the current page).
    switch (params.verification_status) {
      case 'valid':
        query = query.not('dcs_verified_at', 'is', null).eq('is_bounced', false).gte('dcs_score', 80);
        break;
      case 'risky':
        query = query.not('dcs_verified_at', 'is', null).eq('is_bounced', false).gte('dcs_score', 50).lt('dcs_score', 80);
        break;
      case 'not_found':
        // Verified, but the domain has no mail server (MX) — "email not found"
        query = query.not('dcs_verified_at', 'is', null).eq('is_bounced', false).eq('dcs_domain_ok', false).not('dcs_syntax_ok', 'is', false);
        break;
      case 'invalid':
        query = query.or('is_bounced.eq.true,and(dcs_verified_at.not.is.null,dcs_syntax_ok.is.false),and(dcs_verified_at.not.is.null,dcs_domain_ok.not.is.false,dcs_score.lt.50)');
        break;
      case 'unverified':
        query = query.is('dcs_verified_at', null).eq('is_bounced', false);
        break;
    }

    const ALLOWED_SORT = new Set(['email', 'first_name', 'last_name', 'company', 'dcs_score', 'created_at', 'engagement_score']);
    const sortBy = ALLOWED_SORT.has(params.sort_by || '') ? params.sort_by! : 'created_at';
    const sortOrder = params.sort_order === 'asc';
    // id breaks ties: an import writes hundreds of rows in the same instant,
    // and without it paging repeated some and skipped others. Unscored
    // contacts go last either way: "no score yet" is not "coldest".
    query = query
      .order(sortBy, sortBy === 'engagement_score' ? { ascending: sortOrder, nullsFirst: false } : { ascending: sortOrder })
      .order('id', { ascending: sortOrder })
      .range(from, to);

    const { data, count, error } = await query;
    if (error) {
      assertListCountColumn(error);
      // Sorting by a score that migration 096 has not created yet: show the
      // list in its usual order and say why, rather than show nothing.
      if (sortBy === 'engagement_score' && /engagement_score/.test(error.message || '')) {
        const fallback = await contactsService.list(userId, { ...params, sort_by: 'created_at' });
        return { ...fallback, sort_unavailable: 'Sorting by engagement needs database migration 096_duplicates_views_engagement_noshow.sql.' };
      }
      throw new AppError(error.message, 500);
    }

    const suppressed = await suppressedEmails(userId, (data || []).map((c: any) => c.email));
    const contacts = (data || []).map((c: any) => ({
      ...c,
      is_suppressed: suppressed.has(String(c.email || '').toLowerCase()),
      tags: (c.contact_tags || []).map((ct: any) => ct.tags).filter(Boolean),
      lists: (c.list_contacts || []).map((lc: any) => lc.contact_lists).filter(Boolean),
      contact_tags: undefined,
      list_contacts: undefined,
      in_list: undefined,
      has_tag: undefined,
    }));

    return formatPaginatedResponse(contacts, count || 0, page, limit);
  },

  /** Distinct companies (with counts) for this user's contacts — powers the
      "view leads by company" filter. Falls back to an in-memory aggregate if
      the RPC helper isn't present yet. */
  async companies(userId: string): Promise<{ company: string; count: number }[]> {
    const { data, error } = await supabaseAdmin.rpc('contact_companies', { uid: userId });
    if (!error && Array.isArray(data)) {
      return (data as any[]).map((r) => ({ company: r.company as string, count: Number(r.count) }));
    }

    // Fallback: aggregate client-side (used before migration 024 is applied).
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from('contacts')
      .select('company')
      .eq('user_id', userId)
      .not('company', 'is', null)
      .limit(5000);
    if (rowsErr) throw new AppError(rowsErr.message, 500);
    const counts = new Map<string, number>();
    for (const r of (rows || []) as any[]) {
      const c = (r.company || '').trim();
      if (c) counts.set(c, (counts.get(c) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company))
      .slice(0, 500);
  },

  /**
   * How many of each population there are.
   *
   * Three head-only counts rather than one grouped scan: PostgREST cannot
   * GROUP BY, and pulling every row back to count them in Node would mean
   * transferring the whole contact table to render three numbers.
   */
  async lifecycleCounts(userId: string) {
    const one = async (lifecycle: string) => {
      const { count, error } = await supabaseAdmin
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('lifecycle', lifecycle)
        // The same placeholder the list leaves out, so the tab counts agree
        // with the rows under them.
        .not('email', 'like', `%@${REPLY_CHECK_CONTACT_DOMAIN}`);
      if (error) throw new AppError(error.message, 500);
      return count || 0;
    };
    const [prospect, contact, customer] = await Promise.all([
      one('prospect'), one('contact'), one('customer'),
    ]);
    return { prospect, contact, customer, total: prospect + contact + customer };
  },

  async get(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('*, contact_tags(tag_id, tags(*))')
      .eq('id', id)
      .eq('user_id', userId)
      // maybeSingle, not single: .single() turns "no such contact" into a
      // PostgREST error, which surfaced as a 500 instead of the 404 below.
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Contact not found', 404);

    const suppressed = await suppressedEmails(userId, [data.email]);
    return {
      ...data,
      is_suppressed: suppressed.has(String(data.email || '').toLowerCase()),
      tags: (data.contact_tags || []).map((ct: any) => ct.tags).filter(Boolean),
      contact_tags: undefined,
    };
  },

  /**
   * Every campaign this contact is currently enrolled in, with their
   * per-campaign progress. Answers "where does this person already stand?"
   * before you enrol them again — the campaign-side counterpart to
   * listsService.getListsForContact.
   *
   * Only campaigns owned by `userId` are ever returned, and the contact
   * itself is ownership-checked first, so one tenant can't probe another's
   * enrolments by guessing contact ids.
   */
  async getCampaignsForContact(userId: string, contactId: string) {
    const { data: contact, error: contactError } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('user_id', userId)
      .maybeSingle();

    if (contactError) throw new AppError(contactError.message, 500);
    if (!contact) throw new AppError('Contact not found', 404);

    // !inner so a campaign belonging to another user can't come back with a
    // null join row attached.
    const { data, error } = await supabaseAdmin
      .from('campaign_contacts')
      .select(
        'id, campaign_id, status, current_step_order, next_send_at, completed_at, error_message, created_at, campaigns!inner(id, name, status, user_id, list_id)'
      )
      .eq('contact_id', contactId)
      .eq('campaigns.user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new AppError(error.message, 500);

    return (data || []).map((row: any) => ({
      campaign_contact_id: row.id,
      campaign_id: row.campaign_id,
      campaign_name: row.campaigns?.name ?? null,
      campaign_status: row.campaigns?.status ?? null,
      // Exposed so a client can work out which enrolment actually blocks a new
      // one: the exclusivity rule only bites across *different* lead lists.
      campaign_list_id: row.campaigns?.list_id ?? null,
      status: row.status,
      current_step_order: row.current_step_order,
      next_send_at: row.next_send_at,
      completed_at: row.completed_at,
      error_message: row.error_message,
      enrolled_at: row.created_at,
      // A campaign still in flight is one that removing someone from actually
      // changes anything for — the client uses this to decide what to offer.
      is_active: ['draft', 'scheduled', 'running', 'paused'].includes(row.campaigns?.status),
    }));
  },

  async create(userId: string, input: any) {
    const { tag_ids } = input;
    // The same allow-list update() has used since the ownership hole was
    // closed there. create() was left spreading the raw body, so a request
    // could still choose the row's primary key and its audit timestamps.
    const contactData = pickUpdatable(input);

    // And the same casing rule, so a contact created through this path
    // matches one created through any other. Addresses are looked up by
    // exact match all over this codebase; one stored with capitals is a
    // duplicate waiting to happen.
    contactData.email = String(contactData.email ?? '').trim().toLowerCase();
    // The same rule the CSV import applies, so a typo is a 400 here rather
    // than a contact nobody can ever email.
    if (!contactData.email) throw new AppError('A contact needs an email address', 400);
    if (!EMAIL_RE.test(contactData.email)) throw new AppError('That is not a valid email address', 400);

    if (contactData.company_id) {
      const { data: company } = await supabaseAdmin
        .from('companies')
        .select('id')
        .eq('id', contactData.company_id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!company) throw new AppError('Company not found', 404);
    }

    /*
     * Somebody typed in by hand is a relationship, not a sourced stranger
     * (migration 055's "deliberately added"). Left at the column default of
     * 'prospect', they never appeared on the contacts page they were just
     * added from, which shows contacts and customers.
     */
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        ...contactData,
        user_id: userId,
        source: 'manual',
        lifecycle: 'contact',
        engaged_at: new Date().toISOString(),
        promoted_by: 'manual',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new AppError('Contact with this email already exists', 409);
      throw new AppError(error.message, 500);
    }

    if (tag_ids && tag_ids.length > 0) {
      // Verify tags belong to user — otherwise another tenant's tag metadata
      // could be attached to (and rendered for) this user's contacts.
      const { data: ownedTags } = await supabaseAdmin
        .from('tags')
        .select('id')
        .eq('user_id', userId)
        .in('id', tag_ids);
      const validTagIds = (ownedTags || []).map((t: any) => t.id);
      if (validTagIds.length > 0) {
        const tagRows = validTagIds.map((tagId: string) => ({ contact_id: data.id, tag_id: tagId }));
        const { error: tagError } = await supabaseAdmin.from('contact_tags').insert(tagRows);
        if (tagError) throw new AppError(`Contact created but failed to add tags: ${tagError.message}`, 500);
      }
    }

    fireEvent(userId, 'contact.created', { contact: data }).catch(() => {});
    enrichmentService.ensure(userId);
    return data;
  },

  async update(userId: string, id: string, input: any) {
    const { tag_ids } = input || {};
    const contactData = pickUpdatable(input);

    if (contactData.email !== undefined) {
      contactData.email = String(contactData.email).trim().toLowerCase();
      if (!contactData.email) throw new AppError('A contact needs an email address', 400);
    }

    if (contactData.company_id) {
      const { data: company } = await supabaseAdmin
        .from('companies')
        .select('id')
        .eq('id', contactData.company_id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!company) throw new AppError('Company not found', 404);
    }

    const hasFields = Object.keys(contactData).length > 0;
    if (!hasFields && !Array.isArray(tag_ids)) throw new AppError('Nothing to update', 400);

    // A tags-only edit still has to confirm the contact is this user's before
    // touching contact_tags, so read it rather than issuing an empty update.
    const query = supabaseAdmin.from('contacts');
    const { data, error } = hasFields
      ? await query.update(contactData).eq('id', id).eq('user_id', userId).select().single()
      : await query.select().eq('id', id).eq('user_id', userId).maybeSingle();

    if (error) {
      // 23505 = the (user_id, email) unique constraint — a real, explainable
      // conflict rather than a server fault.
      if ((error as any).code === '23505') {
        throw new AppError('Another contact already uses that email address', 409);
      }
      // PGRST116 = .single() matched no row, i.e. not this user's contact.
      if ((error as any).code === 'PGRST116') throw new AppError('Contact not found', 404);
      throw new AppError(error.message, 500);
    }
    if (!data) throw new AppError('Contact not found', 404);

    // Apply tag updates when tag_ids is explicitly provided
    if (Array.isArray(tag_ids)) {
      const { error: delErr } = await supabaseAdmin.from('contact_tags').delete().eq('contact_id', id);
      if (delErr) throw new AppError(`Failed to remove tags: ${delErr.message}`, 500);
      if (tag_ids.length > 0) {
        // Verify tags belong to user — otherwise another tenant's tag metadata
        // could be attached to (and rendered for) this user's contacts.
        const { data: ownedTags } = await supabaseAdmin
          .from('tags')
          .select('id')
          .eq('user_id', userId)
          .in('id', tag_ids);
        const validTagIds = (ownedTags || []).map((t: any) => t.id);
        if (validTagIds.length > 0) {
          const tagRows = validTagIds.map((tagId: string) => ({ contact_id: id, tag_id: tagId }));
          const { error: insErr } = await supabaseAdmin.from('contact_tags').insert(tagRows);
          if (insErr) throw new AppError(`Failed to apply tags: ${insErr.message}`, 500);
        }
      }
    }

    fireEvent(userId, 'contact.updated', { contact: data }).catch(() => {});
    return data;
  },

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('contacts')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
    fireEvent(userId, 'contact.deleted', { contact_id: id }).catch(() => {});
  },

  async bulkCreate(
    userId: string,
    contacts: Array<Record<string, any>>,
    listId?: string,
    /** Filename of the CSV this batch came from, recorded on every row so a
     *  lead's origin is still answerable months later. */
    importSource?: string,
    /** 'contacts' when the import was started from the CRM side: everyone
     *  in it is a deliberate relationship, not a sourced prospect. */
    context?: string,
  ): Promise<{
    total: number;
    imported: number;
    /** Of `imported`, how many were new addresses... */
    created?: number;
    /** ...and how many already existed and only had blanks filled. */
    updated?: number;
    /** Addresses in this import that are on the suppression list. */
    suppressed?: number;
    errors: number;
    duplicates_collapsed?: number;
    error_details: { email: string; reason: string }[];
  }> {
    const total = contacts.length;
    const cleanSource = (importSource || '').trim().slice(0, 200) || null;
    const errorDetails: { email: string; reason: string }[] = [];
    const valid: any[] = [];
    const ALLOWED_FIELDS = new Set([
      'email', 'first_name', 'last_name', 'company',
      'job_title', 'phone', 'linkedin_url', 'website', 'location',
    ]);

    for (const c of contacts) {
      if (!c || typeof c !== 'object') {
        errorDetails.push({ email: '(missing)', reason: 'Email is required' });
        continue;
      }
      const rawEmail = typeof c.email === 'string' ? c.email.trim() : '';
      if (!rawEmail) {
        errorDetails.push({ email: '(missing)', reason: 'Email is required' });
        continue;
      }
      const email = rawEmail.toLowerCase();
      if (!EMAIL_RE.test(email)) {
        errorDetails.push({ email: rawEmail, reason: 'Invalid email format' });
        continue;
      }

      // Only the fields this row actually has. A key left out is "not in
      // this file", never "make it empty" - see the merge below.
      const row: Record<string, any> = { email };
      if (cleanSource) row.import_source = cleanSource;
      for (const [k, v] of Object.entries(c)) {
        if (!ALLOWED_FIELDS.has(k) || k === 'email') continue;
        if (v == null) continue;
        const trimmed = typeof v === 'string' ? v.trim() : v;
        if (trimmed === '') continue;
        row[k] = k === 'linkedin_url' ? normalizeLinkedinUrl(trimmed) : trimmed;
      }

      // Arbitrary custom attributes (from custom-mapped CSV columns / API)
      if (c.custom_fields && typeof c.custom_fields === 'object' && !Array.isArray(c.custom_fields)) {
        const cf: Record<string, string> = {};
        for (const [k, v] of Object.entries(c.custom_fields as Record<string, any>)) {
          if (v == null) continue;
          const tv = typeof v === 'string' ? v.trim() : String(v);
          if (tv === '') continue;
          cf[k] = tv;
        }
        if (Object.keys(cf).length > 0) row.custom_fields = cf;
      }
      valid.push(row);
    }

    if (valid.length === 0) {
      return { total, imported: 0, errors: errorDetails.length, error_details: errorDetails.slice(0, 200) };
    }

    // Deduplicate within the batch - one write per address. A later row
    // wins where both have a value, and fills what an earlier one left out.
    const uniqueByEmail = new Map<string, any>();
    for (const row of valid) {
      const prev = uniqueByEmail.get(row.email);
      uniqueByEmail.set(row.email, prev
        ? { ...prev, ...row, custom_fields: { ...(prev.custom_fields || {}), ...(row.custom_fields || {}) } }
        : row);
    }
    const uniqueValid = Array.from(uniqueByEmail.values());
    const duplicatesCollapsed = valid.length - uniqueValid.length;

    /*
     * Re-importing fills gaps; it never blanks.
     *
     * This was a PostgREST upsert, which sends the union of every row's
     * columns and writes a missing key as its default - so re-importing a
     * file without a phone column wiped every existing contact's phone,
     * replaced custom_fields wholesale and overwrote their source. The
     * import_contacts_merge function (migration 086) only fills columns that
     * are empty now, keeps existing custom fields, never touches source, and
     * says which rows were new.
     */
    let importedRows: Array<{ id: string; email: string; inserted?: boolean }> = [];
    const { data: merged, error: mergeError } = await supabaseAdmin
      .rpc('import_contacts_merge', { p_user_id: userId, p_rows: uniqueValid });

    if (!mergeError) {
      importedRows = Array.isArray(merged) ? (merged as any[]) : [];
    } else if (/import_contacts_merge/.test(mergeError.message || '') || (mergeError as any).code === 'PGRST202') {
      /*
       * Migration 086 not run yet. Fall back to something that cannot
       * blank anything: insert the new addresses, leave existing contacts
       * exactly as they are, then read back every id for list assignment.
       */
      console.warn('[Contacts] import_contacts_merge missing - run migration 086_contact_import_merge.sql. Existing contacts are left unchanged.');
      const now = new Date().toISOString();
      const inserts = uniqueValid.map((r) => ({
        ...r,
        user_id: userId,
        source: 'csv_import',
        ...(r.import_source ? { imported_at: now } : {}),
      }));
      const { data: added, error: insErr } = await supabaseAdmin
        .from('contacts')
        .upsert(inserts, { onConflict: 'user_id,email', ignoreDuplicates: true })
        .select('id, email');
      if (insErr) {
        return { total, imported: 0, errors: total, error_details: [{ email: '(batch)', reason: insErr.message }] };
      }
      const addedIds = new Set((added || []).map((r: any) => r.id));
      try {
        const all = await selectInChunks(uniqueValid.map((r) => r.email), (slice) =>
          supabaseAdmin.from('contacts').select('id, email').eq('user_id', userId).in('email', slice));
        importedRows = all.map((r: any) => ({ id: r.id, email: r.email, inserted: addedIds.has(r.id) }));
      } catch (e: any) {
        return { total, imported: 0, errors: total, error_details: [{ email: '(batch)', reason: e?.message || 'Import failed' }] };
      }
    } else {
      return {
        total,
        imported: 0,
        errors: total,
        error_details: [{ email: '(batch)', reason: mergeError.message }],
      };
    }

    let listKind: string | null = null;
    if (listId && importedRows.length > 0) {
      // Verify the list belongs to this user before attaching members
      const { data: list } = await supabaseAdmin
        .from('contact_lists')
        .select('id, kind')
        .eq('id', listId)
        .eq('user_id', userId)
        .maybeSingle();

      if (list) {
        listKind = (list as any).kind ?? null;
        const memberships = importedRows.map((r: any) => ({
          list_id: listId,
          contact_id: r.id,
        }));
        const { error: memErr } = await supabaseAdmin
          .from('list_contacts')
          .upsert(memberships, { onConflict: 'list_id,contact_id' });
        if (memErr) {
          // Don't fail the whole import — record as soft error
          errorDetails.push({ email: '(list assignment)', reason: memErr.message });
        }
      }
    }

    /*
     * An import into a contact list (or started from the contacts page) is
     * people you already know. Left as prospects - the column default -
     * they never showed on the contacts page they were imported into.
     * Lead-list and API imports keep the default: sourcing is what those
     * are for. promote() only moves forwards, so a customer stays one.
     */
    if (importedRows.length > 0 && (listKind === 'contact' || context === 'contacts')) {
      for (const slice of chunk(importedRows.map((r) => r.id))) {
        await promoteToContact(userId, slice, 'import');
      }
    }

    // How many of these addresses no campaign will email, said up front
    // rather than discovered as skips later.
    const suppressed = (await suppressedEmails(userId, uniqueValid.map((r) => r.email))).size;

    // Failures = rows we tried to write (after collapsing duplicates) but
    // didn't get back. Duplicates collapsed in-batch are not failures —
    // they're legitimate consolidations the user expects.
    enrichmentService.ensure(userId);
    const upsertFailures = Math.max(0, uniqueValid.length - importedRows.length);
    const created = importedRows.filter((r) => r.inserted === true).length;
    return {
      total,
      imported: importedRows.length,
      created,
      updated: importedRows.length - created,
      suppressed,
      errors: errorDetails.length + upsertFailures,
      duplicates_collapsed: duplicatesCollapsed,
      error_details: errorDetails.slice(0, 200),
    };
  },

  /**
   * The legacy multipart import (POST /contacts/import).
   *
   * The app's own import page posts parsed rows to /contacts/bulk; this
   * route survives for API callers. It used to run its own upsert, with
   * the same blanking problem bulkCreate had, so it now parses the file and
   * hands the rows to bulkCreate - one write path, one set of rules.
   */
  async importCsv(userId: string, filePath: string, columnMapping: Record<string, string>) {
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(filePath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Failed to read upload file: ${err.message}`);
    } finally {
      try { fs.unlinkSync(filePath); } catch { /* ignore cleanup errors */ }
    }
    const parsed = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
    const rows = parsed.data as Record<string, string>[];

    // Reject absurdly large imports outright.
    const MAX_ROWS = 50_000;
    if (rows.length > MAX_ROWS) {
      throw new AppError(
        `CSV has ${rows.length.toLocaleString()} rows; the maximum per import is ${MAX_ROWS.toLocaleString()}. Split the file and import in batches.`,
        400
      );
    }

    // columnMapping is client-supplied, so it only ever picks among the
    // columns bulkCreate allows - mapping a CSV column to "user_id" or "id"
    // lands nowhere.
    const IMPORT_ALLOWED_FIELDS = new Set([
      'email', 'first_name', 'last_name', 'company',
      'job_title', 'phone', 'linkedin_url', 'website', 'location',
    ]);

    const mapped = rows.map((row) => {
      const contact: Record<string, any> = {};
      for (const [csvCol, dbField] of Object.entries(columnMapping)) {
        if (!IMPORT_ALLOWED_FIELDS.has(dbField)) continue;
        if (row[csvCol] !== undefined && row[csvCol] !== '') contact[dbField] = row[csvCol];
      }
      return contact;
    });

    let imported = 0;
    let errors = 0;
    const BATCH_SIZE = 1000;
    for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
      const result = await this.bulkCreate(userId, mapped.slice(i, i + BATCH_SIZE));
      imported += result.imported;
      errors += result.errors;
    }

    return { imported, errors };
  },

  async bulkTag(userId: string, contactIds: string[], tagIds: string[]) {
    if (!Array.isArray(contactIds) || contactIds.length === 0) return;
    if (!Array.isArray(tagIds) || tagIds.length === 0) return;

    // Verify tags belong to user — otherwise another tenant's tag metadata
    // could be attached to (and rendered for) this user's contacts.
    const { data: tags } = await supabaseAdmin
      .from('tags')
      .select('id')
      .eq('user_id', userId)
      .in('id', tagIds);
    const validTagIds = (tags || []).map((t: any) => t.id);
    if (validTagIds.length === 0) return;

    // Verify contacts belong to user, a slice at a time: a "select all" of a
    // few hundred contacts is an `in` list too long for one URL.
    const validIds = await ownedContactIds(userId, contactIds);
    for (const slice of chunk(validIds)) {
      const rows = slice.flatMap((cId: string) =>
        validTagIds.map((tId: string) => ({ contact_id: cId, tag_id: tId })),
      );
      const { error } = await supabaseAdmin.from('contact_tags').upsert(rows, { onConflict: 'contact_id,tag_id' });
      if (error) throw new AppError(error.message, 500);
    }
  },

  async bulkUntag(userId: string, contactIds: string[], tagIds: string[]) {
    if (!Array.isArray(contactIds) || contactIds.length === 0) return;
    if (!Array.isArray(tagIds) || tagIds.length === 0) return;

    const { data: tags } = await supabaseAdmin
      .from('tags')
      .select('id')
      .eq('user_id', userId)
      .in('id', tagIds);
    const validTagIds = (tags || []).map((t: any) => t.id);
    if (validTagIds.length === 0) return;

    const validIds = await ownedContactIds(userId, contactIds);
    for (const slice of chunk(validIds)) {
      const { error } = await supabaseAdmin
        .from('contact_tags')
        .delete()
        .in('contact_id', slice)
        .in('tag_id', validTagIds);
      if (error) throw new AppError(error.message, 500);
    }
  },

  /**
   * Put people in Prospects or Contacts by hand, in either direction.
   *
   * Automatic promotion only ever moves forward (a reply makes a prospect a
   * contact); this is the person overriding it - someone imported as a
   * prospect who is really a customer of years, or a contact who belongs
   * back in the cold pile. Moving to prospect clears engaged_at and marks
   * them as placed there by hand, and automatic promotion leaves such people
   * alone (services/lifecycle): somebody you parked is not moved straight
   * back by their next reply. Moving them again by hand always works.
   */
  async setLifecycle(userId: string, contactIds: string[], lifecycle: string) {
    if (!['prospect', 'contact', 'customer'].includes(lifecycle)) {
      throw new AppError('lifecycle must be prospect, contact or customer', 400);
    }
    const ids = [...new Set((Array.isArray(contactIds) ? contactIds : []).filter((x) => typeof x === 'string'))];
    if (ids.length === 0) throw new AppError('No contacts given', 400);
    if (ids.length > 5000) throw new AppError('Up to 5,000 contacts at a time', 400);

    const patch = lifecycle === 'prospect'
      ? { lifecycle, engaged_at: null, promoted_by: 'manual' }
      : { lifecycle, promoted_by: 'manual' };
    let updated = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .update(patch)
        .eq('user_id', userId)
        .in('id', slice)
        .select('id');
      if (error) throw new AppError(error.message, 500);
      updated += data?.length || 0;
      if (lifecycle !== 'prospect') {
        // Keep the first engagement date if there is one; set it if not.
        await supabaseAdmin
          .from('contacts')
          .update({ engaged_at: new Date().toISOString() })
          .eq('user_id', userId)
          .in('id', slice)
          .is('engaged_at', null);
      }
    }
    return { updated, lifecycle };
  },

  async bulkDelete(userId: string, contactIds: string[]) {
    if (!Array.isArray(contactIds) || contactIds.length === 0) return { deleted: 0 };

    // Verify contacts belong to user before deleting
    const validIds = await ownedContactIds(userId, contactIds);
    if (validIds.length === 0) return { deleted: 0 };

    for (const slice of chunk(validIds)) {
      const { error } = await supabaseAdmin
        .from('contacts')
        .delete()
        .eq('user_id', userId)
        .in('id', slice);
      if (error) throw new AppError(error.message, 500);
    }

    fireEvent(userId, 'contacts.bulk_deleted', { contact_ids: validIds, count: validIds.length }).catch(() => {});

    return { deleted: validIds.length };
  },

  async export(userId: string, contactIds?: string[], format: 'csv' | 'json' = 'csv', listId?: string, segmentId?: string) {
    const COLUMNS = 'email, first_name, last_name, company, job_title, phone, linkedin_url, website, location, source, is_unsubscribed, is_bounced, dcs_score, custom_fields, created_at';

    /*
     * Paged, or chunked, but never one bare select.
     *
     * A bare select comes back capped at 1,000 rows, so "Export all" on an
     * account of 4,000 contacts produced a tidy CSV of the first thousand
     * and said nothing about the rest - the kind of loss nobody notices
     * until the other system is missing people.
     */
    let data: any[];
    try {
      if (contactIds && contactIds.length > 0) {
        data = await selectInChunks(contactIds, (slice) =>
          supabaseAdmin.from('contacts').select(COLUMNS).eq('user_id', userId).in('id', slice));
      } else if (segmentId) {
        const segment = await segmentsService.get(userId, segmentId);
        const ids = await segmentsService.getMatchingContactIds(userId, segment.filter_config);
        data = await selectInChunks(ids, (slice) =>
          supabaseAdmin.from('contacts').select(COLUMNS).eq('user_id', userId).in('id', slice));
      } else {
        // The whole account, the "Not in Lists" view, or one list - which
        // is an inner join rather than an id list, for the same reason as
        // in list() above.
        const listScoped = !!listId && !isUnlisted(listId);
        data = await fetchAllPages((from, to) => {
          let q = supabaseAdmin
            .from('contacts')
            .select(listScoped ? `${COLUMNS}, in_list:list_contacts!inner(list_id)` : COLUMNS)
            .eq('user_id', userId);
          if (listScoped) q = q.eq('in_list.list_id', listId!);
          if (isUnlisted(listId)) q = q.eq('list_count', 0);
          return q.order('created_at', { ascending: true }).order('id').range(from, to);
        });
        if (listScoped) data = data.map(({ in_list, ...rest }: any) => rest);
      }
    } catch (err: any) {
      assertListCountColumn(err);
      throw new AppError(err?.message || 'Could not export contacts', 500);
    }

    if (format === 'json') {
      return { data, format: 'json' };
    }

    // CSV format — flatten custom_fields JSON into top-level columns
    const flat = (data || []).map((r: any) => {
      const { custom_fields, ...rest } = r;
      return (custom_fields && typeof custom_fields === 'object' && !Array.isArray(custom_fields))
        ? { ...custom_fields, ...rest } // real columns win over same-named custom fields
        : rest;
    });
    // Papa.unparse(objects) takes its columns from the first row only; use the
    // union so custom fields missing on the first contact aren't dropped.
    const fields: string[] = [];
    const seen = new Set<string>();
    for (const row of flat) for (const k of Object.keys(row)) if (!seen.has(k)) { seen.add(k); fields.push(k); }
    const csv = Papa.unparse({ fields, data: flat.map((row: any) => fields.map((f) => row[f])) });
    return { data: csv, format: 'csv' };
  },

  // Verification-status breakdown for the summary pills. Scoped to a list when
  // given. Buckets mirror the client's derived states so the counts line up.
  async verificationBreakdown(userId: string, listId?: string) {
    const empty = { total: 0, valid: 0, risky: 0, invalid: 0, not_found: 0, unverified: 0, with_linkedin: 0 };
    const listScoped = !!listId && !isUnlisted(listId);
    const COLUMNS = 'dcs_verified_at, dcs_score, dcs_syntax_ok, dcs_domain_ok, is_bounced, linkedin_url';

    // Paged: the pills are counts of the whole list, and an unpaged read
    // stopped counting at 1,000.
    let rows: any[];
    try {
      rows = await fetchAllPages((from, to) => {
        let q = supabaseAdmin
          .from('contacts')
          .select(listScoped ? `id, ${COLUMNS}, in_list:list_contacts!inner(list_id)` : `id, ${COLUMNS}`)
          .eq('user_id', userId);
        if (listScoped) q = q.eq('in_list.list_id', listId!);
        if (isUnlisted(listId)) q = q.eq('list_count', 0);
        return q.order('id').range(from, to);
      });
    } catch (err: any) {
      assertListCountColumn(err);
      throw new AppError(err?.message || 'Could not count verification status', 500);
    }
    if (rows.length === 0) return empty;

    const out = { ...empty, total: rows.length };
    for (const r of rows as any[]) {
      if (r.linkedin_url) out.with_linkedin++;
      // Same ordered logic as the client's emailStatus()
      if (r.is_bounced) { out.invalid++; continue; }
      if (r.dcs_verified_at == null) { out.unverified++; continue; }
      if (r.dcs_syntax_ok === false) { out.invalid++; continue; }
      if (r.dcs_domain_ok === false) { out.not_found++; continue; }
      const score = r.dcs_score ?? 0;
      if (score >= 80) out.valid++;
      else if (score >= 50) out.risky++;
      else out.invalid++;
    }
    return out;
  },

  async getStats(userId: string) {
    const { count: total } = await supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const { count: unsubscribed } = await supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_unsubscribed', true);

    const { count: bounced } = await supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_bounced', true);

    const { count: verified } = await supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('dcs_score', 'is', null);

    return {
      total: total || 0,
      unsubscribed: unsubscribed || 0,
      bounced: bounced || 0,
      verified: verified || 0,
      active: Math.max(0, (total || 0) - (unsubscribed || 0) - (bounced || 0)),
    };
  },
};
