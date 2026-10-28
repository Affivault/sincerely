// Orders a page of Prospector results by how closely each person matches
// the search, so the strongest fits sit at the top. The provider has
// already filtered; this only reorders what it sent, and people who score
// the same keep the provider's order.

import { expandProspectLocations, foldText, prospectValueLabel } from './prospect-suggestions.js';
import type { ProspectPerson, ProspectSearchFilters } from './prospecting.types.js';

/** Words in a job title that place someone at each seniority. */
const SENIORITY_WORDS: Record<string, string[]> = {
  owner: ['owner', 'founder', 'cofounder', 'co founder', 'proprietor'],
  c_suite: ['chief', 'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cro', 'cpo', 'ciso', 'president'],
  vp: ['vp', 'vice president', 'svp', 'evp'],
  director: ['director', 'head of', 'head'],
  manager: ['manager', 'lead'],
  senior: ['senior', 'sr', 'lead', 'principal', 'staff'],
  entry: ['junior', 'jr', 'associate', 'assistant', 'intern', 'graduate', 'trainee'],
};

/** Words too common in titles to count as a match on their own. */
const FILLER = new Set(['of', 'and', 'the', 'for', 'to', 'in', '&', 'a', 'at']);

const words = (s: string) => foldText(s).split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w));
const hasWord = (haystack: string[], phrase: string) => {
  const p = words(phrase);
  if (!p.length) return false;
  for (let i = 0; i + p.length <= haystack.length; i++) {
    if (p.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
};

/** How well a title matches one of the wanted titles: 0 (no word in common) to 6 (the same title). */
function titleScore(title: string, wanted: string[]): number {
  const have = words(title);
  if (!have.length) return 0;
  let best = 0;
  for (const w of wanted) {
    const want = words(w);
    if (!want.length) continue;
    if (want.join(' ') === have.join(' ')) return 6;
    let s = 0;
    if (hasWord(have, w)) s = 4;
    else if (want.every((x) => have.includes(x))) s = 3;
    else if (want.some((x) => have.includes(x))) s = 1;
    best = Math.max(best, s);
  }
  return best;
}

const mentions = (field: string | null, wanted: string[]) => {
  if (!field || !wanted.length) return false;
  const f = foldText(field);
  return wanted.some((w) => w && f.includes(w));
};

/** A person's fit with the search: title counts most, then seniority, then place, industry and company. */
export function prospectRelevance(person: ProspectPerson, filters: ProspectSearchFilters): number {
  let score = 0;
  const title = person.job_title || '';
  if (filters.titles?.length) score += titleScore(title, filters.titles);
  if (filters.seniorities?.length) {
    const have = words(title);
    if (filters.seniorities.some((s) => (SENIORITY_WORDS[s] || []).some((w) => hasWord(have, w)))) score += 2;
  }
  if (filters.locations?.length) {
    const places = expandProspectLocations(filters.locations).flatMap((v) => [foldText(prospectValueLabel(v)), foldText(v.split(',')[0])]);
    if (mentions(person.location, places.filter((p) => p.length > 2))) score += 1;
  }
  if (filters.industries?.length && mentions(person.industry, filters.industries.map(foldText))) score += 1;
  if (filters.companies?.length) {
    const wanted = filters.companies.map((c) => foldText(c).replace(/^https?:\/\/|^www\.|\/.*$/g, ''));
    if (mentions(person.company, wanted) || mentions(person.company_domain, wanted)) score += 1;
  }
  // Among equal fits, someone with a findable email is the more useful lead.
  if (person.has_email) score += 0.5;
  return score;
}

/** The same people, best fits first; ties keep the order they came in. */
export function rankProspects<T extends ProspectPerson>(people: T[], filters: ProspectSearchFilters): T[] {
  return people
    .map((person, i) => ({ person, i, score: prospectRelevance(person, filters) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.person);
}
