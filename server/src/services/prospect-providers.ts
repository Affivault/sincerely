// Prospect data provider adapters. Each adapter maps our neutral filter/person
// shapes onto one vendor's API, so the rest of the platform (credits, reveal
// flow, UI) never knows which vendor is behind the search.
//
// NOTE: endpoint shapes follow each vendor's public docs at time of writing -
// verify request/response fields against the provider dashboard before
// going to production, and mind their terms on caching/reselling data.

import { env } from '../config/env.js';
import { icypeasCallCredits, recordProviderUsage } from './provider-usage.service.js';
import { PROSPECT_FILTER_FIELDS, expandProspectLocations, prospectValueLabel } from '@lemlist/shared';
import type { CompanySearchFilters, CompanySearchResponse, DirectoryCompany, ProspectPerson, ProspectProviderId, ProspectSearchFilters } from '@lemlist/shared';

export interface ProviderSearchResult {
  results: ProspectPerson[];
  total: number;
  /** Emails discovered during search, kept server-side only (never sent to the client). */
  emailsById: Map<string, string>;
}

export interface ProspectProvider {
  id: ProspectProviderId;
  search(filters: ProspectSearchFilters, page: number, perPage: number): Promise<ProviderSearchResult>;
  /**
   * Fetch a work email for one person. Returns null when none is found.
   * `hint` is the search-row snapshot, for providers whose email finder works
   * from a name and a company rather than their own person id.
   */
  enrichEmail(personId: string, hint?: Partial<ProspectPerson>): Promise<{ email: string | null; person?: Partial<ProspectPerson> }>;
  /** How many people match, without spending credits. Null when the provider can't say for free. */
  count?(filters: ProspectSearchFilters): Promise<number | null>;
  /**
   * How many pages the provider would have to be paid for to show this one:
   * 0 when it is already held, more than 1 when a jump walks forward. Absent
   * means every search is a fresh, paid page.
   */
  pagesToFetch?(filters: ProspectSearchFilters, page: number, perPage: number): number;
}

const FETCH_TIMEOUT_MS = 20_000;

async function http(url: string, init: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.message || body?.message || body?.error || `${res.status} ${res.statusText}`;
      throw new Error(`Provider error: ${msg}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────── Icypeas ─────────────────── */

/*
 * Icypeas is the provider for customers: its terms grant the right to resell
 * and sublicense its data inside our own product, which Apollo's do not.
 * People search is the lead database (POST /find-people, 0.02 credit per
 * result, no emails). The email finder (POST /email-search) is asynchronous:
 * it returns a search id that is polled on /bulk-single-searchs/read until it
 * settles, and is only charged when an email is found.
 *
 * Request shapes follow https://api-doc.icypeas.com (v1.15). The docs do not
 * publish the response fields of a person lead or of a finished email search,
 * so both readers below accept the plausible spellings - confirm them against
 * a live response before launch.
 */

const ICYPEAS_BASE = 'https://app.icypeas.com/api';

/** Mutable so the check script can poll without real waits. */
export const icypeasPolling = { delaysMs: [1000, 1500, 2000, 2500, 3000, 3000, 4000, 4000, 4000] };

const ICYPEAS_PENDING = new Set(['NONE', 'SCHEDULED', 'IN_PROGRESS']);
const ICYPEAS_NOT_FOUND = new Set(['NOT_FOUND', 'DEBITED_NOT_FOUND', 'NOT_DEBITED']);
const ICYPEAS_FOUND = new Set(['FOUND', 'DEBITED']);

export async function icypeas(path: string, body?: unknown, method: 'POST' | 'GET' = 'POST'): Promise<any> {
  const data = await http(`${ICYPEAS_BASE}${path}`, {
    method,
    // Their auth header carries the bare API key, no "Bearer" prefix.
    headers: { 'Content-Type': 'application/json', Authorization: env.ICYPEAS_API_KEY },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  // Validation errors come back as HTTP 200 with success: false.
  if (data && data.success === false) {
    const v = Array.isArray(data.validationErrors) ? data.validationErrors[0] : null;
    const msg = v?.message || data.message || data.error || 'request rejected';
    throw new Error(`Provider error: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  recordProviderUsage(path, icypeasCallCredits(path, data));
  return data;
}

/* Icypeas has no seniority filter, so a seniority becomes the titles that mean it. */
const SENIORITY_TITLES: Record<string, string[]> = {
  owner: ['Owner', 'Founder', 'Co-Founder'],
  c_suite: ['CEO', 'CTO', 'CFO', 'COO', 'CMO', 'CRO', 'Chief'],
  vp: ['VP', 'Vice President'],
  director: ['Director', 'Head of'],
  manager: ['Manager'],
  senior: ['Senior', 'Lead'],
  entry: ['Junior', 'Associate', 'Assistant', 'Intern'],
};

const looksLikeDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, ''));
const clean = (values?: string[]) => (values || []).map((s) => s.trim()).filter(Boolean).slice(0, 200);
const include = (values: string[]) => ({ include: values });

export function icypeasQuery(filters: ProspectSearchFilters): Record<string, any> {
  const q: Record<string, any> = {};
  const titles = clean(filters.titles);
  // Titles say more than a seniority does, so seniority only fills in when no
  // title was given (both in one include list would OR them and widen the search).
  const seniorityTitles = [...new Set(clean(filters.seniorities).flatMap((s) => SENIORITY_TITLES[s.toLowerCase()] || []))];
  const jobTitles = titles.length ? titles : seniorityTitles;
  if (jobTitles.length) q.currentJobTitle = include(jobTitles);

  // Market groups widen to their countries; "UK" goes out as "GB".
  const locations = expandProspectLocations(clean(filters.locations));
  if (locations.length) q.location = include(locations);

  const industries = clean(filters.industries);
  if (industries.length) q['currentCompany.industry'] = include(industries);

  const companies = clean(filters.companies);
  const domains = companies.filter(looksLikeDomain).map((c) => c.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '').toLowerCase());
  const names = companies.filter((c) => !looksLikeDomain(c));
  if (names.length) q.currentCompanyName = include(names);
  if (domains.length) q.currentCompanyWebsite = include(domains);

  // One range per query, so several size buckets become their outer bounds.
  const ranges = clean(filters.companySizes)
    .map((r) => r.match(/^(\d+)\s*(?:-\s*(\d+)|\+)?$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ min: Number(m[1]), max: m[2] ? Number(m[2]) : Infinity }));
  if (ranges.length) {
    const min = Math.min(...ranges.map((r) => r.min));
    const max = Math.max(...ranges.map((r) => r.max));
    q['currentCompany.headcount'] = Number.isFinite(max) ? { '>=': min, '<=': max } : { '>=': min };
  }

  const keyword = filters.keywords?.trim();
  if (keyword) q.keyword = include([keyword]);

  applyAdvanced(q, filters.advanced);
  return q;
}

const FIELD_KINDS = new Map(PROSPECT_FILTER_FIELDS.map((f) => [f.key, f.kind]));
const LOCATION_FIELDS = new Set(['location', 'profileLocation', 'workLocation', 'currentCompany.location', 'pastCompany.location']);
const GROWTH_SPANS = new Set(['6months', '12months', '24months']);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/*
 * The rest of Icypeas's filters, passed through by name. Only known fields
 * go out (Icypeas rejects unknown keys and empty filter objects), text lists
 * merge with whatever the main panel set for the same field, and a range or
 * growth filter with neither bound is left off rather than sent empty.
 */
function applyAdvanced(q: Record<string, any>, advanced: ProspectSearchFilters['advanced']) {
  if (!advanced || typeof advanced !== 'object') return;
  for (const [key, raw] of Object.entries(advanced)) {
    const kind = FIELD_KINDS.get(key);
    if (!kind || !raw || typeof raw !== 'object') continue;
    const value = raw as Record<string, any>;
    if (kind === 'text') {
      const read = (v: unknown) => {
        const list = clean(Array.isArray(v) ? v.map(String) : []);
        return LOCATION_FIELDS.has(key) ? expandProspectLocations(list) : list;
      };
      const inc = [...new Set([...(q[key]?.include || []), ...read(value.include)])].slice(0, 200);
      const exc = [...new Set([...(q[key]?.exclude || []), ...read(value.exclude)])].slice(0, 200);
      if (!inc.length && !exc.length) continue;
      q[key] = { ...(inc.length ? { include: inc } : {}), ...(exc.length ? { exclude: exc } : {}) };
    } else if (kind === 'range') {
      const min = num(value.min), max = num(value.max);
      if (min === null && max === null) continue;
      q[key] = { ...(min !== null ? { '>=': min } : {}), ...(max !== null ? { '<=': max } : {}) };
    } else {
      const min = num(value.min), max = num(value.max);
      if (min === null && max === null) continue;
      const clamp = (n: number) => Math.min(10000, Math.max(-100, n));
      q[key] = {
        timespan: GROWTH_SPANS.has(value.timespan) ? value.timespan : '12months',
        ...(min !== null ? { min: clamp(min) } : {}),
        ...(max !== null ? { max: clamp(max) } : {}),
      };
    }
  }
}

const pick = (...values: any[]) => {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
};
const domainOf = (url: string | null) => {
  if (!url) return null;
  const host = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '').toLowerCase();
  return host.includes('.') ? host : null;
};

export function icypeasLeadToProspect(lead: any): ProspectPerson {
  // The current job may sit on the lead itself or as the first experience.
  const job = (Array.isArray(lead.experiences) && lead.experiences[0]) || (Array.isArray(lead.positions) && lead.positions[0]) || {};
  const company = lead.currentCompany || lead.company || job.company || {};
  const first = pick(lead.firstname, lead.firstName, lead.first_name);
  const last = pick(lead.lastname, lead.lastName, lead.last_name);
  const linkedin = pick(lead.profileUrl, lead.linkedinUrl, lead.url, lead.publicProfileUrl);
  const website = pick(lead.lastCompanyWebsite, lead.currentCompanyWebsite, company.website, job.companyWebsite, company.domain);
  const size = company.numberOfEmployees ?? company.headcount ?? lead.lastCompanyNumberOfEmployees;
  return {
    // Icypeas's own id, else the profile URL: stable across searches either way.
    id: String(pick(lead.lid, lead._id, lead.id, lead.urn) || linkedin || [first, last, website].filter(Boolean).join('|')),
    provider: 'icypeas',
    first_name: first,
    last_name: last,
    full_name: pick(lead.fullname, lead.fullName, lead.name) || [first, last].filter(Boolean).join(' ') || 'Unknown',
    job_title: pick(lead.lastJobTitle, lead.currentJobTitle, lead.jobTitle, job.title, lead.headline),
    company: pick(lead.lastCompanyName, lead.currentCompanyName, lead.companyName, company.name, job.companyName),
    company_domain: domainOf(website),
    company_size: size !== undefined && size !== null && size !== '' ? String(size) : null,
    industry: pick(lead.lastCompanyIndustry, company.industry, lead.industry),
    location: pick(lead.address, lead.location, lead.profileLocation),
    linkedin_url: linkedin ? (linkedin.startsWith('http') ? linkedin : `https://${linkedin}`) : null,
    // The lead database holds no emails; whether one exists is only known at
    // reveal, which refunds the credit when it is not found.
    has_email: true,
  };
}

/*
 * Pages are token-chained (each response carries the token for the next one),
 * so results are fetched in chunks, kept per query for a few minutes, and our
 * 25-a-page numbering is cut out of them. A jump past the furthest chunk seen
 * walks forward to it.
 *
 * Icypeas charges 0.02 credit for every result it returns, so a chunk is one
 * of our pages. Leaving the size off returns Icypeas's default of 100: 2
 * credits for a search that showed 25 people.
 */
interface IcypeasChunks { chunks: Map<number, any[]>; tokens: Map<number, string>; size: number; total: number; at: number }
const queryChunks = new Map<string, IcypeasChunks>();
const CHUNK_TTL_MS = 10 * 60 * 1000;
const CHUNK_KEYS_MAX = 200;
const ICYPEAS_PAGE_SIZE = 25;

function chunksFor(key: string): IcypeasChunks {
  const now = Date.now();
  for (const [k, v] of queryChunks) if (now - v.at > CHUNK_TTL_MS) queryChunks.delete(k);
  let entry = queryChunks.get(key);
  if (!entry) {
    if (queryChunks.size >= CHUNK_KEYS_MAX) queryChunks.delete(queryChunks.keys().next().value as string);
    entry = { chunks: new Map(), tokens: new Map(), size: ICYPEAS_PAGE_SIZE, total: 0, at: now };
    queryChunks.set(key, entry);
  }
  return entry;
}

async function icypeasChunk(query: Record<string, any>, entry: IcypeasChunks, n: number, path = '/find-people'): Promise<any[] | null> {
  const have = entry.chunks.get(n);
  if (have) return have;
  if (n > 1 && !entry.chunks.has(n - 1) && !entry.tokens.has(n)) {
    if (!(await icypeasChunk(query, entry, n - 1, path))) return null;
  }
  const token = entry.tokens.get(n);
  if (n > 1 && !token) return null; // the previous chunk was the last one
  const data = await icypeas(path, { query, pagination: n === 1 ? { size: entry.size } : { token, size: entry.size } });
  const leads = (Array.isArray(data?.leads) ? data.leads : []).map((lead: any) => (lead?._source ? { _id: lead._id, ...lead._source } : lead));
  entry.total = Number(data?.total) || entry.total;
  const next = data?.pagination?.token;
  if (typeof next === 'string' && next && leads.length >= entry.size) entry.tokens.set(n + 1, next);
  entry.chunks.set(n, leads);
  entry.at = Date.now();
  return leads;
}

/**
 * How many chunks showing this page would pay for: 0 when it is held, more
 * than 1 when a jump has to walk forward from the last one held.
 */
export function icypeasPagesToFetch(path: string, query: Record<string, any>, page: number, perPage: number): number {
  const entry = queryChunks.get(`${path} ${JSON.stringify(query)}`);
  const size = entry && Date.now() - entry.at <= CHUNK_TTL_MS ? entry.size : ICYPEAS_PAGE_SIZE;
  const last = Math.floor(((page - 1) * perPage + perPage - 1) / size) + 1;
  if (!entry || Date.now() - entry.at > CHUNK_TTL_MS) return last;
  let missing = 0;
  for (let n = last; n >= 1 && !entry.chunks.has(n); n--) {
    missing++;
    if (entry.tokens.has(n)) break;
  }
  return missing;
}

/** One of our 25-a-page pages, cut from Icypeas's chunks. A page can straddle two. */
async function icypeasPage(path: string, query: Record<string, any>, page: number, perPage: number) {
  const entry = chunksFor(`${path} ${JSON.stringify(query)}`);
  const from = (page - 1) * perPage;
  const leads: any[] = [];
  while (leads.length < perPage) {
    const at = from + leads.length;
    const n = Math.floor(at / entry.size) + 1;
    const chunk = await icypeasChunk(query, entry, n, path);
    if (!chunk) break;
    const slice = chunk.slice(at - (n - 1) * entry.size, at - (n - 1) * entry.size + perPage - leads.length);
    if (!slice.length) break;
    leads.push(...slice);
  }
  return { leads, entry, from };
}

/*
 * Company search through Icypeas's company database, for when our own free
 * directory is not loaded. Same cost as a people search: Icypeas charges a
 * small amount per company returned, and no Sincerely credits are spent.
 * Its query takes name, domain, industry, location and a headcount range.
 */
export function icypeasCompanyQuery(filters: CompanySearchFilters): Record<string, any> {
  const q: Record<string, any> = {};
  const companies = clean(filters.companies);
  const domains = companies.filter(looksLikeDomain).map((c) => c.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '').toLowerCase());
  const names = companies.filter((c) => !looksLikeDomain(c));
  if (names.length) q.name = include(names);
  if (domains.length) q.domain = include(domains);
  const industries = clean(filters.industries);
  if (industries.length) q.industry = include(industries);
  const locations = expandProspectLocations(clean(filters.locations));
  if (locations.length) q.location = include(locations);
  const ranges = clean(filters.companySizes)
    .map((r) => r.match(/^(\d+)\s*(?:-\s*(\d+)|\+)?$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ min: Number(m[1]), max: m[2] ? Number(m[2]) : Infinity }));
  if (ranges.length) {
    const min = Math.min(...ranges.map((r) => r.min));
    const max = Math.max(...ranges.map((r) => r.max));
    q.headcount = Number.isFinite(max) ? { '>=': min, '<=': max } : { '>=': min };
  }
  return q;
}

const domainFrom = (url: unknown) => {
  const host = String(url ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
  return host.includes('.') && !host.includes('linkedin.com') ? host : null;
};

/** One company from Icypeas's database, in the directory's shape. */
export function icypeasCompanyToDirectory(lead: any): DirectoryCompany {
  const domain = domainFrom(lead.website) || domainFrom(lead.domain);
  const employees = lead.numberOfEmployees ?? lead.headcount;
  return {
    id: String(lead.lid || lead._id || lead.urn || domain || lead.name),
    name: String(lead.name || domain || 'Unknown company'),
    domain,
    linkedin_url: typeof lead.url === 'string' && /linkedin\.com/i.test(lead.url) ? lead.url.replace(/\/$/, '') : null,
    founded: Number(lead.founded ?? lead.foundedOn?.year) || null,
    size: employees != null && employees !== '' ? String(employees) : null,
    industry: lead.industry ? String(lead.industry) : null,
    country: null,
    region: null,
    locality: typeof lead.address === 'string' ? lead.address : null,
    description: typeof lead.description === 'string' ? lead.description : null,
  };
}

/* Companies seen in a company search, by domain, so the company panel can show them for free. */
const seenCompanies = new Map<string, { lead: any; at: number }>();
const COMPANIES_MAX = 2000;

/** A company from a recent company search, while it is still held. */
export function cachedCompany(domain: string): any | null {
  const hit = seenCompanies.get(domain.toLowerCase());
  return hit && Date.now() - hit.at < SEEN_TTL_MS ? hit.lead : null;
}

/** Pages a company search would pay for (see icypeasPagesToFetch). */
export function icypeasCompanyPagesToFetch(filters: CompanySearchFilters, page: number, perPage = 25): number {
  return icypeasPagesToFetch('/find-companies', icypeasCompanyQuery(filters), page, perPage);
}

export async function icypeasCompanySearch(filters: CompanySearchFilters, page: number, perPage = 25): Promise<CompanySearchResponse> {
  const query = icypeasCompanyQuery(filters);
  if (!Object.keys(query).length) throw new Error('Add at least one filter to search companies.');
  const { leads, entry, from } = await icypeasPage('/find-companies', query, page, perPage);
  const results = leads.map(icypeasCompanyToDirectory);
  results.forEach((c, i) => {
    if (!c.domain) return;
    if (seenCompanies.size >= COMPANIES_MAX) seenCompanies.delete(seenCompanies.keys().next().value as string);
    seenCompanies.set(c.domain, { lead: leads[i], at: Date.now() });
  });
  return { results, page, total: entry.total || from + results.length, source: 'icypeas' };
}

/*
 * The whole lead of each person seen in search, already paid for, so the
 * Prospector's person panel can show more than the table without spending
 * anything. Bounded: an hour, and the most recent few thousand people.
 */
const seenLeads = new Map<string, { lead: any; at: number }>();
const LEADS_MAX = 3000;

function keepLead(id: string, lead: any) {
  if (seenLeads.has(id)) seenLeads.delete(id);
  else if (seenLeads.size >= LEADS_MAX) seenLeads.delete(seenLeads.keys().next().value as string);
  seenLeads.set(id, { lead, at: Date.now() });
}

/** The raw lead behind a search row, while it is still held. */
export function cachedLead(personId: string): any | null {
  const hit = seenLeads.get(personId);
  return hit && Date.now() - hit.at < SEEN_TTL_MS ? hit.lead : null;
}

/* Name and company of people seen in search, so a reveal does not depend on the client's copy. */
const seenPeople = new Map<string, { first: string | null; last: string | null; company: string | null; at: number }>();
const SEEN_TTL_MS = 60 * 60 * 1000;
const SEEN_MAX = 20_000;

function remember(person: ProspectPerson) {
  if (seenPeople.size >= SEEN_MAX) {
    const cutoff = Date.now() - SEEN_TTL_MS;
    for (const [k, v] of seenPeople) if (v.at < cutoff) seenPeople.delete(k);
    if (seenPeople.size >= SEEN_MAX) seenPeople.delete(seenPeople.keys().next().value as string);
  }
  seenPeople.set(person.id, {
    first: person.first_name, last: person.last_name,
    company: person.company_domain || person.company, at: Date.now(),
  });
}

/** One finished email search: the address, or null when Icypeas found none. */
export function icypeasEmailFromItem(item: any): string | null {
  const results = item?.results;
  const emails: any[] = Array.isArray(results?.emails) ? results.emails
    : Array.isArray(results) ? results.flatMap((r: any) => (Array.isArray(r?.emails) ? r.emails : [r]))
    : Array.isArray(item?.emails) ? item.emails : [];
  for (const e of emails) {
    const address = typeof e === 'string' ? e : e?.email;
    if (typeof address === 'string' && address.includes('@')) return address.trim();
  }
  return null;
}

/*
 * What a settled search cost: the finder charges 1 credit for a found email,
 * the verifier 0.1 for every address it tests.
 */
const SETTLED_CREDITS: Record<'email-search' | 'email-verification', (found: boolean) => number> = {
  'email-search': (found) => (found ? 1 : 0),
  'email-verification': () => 0.1,
};

export async function icypeasAwait(searchId: string, kind: 'email-search' | 'email-verification' = 'email-search'): Promise<any> {
  for (const delay of icypeasPolling.delaysMs) {
    await new Promise((r) => setTimeout(r, delay));
    const data = await icypeas('/bulk-single-searchs/read', { id: searchId });
    const item = data.item || (Array.isArray(data.items) ? data.items[0] : null);
    const status = String(item?.status || 'NONE').toUpperCase();
    if (ICYPEAS_PENDING.has(status)) continue;
    if (ICYPEAS_FOUND.has(status) || ICYPEAS_NOT_FOUND.has(status)) {
      recordProviderUsage(`/${kind}`, SETTLED_CREDITS[kind](ICYPEAS_FOUND.has(status)));
      return { ...item, status };
    }
    if (status === 'INSUFFICIENT_FUNDS') throw new Error('Provider error: the Icypeas account is out of credits');
    throw new Error(`Provider error: email search ended ${status}`);
  }
  // Thrown, so the reveal refunds; Icypeas only charges if it later finds one.
  throw new Error('Provider error: the email search is taking too long, try again in a minute');
}

/*
 * Our own Icypeas balance, for the admin page. The route takes the account's
 * email and its answer's fields are undocumented, so the first credit-like
 * number found is used and the keys are logged when none is.
 */
export async function icypeasBalance(email: string): Promise<number | null> {
  const data = await icypeas('/a/actions/subscription-information', { email });
  const seen = new Set<any>();
  const walk = (v: any, depth: number): number | null => {
    if (!v || typeof v !== 'object' || depth > 4 || seen.has(v)) return null;
    seen.add(v);
    for (const [k, x] of Object.entries(v)) {
      if (/credit/i.test(k) && !/used|spent|consumed|total|max|limit/i.test(k)) {
        const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN;
        if (Number.isFinite(n)) return n;
      }
    }
    for (const x of Object.values(v)) {
      const n = walk(x, depth + 1);
      if (n !== null) return n;
    }
    return null;
  };
  const credits = walk(data, 0);
  if (credits === null) console.log(`[Icypeas] subscription-information keys: ${Object.keys(data || {}).join(',')}`);
  return credits;
}

/* Counts are free on Icypeas but rate limited, and the panel asks on every change. */
const counts = new Map<string, { total: number; at: number }>();
const COUNT_TTL_MS = 5 * 60 * 1000;

/** The match count from a find-people/count response; the docs don't show its shape. */
export function icypeasCountFrom(data: any): number | null {
  for (const v of [data?.total, data?.count, data?.nbResults, data?.item?.total, data?.item?.count, data?.data?.total]) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export const icypeasProvider: ProspectProvider = {
  id: 'icypeas',
  pagesToFetch(filters, page, perPage) {
    return icypeasPagesToFetch('/find-people', icypeasQuery(filters), page, perPage);
  },
  async count(filters) {
    const query = icypeasQuery(filters);
    if (!Object.keys(query).length) return null;
    const key = JSON.stringify(query);
    const hit = counts.get(key);
    if (hit && Date.now() - hit.at < COUNT_TTL_MS) return hit.total;
    const total = icypeasCountFrom(await icypeas('/find-people/count', { query }));
    if (total !== null) {
      if (counts.size >= 500) counts.delete(counts.keys().next().value as string);
      counts.set(key, { total, at: Date.now() });
    }
    return total;
  },
  async search(filters, page, perPage) {
    const query = icypeasQuery(filters);
    const { leads, entry, from } = await icypeasPage('/find-people', query, page, perPage);
    const results = leads.map(icypeasLeadToProspect);
    results.forEach(remember);
    results.forEach((person, i) => keepLead(person.id, leads[i]));
    return { results, total: entry.total || from + results.length, emailsById: new Map() };
  },
  async enrichEmail(personId, hint) {
    const seen = seenPeople.get(personId);
    const first = seen?.first ?? pick(hint?.first_name);
    const last = seen?.last ?? pick(hint?.last_name);
    const company = seen?.company ?? pick(hint?.company_domain, hint?.company);
    // Nothing to search with means nothing found: the caller refunds.
    if (!(first || last) || !company) return { email: null };

    const started = await icypeas('/email-search', { firstname: first || '', lastname: last || '', domainOrCompany: company });
    const searchId = started?.item?._id || started?._id;
    if (!searchId) throw new Error('Provider error: Icypeas did not return a search id');
    const item = await icypeasAwait(String(searchId), 'email-search');
    return { email: ICYPEAS_NOT_FOUND.has(item.status) ? null : icypeasEmailFromItem(item) };
  },
};

/* ─────────────────── People Data Labs ─────────────────── */

function pdlPersonToProspect(p: any): ProspectPerson {
  const email = p.work_email || (Array.isArray(p.emails) ? p.emails.find((e: any) => e?.type === 'professional')?.address : null) || null;
  return {
    id: String(p.id),
    provider: 'pdl',
    first_name: p.first_name || null,
    last_name: p.last_name || null,
    full_name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown',
    job_title: p.job_title || null,
    company: p.job_company_name || null,
    company_domain: p.job_company_website || null,
    company_size: p.job_company_size || null,
    industry: p.industry || p.job_company_industry || null,
    location: p.location_name || [p.location_locality, p.location_country].filter(Boolean).join(', ') || null,
    linkedin_url: p.linkedin_url ? (p.linkedin_url.startsWith('http') ? p.linkedin_url : `https://${p.linkedin_url}`) : null,
    has_email: !!email,
  };
}

function pdlQuery(filters: ProspectSearchFilters): any {
  const must: any[] = [];
  const terms = (field: string, values?: string[]) => {
    const v = (values || []).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (v.length) must.push({ terms: { [field]: v } });
  };
  if (filters.titles?.length) {
    must.push({ bool: { should: filters.titles.map((t) => ({ match: { job_title: t.toLowerCase() } })), minimum_should_match: 1 } });
  }
  terms('job_title_levels', filters.seniorities);
  terms('industry', filters.industries?.map((i) => i.toLowerCase()));
  terms('job_company_size', filters.companySizes);
  // PDL matches place names, so a group or a two-letter code goes out as country names.
  const locations = expandProspectLocations(filters.locations).map((l) => (/^[A-Z]{2}$/.test(l) ? prospectValueLabel(l) : l));
  if (locations.length) {
    must.push({ bool: { should: locations.map((l) => ({ match: { location_name: l.toLowerCase() } })), minimum_should_match: 1 } });
  }
  if (filters.companies?.length) {
    must.push({
      bool: {
        should: [
          ...filters.companies.map((c) => ({ match: { job_company_name: c.toLowerCase() } })),
          ...filters.companies.map((c) => ({ term: { job_company_website: c.toLowerCase() } })),
        ],
        minimum_should_match: 1,
      },
    });
  }
  if (filters.keywords?.trim()) {
    must.push({ match: { summary: filters.keywords.trim() } });
  }
  // Only return people PDL believes have a work email — reveals should succeed.
  must.push({ exists: { field: 'work_email' } });
  return { bool: { must } };
}

const pdlProvider: ProspectProvider = {
  id: 'pdl',
  async search(filters, page, perPage) {
    const body = {
      query: pdlQuery(filters),
      size: perPage,
      from: (page - 1) * perPage,
      dataset: 'resume',
    };
    const data = await http('https://api.peopledatalabs.com/v5/person/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': env.PDL_API_KEY },
      body: JSON.stringify(body),
    });
    const records: any[] = data.data || [];
    const emailsById = new Map<string, string>();
    const results = records.map((p) => {
      const person = pdlPersonToProspect(p);
      const email = p.work_email || null;
      if (email) emailsById.set(person.id, email);
      return person;
    });
    return { results, total: data.total ?? results.length, emailsById };
  },
  async enrichEmail(personId) {
    const data = await http(`https://api.peopledatalabs.com/v5/person/enrich?pdl_id=${encodeURIComponent(personId)}`, {
      method: 'GET',
      headers: { 'X-Api-Key': env.PDL_API_KEY },
    });
    const p = data.data || {};
    const person = pdlPersonToProspect({ ...p, id: personId });
    return { email: p.work_email || null, person };
  },
};

/* ─────────────────── Apollo ─────────────────── */

/*
 * INTERNAL TESTING ONLY. Apollo's API terms allow internal use only and forbid
 * using it to "replicate or compete with any Apollo products". Sincerely is a
 * direct competitor, so this adapter must never serve customers: it only runs
 * when ALLOW_APOLLO_PROVIDER=true is set alongside APOLLO_API_KEY.
 */

function apolloPersonToProspect(p: any): ProspectPerson {
  const org = p.organization || {};
  return {
    id: String(p.id),
    provider: 'apollo',
    first_name: p.first_name || null,
    last_name: p.last_name || null,
    full_name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown',
    job_title: p.title || null,
    company: org.name || null,
    company_domain: org.primary_domain || null,
    company_size: org.estimated_num_employees ? String(org.estimated_num_employees) : null,
    industry: org.industry || null,
    location: [p.city, p.state, p.country].filter(Boolean).join(', ') || null,
    linkedin_url: p.linkedin_url || null,
    // Apollo masks emails in search results; a locked/verified status still
    // signals one exists behind the reveal.
    has_email: p.email_status !== 'unavailable',
  };
}

const apolloProvider: ProspectProvider = {
  id: 'apollo',
  async search(filters, page, perPage) {
    const body: any = {
      page,
      per_page: perPage,
      person_titles: filters.titles?.length ? filters.titles : undefined,
      person_seniorities: filters.seniorities?.length ? filters.seniorities : undefined,
      person_locations: filters.locations?.length
        ? expandProspectLocations(filters.locations).map((l) => (/^[A-Z]{2}$/.test(l) ? prospectValueLabel(l) : l)) : undefined,
      organization_num_employees_ranges: filters.companySizes?.length
        ? filters.companySizes.map((r) => r.replace('-', ',')) : undefined,
      q_organization_keyword_tags: filters.industries?.length ? filters.industries : undefined,
      q_organization_name: filters.companies?.length ? filters.companies.join(' ') : undefined,
      q_keywords: filters.keywords?.trim() || undefined,
    };
    const data = await http('https://api.apollo.io/api/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': env.APOLLO_API_KEY },
      body: JSON.stringify(body),
    });
    const records: any[] = data.people || [];
    return {
      results: records.map(apolloPersonToProspect),
      total: data.pagination?.total_entries ?? records.length,
      emailsById: new Map(), // Apollo never exposes emails at search time
    };
  },
  async enrichEmail(personId) {
    const data = await http('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': env.APOLLO_API_KEY },
      body: JSON.stringify({ id: personId, reveal_personal_emails: false }),
    });
    const p = data.person || {};
    const email = p.email && !String(p.email).includes('not_unlocked') ? p.email : null;
    return { email, person: apolloPersonToProspect({ ...p, id: personId }) };
  },
};

/* ─────────────────── Registry ─────────────────── */

export function getActiveProvider(): ProspectProvider | null {
  if (env.ICYPEAS_API_KEY) return icypeasProvider;
  if (env.PDL_API_KEY) return pdlProvider;
  // A key alone is not enough: see the terms note above apolloProvider.
  if (env.APOLLO_API_KEY && env.ALLOW_APOLLO_PROVIDER) return apolloProvider;
  return null;
}
