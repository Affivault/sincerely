/* ═══════════════════════════════════════════════════════════════════════
   The person panel in the Prospector, at no cost.

   Clicking a name in the results opens what is already known about that
   person and their company. Nothing here spends a credit, Icypeas's or
   ours:

     person          the lead the search already paid for, held for an
                     hour after the search (prospect-providers.cachedLead)
     company         the same lead's company fields, filled in from the
                     account's own company record (Enrich keeps a full
                     profile there) and the free company directory
     company_people  Icypeas's find-people count, which is free
     in_crm          people at that company already in this account

   Finding more people at the company is a normal Prospector search,
   which the panel hands back to the page.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { cachedLead, getActiveProvider } from './prospect-providers.js';
import { companyFromProfile, mergeCompany, personFromProfile } from './contact-enrichment.service.js';
import type { EnrichedCompany, ProspectDetails } from '@lemlist/shared';

const cleanDomain = (raw: unknown): string | null => {
  const host = String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
  return host.includes('.') && /^[a-z0-9.-]+$/.test(host) ? host : null;
};

/** The company half of a people-database lead, in whichever spelling it uses. */
function companyFromLead(lead: any): EnrichedCompany | null {
  if (!lead) return null;
  const nested = lead.currentCompany || lead.company || {};
  const job = (Array.isArray(lead.experiences) && lead.experiences[0]) || {};
  return companyFromProfile({
    name: lead.lastCompanyName ?? lead.currentCompanyName ?? nested.name ?? job.companyName,
    website: lead.lastCompanyWebsite ?? lead.currentCompanyWebsite ?? nested.website ?? job.companyWebsite,
    industry: lead.lastCompanyIndustry ?? nested.industry,
    numberOfEmployees: lead.lastCompanyNumberOfEmployees ?? nested.numberOfEmployees ?? nested.headcount,
    url: lead.lastCompanyUrl ?? lead.lastCompanyLinkedinUrl ?? nested.url ?? nested.linkedinUrl ?? job.companyUrl,
    address: lead.lastCompanyAddress ?? nested.address ?? nested.location,
    description: lead.lastCompanyDescription ?? nested.description,
    specialties: nested.specialties,
    type: nested.type,
  });
}

let shapeLogged = false;
const likeSafe = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
const title = (s: string | null) => (s ? s.replace(/\b[a-z]/g, (ch) => ch.toUpperCase()) : null);

export const prospectDetailsService = {
  async details(userId: string, personId: string, hint: { company?: string; domain?: string }): Promise<ProspectDetails> {
    const raw = cachedLead(personId);
    const lead = raw?._source ? { _id: raw._id, ...raw._source } : raw;
    // Once per process: the lead's keys (no values), to map fields we miss.
    if (lead && !shapeLogged) {
      shapeLogged = true;
      console.log(`[ProspectDetails] lead keys: ${Object.keys(lead).slice(0, 60).join(',')}`);
    }
    const person = lead ? personFromProfile(lead) : null;
    let company = companyFromLead(lead);

    const domain = cleanDomain(company?.domain) || cleanDomain(hint.domain);
    const name = company?.name || (hint.company ? String(hint.company).trim().slice(0, 200) : null);

    // What the account already knows: its own record (a full profile once
    // anyone there was enriched), then the free directory.
    if (domain || name) {
      let q = supabaseAdmin.from('companies').select('name, domain, website, industry, size, location, linkedin_url, enrichment').eq('user_id', userId).limit(1);
      q = domain ? q.eq('domain', domain) : q.ilike('name', likeSafe(name!));
      const { data: own } = await q.maybeSingle();
      if (own) {
        const fromOwn: EnrichedCompany = (own as any).enrichment || {
          name: own.name, domain: own.domain, website: own.website, linkedin_url: own.linkedin_url,
          industry: own.industry, size: own.size, founded: null, location: own.location,
          description: null, specialties: [], followers: null, type: null, logo_url: null, sources: [],
        };
        company = mergeCompany(company, fromOwn);
      }
    }
    if (domain && (!company?.industry || !company?.size)) {
      const { data: dir } = await supabaseAdmin
        .from('company_directory').select('name, domain, linkedin_url, founded, size, industry, locality, country')
        .eq('domain', domain).limit(1).maybeSingle();
      if (dir) {
        company = mergeCompany(company, {
          name: title(dir.name), domain: dir.domain, website: `https://${dir.domain}`, linkedin_url: dir.linkedin_url,
          industry: title(dir.industry), size: dir.size, founded: dir.founded, location: [title(dir.locality), title(dir.country)].filter(Boolean).join(', ') || null,
          description: null, specialties: [], followers: null, type: null, logo_url: null, sources: ['directory'],
        });
      }
    }

    // Free on Icypeas; a count that fails is just not shown.
    let companyPeople: number | null = null;
    const provider = getActiveProvider();
    if (provider?.count && (domain || name)) {
      companyPeople = await provider.count({ companies: [domain || name!] }).catch(() => null);
    }

    // Already in the CRM at that company.
    let inCrm: ProspectDetails['in_crm'] = [];
    if (domain || name) {
      let q = supabaseAdmin.from('contacts').select('id, first_name, last_name, job_title, email').eq('user_id', userId).limit(8);
      q = domain ? q.ilike('email', `%@${domain}`) : q.ilike('company', likeSafe(name!));
      const { data } = await q;
      inCrm = (data || []).map((c: any) => ({
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
        job_title: c.job_title || null,
        email: c.email,
      }));
    }

    return { person, company, company_people: companyPeople, in_crm: inCrm };
  },
};
