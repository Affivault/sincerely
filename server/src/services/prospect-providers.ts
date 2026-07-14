// Prospect data provider adapters. Each adapter maps our neutral filter/person
// shapes onto one vendor's API, so the rest of the platform (credits, reveal
// flow, UI) never knows which vendor is behind the search.
//
// NOTE: endpoint shapes follow each vendor's public docs at time of writing —
// verify request/response fields against the provider dashboard before
// going to production, and mind their terms on caching/reselling data.

import { env } from '../config/env.js';
import type { ProspectPerson, ProspectProviderId, ProspectSearchFilters } from '@lemlist/shared';

export interface ProviderSearchResult {
  results: ProspectPerson[];
  total: number;
  /** Emails discovered during search, kept server-side only (never sent to the client). */
  emailsById: Map<string, string>;
}

export interface ProspectProvider {
  id: ProspectProviderId;
  search(filters: ProspectSearchFilters, page: number, perPage: number): Promise<ProviderSearchResult>;
  /** Fetch a work email for one person. Returns null when none is found. */
  enrichEmail(personId: string): Promise<{ email: string | null; person?: Partial<ProspectPerson> }>;
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
  if (filters.locations?.length) {
    must.push({ bool: { should: filters.locations.map((l) => ({ match: { location_name: l.toLowerCase() } })), minimum_should_match: 1 } });
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
      person_locations: filters.locations?.length ? filters.locations : undefined,
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
  if (env.PDL_API_KEY) return pdlProvider;
  if (env.APOLLO_API_KEY) return apolloProvider;
  return null;
}
