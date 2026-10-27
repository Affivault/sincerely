// Pure helpers for the free company directory (migration 098): turning a
// row of the People Data Labs Free Company Dataset into a table row, and the
// Prospector's company filters into PostgREST filters. Kept free of the
// database client so the importer script and the checks can use them.

import type { CompanySearchFilters } from '@lemlist/shared';

export interface CompanyDirectoryRow {
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

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== 'null' ? s : null;
};
const lower = (v: unknown) => text(v)?.toLowerCase() ?? null;

/** "https://www.Acme.com/about" -> "acme.com"; null when it is not a host. */
export function domainFromWebsite(website: unknown): string | null {
  const s = text(website);
  if (!s) return null;
  const host = s.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/[/?#:].*$/, '').toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/**
 * One record of the dataset, from the CSV (header names) or the JSON file.
 * Returns null for a record that cannot be used: no id or no name.
 * Text filters match lower case, so the filterable columns are stored so.
 */
export function normalizeCompanyRecord(r: Record<string, unknown>): CompanyDirectoryRow | null {
  const id = text(r.id);
  const name = text(r.name);
  if (!id || !name) return null;
  const founded = Number(text(r.founded));
  const linkedin = text(r.linkedin_url);
  return {
    id,
    name,
    domain: domainFromWebsite(r.website ?? r.domain),
    linkedin_url: linkedin ? (/^https?:\/\//i.test(linkedin) ? linkedin : `https://${linkedin}`) : null,
    founded: Number.isInteger(founded) && founded > 0 ? founded : null,
    size: lower(r.size),
    industry: lower(r.industry),
    country: lower(r.country),
    region: lower(r.region),
    locality: lower(r.locality),
  };
}

const looksLikeDomain = (s: string) => domainFromWebsite(s) !== null && !/\s/.test(s.trim());
// Inside a PostgREST or=() list a value is double-quoted, so commas and
// brackets in it are safe; quotes, backslashes and wildcards are dropped.
const quote = (v: string) => `"${v.replace(/["\\*%]/g, '')}"`;
const clean = (values?: string[]) => [...new Set((values || []).map((s) => String(s).trim()).filter(Boolean))].slice(0, 50);

/* The dataset spells countries out in full; people type the short forms. */
const LOCATION_ALIASES: Record<string, string> = {
  uk: 'united kingdom', 'great britain': 'united kingdom', britain: 'united kingdom',
  us: 'united states', usa: 'united states', 'united states of america': 'united states', america: 'united states',
  uae: 'united arab emirates', nyc: 'new york', sf: 'san francisco',
};

export interface CompanyDirectoryQuery {
  /** PostgREST or=() body for names (prefix) and domains (exact), or null. */
  companyOr: string | null;
  industries: string[];
  /** PostgREST or=() body matching country, region or city, or null. */
  locationOr: string | null;
  sizes: string[];
}

export function companyDirectoryQuery(filters: CompanySearchFilters): CompanyDirectoryQuery {
  const companies = clean(filters.companies);
  const domains = companies.filter(looksLikeDomain).map((c) => domainFromWebsite(c)!);
  const names = companies.filter((c) => !looksLikeDomain(c)).map((c) => c.toLowerCase().replace(/["\\*%]/g, '')).filter(Boolean);
  const companyParts = [
    ...(domains.length ? [`domain.in.(${domains.map(quote).join(',')})`] : []),
    ...names.map((n) => `name_key.like."${n}*"`),
  ];

  const locations = [...new Set(clean(filters.locations).map((l) => l.toLowerCase()).flatMap((l) => [l, ...(LOCATION_ALIASES[l] ? [LOCATION_ALIASES[l]] : [])]))];
  const list = locations.map(quote).join(',');
  return {
    companyOr: companyParts.length ? companyParts.join(',') : null,
    industries: clean(filters.industries).map((i) => i.toLowerCase()),
    locationOr: locations.length ? `country.in.(${list}),region.in.(${list}),locality.in.(${list})` : null,
    sizes: clean(filters.companySizes),
  };
}

export function hasCompanyFilters(q: CompanyDirectoryQuery): boolean {
  return !!(q.companyOr || q.locationOr || q.industries.length || q.sizes.length);
}
