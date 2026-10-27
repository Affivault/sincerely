// The Prospector's location typeahead: countries, regions, metro areas and
// every town of 5,000+ people (server/src/data/places.ts), matched on what
// has been typed so far. Market groups (DACH, Nordics...) come first.

import { PLACES_TSV } from '../data/places.js';
import { COUNTRY_ALIASES, foldText, matchLocationGroups, prospectValueLabel } from '@lemlist/shared';
import type { ProspectSuggestion } from '@lemlist/shared';

interface Place { kind: string; value: string; label: string; folded: string; words: string[]; rank: number }

const KIND_LABEL: Record<string, string> = { c: 'Country', r: 'Region', m: 'Metro area', t: 'Town' };

/** Common short forms, matched as if the full name had been typed. */
const PLACE_ALIASES: Record<string, string> = {
  nyc: 'new york', sf: 'san francisco', 'bay area': 'san francisco bay area', la: 'los angeles', dc: 'washington',
  bangalore: 'bengaluru', bombay: 'mumbai', kiev: 'kyiv', 'ho chi minh': 'ho chi minh city', saigon: 'ho chi minh city',
  munchen: 'munich', koln: 'cologne', wien: 'vienna', praha: 'prague', lisboa: 'lisbon', roma: 'rome', milano: 'milan',
};

let places: Place[] | null = null;

function load(): Place[] {
  if (places) return places;
  places = PLACES_TSV.split('\n').map((line) => {
    const [kind, value, label, pop] = line.split('\t');
    const folded = foldText(label);
    return { kind, value: value || label, label, folded, words: folded.split(/[\s,()'-]+/).filter(Boolean), rank: Number(pop) || 0 };
  });
  return places;
}

export function suggestPlaces(typed: string, limit = 12): ProspectSuggestion[] {
  const raw = foldText(typed).slice(0, 80);
  const groups = matchLocationGroups(raw);
  if (!raw) {
    // Nothing typed yet: markets, then the biggest countries people prospect in.
    const top = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'NL', 'IE', 'IT', 'IN', 'SG', 'AE', 'SE', 'CH', 'BR'];
    return [...groups, ...top.map((value) => ({ value, label: prospectValueLabel(value), kind: 'Country' }))];
  }
  const q = PLACE_ALIASES[raw] || raw;
  const tokens = q.split(/[\s,]+/).filter(Boolean);
  const aliasCode = COUNTRY_ALIASES[raw];

  const hits: { place: Place; score: number }[] = [];
  for (const place of load()) {
    if (!tokens.every((t) => place.words.some((w) => w.startsWith(t)))) continue;
    const startsLabel = place.folded.startsWith(q);
    // A short query matching a tiny place exactly ("man") should not beat Manchester.
    const exactName = q.length >= 4 && place.folded.split(',')[0] === q;
    // Rank is a town's population, or a set weight for countries, regions and metros.
    const score = (exactName ? 3e10 : startsLabel ? 2e10 : 1e10) + place.rank;
    hits.push({ place, score });
    if (hits.length > 4000) break; // a one-letter query: enough to rank from
  }
  hits.sort((a, b) => b.score - a.score);

  const out: ProspectSuggestion[] = [];
  if (aliasCode) out.push({ value: aliasCode, label: prospectValueLabel(aliasCode), kind: 'Country' });
  out.push(...groups.slice(0, 3));
  const seen = new Set(out.map((s) => s.value));
  for (const { place } of hits) {
    if (out.length >= limit) break;
    if (seen.has(place.value)) continue;
    seen.add(place.value);
    out.push({ value: place.value, label: place.label, kind: KIND_LABEL[place.kind] });
  }
  return out;
}
