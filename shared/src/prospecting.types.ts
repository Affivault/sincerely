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
