import {
  REPLY_CHECK_CONTACT_DOMAIN, normalizeLinkedinUrl, summariseOutreach, summariseDeals,
  LEAD_OUTREACH_STATES, IMPORT_FIELDS, IMPORT_MODES, type ImportMode,
  buildContactExport, resolveExportColumns, toCsv, emailState, heldMatchKey,
  sanitizePersonFilters, exactIlike, type PersonFacets,
} from '@lemlist/shared';
import { heldPeopleService } from './held-people.service.js';
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
  'phone', 'linkedin_url', 'website', 'location', 'country', 'city', 'state', 'industry',
  'custom_fields', 'is_unsubscribed', 'is_bounced',
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

export interface ExportOptions {
  contactIds?: string[];
  format?: 'csv' | 'json' | 'table';
  listId?: string;
  segmentId?: string;
  lifecycle?: string;
  search?: string;
  company?: string;
  outreach?: string;
  verificationStatus?: string;
  tagIds?: string[];
  /** Traffic lights, as on the list (green/amber/red). */
  lights?: string[];
  /** Country, industry, company size... */
  filters?: Record<string, unknown>;
  /** Export column keys (shared/contact-export); all when omitted. */
  columns?: string[];
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
  /** Traffic lights to show, any of green/amber/red (shared/email-light). */
  lights?: string[] | string;
  /** Country, industry, company size... (shared/person-filters). */
  country?: string;
  city?: string;
  state?: string;
  industry?: string;
  company_size?: string;
  company_industry?: string;
  engagement_min?: number | string;
  /**
   * Which population to show.
   *
   * 'engaged' is contacts plus customers — the CRM's idea of a contact
   * list, and the default for the contacts page. 'all' includes prospects,
   * which is what campaign audiences and lead lists operate over. A single
   * lifecycle can also be named directly.
   */
  lifecycle?: string;
  /** Leads page: none | in_sequence | finished | replied (shared/lifecycle). */
  outreach?: string;
  /** Per-row extras for one page: 'outreach' (Leads) or 'deals' (Contacts). */
  include?: string;
  sort_by?: string;
  sort_order?: string;
}

/**
 * The population filter shared by the list, its counts and its export, so
 * the number on a pill, the rows under it and the CSV can never disagree.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLifecycle<Q>(query: Q, lifecycle?: string): Q {
  const q = query as any;
  if (lifecycle === 'engaged') return q.in('lifecycle', ['contact', 'customer']);
  if (lifecycle === 'prospect' || lifecycle === 'contact' || lifecycle === 'customer') return q.eq('lifecycle', lifecycle);
  return query;
}

/**
 * Campaign state for a page of leads, one query for the page.
 *
 * Never throws: the column is a convenience, and a missing one is the state
 * the page was in before it existed.
 */
export async function outreachFor(userId: string, contactIds: string[]): Promise<Map<string, ReturnType<typeof summariseOutreach>>> {
  const out = new Map<string, ReturnType<typeof summariseOutreach>>();
  if (contactIds.length === 0) return out;
  try {
    const rows = await selectInChunks(contactIds, (slice) =>
      supabaseAdmin
        .from('campaign_contacts')
        .select('contact_id, status, current_step_order, updated_at, campaign_id, campaigns!inner(name, status, user_id)')
        .eq('campaigns.user_id', userId)
        .in('contact_id', slice));
    const byContact = new Map<string, any[]>();
    for (const r of rows as any[]) {
      const list = byContact.get(r.contact_id) || [];
      list.push({ ...r, campaign_name: r.campaigns?.name ?? null, campaign_status: r.campaigns?.status ?? null });
      byContact.set(r.contact_id, list);
    }
    for (const id of contactIds) out.set(id, summariseOutreach(byContact.get(id)));
  } catch (e: any) {
    console.warn('[Contacts] outreach lookup failed:', e?.message || e);
  }
  return out;
}

/** Open and won deals for a page of contacts, directly or as a participant. */
async function dealsFor(userId: string, contactIds: string[]): Promise<Map<string, ReturnType<typeof summariseDeals>>> {
  const out = new Map<string, ReturnType<typeof summariseDeals>>();
  if (contactIds.length === 0) return out;
  try {
    const [direct, viaParticipants] = await Promise.all([
      selectInChunks(contactIds, (slice) =>
        supabaseAdmin.from('deals').select('id, contact_id, stage, value, currency').eq('user_id', userId).in('contact_id', slice)),
      selectInChunks(contactIds, (slice) =>
        supabaseAdmin.from('deal_participants').select('contact_id, deals!inner(id, stage, value, currency, user_id)').eq('deals.user_id', userId).in('contact_id', slice))
        .catch(() => [] as any[]),
    ]);
    // One deal counted once per person, however it is linked.
    const byContact = new Map<string, Map<string, any>>();
    const add = (contactId: string, deal: any) => {
      if (!contactId || !deal?.id) return;
      const m = byContact.get(contactId) || new Map<string, any>();
      m.set(deal.id, deal);
      byContact.set(contactId, m);
    };
    for (const d of direct as any[]) add(d.contact_id, d);
    for (const p of viaParticipants as any[]) add(p.contact_id, p.deals);
    for (const id of contactIds) out.set(id, summariseDeals([...(byContact.get(id)?.values() || [])]));
  } catch (e: any) {
    console.warn('[Contacts] deal lookup failed:', e?.message || e);
  }
  return out;
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

/**
 * Put tags on freshly imported contacts: the ones chosen for the whole
 * import, plus any named in a Tags column - found by name, or created.
 */
async function tagImported(
  userId: string,
  rows: Array<{ id: string; email: string }>,
  namesByEmail: Map<string, string[]>,
  batchTagIds: string[],
): Promise<void> {
  const tagIdByName = new Map<string, string>();
  const wantedNames = [...new Set([...namesByEmail.values()].flat())];
  if (wantedNames.length > 0) {
    const { data: existing, error } = await supabaseAdmin.from('tags').select('id, name').eq('user_id', userId);
    if (error) throw new Error(error.message);
    for (const t of existing || []) tagIdByName.set(String((t as any).name).toLowerCase(), (t as any).id);
    const missing = wantedNames.filter((n) => !tagIdByName.has(n.toLowerCase()));
    // Unique by lower-case name, so "VIP" and "vip" in one file are one tag.
    const toCreate = [...new Map(missing.map((n) => [n.toLowerCase(), n])).values()];
    if (toCreate.length > 0) {
      const { data: created, error: cErr } = await supabaseAdmin
        .from('tags')
        .upsert(toCreate.map((name) => ({ user_id: userId, name, color: '#6B7280' })), { onConflict: 'user_id,name', ignoreDuplicates: true })
        .select('id, name');
      if (cErr) throw new Error(cErr.message);
      for (const t of created || []) tagIdByName.set(String((t as any).name).toLowerCase(), (t as any).id);
    }
  }
  let validBatch: string[] = [];
  if (batchTagIds.length > 0) {
    const { data } = await supabaseAdmin.from('tags').select('id').eq('user_id', userId).in('id', batchTagIds.slice(0, 50));
    validBatch = (data || []).map((t: any) => t.id);
  }
  const links: Array<{ contact_id: string; tag_id: string }> = [];
  for (const r of rows) {
    const ids = new Set(validBatch);
    for (const n of namesByEmail.get(String(r.email).toLowerCase()) || []) {
      const id = tagIdByName.get(n.toLowerCase());
      if (id) ids.add(id);
    }
    for (const tag_id of ids) links.push({ contact_id: r.id, tag_id });
  }
  for (const slice of chunk(links, 500)) {
    const { error } = await supabaseAdmin.from('contact_tags').upsert(slice, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
}

/** The company join a size/industry filter needs, or nothing. */
function companyFilterJoin(params: { company_size?: unknown; company_industry?: unknown }): string | null {
  return params.company_size || params.company_industry ? 'co_filter:companies!inner(size, industry)' : null;
}

/** Which of these ids are this user's contacts, asked a slice at a time. */
async function ownedContactIds(userId: string, contactIds: string[]): Promise<string[]> {
  const rows = await selectInChunks([...new Set(contactIds)], (slice) =>
    supabaseAdmin.from('contacts').select('id').eq('user_id', userId).in('id', slice));
  return rows.map((c: any) => c.id as string);
}

/**
 * The filters a contacts list applies - list, tags, outreach, search,
 * lifecycle, company, status - shared by the list and its export, so
 * "Export this view" is exactly the rows on screen. The joins the list
 * and tag filters need (in_list, has_tag) are the caller's select.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyContactFilters(query: any, params: ListParams, ctx: { listScoped: boolean; tagIds: string[]; outreach: string | null }): any {
  const { listScoped, tagIds, outreach } = ctx;
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

  if (outreach) {
    query = query.eq('outreach_state', outreach);
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
  query = applyLifecycle(query, params.lifecycle);

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

  // Who they are and where they work (shared/person-filters): exact but
  // case-blind. Company size and industry live on the company record, which
  // the caller joins as co_filter when either is asked for.
  const pf = sanitizePersonFilters(params);
  for (const k of ['country', 'city', 'state', 'industry'] as const) {
    if (pf[k]) query = query.ilike(k, exactIlike(pf[k]!));
  }
  if (pf.company_size) query = query.ilike('co_filter.size', exactIlike(pf.company_size));
  if (pf.company_industry) query = query.ilike('co_filter.industry', exactIlike(pf.company_industry));
  if (pf.engagement_min) query = query.gte('engagement_score', pf.engagement_min);

  // Traffic lights: the union of the chosen ones, in the same buckets as
  // shared/email-light emailState(), so the chip counts and rows agree.
  const lights = (Array.isArray(params.lights) ? params.lights : String(params.lights || '').split(','))
    .map((l) => String(l).trim()).filter((l) => l === 'green' || l === 'amber' || l === 'red');
  if (lights.length > 0 && lights.length < 3) {
    const clauses: string[] = [];
    const checked = 'dcs_verified_at.not.is.null,is_bounced.is.false,dcs_syntax_ok.not.is.false,dcs_domain_ok.not.is.false';
    if (lights.includes('green')) clauses.push(`and(${checked},dcs_score.gte.80)`);
    if (lights.includes('amber')) {
      clauses.push(`and(${checked},dcs_score.gte.50,dcs_score.lt.80)`);
      clauses.push('and(dcs_verified_at.is.null,is_bounced.is.false)');
    }
    if (lights.includes('red')) {
      clauses.push('is_bounced.is.true');
      clauses.push('and(dcs_verified_at.not.is.null,dcs_syntax_ok.is.false)');
      clauses.push('and(dcs_verified_at.not.is.null,dcs_domain_ok.is.false)');
      clauses.push(`and(${checked},dcs_score.lt.50)`);
      clauses.push(`and(${checked},dcs_score.is.null)`);
    }
    query = query.or(clauses.join(','));
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
  return query;
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

    /*
     * The Leads page's outbound filter. outreach_state(contacts) is a SQL
     * function (migration 104) that PostgREST exposes as a column, so the
     * filter is exact over every lead and uses the same rules as the
     * Outreach column (shared/lifecycle summariseOutreach).
     */
    const outreach = (LEAD_OUTREACH_STATES as string[]).includes(params.outreach || '') ? params.outreach! : null;

    const select = [
      '*, contact_tags(tag_id, tags(*)), list_contacts(contact_lists(id, name))',
      companyFilterJoin(params),
      listScoped ? 'in_list:list_contacts!inner(list_id)' : null,
      tagIds.length > 0 ? 'has_tag:contact_tags!inner(tag_id)' : null,
    ].filter(Boolean).join(', ');

    let query = supabaseAdmin
      .from('contacts')
      .select(select, { count: 'exact' })
      .eq('user_id', userId)
      // A running reply check's placeholder (shared/reply-check).
      .not('email', 'like', `%@${REPLY_CHECK_CONTACT_DOMAIN}`);

    query = applyContactFilters(query, params, { listScoped, tagIds, outreach });

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
        return { ...fallback, sort_unavailable: 'Sorting by engagement is not switched on for your account yet, so the usual order is shown.' };
      }
      // An outreach filter the database cannot run: show the leads unfiltered
      // and say so, rather than show nothing.
      if (outreach) {
        console.warn('[Contacts] outreach filter failed:', error.message);
        const fallback = await contactsService.list(userId, { ...params, outreach: undefined });
        return {
          ...fallback,
          sort_unavailable: /outreach_state/.test(error.message || '')
            ? 'Filtering by outreach is not switched on for your account yet, so every lead is shown.'
            : 'That outreach filter could not be applied, so every lead is shown.',
        };
      }
      throw new AppError(error.message, 500);
    }

    const ids = (data || []).map((c: any) => c.id as string);
    const [suppressed, outreachById, dealsById] = await Promise.all([
      suppressedEmails(userId, (data || []).map((c: any) => c.email)),
      params.include === 'outreach' ? outreachFor(userId, ids) : Promise.resolve(null),
      params.include === 'deals' ? dealsFor(userId, ids) : Promise.resolve(null),
    ]);
    const contacts = (data || []).map((c: any) => ({
      ...c,
      is_suppressed: suppressed.has(String(c.email || '').toLowerCase()),
      tags: (c.contact_tags || []).map((ct: any) => ct.tags).filter(Boolean),
      lists: (c.list_contacts || []).map((lc: any) => lc.contact_lists).filter(Boolean),
      contact_tags: undefined,
      list_contacts: undefined,
      in_list: undefined,
      has_tag: undefined,
      co_filter: undefined,
      ...(outreachById ? { outreach: outreachById.get(c.id) ?? null } : {}),
      ...(dealsById ? { deals: dealsById.get(c.id) ?? null } : {}),
      // The 360 profile is read on the contact's own page; a hundred of
      // them would only slow the list down.
      enrichment: undefined,
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
      .select('*, contact_tags(tag_id, tags(*)), list_contacts(contact_lists(id, name, kind, color, is_trashed))')
      .eq('id', id)
      .eq('user_id', userId)
      // maybeSingle, not single: .single() turns "no such contact" into a
      // PostgREST error, which surfaced as a 500 instead of the 404 below.
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Contact not found', 404);

    const [suppressed, outreach] = await Promise.all([
      suppressedEmails(userId, [data.email]),
      outreachFor(userId, [data.id]),
    ]);
    return {
      ...data,
      is_suppressed: suppressed.has(String(data.email || '').toLowerCase()),
      tags: (data.contact_tags || []).map((ct: any) => ct.tags).filter(Boolean),
      // Where this person stands in outreach and which lists hold them, so
      // the profile, the peek and the company page all say the same thing.
      outreach: outreach.get(data.id) ?? null,
      lists: (data.list_contacts || []).map((lc: any) => lc.contact_lists).filter((l: any) => l && !l.is_trashed),
      contact_tags: undefined,
      list_contacts: undefined,
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

  async create(userId: string, input: any, opts: {
    /** Where they came from, when it is not a person typing (the public API says 'api'). */
    source?: string;
    /** Set outright, rather than read from the Leads-page convention below. */
    lifecycle?: 'prospect' | 'contact' | 'customer';
  } = {}) {
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
     *
     * Except from the Leads page, which asks for a lead: filed as a contact,
     * the person you just added would vanish from the page you added them on.
     */
    const lifecycle = opts.lifecycle ?? (input?.lifecycle === 'prospect' ? 'prospect' : 'contact');
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        ...contactData,
        user_id: userId,
        source: opts.source || 'manual',
        ...(lifecycle === 'prospect'
          ? { lifecycle: 'prospect' }
          : { lifecycle, engaged_at: new Date().toISOString(), promoted_by: 'manual' }),
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
    options: {
      /** What happens to people already here: see migration 109. */
      mode?: ImportMode;
      /** Existing tags to put on everyone in the batch. */
      tagIds?: string[];
    } = {},
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
    /** Ids of the contacts this batch created, so the import can be undone. */
    created_ids?: string[];
    error_details: { email: string; reason: string }[];
  }> {
    const total = contacts.length;
    const mode: ImportMode = IMPORT_MODES.includes(options.mode as ImportMode) ? options.mode as ImportMode : 'fill';
    const cleanSource = (importSource || '').trim().slice(0, 200) || null;
    const errorDetails: { email: string; reason: string }[] = [];
    const valid: any[] = [];
    const ALLOWED_FIELDS = new Set<string>(IMPORT_FIELDS);
    /** Tag names per address, from a Tags column. */
    const tagNamesByEmail = new Map<string, string[]>();

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
      if (Array.isArray(c.tags)) {
        const names = c.tags
          .map((t: unknown) => (typeof t === 'string' ? t.trim().replace(/\s+/g, ' ').slice(0, 50) : ''))
          .filter(Boolean)
          .slice(0, 20);
        if (names.length) tagNamesByEmail.set(email, [...new Set([...(tagNamesByEmail.get(email) || []), ...names])]);
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
    let { data: merged, error: mergeError } = await supabaseAdmin
      .rpc('import_contacts_merge', { p_user_id: userId, p_rows: uniqueValid, p_mode: mode });
    if (mergeError && /p_mode|schema cache|PGRST202/i.test(`${mergeError.message} ${(mergeError as any).code}`)) {
      /*
       * Migration 109 not run yet: the two-argument function fills blanks
       * only and does not know the new columns, which it ignores rather
       * than failing on. Say so once in the log; the import still works.
       */
      console.warn('[Contacts] import_contacts_merge(p_mode) missing - run migration 109_import_export_fields.sql. Importing with fill-blanks only; country, city, state, industry and company details are not saved.');
      ({ data: merged, error: mergeError } = await supabaseAdmin
        .rpc('import_contacts_merge', { p_user_id: userId, p_rows: uniqueValid }));
    }

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
      const LEGACY = new Set(['email', 'first_name', 'last_name', 'company', 'job_title', 'phone', 'linkedin_url', 'website', 'location', 'custom_fields', 'import_source']);
      const inserts = uniqueValid.map((r) => ({
        ...Object.fromEntries(Object.entries(r).filter(([k]) => LEGACY.has(k))),
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

    // Anyone held without an email who has now arrived with one is released.
    if (importedRows.length > 0) await heldPeopleService.releaseMatches(userId, uniqueValid);

    // Tags: the ones picked for the whole import, and any from a Tags column.
    if (importedRows.length > 0 && (tagNamesByEmail.size > 0 || (options.tagIds || []).length > 0)) {
      try {
        await tagImported(userId, importedRows, tagNamesByEmail, options.tagIds || []);
      } catch (e: any) {
        errorDetails.push({ email: '(tags)', reason: e?.message || 'Tags could not be added' });
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
      created_ids: importedRows.filter((r) => r.inserted === true).map((r) => r.id),
      error_details: errorDetails.slice(0, 200),
    };
  },

  /**
   * Every id the list would show for these filters - for "Select all N
   * matching", so a filtered audience can be put in a campaign, edited or
   * enriched in one go. Capped, and says when it was.
   */
  async matchingIds(userId: string, params: ListParams, cap = 10_000): Promise<{ ids: string[]; total: number; capped: boolean }> {
    const tagIds = Array.isArray(params.tag_ids) ? params.tag_ids.filter(Boolean) : params.tag_ids ? [String(params.tag_ids)] : [];
    const listScoped = !!params.list_id && !isUnlisted(params.list_id);
    const outreach = (LEAD_OUTREACH_STATES as string[]).includes(params.outreach || '') ? params.outreach! : null;
    const select = [
      'id',
      companyFilterJoin(params),
      listScoped ? 'in_list:list_contacts!inner(list_id)' : null,
      tagIds.length > 0 ? 'has_tag:contact_tags!inner(tag_id)' : null,
    ].filter(Boolean).join(', ');
    const ids: string[] = [];
    let total = 0;
    for (let from = 0; from < cap; from += 1000) {
      let q = supabaseAdmin.from('contacts').select(select, { count: from === 0 ? 'exact' : undefined })
        .eq('user_id', userId)
        .not('email', 'like', `%@${REPLY_CHECK_CONTACT_DOMAIN}`);
      q = applyContactFilters(q, params, { listScoped, tagIds, outreach });
      const { data, error, count } = await q.order('created_at', { ascending: false }).order('id').range(from, Math.min(from + 999, cap - 1));
      if (error) throw new AppError(error.message, 500);
      if (from === 0) total = count || 0;
      for (const r of (data || []) as any[]) ids.push(r.id);
      if (!data || data.length < 1000) break;
    }
    return { ids, total, capped: total > ids.length };
  },

  /**
   * The values the filter menu offers, commonest first: what this page's
   * people actually have for country, city, state and industry, and what
   * their companies have for size and industry.
   */
  async facets(userId: string, lifecycle?: string): Promise<PersonFacets> {
    const tally = () => new Map<string, { value: string; count: number }>();
    const t = { country: tally(), city: tally(), state: tally(), industry: tally(), company_size: tally(), company_industry: tally() };
    const add = (m: Map<string, { value: string; count: number }>, v: unknown) => {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) return;
      const k = s.toLowerCase();
      const hit = m.get(k);
      if (hit) hit.count++; else m.set(k, { value: s, count: 1 });
    };
    // Sampled at 20,000 people: enough for every value worth a menu entry.
    for (let from = 0; from < 20_000; from += 1000) {
      let q = supabaseAdmin.from('contacts').select('country, city, state, industry, companies(size, industry)').eq('user_id', userId);
      q = applyLifecycle(q, lifecycle);
      const { data, error } = await q.order('id').range(from, from + 999);
      if (error) {
        // Before migration 109 there are no such columns: no facets, not an error page.
        if (/country|city|state|industry/.test(error.message || '')) break;
        throw new AppError(error.message, 500);
      }
      for (const r of (data || []) as any[]) {
        add(t.country, r.country); add(t.city, r.city); add(t.state, r.state); add(t.industry, r.industry);
        add(t.company_size, r.companies?.size); add(t.company_industry, r.companies?.industry);
      }
      if (!data || data.length < 1000) break;
    }
    const top = (m: Map<string, { value: string; count: number }>) => [...m.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 60);
    return {
      country: top(t.country), city: top(t.city), state: top(t.state), industry: top(t.industry),
      company_size: top(t.company_size), company_industry: top(t.company_industry),
    };
  },

  /**
   * How many of these contacts are each light, for the launch screen.
   * Unverified is counted on its own as well, because "verify them first"
   * is the thing to offer when amber is mostly unchecked.
   */
  /**
   * With `amberIds`, also who is amber (at most 5,000): the launch screen's
   * "Verify the unsure now" checks exactly those, not the whole audience.
   */
  async lightCounts(userId: string, contactIds: string[], opts: { amberIds?: boolean } = {}): Promise<{ green: number; amber: number; red: number; unverified: number; amber_ids?: string[] }> {
    const ids = [...new Set((contactIds || []).filter((x) => typeof x === 'string'))].slice(0, 100_000);
    const out: { green: number; amber: number; red: number; unverified: number; amber_ids?: string[] } = { green: 0, amber: 0, red: 0, unverified: 0 };
    if (opts.amberIds) out.amber_ids = [];
    if (ids.length === 0) return out;
    const rows = await selectInChunks(ids, (slice) =>
      supabaseAdmin.from('contacts').select('id, email, is_bounced, dcs_verified_at, dcs_score, dcs_syntax_ok, dcs_domain_ok').eq('user_id', userId).in('id', slice));
    for (const r of rows) {
      const state = emailState(r);
      if (state === 'unverified') out.unverified++;
      const light = state === 'valid' ? 'green' : state === 'risky' || state === 'unverified' ? 'amber' : state === 'no_email' ? null : 'red';
      if (light) out[light]++;
      if (light === 'amber' && out.amber_ids && out.amber_ids.length < 5000) out.amber_ids.push(r.id);
    }
    return out;
  },

  /**
   * Before an import starts: of these addresses, how many are already
   * here and how many are suppressed. The review screen shows the answer,
   * so "Import 4,000" is not followed by "3,100 already existed".
   */
  async importPreflight(userId: string, emails: string[]): Promise<{ existing: number; suppressed: number; checked: number }> {
    const wanted = [...new Set((emails || []).filter((e) => typeof e === 'string').map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 50_000);
    if (wanted.length === 0) return { existing: 0, suppressed: 0, checked: 0 };
    const rows = await selectInChunks(wanted, (slice) =>
      supabaseAdmin.from('contacts').select('email').eq('user_id', userId).in('email', slice));
    const suppressed = await suppressedEmails(userId, wanted);
    return { existing: new Set(rows.map((r: any) => String(r.email).toLowerCase())).size, suppressed: suppressed.size, checked: wanted.length };
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
    const IMPORT_ALLOWED_FIELDS = new Set<string>(IMPORT_FIELDS);

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

  /**
   * Export contacts: the selection, a segment, or a view (list, lifecycle
   * and the page's filters), as CSV, as a table for an Excel file, or as
   * raw JSON for API callers.
   */
  async export(userId: string, opts: ExportOptions = {}) {
    const format = opts.format === 'json' || opts.format === 'table' ? opts.format : 'csv';
    const columns = resolveExportColumns(opts.columns);
    const contactIds = Array.isArray(opts.contactIds) ? opts.contactIds.filter((x) => typeof x === 'string') : [];

    /*
     * Paged, or chunked, but never one bare select.
     *
     * A bare select comes back capped at 1,000 rows, so "Export all" on an
     * account of 4,000 contacts produced a tidy CSV of the first thousand
     * and said nothing about the rest - the kind of loss nobody notices
     * until the other system is missing people.
     */
    const fetchWith = async (companyCols: string): Promise<any[]> => {
      const withJoins = `*, contact_tags(tags(name)), list_contacts(contact_lists(name)), company_rec:companies(${companyCols})`;
      if (contactIds.length > 0) {
        return selectInChunks(contactIds, (slice) =>
          supabaseAdmin.from('contacts').select(withJoins).eq('user_id', userId).in('id', slice));
      }
      if (opts.segmentId) {
        const segment = await segmentsService.get(userId, opts.segmentId);
        const ids = await segmentsService.getMatchingContactIds(userId, segment.filter_config);
        return selectInChunks(ids, (slice) =>
          supabaseAdmin.from('contacts').select(withJoins).eq('user_id', userId).in('id', slice));
      }
      const params: ListParams = {
        list_id: opts.listId, lifecycle: opts.lifecycle, search: opts.search, company: opts.company,
        outreach: opts.outreach, verification_status: opts.verificationStatus, lights: opts.lights,
        ...sanitizePersonFilters(opts.filters),
        tag_ids: Array.isArray(opts.tagIds) ? opts.tagIds : undefined,
      };
      const tagIds = (params.tag_ids || []).filter(Boolean);
      const listScoped = !!params.list_id && !isUnlisted(params.list_id);
      const outreach = (LEAD_OUTREACH_STATES as string[]).includes(params.outreach || '') ? params.outreach! : null;
      const select = [
        withJoins,
        companyFilterJoin(params),
        listScoped ? 'in_list:list_contacts!inner(list_id)' : null,
        tagIds.length > 0 ? 'has_tag:contact_tags!inner(tag_id)' : null,
      ].filter(Boolean).join(', ');
      return fetchAllPages((from, to) => {
        let q = supabaseAdmin
          .from('contacts')
          .select(select)
          .eq('user_id', userId)
          .not('email', 'like', `%@${REPLY_CHECK_CONTACT_DOMAIN}`);
        q = applyContactFilters(q, params, { listScoped, tagIds, outreach });
        return q.order('created_at', { ascending: true }).order('id').range(from, to);
      });
    };

    let data: any[];
    try {
      try {
        data = await fetchWith('website, linkedin_url, size, industry, location, phone');
      } catch (err: any) {
        // companies.phone arrives with migration 109; export without it until then.
        if (!/phone/.test(err?.message || '')) throw err;
        data = await fetchWith('website, linkedin_url, size, industry, location');
      }
    } catch (err: any) {
      assertListCountColumn(err);
      throw new AppError(err?.message || 'Could not export contacts', 500);
    }

    const rows = (data || []).map((r: any) => {
      const { contact_tags, list_contacts, in_list: _l, has_tag: _t, co_filter: _c, enrichment: _e, engagement_factors: _f, ...rest } = r;
      return {
        ...rest,
        tag_names: (contact_tags || []).map((ct: any) => ct?.tags?.name).filter(Boolean),
        list_names: (list_contacts || []).map((lc: any) => lc?.contact_lists?.name).filter(Boolean),
      };
    });

    if (format === 'json') return { data: rows, format: 'json' as const };
    const sheet = buildContactExport(rows, columns);
    if (format === 'table') return { data: sheet, format: 'table' as const };
    return { data: toCsv(sheet.header, sheet.rows), format: 'csv' as const };
  },

  // Verification-status breakdown for the summary pills. Scoped to a list when
  // given. Buckets mirror the client's derived states so the counts line up.
  async verificationBreakdown(userId: string, listId?: string, lifecycle?: string) {
    const empty = { total: 0, valid: 0, risky: 0, invalid: 0, not_found: 0, unverified: 0, with_linkedin: 0, no_email: 0 };
    // People held without an email (migration 110), on the same scope.
    const noEmail = await heldPeopleService.count(userId, listId, lifecycle);
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
        q = applyLifecycle(q, lifecycle);
        return q.order('id').range(from, to);
      });
    } catch (err: any) {
      assertListCountColumn(err);
      throw new AppError(err?.message || 'Could not count verification status', 500);
    }
    if (rows.length === 0) return { ...empty, no_email: noEmail };

    const out = { ...empty, total: rows.length, no_email: noEmail };
    for (const r of rows as any[]) {
      if (r.linkedin_url) out.with_linkedin++;
      // shared/email-light: the one definition the dots, chips and sender use.
      const state = emailState({ ...r, email: 'counted' });
      if (state === 'bounced') out.invalid++;
      else out[state as 'valid' | 'risky' | 'unverified' | 'invalid' | 'not_found']++;
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
