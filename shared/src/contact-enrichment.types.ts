/* ═══════════════════════════════════════════════════════════════════════
   The 360 profile: what a manual "Enrich" on a contact brings back.

   Enrichment is only ever started by a person pressing the button on a
   contact's page. It looks the person up (their LinkedIn profile), their
   company (our free company directory first, then the company's own
   profile), and checks their email address, then fills in the blanks on
   the contact and the company record. Nothing anyone typed is overwritten:
   where the profile disagrees with what is on file, it is offered as a
   suggestion instead.
   ═══════════════════════════════════════════════════════════════════════ */

import { CREDIT_PRICES } from './credits.types.js';

/** Who checked an address: a paid mailbox check, our own mail-server probe, or DNS alone. */
export type EmailVerifiedBy = 'icypeas' | 'mail_server' | 'dns';

export interface EnrichedJob {
  title: string | null;
  company: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  description: string | null;
}

export interface EnrichedSchool {
  school: string | null;
  degree: string | null;
  field: string | null;
  start: string | null;
  end: string | null;
}

export interface EnrichedPerson {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  headline: string | null;
  summary: string | null;
  job_title: string | null;
  company: string | null;
  location: string | null;
  linkedin_url: string | null;
  photo_url: string | null;
  connections: number | null;
  skills: string[];
  languages: string[];
  experience: EnrichedJob[];
  education: EnrichedSchool[];
  /** The employer's LinkedIn page, when the profile names one: it saves a lookup. */
  company_linkedin_url: string | null;
  company_website: string | null;
}

export interface EnrichedCompany {
  name: string | null;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  industry: string | null;
  /** Headcount, or a band like "51-200". */
  size: string | null;
  founded: number | null;
  location: string | null;
  description: string | null;
  specialties: string[];
  followers: number | null;
  type: string | null;
  logo_url: string | null;
  /** Where each part came from, so the page can say so. */
  sources: ('directory' | 'icypeas')[];
}

export interface EmailCheckSummary {
  score: number;
  verified_by: EmailVerifiedBy | null;
  fail_reason: string | null;
  checked_at: string;
}

/** Stored on contacts.enrichment (migration 099). */
export interface ContactEnrichment {
  person: EnrichedPerson | null;
  company: EnrichedCompany | null;
  email: EmailCheckSummary | null;
  /** Plain-language notes on what could not be found. */
  notes: string[];
  enriched_at: string;
}

/** A field where the fresh profile says something different from what is on file. */
export interface EnrichmentSuggestion {
  field: 'first_name' | 'last_name' | 'job_title' | 'company' | 'location' | 'linkedin_url' | 'website';
  current: string;
  suggested: string;
}

export interface EnrichContactResult {
  enrichment: ContactEnrichment;
  /** Contact fields that were empty and are now filled. */
  filled: string[];
  /** Company record fields that were empty and are now filled. */
  company_filled: string[];
  company_id: string | null;
  suggestions: EnrichmentSuggestion[];
  /** Prospect credits this cost: 0 when nothing at all was found. */
  credits_charged: number;
}

/** Credits one enrichment costs, refunded when nothing is found. */
export const ENRICH_CREDIT_COST = CREDIT_PRICES.enrich;
