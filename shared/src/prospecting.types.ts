// Prospecting: built-in B2B lead search + reveal, powered by pluggable data
// providers (People Data Labs, Apollo, …) behind a monthly credit system.

export type ProspectProviderId = 'pdl' | 'apollo';

export interface ProspectSearchFilters {
  /** Job titles, e.g. ["Head of Growth", "CMO"] */
  titles?: string[];
  /** Seniority levels, e.g. ["director", "vp", "c_suite"] */
  seniorities?: string[];
  /** Locations (city/region/country), e.g. ["London", "United States"] */
  locations?: string[];
  /** Industries, e.g. ["computer software"] */
  industries?: string[];
  /** Company names or domains */
  companies?: string[];
  /** Company headcount ranges, e.g. ["11-50", "51-200"] */
  companySizes?: string[];
  /** Free-text keywords */
  keywords?: string;
}

/** A person returned by search. Email is never included — revealing costs a credit. */
export interface ProspectPerson {
  /** Provider-scoped stable id used for reveal + dedupe */
  id: string;
  provider: ProspectProviderId;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  job_title: string | null;
  company: string | null;
  company_domain: string | null;
  company_size: string | null;
  industry: string | null;
  location: string | null;
  linkedin_url: string | null;
  /** Whether the provider says a work email exists for this person */
  has_email: boolean;
  /** True when this user already revealed this person (no credit to view again) */
  already_revealed?: boolean;
  /** Contact id when already revealed and saved */
  contact_id?: string | null;
}

export interface ProspectSearchResponse {
  results: ProspectPerson[];
  page: number;
  /** Total matches reported by the provider (may be approximate) */
  total: number;
  provider: ProspectProviderId;
}

export interface ProspectCreditsSummary {
  /** Monthly allowance from the plan. -1 = unlimited */
  allowance: number;
  /** Credits spent this calendar month (net of refunds) */
  used: number;
  /** allowance - used (or -1 when unlimited) */
  remaining: number;
  /** ISO date the allowance resets (start of next month) */
  resets_at: string;
}

export interface ProspectorStatus {
  /** Configured provider, or null when no data provider API key is set */
  provider: ProspectProviderId | null;
  credits: ProspectCreditsSummary;
}

export interface RevealProspectInput {
  provider: ProspectProviderId;
  provider_person_id: string;
  /** Snapshot of the search row, used to build the contact record */
  person?: Partial<ProspectPerson>;
  /** Optional lead list to add the saved contact to */
  list_id?: string | null;
}

export interface RevealProspectResponse {
  /** False when the provider couldn't find a usable email (no credit charged) */
  found: boolean;
  email: string | null;
  contact_id: string | null;
  /** True when this reveal was already paid for previously */
  already_revealed: boolean;
  credits: ProspectCreditsSummary;
}
