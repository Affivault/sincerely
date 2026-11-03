/* ═══════════════════════════════════════════════════════════════════════
   Filters on who a person is and where they work.

   Imports now bring in country, city, state and industry for the person
   and size and industry for their company, but nothing could filter on
   them - so "UK property owners at small firms" could not be shown, saved
   as a view, exported or sent to. These are those filters, defined once
   for the list, its counts, the export, saved views and "select all".

   Matching is exact but case-blind ("united kingdom" finds "United
   Kingdom"), which is what picking a value from the menu means.
   ═══════════════════════════════════════════════════════════════════════ */

export interface PersonFilters {
  country?: string;
  city?: string;
  state?: string;
  industry?: string;
  company_size?: string;
  company_industry?: string;
  /** Engagement score at least this (0-100). */
  engagement_min?: number;
}

export type PersonFilterKey = keyof PersonFilters;

export const PERSON_FILTER_FIELDS: Array<{ key: Exclude<PersonFilterKey, 'engagement_min'>; label: string; group: 'Person' | 'Company' }> = [
  { key: 'country', label: 'Country', group: 'Person' },
  { key: 'state', label: 'State / region', group: 'Person' },
  { key: 'city', label: 'City', group: 'Person' },
  { key: 'industry', label: 'Industry', group: 'Person' },
  { key: 'company_size', label: 'Company size', group: 'Company' },
  { key: 'company_industry', label: 'Company industry', group: 'Company' },
];

export const ENGAGEMENT_STEPS = [20, 40, 60, 80] as const;

const TEXT_KEYS = PERSON_FILTER_FIELDS.map((f) => f.key);

/** Only known keys, trimmed, nothing empty. Safe on untrusted input. */
export function sanitizePersonFilters(raw: unknown): PersonFilters {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: PersonFilters = {};
  for (const k of TEXT_KEYS) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 120);
  }
  const e = Number(r.engagement_min);
  if (Number.isFinite(e) && e > 0) out.engagement_min = Math.min(100, Math.max(0, Math.round(e)));
  return out;
}

export function hasPersonFilters(f: PersonFilters | undefined | null): boolean {
  return !!f && Object.keys(sanitizePersonFilters(f)).length > 0;
}

/** The chip text for one active filter. */
export function personFilterLabel(key: PersonFilterKey, value: string | number): string {
  if (key === 'engagement_min') return `Engagement ${value}+`;
  const f = PERSON_FILTER_FIELDS.find((x) => x.key === key);
  return `${f?.label ?? key}: ${value}`;
}

/** Facet values for the menu: the commonest first. */
export interface FacetValue { value: string; count: number }
export type PersonFacets = Record<Exclude<PersonFilterKey, 'engagement_min'>, FacetValue[]>;

/** LIKE wildcards in a value are literal: "100%" is a value, not a pattern. */
export function exactIlike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}
