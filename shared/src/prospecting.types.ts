// Prospecting: built-in B2B lead search + reveal, powered by pluggable data
// providers (Icypeas, People Data Labs, …) behind a monthly credit system.

export type ProspectProviderId = 'icypeas' | 'pdl' | 'apollo';

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
  /**
   * Every other people-search filter the provider supports, keyed by the
   * field names in PROSPECT_FILTER_FIELDS (Icypeas's own). Text fields take
   * include/exclude lists, numeric ones a min/max range. A key that is also
   * covered above (job title, location...) adds to it, e.g. its excludes.
   */
  advanced?: Record<string, ProspectAdvancedValue>;
}

export interface ProspectTextFilter { include?: string[]; exclude?: string[] }
export interface ProspectRangeFilter { min?: number | null; max?: number | null }
export interface ProspectGrowthFilter { timespan: '6months' | '12months' | '24months'; min?: number | null; max?: number | null }
export type ProspectAdvancedValue = ProspectTextFilter | ProspectRangeFilter | ProspectGrowthFilter;

export interface ProspectFilterField {
  /** The provider's field name, e.g. "pastCompany.industry" */
  key: string;
  label: string;
  kind: 'text' | 'range' | 'growth';
  group: 'Person' | 'Current role' | 'Current company' | 'Past roles';
  placeholder?: string;
  /** Set on fields the main panel already asks for: only their excludes show here. */
  basic?: boolean;
  /** Unit shown beside a range, e.g. "years". */
  unit?: string;
}

/**
 * The people-search filters Icypeas supports (find-people, 35 fields),
 * minus its internal company ids and URNs, which nobody can type. Order is
 * display order within each group.
 */
export const PROSPECT_FILTER_FIELDS: ProspectFilterField[] = [
  { key: 'firstname', label: 'First name', kind: 'text', group: 'Person', placeholder: 'Sarah, James…' },
  { key: 'lastname', label: 'Last name', kind: 'text', group: 'Person', placeholder: 'Smith…' },
  { key: 'location', label: 'Location', kind: 'text', group: 'Person', basic: true },
  { key: 'profileLocation', label: 'Profile location', kind: 'text', group: 'Person', placeholder: 'Where their profile says they live' },
  { key: 'keyword', label: 'Profile keywords', kind: 'text', group: 'Person', basic: true },
  { key: 'skills', label: 'Skills', kind: 'text', group: 'Person', placeholder: 'Salesforce, SEO, Python…' },
  { key: 'languages', label: 'Languages', kind: 'text', group: 'Person', placeholder: 'French, Spanish…' },
  { key: 'school', label: 'School or university', kind: 'text', group: 'Person', placeholder: 'HEC Paris, Stanford…' },
  { key: 'totalYearsOfExperience', label: 'Years of experience', kind: 'range', group: 'Person', unit: 'years' },

  { key: 'currentJobTitle', label: 'Job title', kind: 'text', group: 'Current role', basic: true },
  { key: 'workLocation', label: 'Work location', kind: 'text', group: 'Current role', placeholder: 'Where the job is based' },
  { key: 'timeInCurrentCompany', label: 'Years at current company', kind: 'range', group: 'Current role', unit: 'years' },

  { key: 'currentCompanyName', label: 'Company name', kind: 'text', group: 'Current company', basic: true },
  { key: 'currentCompanyWebsite', label: 'Company website', kind: 'text', group: 'Current company', placeholder: 'acme.com…' },
  { key: 'currentCompany.industry', label: 'Industry', kind: 'text', group: 'Current company', basic: true },
  { key: 'currentCompany.type', label: 'Company type', kind: 'text', group: 'Current company', placeholder: 'Privately held, Public company, Nonprofit…' },
  { key: 'currentCompany.location', label: 'Company location', kind: 'text', group: 'Current company', placeholder: 'HQ city or country' },
  { key: 'currentCompany.keyword', label: 'Company keywords', kind: 'text', group: 'Current company', placeholder: 'e-commerce, B2B, Shopify…' },
  { key: 'currentCompany.headcount', label: 'Headcount', kind: 'range', group: 'Current company', unit: 'people' },
  { key: 'currentCompany.revenue', label: 'Revenue', kind: 'range', group: 'Current company', unit: 'USD' },
  { key: 'currentCompany.headcountGrowth', label: 'Headcount growth', kind: 'growth', group: 'Current company', unit: '%' },

  { key: 'pastJobTitle', label: 'Past job title', kind: 'text', group: 'Past roles', placeholder: 'Founder, SDR…' },
  { key: 'pastCompanyName', label: 'Past company', kind: 'text', group: 'Past roles', placeholder: 'Salesforce, HubSpot…' },
  { key: 'pastCompanyWebsite', label: 'Past company website', kind: 'text', group: 'Past roles', placeholder: 'hubspot.com…' },
  { key: 'pastCompany.industry', label: 'Past industry', kind: 'text', group: 'Past roles' },
  { key: 'pastCompany.type', label: 'Past company type', kind: 'text', group: 'Past roles' },
  { key: 'pastCompany.location', label: 'Past company location', kind: 'text', group: 'Past roles' },
  { key: 'pastCompany.keyword', label: 'Past company keywords', kind: 'text', group: 'Past roles' },
  { key: 'pastCompany.headcount', label: 'Past company headcount', kind: 'range', group: 'Past roles', unit: 'people' },
  { key: 'pastCompany.revenue', label: 'Past company revenue', kind: 'range', group: 'Past roles', unit: 'USD' },
  { key: 'pastCompany.headcountGrowth', label: 'Past company headcount growth', kind: 'growth', group: 'Past roles', unit: '%' },
];

/** How many advanced filters actually hold a value. */
export function countAdvancedFilters(advanced?: Record<string, ProspectAdvancedValue>): number {
  if (!advanced) return 0;
  let n = 0;
  for (const value of Object.values(advanced)) {
    if (!value) continue;
    const v = value as ProspectTextFilter & ProspectRangeFilter;
    if ((v.include?.length || 0) + (v.exclude?.length || 0) > 0) n++;
    else if (typeof v.min === 'number' || typeof v.max === 'number') n++;
  }
  return n;
}

/** A short, human summary of a search, stored on the contacts it produced. */
export function describeProspectSearch(filters: ProspectSearchFilters): string {
  const parts = [
    ...(filters.titles || []),
    ...(filters.seniorities || []).map((s) => s.replace(/_/g, '-')),
    ...(filters.industries || []),
    ...(filters.locations || []),
    ...(filters.companies || []),
    ...(filters.companySizes || []).map((s) => `${s} people`),
    ...(filters.keywords ? [filters.keywords] : []),
  ].map((s) => String(s).trim()).filter(Boolean);
  const extra = countAdvancedFilters(filters.advanced);
  const head = parts.slice(0, 4).join(' · ');
  const more = parts.length - 4 + extra;
  return `Prospector${head ? `: ${head}` : ''}${more > 0 ? ` +${more} more` : ''}`.slice(0, 200);
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
  /** Plan credits spent this calendar month (net of refunds) */
  used: number;
  /** Plan credits left this month (-1 when unlimited) */
  plan_remaining: number;
  /** Purchased credits balance — never expires, spent after plan credits */
  purchased: number;
  /** Total spendable right now: plan_remaining + purchased (-1 = unlimited) */
  remaining: number;
  /** ISO date the plan allowance resets (start of next month) */
  resets_at: string;
}

/** One-off purchasable credit packs (Stripe payment mode, no dashboard setup
 *  needed — prices are created inline). Tune freely; ids must stay stable. */
export interface CreditPack {
  id: string;
  credits: number;
  priceUsd: number;
  label: string;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: 'pack_500', credits: 500, priceUsd: 15, label: 'Top-up' },
  { id: 'pack_2000', credits: 2000, priceUsd: 49, label: 'Popular' },
  { id: 'pack_5000', credits: 5000, priceUsd: 99, label: 'Best value' },
];

export interface ProspectorStatus {
  /** Configured provider, or null when no data provider API key is set */
  provider: ProspectProviderId | null;
  credits: ProspectCreditsSummary;
  /** The free company directory (migration 098), when it has been loaded. */
  company_directory: CompanyDirectoryStatus;
}

/* ─── Company directory ───────────────────────────────────────────────────
   Companies searched from our own copy of the People Data Labs Free Company
   Dataset (CC BY 4.0), so company search costs no provider credits. It holds
   firmographics only: no people and no emails. Finding people at a company
   still goes through the people provider. */

export interface CompanyDirectoryStatus {
  /** True once the table exists and holds at least one company. */
  available: boolean;
  /** Rows in the directory (a planner estimate on large tables). */
  companies: number;
}

export interface CompanySearchFilters {
  /** Company names (prefix match) or domains (exact match) */
  companies?: string[];
  /** Industries, e.g. ["computer software"] */
  industries?: string[];
  /** Country, region or city, e.g. ["United Kingdom", "London"] */
  locations?: string[];
  /** Headcount ranges, e.g. ["11-50", "51-200"] */
  companySizes?: string[];
}

export interface DirectoryCompany {
  id: string;
  name: string;
  domain: string | null;
  linkedin_url: string | null;
  founded: number | null;
  size: string | null;
  industry: string | null;
  country: string | null;
  region: string | null;
  locality: string | null;
}

export interface CompanySearchResponse {
  results: DirectoryCompany[];
  page: number;
  /** Total matches (approximate on large result sets) */
  total: number;
}

/** Shown wherever directory results are, as CC BY 4.0 requires. */
export const COMPANY_DIRECTORY_ATTRIBUTION = {
  source: 'People Data Labs Free Company Dataset',
  sourceUrl: 'https://docs.peopledatalabs.com/docs/free-company-dataset',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};

export interface RevealProspectInput {
  provider: ProspectProviderId;
  provider_person_id: string;
  /** Snapshot of the search row, used to build the contact record */
  person?: Partial<ProspectPerson>;
  /** Optional lead list to add the saved contact to */
  list_id?: string | null;
  /** The search that found them, recorded on the contact as where it came from. */
  search?: ProspectSearchFilters;
}

/** A lead list the Prospector can save into, with the campaigns it feeds. */
export interface ProspectDestination {
  id: string;
  name: string;
  folder: string | null;
  contact_count: number;
  /** Campaigns bound to this list that are not finished: new leads join them. */
  campaigns: { id: string; name: string; status: string }[];
}

export interface RevealProspectResponse {
  /** False when the provider couldn't find a usable email (no credit charged) */
  found: boolean;
  email: string | null;
  contact_id: string | null;
  /** True when this reveal was already paid for previously */
  already_revealed: boolean;
  credits: ProspectCreditsSummary;
  /** Campaigns on the chosen list the lead was enrolled into just now. */
  enrolled_in?: { id: string; name: string }[];
}

/* ─── Standing searches ───────────────────────────────────────────────────
   A Prospector search that keeps running: new matches are revealed,
   verified and enrolled on a cadence, within a daily cap. Migration 074. */

export type ProspectRuleCadence = 'daily' | 'weekdays' | 'weekly';

export interface ProspectRuleRunResult {
  at: string;
  searched: number;
  revealed: number;
  no_email: number;
  failed_verification: number;
  enrolled: number;
  /** Enrolment skip reasons, e.g. { suppressed: 1, on_open_deal: 2 }. */
  skipped: Record<string, number>;
  /** Why the run ended: cap reached, out of matches, out of credits, an error. */
  stopped: 'cap' | 'exhausted' | 'no_credits' | 'no_provider' | 'no_destination' | 'error';
  error?: string;
}

export interface ProspectRule {
  id: string;
  user_id: string;
  name: string;
  filters: ProspectSearchFilters;
  campaign_id: string | null;
  list_id: string | null;
  daily_cap: number;
  cadence: ProspectRuleCadence;
  min_score: number;
  is_active: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_result: ProspectRuleRunResult | null;
  total_enrolled: number;
  created_at: string;
  updated_at: string;
  campaign?: { id: string; name: string; status: string } | null;
}

/** When a rule runs next, from when it last ran. */
export function nextRuleRun(cadence: ProspectRuleCadence, from: Date): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + (cadence === 'weekly' ? 7 : 1));
  if (cadence === 'weekdays') {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}
