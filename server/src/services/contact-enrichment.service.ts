/* ═══════════════════════════════════════════════════════════════════════
   Enrich: the 360 profile behind the button on a contact's page.

   Only ever started by a person pressing Enrich. It never runs in the
   background, because each one spends credits. In order:

     1. The person. Their LinkedIn profile, found by name and company when
        the contact has no LinkedIn URL yet, then read with Icypeas's
        profile scraper: headline, summary, location, current role, career
        history, education, skills, languages.
     2. Their company. Our free company directory (the PDL dataset,
        migration 098) first, then the company's own profile through
        Icypeas: industry, headcount, founded, headquarters, description,
        specialties. A company profiled in the last 30 days is reused, so
        five people at one company pay for it once.
     3. Their email, through the same deep check the Verify buttons use.

   Blanks are filled on the contact and on its company record. Nothing a
   person typed is overwritten: where the profile disagrees with what is on
   file, the difference comes back as a suggestion the page can offer.

   Costs ENRICH_CREDIT_COST prospect credits, refunded when nothing at all
   is found. Icypeas does not publish the response shapes of its scrapers,
   so the readers below accept the plausible spellings, like the Prospector
   adapter does; the raw answers are not stored.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { billingService } from './billing.service.js';
import { companiesService } from './companies.service.js';
import { icypeas } from './prospect-providers.js';
import { verifyContact } from './verification.service.js';
import {
  ENRICH_CREDIT_COST, PLANS, emailDomain, isFreeMailDomain, normalizeLinkedinUrl, registrableDomain,
} from '@lemlist/shared';
import type {
  ContactEnrichment, EnrichContactResult, EnrichedCompany, EnrichedJob, EnrichedPerson, EnrichedSchool,
  EnrichmentSuggestion,
} from '@lemlist/shared';

const COMPANY_REUSE_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_REUSE_MS = 30 * 24 * 60 * 60 * 1000;
const running = new Set<string>();

/* ── Reading whatever shape comes back ─────────────────────────────── */

const str = (...values: any[]): string | null => {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
};
const num = (...values: any[]): number | null => {
  for (const v of values) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[, ]/g, '')) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
};
const arr = (...values: any[]): any[] => {
  for (const v of values) if (Array.isArray(v) && v.length) return v;
  return [];
};
const strings = (...values: any[]): string[] => {
  for (const v of values) {
    const list = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(/\s*[,;|]\s*/) : null;
    if (!list) continue;
    const out = [...new Set(list.map((x: any) => str(x, x?.name, x?.title, x?.language)).filter((x): x is string => !!x))];
    if (out.length) return out.slice(0, 40);
  }
  return [];
};
const trimTo = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A date-ish value ({year, month}, "2019-04", 2019) as "2019-04" or "2019". */
function when(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim() || null;
  const year = num(v.year);
  if (!year) return null;
  const month = num(v.month);
  return month ? `${year}-${String(month).padStart(2, '0')}` : String(year);
}

/** The payload inside an Icypeas answer: data, result or item, first of a list. */
export function unwrapIcypeas(body: any): any {
  let v = body;
  for (let i = 0; i < 3 && v && typeof v === 'object'; i++) {
    const inner = v.data ?? v.result ?? v.item ?? (Array.isArray(v.items) ? v.items[0] : undefined) ?? (Array.isArray(v.leads) ? v.leads[0] : undefined) ?? v._source;
    if (inner === undefined || inner === null) break;
    v = Array.isArray(inner) ? inner[0] : inner;
  }
  return v && typeof v === 'object' ? v : null;
}

/** The first LinkedIn URL of one kind anywhere in an answer. */
export function findLinkedinUrl(body: any, kind: 'in' | 'company'): string | null {
  const re = new RegExp(`(?:https?://)?(?:[a-z]{2,3}\\.)?linkedin\\.com/${kind}/[^\\s"'?#]+`, 'i');
  const seen = new Set<any>();
  const walk = (v: any, depth: number): string | null => {
    if (typeof v === 'string') {
      const m = v.match(re);
      return m ? (m[0].startsWith('http') ? m[0] : `https://${m[0]}`).replace(/\/+$/, '') : null;
    }
    if (!v || typeof v !== 'object' || depth > 5 || seen.has(v)) return null;
    seen.add(v);
    for (const child of Array.isArray(v) ? v : Object.values(v)) {
      const hit = walk(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(body, 0);
}

const domainOf = (url: string | null) => {
  if (!url) return null;
  const host = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '').toLowerCase();
  return host.includes('.') ? registrableDomain(host) || host : null;
};

export function personFromProfile(body: any): EnrichedPerson | null {
  const p = unwrapIcypeas(body);
  if (!p) return null;
  const prof = p.profile && typeof p.profile === 'object' ? p.profile : {};
  const current = p.currentPosition || p.currentCompany || {};
  const jobs = arr(p.experiences, p.experience, p.positions, p.workExperience);
  const job0 = jobs[0] || {};

  const experience: EnrichedJob[] = jobs.slice(0, 15).map((j: any) => ({
    title: str(j.title, j.jobTitle, j.position, j.role),
    company: str(j.companyName, j.company?.name, j.company, j.organization),
    location: str(j.location, j.jobLocation),
    start: when(j.startDate ?? j.start ?? j.dateRange?.start ?? j.starts_at),
    end: when(j.endDate ?? j.end ?? j.dateRange?.end ?? j.ends_at),
    description: trimTo(str(j.description, j.summary), 500),
  })).filter((j) => j.title || j.company);
  const education: EnrichedSchool[] = arr(p.educations, p.education, p.schools).slice(0, 10).map((e: any) => ({
    school: str(e.schoolName, e.school?.name, e.school, e.institution, e.name),
    degree: str(e.degreeName, e.degree),
    field: str(e.fieldOfStudy, e.field, e.fieldsOfStudy),
    start: when(e.startDate ?? e.start ?? e.dateRange?.start),
    end: when(e.endDate ?? e.end ?? e.dateRange?.end),
  })).filter((e) => e.school);

  let first = str(p.firstname, p.firstName, p.first_name, prof.firstName, prof.firstname);
  let last = str(p.lastname, p.lastName, p.last_name, prof.lastName, prof.lastname);
  const full = str(p.fullname, p.fullName, p.full_name, p.name, prof.name, prof.fullName) || [first, last].filter(Boolean).join(' ') || null;
  if (!first && !last && full) {
    const parts = full.split(/\s+/);
    first = parts[0] || null;
    last = parts.length > 1 ? parts.slice(1).join(' ') : null;
  }

  const linkedin = str(p.profileUrl, p.linkedinUrl, p.publicProfileUrl, p.url, prof.url, prof.profileUrl);
  const person: EnrichedPerson = {
    first_name: first,
    last_name: last,
    full_name: full,
    headline: str(p.headline, prof.headline, p.title),
    summary: trimTo(str(p.summary, p.about, p.description, prof.summary, prof.about), 2000),
    job_title: str(p.lastJobTitle, p.currentJobTitle, p.jobTitle, current.title, job0.title, job0.jobTitle),
    company: str(p.lastCompanyName, p.currentCompanyName, p.companyName, current.company, current.name, job0.companyName, job0.company?.name, typeof job0.company === 'string' ? job0.company : null),
    location: str(p.address, p.location, p.profileLocation, p.geoLocationName, prof.location, current.location),
    linkedin_url: linkedin ? normalizeLinkedinUrl(linkedin.startsWith('http') ? linkedin : `https://${linkedin}`) : null,
    photo_url: str(p.pictureUrl, p.profilePicture, p.profilePictureUrl, p.photoUrl, p.picture, prof.picture, prof.photoUrl),
    connections: num(p.connections, p.connectionsCount, p.connectionCount, prof.connections, p.followers),
    skills: strings(p.skills, prof.skills),
    languages: strings(p.languages, prof.languages),
    experience,
    education,
    company_linkedin_url: findLinkedinUrl([p.lastCompanyUrl, p.currentCompanyUrl, p.lastCompanyLinkedinUrl, current, job0], 'company'),
    company_website: str(p.lastCompanyWebsite, p.currentCompanyWebsite, current.website, current.companyWebsite, job0.companyWebsite),
  };
  // A not-found answer is a success with nothing in it.
  const meaningful = person.full_name || person.headline || person.job_title || person.experience.length;
  return meaningful ? person : null;
}

export function companyFromProfile(body: any): EnrichedCompany | null {
  const c = unwrapIcypeas(body);
  if (!c) return null;
  const hq = c.headquarter || c.headquarters || c.hq || (Array.isArray(c.locations) ? c.locations[0] : null) || {};
  const range = c.employeeCountRange || c.staffCountRange || {};
  const headcount = num(c.employeeCount, c.staffCount, c.numberOfEmployees, c.headcount, c.employees);
  const band = str(c.companySize, c.size, c.employeesRange, range.start && range.end ? `${range.start}-${range.end}` : null);
  const website = str(c.website, c.websiteUrl, c.companyUrl, c.url && !/linkedin\.com/i.test(c.url) ? c.url : null);
  const company: EnrichedCompany = {
    name: str(c.name, c.companyName, c.universalName),
    domain: domainOf(website) || str(c.domain),
    website,
    linkedin_url: findLinkedinUrl([c.linkedinUrl, c.linkedin_url, c.url, c.companyLinkedinUrl], 'company'),
    industry: str(c.industry, Array.isArray(c.industries) ? c.industries[0]?.name ?? c.industries[0] : null),
    size: headcount !== null ? String(headcount) : band,
    founded: num(c.founded, c.foundedOn?.year, c.foundedYear, c.yearFounded),
    location: typeof hq === 'string' ? hq : [str(hq.city, hq.locality), str(hq.geographicArea, hq.region, hq.state), str(hq.country)].filter(Boolean).join(', ') || str(c.location, c.address),
    description: trimTo(str(c.description, c.about, c.tagline), 3000),
    specialties: strings(c.specialities, c.specialties, c.keywords),
    followers: num(c.followerCount, c.followers, c.followersCount),
    type: str(c.companyType, c.type),
    logo_url: str(c.logo, c.logoUrl, c.logoResolutionResult, c.image),
    sources: ['icypeas'],
  };
  return company.name || company.description || company.industry ? company : null;
}

/* ── The calls ──────────────────────────────────────────────────────── */

async function tryIcypeas<T>(label: string, run: () => Promise<T>, notes: string[]): Promise<T | null> {
  try {
    return await run();
  } catch (err: any) {
    const msg = String(err?.message || err);
    // An empty account stops everything: say so rather than "not found".
    if (/out of credits|INSUFFICIENT_FUNDS|insufficient/i.test(msg)) throw new AppError('The Icypeas account is out of credits, so nothing could be looked up. Top it up and try again.', 402);
    console.warn(`[Enrich] ${label} failed:`, msg);
    notes.push(`${label} could not be reached just now.`);
    return null;
  }
}

async function directoryByDomain(domain: string) {
  try {
    const { data } = await supabaseAdmin
      .from('company_directory')
      .select('name, domain, linkedin_url, founded, size, industry, country, region, locality')
      .eq('domain', domain)
      .limit(1)
      .maybeSingle();
    return data as any;
  } catch {
    return null; // migration 098 not run, or the table is empty
  }
}

const title = (s: string | null) => (s ? s.replace(/\b[a-z]/g, (ch) => ch.toUpperCase()) : null);

/** The first result of a lead-database answer that passes `fits`. */
function pickLead(body: any, fits: (lead: any) => boolean): any | null {
  const leads: any[] = Array.isArray(body?.leads) ? body.leads : [];
  const flat = leads.map((l) => (l?._source ? { _id: l._id, ...l._source } : l)).filter((l) => l && typeof l === 'object');
  return flat.find(fits) || null;
}

const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function sameName(lead: any, first: string, last: string): boolean {
  const f = fold(str(lead.firstname, lead.firstName, lead.first_name));
  const l = fold(str(lead.lastname, lead.lastName, lead.last_name));
  if (f || l) return f === fold(first) && l === fold(last);
  const full = fold(str(lead.fullname, lead.fullName, lead.name));
  return !!full && full.includes(fold(first)) && full.includes(fold(last));
}

/** The full profile where it has a field, the database record filling its gaps. */
export function mergePerson(full: EnrichedPerson | null, lead: EnrichedPerson | null): EnrichedPerson | null {
  if (!full) return lead;
  if (!lead) return full;
  const out: any = { ...full };
  for (const key of Object.keys(lead) as (keyof EnrichedPerson)[]) {
    const have = out[key];
    if (have === null || have === undefined || (Array.isArray(have) && !have.length)) out[key] = lead[key];
  }
  return out as EnrichedPerson;
}

/*
 * The shape of each Icypeas answer, keys only and no values, so a field
 * this reader misses can be found in the server log without a guess.
 */
function logShape(label: string, body: any) {
  if (!body || typeof body !== 'object') return;
  const keys = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).slice(0, 40).join(',') : Array.isArray(v) ? `[${v.length}]` : typeof v);
  const first = Array.isArray(body.leads) ? body.leads[0] : body.data ?? body.result ?? body.item;
  console.log(`[Enrich] ${label}: status=${body.status ?? body.item?.status ?? '-'} top=${keys(body)} first=${keys(first?._source ?? first)}`);
}

/* ── Credits ────────────────────────────────────────────────────────── */

async function spend(userId: string, contactId: string): Promise<string> {
  const planId = await billingService.getPlanId(userId);
  const { data, error } = await supabaseAdmin.rpc('try_spend_prospect_credits', {
    p_user_id: userId,
    p_amount: ENRICH_CREDIT_COST,
    p_allowance: PLANS[planId].prospectCredits,
    p_reason: 'enrich',
    p_provider: 'icypeas',
    p_provider_person_id: contactId,
  });
  if (error) throw new AppError(error.message, 500);
  const bucket = (Array.isArray(data) ? data[0] : data)?.spent_bucket ?? null;
  if (!bucket) throw new AppError('You’re out of prospect credits. Buy a credit pack or upgrade your plan to enrich more contacts.', 403);
  return bucket;
}

async function refund(userId: string, contactId: string, bucket: string, reason: string) {
  await supabaseAdmin.from('prospect_credit_ledger').insert({
    user_id: userId, delta: ENRICH_CREDIT_COST, kind: 'refund', reason,
    provider: 'icypeas', provider_person_id: contactId, bucket,
  });
}

/* ── The enrichment ────────────────────────────────────────────────── */

async function run(userId: string, contactId: string): Promise<EnrichContactResult> {
  const { data: contact, error } = await supabaseAdmin
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!contact) throw new AppError('Contact not found', 404);

  let company: any = null;
  if (contact.company_id) {
    const { data } = await supabaseAdmin.from('companies').select('*').eq('id', contact.company_id).eq('user_id', userId).maybeSingle();
    company = data || null;
  }

  const bucket = await spend(userId, contactId);
  const notes: string[] = [];
  try {
    /* 1. The person */
    let linkedin = normalizeLinkedinUrl(contact.linkedin_url) || null;
    const emailDom = registrableDomain(emailDomain(contact.email));
    const workDomain = emailDom && !isFreeMailDomain(emailDom) ? emailDom : null;
    const knownDomain = str(company?.domain && domainOf(company.domain), domainOf(contact.website), workDomain);
    const knownCompany = str(contact.company, company?.name);
    const first = str(contact.first_name);
    const last = str(contact.last_name);

    // The lead database first: 0.02 credit, and it often holds the whole
    // profile. Looked up by name at their company's website, then its name.
    let person: EnrichedPerson | null = null;
    if (first && last && (knownDomain || knownCompany)) {
      const tries: Record<string, any>[] = [];
      if (knownDomain) tries.push({ currentCompanyWebsite: { include: [knownDomain] } });
      if (knownCompany) tries.push({ currentCompanyName: { include: [knownCompany] } });
      for (const where of tries) {
        const found = await tryIcypeas('The people database', () => icypeas('/find-people', {
          query: { firstname: { include: [first] }, lastname: { include: [last] }, ...where },
        }), notes);
        logShape('find-people', found);
        const lead = pickLead(found, (l) => sameName(l, first, last));
        person = lead ? personFromProfile(lead) : null;
        if (person) break;
      }
    }
    if (!linkedin && person?.linkedin_url) linkedin = person.linkedin_url;

    // Not in the database: search LinkedIn by name, free when nothing is found.
    if (!linkedin && first && last && (knownCompany || knownDomain || contact.job_title)) {
      for (const companyOrDomain of [...new Set([knownCompany, knownDomain].filter(Boolean) as string[])].concat(knownCompany || knownDomain ? [] : [''])) {
        const found = await tryIcypeas('The LinkedIn search', () => icypeas('/url-search/profile', {
          firstname: first, lastname: last, companyOrDomain, jobTitle: contact.job_title || '',
        }), notes);
        logShape('url-search/profile', found);
        linkedin = found ? normalizeLinkedinUrl(findLinkedinUrl(found, 'in')) || null : null;
        if (linkedin) break;
      }
    }

    // The full profile (career, education, skills) costs 1.5 credits, so it
    // is only read when the database answer lacks the career history.
    if (linkedin && (!person || person.experience.length < 2)) {
      const scraped = await tryIcypeas('The profile reader', () => icypeas(`/scrape/profile?url=${encodeURIComponent(linkedin!)}`, undefined, 'GET'), notes);
      logShape('scrape/profile', scraped);
      const full = scraped ? personFromProfile(scraped) : null;
      person = mergePerson(full, person);
      if (!person && scraped) notes.push('Their LinkedIn profile could not be read.');
    }
    if (person && !person.linkedin_url) person.linkedin_url = linkedin;
    if (!person) {
      notes.push(!first || !last
        ? 'Add their first and last name to look them up.'
        : linkedin ? 'Their LinkedIn profile could not be read.' : 'No LinkedIn profile was found for them.');
    }

    /* 2. Their company */
    const domain = str(knownDomain, domainOf(person?.company_website ?? null));
    let enrichedCompany: EnrichedCompany | null = null;
    const recent = company?.profile_enriched_at && Date.now() - new Date(company.profile_enriched_at).getTime() < COMPANY_REUSE_MS;
    if (recent && company.enrichment) {
      enrichedCompany = company.enrichment as EnrichedCompany;
    } else {
      const dir = domain ? await directoryByDomain(domain) : null;
      const fromDir: EnrichedCompany | null = dir ? {
        name: title(dir.name), domain: dir.domain, website: dir.domain ? `https://${dir.domain}` : null,
        linkedin_url: dir.linkedin_url ? normalizeCompanyUrl(dir.linkedin_url) : null,
        industry: title(dir.industry), size: dir.size || null, founded: dir.founded ?? null,
        location: [title(dir.locality), title(dir.region), title(dir.country)].filter(Boolean).join(', ') || null,
        description: null, specialties: [], followers: null, type: null, logo_url: null, sources: ['directory'],
      } : null;
      const companyName = str(person?.company, contact.company, company?.name, fromDir?.name);

      // The company database: 0.02 credit for description, headcount, HQ,
      // industry and specialties, where the profile reader costs 1.5.
      let fromIcy: EnrichedCompany | null = null;
      if (domain || companyName) {
        const found = await tryIcypeas('The company database', () => icypeas('/find-companies', {
          query: domain ? { domain: { include: [domain] } } : { name: { include: [companyName] } },
        }), notes);
        logShape('find-companies', found);
        const lead = pickLead(found, (l) => !domain || domainOf(str(l.website, l.domain)) === domain);
        fromIcy = lead ? companyFromProfile(lead) : null;
      }
      // Not in the database: find its page and read it.
      if (!fromIcy) {
        let companyUrl = str(company?.linkedin_url, fromDir?.linkedin_url, person?.company_linkedin_url);
        if (!companyUrl && (domain || companyName)) {
          const found = await tryIcypeas('The company search', () => icypeas('/url-search/company', { companyOrDomain: companyName || domain }), notes);
          logShape('url-search/company', found);
          companyUrl = found ? findLinkedinUrl(found, 'company') : null;
        }
        const scraped = companyUrl
          ? await tryIcypeas('The company profile reader', () => icypeas(`/scrape/company?url=${encodeURIComponent(companyUrl!)}`, undefined, 'GET'), notes)
          : null;
        logShape('scrape/company', scraped);
        fromIcy = scraped ? companyFromProfile(scraped) : null;
        if (fromIcy && !fromIcy.linkedin_url) fromIcy.linkedin_url = companyUrl;
      }
      enrichedCompany = mergeCompany(fromIcy, fromDir);
      if (!enrichedCompany) notes.push(domain || companyName ? 'Nothing more was found about their company.' : 'Their company is unknown: add a company or work email first.');
    }

    /* 3. Their email, saved to the contact like any other check */
    const lastCheck = contact.dcs_verified_at ? new Date(contact.dcs_verified_at).getTime() : 0;
    const checkedRecently = contact.email_verified_by === 'icypeas' && Date.now() - lastCheck < EMAIL_REUSE_MS;
    const check = checkedRecently ? null : await verifyContact(contactId, userId, { deep: true }).catch(() => null);
    const now = new Date().toISOString();
    const email = check
      ? { score: check.score, verified_by: check.verified_by ?? null, fail_reason: check.fail_reason, checked_at: now }
      : { score: contact.dcs_score ?? 0, verified_by: contact.email_verified_by ?? null, fail_reason: contact.dcs_fail_reason ?? null, checked_at: contact.dcs_verified_at };

    /* Fill the blanks, suggest the differences */
    const proposed: Record<EnrichmentSuggestion['field'], string | null> = {
      first_name: person?.first_name ?? null,
      last_name: person?.last_name ?? null,
      job_title: person?.job_title ?? null,
      company: person?.company ?? enrichedCompany?.name ?? null,
      location: person?.location ?? null,
      linkedin_url: person?.linkedin_url ?? (linkedin || null),
      website: enrichedCompany?.website ?? (enrichedCompany?.domain ? `https://${enrichedCompany.domain}` : null),
    };
    const patch: Record<string, any> = {};
    const filled: string[] = [];
    const suggestions: EnrichmentSuggestion[] = [];
    for (const [field, value] of Object.entries(proposed) as [EnrichmentSuggestion['field'], string | null][]) {
      if (!value) continue;
      const current = str(contact[field]);
      if (!current) { patch[field] = value; filled.push(field); }
      else if (field !== 'linkedin_url' && field !== 'website' && current.toLowerCase() !== value.toLowerCase()) {
        suggestions.push({ field, current, suggested: value });
      }
    }

    /* The company record: made or linked when there is none, blanks filled */
    const companyFilled: string[] = [];
    let companyId: string | null = contact.company_id || null;
    if (enrichedCompany) {
      if (!company && (enrichedCompany.name || contact.company)) {
        try {
          company = await companiesService.createOrGet(userId, {
            name: contact.company || enrichedCompany.name,
            domain: enrichedCompany.domain || domain,
            website: enrichedCompany.website,
          });
          companyId = company?.id || null;
          if (companyId) patch.company_id = companyId;
        } catch (e) {
          console.warn('[Enrich] could not make the company record:', (e as Error).message);
        }
      }
      if (company?.id && !recent) {
        const companyPatch: Record<string, any> = { enrichment: enrichedCompany, profile_enriched_at: now };
        for (const key of ['domain', 'website', 'industry', 'size', 'location', 'linkedin_url'] as const) {
          const value = enrichedCompany[key];
          if (value && !str(company[key])) { companyPatch[key] = value; companyFilled.push(key); }
        }
        const { error: coErr } = await supabaseAdmin.from('companies').update(companyPatch).eq('id', company.id).eq('user_id', userId);
        if (coErr) console.warn('[Enrich] company update failed:', coErr.message);
      }
    }

    const enrichment: ContactEnrichment = { person, company: enrichedCompany, email, notes, enriched_at: now };
    const { error: upErr } = await supabaseAdmin
      .from('contacts')
      .update({ ...patch, enrichment, profile_enriched_at: now })
      .eq('id', contactId)
      .eq('user_id', userId);
    if (upErr) {
      if (/enrichment|profile_enriched_at/.test(upErr.message)) throw new AppError('Enrichment needs database migration 099 to be run first.', 503);
      throw new AppError(upErr.message, 500);
    }

    // Only what Icypeas found is paid for: the directory and a reused
    // company profile are free, and finding nothing gives the credit back.
    const paidFor = person || (!recent && enrichedCompany?.sources.includes('icypeas'));
    const charged = paidFor ? ENRICH_CREDIT_COST : 0;
    if (!charged) await refund(userId, contactId, bucket, 'nothing_found');

    return { enrichment, filled, company_filled: companyFilled, company_id: companyId, suggestions, credits_charged: charged };
  } catch (err) {
    await refund(userId, contactId, bucket, 'enrich_failed').catch(() => {});
    throw err;
  }
}

function normalizeCompanyUrl(url: string): string | null {
  return findLinkedinUrl(url.startsWith('http') ? url : `https://${url}`, 'company');
}

/** Icypeas's profile where it has one, the directory filling its gaps. */
export function mergeCompany(icy: EnrichedCompany | null, dir: EnrichedCompany | null): EnrichedCompany | null {
  if (!icy) return dir;
  if (!dir) return icy;
  const out: any = { ...icy, sources: ['icypeas', 'directory'] };
  for (const key of Object.keys(dir) as (keyof EnrichedCompany)[]) {
    if (key === 'sources') continue;
    const have = out[key];
    if (have === null || have === undefined || (Array.isArray(have) && !have.length)) out[key] = dir[key];
  }
  return out as EnrichedCompany;
}

export const contactEnrichmentService = {
  async enrich(userId: string, contactId: string): Promise<EnrichContactResult> {
    if (!env.ICYPEAS_API_KEY) {
      throw new AppError('Enrichment needs an ICYPEAS_API_KEY on the server.', 503);
    }
    // A double click would pay twice for the same answer.
    const key = `${userId}:${contactId}`;
    if (running.has(key)) throw new AppError('This contact is already being enriched.', 409);
    running.add(key);
    try {
      return await run(userId, contactId);
    } finally {
      running.delete(key);
    }
  },
};
