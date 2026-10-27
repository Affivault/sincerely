/*
 * The Prospector's search engine: what people type becomes values Icypeas matches.
 *
 *   - market groups (DACH, Nordics...) widen to two-letter country codes, and
 *     "UK" or "Germany" go out as GB / DE, which Icypeas matches best
 *   - the same happens on every location field, includes and excludes
 *   - the place typeahead finds towns, regions, metros and countries
 *   - industries suggest Icypeas's own names, also for words like "SaaS"
 *   - a standing search keeps every filter it was saved with, up to 200 values
 *   - the free match count reads whichever field the response uses
 */
process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.ICYPEAS_API_KEY = 'icy-test-key';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const { icypeasQuery, icypeasCountFrom } = await import('../src/services/prospect-providers.js');
const { suggestPlaces } = await import('../src/services/place-suggest.js');
const {
  expandProspectLocations, prospectValueLabel, rankSuggestions, sanitizeAdvancedFilters,
  PROSPECT_INDUSTRIES, INDUSTRY_ALIASES, LOCATION_GROUPS,
} = await import('@lemlist/shared');

console.log('\nLocations become what Icypeas matches');
{
  const dach = expandProspectLocations(['group:dach', 'UK', 'Germany', 'Manchester, United Kingdom']);
  is('a group widens to its countries, names and short forms become codes', JSON.stringify(dach) === JSON.stringify(['DE', 'AT', 'CH', 'GB', 'Manchester, United Kingdom']), JSON.stringify(dach));
  is('an unknown group is dropped, not sent', expandProspectLocations(['group:mars']).length === 0);
  is('no more than 200 values go out', expandProspectLocations(Array.from({ length: 300 }, (_, i) => `Town ${i}`)).length === 200);
  is('every group code is a real two-letter code', LOCATION_GROUPS.every((g) => g.codes.every((c) => /^[A-Z]{2}$/.test(c) && prospectValueLabel(c) !== c)));

  const q = icypeasQuery({
    locations: ['group:nordics'],
    advanced: { location: { exclude: ['group:ukie'] }, 'currentCompany.location': { include: ['usa'] }, pastCompanyName: { include: ['UK'] } } as any,
  });
  is('the main location list is expanded', JSON.stringify(q.location?.include) === JSON.stringify(['SE', 'NO', 'DK', 'FI', 'IS']), JSON.stringify(q.location));
  is('location excludes are expanded too', JSON.stringify(q.location?.exclude) === JSON.stringify(['GB', 'IE']), JSON.stringify(q.location));
  is('company HQ location is expanded', JSON.stringify(q['currentCompany.location']) === JSON.stringify({ include: ['US'] }));
  is('a field that is not a place is left alone', JSON.stringify(q.pastCompanyName) === JSON.stringify({ include: ['UK'] }));
  is('chips read as names', prospectValueLabel('GB') === 'United Kingdom' && prospectValueLabel('group:dach') === 'DACH');
}

console.log('\nThe place typeahead');
{
  const first = (q: string) => suggestPlaces(q)[0];
  is('a town', first('guildf')?.value === 'Guildford, United Kingdom', JSON.stringify(first('guildf')));
  is('the biggest town of a name comes first', first('manchester')?.value === 'Manchester, United Kingdom', JSON.stringify(first('manchester')));
  is('a US town carries its state', first('austin')?.value === 'Austin, Texas, United States', JSON.stringify(first('austin')));
  is('a region', first('texas')?.value === 'Texas, United States', JSON.stringify(first('texas')));
  is('a country goes out as its code', first('uk')?.value === 'GB' && first('germany')?.value === 'DE', JSON.stringify([first('uk'), first('germany')]));
  is('a market group', first('dach')?.value === 'group:dach', JSON.stringify(first('dach')));
  is('a short form', suggestPlaces('nyc').some((s) => s.value.startsWith('New York')), JSON.stringify(suggestPlaces('nyc').slice(0, 3)));
  is('accents do not matter', suggestPlaces('zurich').some((s) => s.value === 'Zurich, Switzerland'), JSON.stringify(suggestPlaces('zurich').slice(0, 3)));
  is('a metro area', suggestPlaces('bay area').some((s) => s.value === 'San Francisco Bay Area'));
  is('empty shows markets and top countries', suggestPlaces('').length > 20);
  is('two words narrow it', suggestPlaces('london canada')[0]?.value === 'London, Canada', JSON.stringify(suggestPlaces('london canada')[0]));
}

console.log('\nIndustries are Icypeas names');
{
  is('the full Icypeas list is there', PROSPECT_INDUSTRIES.length > 400 && PROSPECT_INDUSTRIES.includes('Software Development'));
  is('every alias points at a real industry', Object.values(INDUSTRY_ALIASES).flat().every((v) => PROSPECT_INDUSTRIES.includes(v)),
    Object.values(INDUSTRY_ALIASES).flat().filter((v) => !PROSPECT_INDUSTRIES.includes(v)).join(', '));
  const saas = rankSuggestions(PROSPECT_INDUSTRIES, 'SaaS', 10, INDUSTRY_ALIASES);
  is('"SaaS" suggests Software Development', saas[0]?.value === 'Software Development' && saas[0]?.hint === 'for SaaS', JSON.stringify(saas[0]));
  is('word starts match', rankSuggestions(PROSPECT_INDUSTRIES, 'staff').some((s) => s.value === 'Staffing and Recruiting'));
  is('nothing typed lists everything', rankSuggestions(PROSPECT_INDUSTRIES, '', 1000).length === PROSPECT_INDUSTRIES.length);
}

console.log('\nStanding searches keep every filter');
{
  const adv = sanitizeAdvancedFilters({
    skills: { include: ['Shopify', ' ', 'Shopify'] },
    'currentCompany.revenue': { min: '1000', max: null },
    'currentCompany.headcountGrowth': { timespan: 'never', min: 5 },
    school: { include: [] },
    hacked: { include: ['x'] },
  });
  is('known fields are kept, cleaned', JSON.stringify(adv?.skills) === JSON.stringify({ include: ['Shopify'] }), JSON.stringify(adv));
  is('a range keeps its numbers', JSON.stringify(adv?.['currentCompany.revenue']) === JSON.stringify({ min: 1000, max: null }));
  is('growth gets a valid period', (adv?.['currentCompany.headcountGrowth'] as any)?.timespan === '12months');
  is('empty and unknown fields are dropped', !adv?.school && !(adv as any)?.hacked);
  is('nothing set is undefined', sanitizeAdvancedFilters({ school: { include: [] } }) === undefined);
}

console.log('\nThe free match count');
{
  is('reads total', icypeasCountFrom({ success: true, total: 1234 }) === 1234);
  is('reads count', icypeasCountFrom({ count: '56' }) === 56);
  is('reads a nested total', icypeasCountFrom({ item: { total: 7 } }) === 7);
  is('says nothing when it cannot tell', icypeasCountFrom({ success: true }) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
