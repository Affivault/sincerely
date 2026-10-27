// Builds server/src/data/places.ts, the place list behind the Prospector's
// location typeahead: every country, the main regions of the big markets,
// and every town of 5,000+ people.
//
// Sources (both MIT): all-the-cities (GeoNames cities1000, CC BY 4.0, so keep
// the credit in places.ts) and country-region-data. Neither is a dependency;
// install them somewhere throwaway and point NODE_PATH at it:
//   npm i --prefix /tmp/geo all-the-cities@3.1.0 country-region-data@4.1.0
//   NODE_PATH=/tmp/geo/node_modules node server/scripts/build-places.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cities = require('all-the-cities');
const regionData = require('country-region-data/data.json');

const intlName = new Intl.DisplayNames(['en'], { type: 'region' });
const sourceName = new Map(regionData.map((c) => [c.countryShortCode, c.countryName]));
// Intl's short forms ("Congo - Kinshasa", "Bosnia & Herzegovina") are not how profiles spell them.
const countryName = { of: (code) => { const n = intlName.of(code); return !n || n === code || /&| - /.test(n) ? sourceName.get(code) || n : n; } };
const MIN_POPULATION = 5000;

// GeoNames admin1 codes for the markets where a region helps tell towns apart.
const ADMIN1 = {
  US: { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' },
  GB: { ENG: 'England', SCT: 'Scotland', WLS: 'Wales', NIR: 'Northern Ireland' },
  CA: { '01': 'Alberta', '02': 'British Columbia', '03': 'Manitoba', '04': 'New Brunswick', '05': 'Newfoundland and Labrador', '07': 'Nova Scotia', '08': 'Ontario', '09': 'Prince Edward Island', '10': 'Quebec', '11': 'Saskatchewan', '12': 'Yukon', '13': 'Northwest Territories', '14': 'Nunavut' },
  AU: { '01': 'Australian Capital Territory', '02': 'New South Wales', '03': 'Northern Territory', '04': 'Queensland', '05': 'South Australia', '06': 'Tasmania', '07': 'Victoria', '08': 'Western Australia' },
  DE: { '01': 'Baden-Wurttemberg', '02': 'Bavaria', '03': 'Bremen', '04': 'Hamburg', '05': 'Hesse', '06': 'Lower Saxony', '07': 'North Rhine-Westphalia', '08': 'Rhineland-Palatinate', '09': 'Saarland', '10': 'Schleswig-Holstein', '11': 'Brandenburg', '12': 'Mecklenburg-Vorpommern', '13': 'Saxony', '14': 'Saxony-Anhalt', '15': 'Thuringia', '16': 'Berlin' },
};
// Only US profiles reliably carry the state, so only there is it part of the search value.
const REGION_IN_VALUE = new Set(['US']);

// Local spellings where profiles use the English one.
const CITY_NAMES = {
  'Köln': 'Cologne', 'Nürnberg': 'Nuremberg', 'Zürich': 'Zurich', 'Genève': 'Geneva', 'Göteborg': 'Gothenburg',
  'Sevilla': 'Seville', 'Montréal': 'Montreal', 'Québec': 'Quebec City', 'New York City': 'New York', 'Frankfurt am Main': 'Frankfurt',
};

// Region lists in English for the markets where the source uses local names.
const REGIONS_EN = {
  DE: Object.values(ADMIN1.DE),
  US: Object.values(ADMIN1.US), CA: Object.values(ADMIN1.CA), AU: Object.values(ADMIN1.AU),
  GB: ['England', 'Scotland', 'Wales', 'Northern Ireland', 'Greater London', 'Greater Manchester', 'West Midlands', 'East Midlands', 'South East England', 'South West England', 'North West England', 'North East England', 'Yorkshire and the Humber', 'East of England', 'Kent', 'Surrey', 'Essex', 'Hampshire', 'Sussex', 'Hertfordshire', 'Berkshire', 'Oxfordshire', 'Cambridgeshire', 'Devon', 'Cornwall', 'Lancashire', 'Merseyside', 'West Yorkshire', 'South Yorkshire', 'Tyne and Wear', 'Cheshire', 'Norfolk', 'Suffolk', 'Leicestershire', 'Nottinghamshire', 'Derbyshire', 'Staffordshire', 'Warwickshire', 'Gloucestershire', 'Somerset', 'Dorset', 'Wiltshire', 'Buckinghamshire', 'Bedfordshire', 'Northamptonshire', 'Lincolnshire'],
  IT: ['Lombardy', 'Lazio', 'Campania', 'Sicily', 'Veneto', 'Emilia-Romagna', 'Piedmont', 'Apulia', 'Tuscany', 'Calabria', 'Sardinia', 'Liguria', 'Marche', 'Abruzzo', 'Friuli-Venezia Giulia', 'Trentino-Alto Adige', 'Umbria', 'Basilicata', 'Molise', 'Aosta Valley'],
  ES: ['Andalusia', 'Catalonia', 'Community of Madrid', 'Valencian Community', 'Galicia', 'Castile and Leon', 'Basque Country', 'Canary Islands', 'Castilla-La Mancha', 'Region of Murcia', 'Aragon', 'Balearic Islands', 'Extremadura', 'Asturias', 'Navarre', 'Cantabria', 'La Rioja'],
  FR: ['Ile-de-France', 'Auvergne-Rhone-Alpes', "Provence-Alpes-Cote d'Azur", 'Occitanie', 'Nouvelle-Aquitaine', 'Hauts-de-France', 'Grand Est', 'Brittany', 'Normandy', 'Pays de la Loire', 'Bourgogne-Franche-Comte', 'Centre-Val de Loire', 'Corsica'],
  NL: ['North Holland', 'South Holland', 'Utrecht', 'North Brabant', 'Gelderland', 'Overijssel', 'Limburg', 'Groningen', 'Friesland', 'Flevoland', 'Drenthe', 'Zeeland'],
  BE: ['Flanders', 'Wallonia', 'Brussels Region'],
  CH: ['Zurich', 'Geneva', 'Vaud', 'Bern', 'Basel', 'Lucerne', 'Ticino', 'Zug', 'St. Gallen', 'Aargau'],
  AT: ['Vienna', 'Lower Austria', 'Upper Austria', 'Styria', 'Tyrol', 'Carinthia', 'Salzburg', 'Vorarlberg', 'Burgenland'],
  IE: ['Leinster', 'Munster', 'Connacht', 'Ulster', 'County Dublin', 'County Cork', 'County Galway', 'County Limerick'],
};

// Metro areas, which profiles often name instead of a town.
const METROS = [
  ['Greater London', 'GB'], ['Greater Manchester', 'GB'], ['Greater Paris Metropolitan Region', 'FR'], ['San Francisco Bay Area', 'US'],
  ['New York City Metropolitan Area', 'US'], ['Greater Los Angeles Area', 'US'], ['Greater Chicago Area', 'US'], ['Greater Boston', 'US'],
  ['Greater Seattle Area', 'US'], ['Washington DC-Baltimore Area', 'US'], ['Dallas-Fort Worth Metroplex', 'US'], ['Greater Houston', 'US'],
  ['Atlanta Metropolitan Area', 'US'], ['Miami-Fort Lauderdale Area', 'US'], ['Denver Metropolitan Area', 'US'], ['Austin, Texas Metropolitan Area', 'US'],
  ['Greater Philadelphia', 'US'], ['Greater Phoenix Area', 'US'], ['Greater Toronto Area', 'CA'], ['Greater Vancouver Metropolitan Area', 'CA'],
  ['Greater Montreal Metropolitan Area', 'CA'], ['Greater Sydney Area', 'AU'], ['Greater Melbourne Area', 'AU'], ['Greater Dublin', 'IE'],
  ['Greater Madrid Metropolitan Area', 'ES'], ['Greater Barcelona Metropolitan Area', 'ES'], ['Greater Milan Metropolitan Area', 'IT'],
  ['Berlin Metropolitan Area', 'DE'], ['Greater Munich Metropolitan Area', 'DE'], ['Amsterdam Area', 'NL'], ['Randstad', 'NL'],
  ['Greater Stockholm Metropolitan Area', 'SE'], ['Greater Copenhagen Region', 'DK'], ['Greater Lisbon', 'PT'], ['Greater Zurich Area', 'CH'],
  ['Dubai Emirate', 'AE'], ['Greater Bengaluru Area', 'IN'], ['Mumbai Metropolitan Region', 'IN'], ['Greater Delhi Area', 'IN'],
  ['Greater Sao Paulo', 'BR'], ['Singapore Metropolitan Area', 'SG'], ['Tel Aviv Metropolitan Area', 'IL'],
];

const rows = new Map(); // value -> [kind, value, label, rank]
const add = (kind, value, label, rank) => {
  const have = rows.get(value);
  if (!have || have[3] < rank) rows.set(value, [kind, value, label, rank]);
};

for (const c of regionData) {
  const code = c.countryShortCode;
  const name = countryName.of(code);
  // A country searches by its two-letter code, which Icypeas recommends.
  add('c', code, name, 1e9);
  // A region ranks like a big town in the markets people prospect in, like a small one elsewhere.
  const regions = REGIONS_EN[code] || c.regions.map((r) => r.name);
  for (const r of regions) add('r', `${r}, ${name}`, `${r}, ${name}`, REGIONS_EN[code] ? 2e6 : 3e4);
}
for (const [metro, code] of METROS) add('m', metro, `${metro}, ${countryName.of(code)}`, 8e5);

for (const city of cities) {
  if (city.population < MIN_POPULATION) continue;
  if (!/^PPL/.test(city.featureCode || '')) continue;
  const name = CITY_NAMES[city.name] || city.name;
  let country;
  try { country = countryName.of(city.country); } catch { continue; }
  const region = ADMIN1[city.country]?.[city.adminCode];
  const value = region && REGION_IN_VALUE.has(city.country) ? `${name}, ${region}, ${country}` : `${name}, ${country}`;
  const label = region ? `${name}, ${region}, ${country}` : value;
  add('t', value, label, city.population);
}

const list = [...rows.values()].sort((a, b) => b[3] - a[3]);
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/[\t\n]/g, ' ');
const lines = list.map(([kind, value, label, rank]) => [kind, label === value ? '' : value, label, rank].map(String).map(esc).join('\t'));

const out = `// Generated by server/scripts/build-places.mjs. Do not edit by hand.
// Towns: GeoNames (geonames.org), CC BY 4.0, via all-the-cities.
// Regions: country-region-data (MIT) plus English names for the big markets.
//
// One place per line, tab separated: kind (c country, r region, m metro area,
// t town), the search value when it differs from the label, the label, and a
// rank (a town's population; a set weight for the rest). Sorted by rank.
export const PLACES_TSV = \`${lines.join('\n')}\`;
`;
const target = fileURLToPath(new URL('../src/data/places.ts', import.meta.url));
writeFileSync(target, out);
console.log(`${list.length} places -> ${target} (${(out.length / 1024).toFixed(0)} KB)`);
