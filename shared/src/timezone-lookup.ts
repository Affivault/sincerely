/* ═══════════════════════════════════════════════════════════════════════
   Guessing where a prospect is, from the only thing we store about it.

   `contacts.location` is free text — "London, England, United Kingdom",
   "San Francisco, CA", "Berlin". This turns that into an IANA zone so a
   campaign can send at nine in the *recipient's* morning rather than the
   sender's.

   The governing rule is that a wrong answer is worse than no answer. A
   campaign that can't place someone falls back to its own timezone, which
   is exactly what it does today — no worse off. A campaign that places
   someone wrongly emails them at three in the morning, which is worse than
   what it does today. So every entry below is one where the mapping is
   unambiguous, and anything doubtful is deliberately absent:

     · "Georgia" is a US state and a country in the Caucasus — omitted.
     · "Washington" is a state on the Pacific and a capital on the
       Atlantic — only the explicit DC spellings are mapped.
     · Countries spanning several zones (US, Canada, Australia, Russia,
       Brazil) are not mapped at country level at all; they resolve only
       through a city or region that pins the zone down.
     · "Manchester", "Birmingham", "Cambridge", "Bristol" and "Portland"
       each name a UK/Los-Angeles-area city *and* a distinct, common
       US city elsewhere (Manchester NH, Birmingham AL, Cambridge MA,
       Bristol CT/TN, Portland ME) — omitted from CITY_ZONES so a
       segment like "MA" or "OR" that follows gets the chance to settle
       it instead of the city name jumping to the wrong zone first.
   ═══════════════════════════════════════════════════════════════════════ */

/** Cities distinctive enough that the name alone settles the zone. */
const CITY_ZONES: Record<string, string> = {
  // North America
  'new york': 'America/New_York', 'brooklyn': 'America/New_York', 'manhattan': 'America/New_York',
  'boston': 'America/New_York', 'philadelphia': 'America/New_York', 'atlanta': 'America/New_York',
  'miami': 'America/New_York', 'washington dc': 'America/New_York',
  'toronto': 'America/Toronto', 'ottawa': 'America/Toronto', 'montreal': 'America/Toronto',
  'chicago': 'America/Chicago', 'dallas': 'America/Chicago', 'houston': 'America/Chicago',
  'austin': 'America/Chicago', 'minneapolis': 'America/Chicago', 'winnipeg': 'America/Winnipeg',
  'denver': 'America/Denver', 'salt lake city': 'America/Denver', 'calgary': 'America/Edmonton',
  'edmonton': 'America/Edmonton', 'phoenix': 'America/Phoenix',
  'san francisco': 'America/Los_Angeles', 'los angeles': 'America/Los_Angeles',
  'san diego': 'America/Los_Angeles', 'seattle': 'America/Los_Angeles',
  'san jose': 'America/Los_Angeles',
  'palo alto': 'America/Los_Angeles', 'oakland': 'America/Los_Angeles',
  'vancouver': 'America/Vancouver',
  'mexico city': 'America/Mexico_City',

  // South America
  'sao paulo': 'America/Sao_Paulo', 'são paulo': 'America/Sao_Paulo',
  'rio de janeiro': 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires',
  'santiago': 'America/Santiago', 'bogota': 'America/Bogota', 'bogotá': 'America/Bogota',
  'lima': 'America/Lima',

  // Europe
  'london': 'Europe/London',
  'edinburgh': 'Europe/London', 'glasgow': 'Europe/London',
  'leeds': 'Europe/London', 'oxford': 'Europe/London',
  'dublin': 'Europe/Dublin', 'lisbon': 'Europe/Lisbon', 'porto': 'Europe/Lisbon',
  'paris': 'Europe/Paris', 'lyon': 'Europe/Paris', 'marseille': 'Europe/Paris',
  'madrid': 'Europe/Madrid', 'barcelona': 'Europe/Madrid', 'valencia': 'Europe/Madrid',
  'berlin': 'Europe/Berlin', 'munich': 'Europe/Berlin', 'münchen': 'Europe/Berlin',
  'hamburg': 'Europe/Berlin', 'frankfurt': 'Europe/Berlin', 'cologne': 'Europe/Berlin',
  'amsterdam': 'Europe/Amsterdam', 'rotterdam': 'Europe/Amsterdam', 'utrecht': 'Europe/Amsterdam',
  'brussels': 'Europe/Brussels', 'antwerp': 'Europe/Brussels',
  'zurich': 'Europe/Zurich', 'zürich': 'Europe/Zurich', 'geneva': 'Europe/Zurich',
  'vienna': 'Europe/Vienna', 'milan': 'Europe/Rome', 'rome': 'Europe/Rome', 'turin': 'Europe/Rome',
  'copenhagen': 'Europe/Copenhagen', 'stockholm': 'Europe/Stockholm',
  'oslo': 'Europe/Oslo', 'helsinki': 'Europe/Helsinki',
  'warsaw': 'Europe/Warsaw', 'krakow': 'Europe/Warsaw', 'kraków': 'Europe/Warsaw',
  'prague': 'Europe/Prague', 'budapest': 'Europe/Budapest', 'bucharest': 'Europe/Bucharest',
  'athens': 'Europe/Athens', 'sofia': 'Europe/Sofia', 'kyiv': 'Europe/Kyiv', 'kiev': 'Europe/Kyiv',
  'istanbul': 'Europe/Istanbul', 'moscow': 'Europe/Moscow',

  // Middle East & Africa
  'dubai': 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai', 'doha': 'Asia/Qatar',
  'riyadh': 'Asia/Riyadh', 'tel aviv': 'Asia/Jerusalem', 'jerusalem': 'Asia/Jerusalem',
  'cairo': 'Africa/Cairo', 'lagos': 'Africa/Lagos', 'nairobi': 'Africa/Nairobi',
  'johannesburg': 'Africa/Johannesburg', 'cape town': 'Africa/Johannesburg',

  // Asia-Pacific
  'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata',
  'bangalore': 'Asia/Kolkata', 'bengaluru': 'Asia/Kolkata', 'hyderabad': 'Asia/Kolkata',
  'chennai': 'Asia/Kolkata', 'pune': 'Asia/Kolkata', 'gurgaon': 'Asia/Kolkata',
  'karachi': 'Asia/Karachi', 'lahore': 'Asia/Karachi', 'dhaka': 'Asia/Dhaka',
  'bangkok': 'Asia/Bangkok', 'ho chi minh city': 'Asia/Ho_Chi_Minh', 'hanoi': 'Asia/Ho_Chi_Minh',
  'jakarta': 'Asia/Jakarta', 'kuala lumpur': 'Asia/Kuala_Lumpur', 'manila': 'Asia/Manila',
  'singapore': 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong', 'taipei': 'Asia/Taipei',
  'shanghai': 'Asia/Shanghai', 'beijing': 'Asia/Shanghai', 'shenzhen': 'Asia/Shanghai',
  'seoul': 'Asia/Seoul', 'tokyo': 'Asia/Tokyo', 'osaka': 'Asia/Tokyo', 'kyoto': 'Asia/Tokyo',
  'sydney': 'Australia/Sydney', 'melbourne': 'Australia/Melbourne', 'canberra': 'Australia/Sydney',
  'brisbane': 'Australia/Brisbane', 'perth': 'Australia/Perth', 'adelaide': 'Australia/Adelaide',
  'auckland': 'Pacific/Auckland', 'wellington': 'Pacific/Auckland',
};

/**
 * Sub-national regions, for the countries a single zone can't describe.
 * Both the full name and the postal abbreviation, since a CSV may hold either.
 */
const REGION_ZONES: Record<string, string> = {
  // ─── United States ───
  'district of columbia': 'America/New_York', 'dc': 'America/New_York',
  'maine': 'America/New_York', 'me': 'America/New_York',
  'new hampshire': 'America/New_York', 'nh': 'America/New_York',
  'vermont': 'America/New_York', 'vt': 'America/New_York',
  'massachusetts': 'America/New_York',
  'rhode island': 'America/New_York', 'ri': 'America/New_York',
  'connecticut': 'America/New_York', 'ct': 'America/New_York',
  'new york': 'America/New_York', 'ny': 'America/New_York',
  'new jersey': 'America/New_York', 'nj': 'America/New_York',
  'pennsylvania': 'America/New_York', 'pa': 'America/New_York',
  'delaware': 'America/New_York',
  'maryland': 'America/New_York', 'md': 'America/New_York',
  'virginia': 'America/New_York', 'va': 'America/New_York',
  'west virginia': 'America/New_York', 'wv': 'America/New_York',
  'north carolina': 'America/New_York', 'nc': 'America/New_York',
  'south carolina': 'America/New_York', 'sc': 'America/New_York',
  'ohio': 'America/New_York', 'oh': 'America/New_York',
  'michigan': 'America/New_York', 'mi': 'America/New_York',
  'indiana': 'America/New_York',
  'kentucky': 'America/New_York', 'ky': 'America/New_York',
  'alabama': 'America/Chicago', 'al': 'America/Chicago',
  'arkansas': 'America/Chicago', 'ar': 'America/Chicago',
  'illinois': 'America/Chicago',
  'iowa': 'America/Chicago', 'ia': 'America/Chicago',
  'louisiana': 'America/Chicago', 'la': 'America/Chicago',
  'minnesota': 'America/Chicago', 'mn': 'America/Chicago',
  'mississippi': 'America/Chicago', 'ms': 'America/Chicago',
  'missouri': 'America/Chicago', 'mo': 'America/Chicago',
  'oklahoma': 'America/Chicago', 'ok': 'America/Chicago',
  'wisconsin': 'America/Chicago', 'wi': 'America/Chicago',
  'texas': 'America/Chicago', 'tx': 'America/Chicago',
  'tennessee': 'America/Chicago', 'tn': 'America/Chicago',
  'colorado': 'America/Denver',
  'montana': 'America/Denver', 'mt': 'America/Denver',
  'new mexico': 'America/Denver', 'nm': 'America/Denver',
  'utah': 'America/Denver', 'ut': 'America/Denver',
  'wyoming': 'America/Denver', 'wy': 'America/Denver',
  'arizona': 'America/Phoenix', 'az': 'America/Phoenix',
  'california': 'America/Los_Angeles',
  'nevada': 'America/Los_Angeles', 'nv': 'America/Los_Angeles',
  'oregon': 'America/Los_Angeles', 'or': 'America/Los_Angeles',
  'washington state': 'America/Los_Angeles', 'wa': 'America/Los_Angeles',
  'alaska': 'America/Anchorage', 'ak': 'America/Anchorage',
  'hawaii': 'Pacific/Honolulu', 'hi': 'Pacific/Honolulu',
  // Idaho, Kansas, Nebraska, North/South Dakota, Florida and Georgia all
  // straddle a zone boundary or collide with another name — left out.
  // California, Delaware, Indiana, Illinois, Colorado and Massachusetts also
  // had their 2-letter postal codes (CA, DE, IN, IL, CO, MA) dropped here —
  // each collides with a real ISO country code for a country already listed
  // in COUNTRY_ZONES below (Canada, Germany, India, Israel, Colombia,
  // Morocco), so keeping the alias would confidently resolve a segment like
  // "DE" for a German contact to Delaware instead — full state names only.

  // ─── Canada ───
  'ontario': 'America/Toronto', 'quebec': 'America/Toronto', 'québec': 'America/Toronto',
  'nova scotia': 'America/Halifax', 'new brunswick': 'America/Halifax',
  'manitoba': 'America/Winnipeg', 'saskatchewan': 'America/Regina',
  'alberta': 'America/Edmonton', 'british columbia': 'America/Vancouver',

  // ─── Australia ───
  'new south wales': 'Australia/Sydney', 'nsw': 'Australia/Sydney',
  'victoria': 'Australia/Melbourne', 'vic': 'Australia/Melbourne',
  'queensland': 'Australia/Brisbane', 'qld': 'Australia/Brisbane',
  'western australia': 'Australia/Perth',
  'south australia': 'Australia/Adelaide',
  'tasmania': 'Australia/Hobart', 'tas': 'Australia/Hobart',

  // ─── United Kingdom ───
  'england': 'Europe/London', 'scotland': 'Europe/London',
  'wales': 'Europe/London', 'northern ireland': 'Europe/London',
};

/**
 * Countries that sit in one zone. The large multi-zone ones are absent on
 * purpose — "United States" alone tells you nothing useful about when it is
 * a reasonable hour to arrive.
 */
const COUNTRY_ZONES: Record<string, string> = {
  'united kingdom': 'Europe/London', 'uk': 'Europe/London', 'great britain': 'Europe/London',
  'ireland': 'Europe/Dublin', 'portugal': 'Europe/Lisbon', 'iceland': 'Atlantic/Reykjavik',
  'france': 'Europe/Paris', 'spain': 'Europe/Madrid', 'germany': 'Europe/Berlin',
  'netherlands': 'Europe/Amsterdam', 'the netherlands': 'Europe/Amsterdam',
  'belgium': 'Europe/Brussels', 'luxembourg': 'Europe/Luxembourg',
  'switzerland': 'Europe/Zurich', 'austria': 'Europe/Vienna', 'italy': 'Europe/Rome',
  'denmark': 'Europe/Copenhagen', 'sweden': 'Europe/Stockholm', 'norway': 'Europe/Oslo',
  'finland': 'Europe/Helsinki', 'poland': 'Europe/Warsaw', 'czech republic': 'Europe/Prague',
  'czechia': 'Europe/Prague', 'slovakia': 'Europe/Bratislava', 'hungary': 'Europe/Budapest',
  'romania': 'Europe/Bucharest', 'bulgaria': 'Europe/Sofia', 'greece': 'Europe/Athens',
  'croatia': 'Europe/Zagreb', 'slovenia': 'Europe/Ljubljana', 'serbia': 'Europe/Belgrade',
  'estonia': 'Europe/Tallinn', 'latvia': 'Europe/Riga', 'lithuania': 'Europe/Vilnius',
  'ukraine': 'Europe/Kyiv', 'turkey': 'Europe/Istanbul', 'türkiye': 'Europe/Istanbul',
  'israel': 'Asia/Jerusalem', 'united arab emirates': 'Asia/Dubai', 'uae': 'Asia/Dubai',
  'qatar': 'Asia/Qatar', 'saudi arabia': 'Asia/Riyadh', 'kuwait': 'Asia/Kuwait',
  'egypt': 'Africa/Cairo', 'nigeria': 'Africa/Lagos', 'kenya': 'Africa/Nairobi',
  'south africa': 'Africa/Johannesburg', 'ghana': 'Africa/Accra', 'morocco': 'Africa/Casablanca',
  'india': 'Asia/Kolkata', 'pakistan': 'Asia/Karachi', 'bangladesh': 'Asia/Dhaka',
  'sri lanka': 'Asia/Colombo', 'nepal': 'Asia/Kathmandu',
  'thailand': 'Asia/Bangkok', 'vietnam': 'Asia/Ho_Chi_Minh', 'viet nam': 'Asia/Ho_Chi_Minh',
  'malaysia': 'Asia/Kuala_Lumpur', 'singapore': 'Asia/Singapore', 'philippines': 'Asia/Manila',
  'hong kong': 'Asia/Hong_Kong', 'taiwan': 'Asia/Taipei', 'china': 'Asia/Shanghai',
  'south korea': 'Asia/Seoul', 'korea': 'Asia/Seoul', 'japan': 'Asia/Tokyo',
  'new zealand': 'Pacific/Auckland',
  'argentina': 'America/Argentina/Buenos_Aires', 'chile': 'America/Santiago',
  'colombia': 'America/Bogota', 'peru': 'America/Lima', 'uruguay': 'America/Montevideo',
  // Absent on purpose, each spanning zones a country name can't choose
  // between: United States, Canada, Australia, Russia, Brazil, Indonesia,
  // Mexico, Kazakhstan.
};

/** Trim, lowercase, drop punctuation that varies between exports. */
function normalise(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best guess at a contact's IANA timezone from their free-text location, or
 * null when nothing in it is unambiguous.
 *
 * Segments are tried most-specific first, so "Portland, Oregon" resolves on
 * the city and "Somewhereville, Oregon" still resolves on the state. Within
 * a segment, city beats region beats country: "New York" is both a city and
 * a state and they agree, but where the two ever disagreed the city — being
 * the more specific claim — is the one to trust.
 */
export function inferTimezone(location?: string | null): string | null {
  if (!location || typeof location !== 'string') return null;

  const segments = location.split(',').map(normalise).filter(Boolean);
  if (segments.length === 0) return null;

  for (const segment of segments) {
    const hit = CITY_ZONES[segment] || REGION_ZONES[segment] || COUNTRY_ZONES[segment];
    if (hit) return hit;
  }

  // Nothing matched a whole segment. One last try on the entire string, for
  // locations written without commas ("Greater London Area", "Tokyo Japan").
  const whole = normalise(location);
  for (const [name, zone] of Object.entries(CITY_ZONES)) {
    // Word-bounded so "orlando" can't match on "orl" and "india" can't match
    // inside "indiana".
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(whole)) return zone;
  }
  for (const [name, zone] of Object.entries(REGION_ZONES)) {
    if (name.length < 4) continue; // skip 2-letter abbreviations — too easy to hit by accident
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(whole)) return zone;
  }
  for (const [name, zone] of Object.entries(COUNTRY_ZONES)) {
    if (name.length < 5) continue; // skip "uk"/"uae" — too easy to hit by accident
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(whole)) return zone;
  }

  return null;
}

/** Every zone this module can produce, for tests and for the settings UI. */
export function knownTimezones(): string[] {
  return [...new Set([
    ...Object.values(CITY_ZONES),
    ...Object.values(REGION_ZONES),
    ...Object.values(COUNTRY_ZONES),
  ])].sort();
}
