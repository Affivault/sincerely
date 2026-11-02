/* ═══════════════════════════════════════════════════════════════════════
   Importing a CSV without a mapping screen.

   Every import used to stop on a table of dropdowns, one per column, and
   for the common file - Email, First name, Company - every dropdown was
   already right. The screen asked the person to confirm what the software
   had worked out, column by column, which is work that proves nothing.

   So the plan is made here from the headers AND the values. The review
   screen still shows what was decided, grouped and in plain words, so a
   wrong guess is visible at a glance rather than buried behind a toggle.

   How a column is matched, best evidence first:

     1. Noise: ids, "Add date", Sincerely's own system columns. Skipped.
     2. The header, against the column names the common tools export
        (Apollo, Lemlist, LinkedIn/Sales Navigator, HubSpot, ZoomInfo,
        Hunter, Snov, Lusha, Sincerely itself). An exact name beats a
        pattern, so "Location" wins Location over "Country".
     3. Company context: "Company URL", "Company's country", "HQ phone",
        "# Employees" describe the company, not the person, and go to the
        company record.
     4. The values, for a header that said nothing: a column of addresses
        is the email, a column of linkedin.com/in links is the profile.

   Then the tidy-up a person would do by eye: a second column with the same
   values as a mapped one is skipped (LinkedIn twice), a Full name next to
   first and last is skipped, and a bare City that is really the company's
   city (it is inside "Company location", not the person's location) is
   skipped. Anything else that is not recognised is kept as a custom field,
   never dropped, so a guess can lose a label but never the data.

   The rows are cleaned the same way on the way in: addresses trimmed and
   lower-cased, the same person twice merged into one row, a "Name" column
   split into first and last, and anything that cannot be imported set
   aside WITH its whole row, so it can be downloaded, fixed and re-uploaded.
   ═══════════════════════════════════════════════════════════════════════ */

export type ImportTarget =
  | ''
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'job_title'
  | 'phone'
  | 'linkedin_url'
  | 'website'
  | 'location'
  | 'city'
  | 'state'
  | 'country'
  | 'industry'
  | 'company'
  | 'company_website'
  | 'company_linkedin'
  | 'company_size'
  | 'company_industry'
  | 'company_location'
  | 'company_phone'
  | 'email_status'
  | 'do_not_contact'
  | 'tags'
  | '__custom__';

export const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = {
  '': 'Skip this column',
  email: 'Email',
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Full name (split into first and last)',
  job_title: 'Job title',
  phone: 'Phone',
  linkedin_url: 'LinkedIn URL',
  website: 'Website',
  location: 'Location',
  city: 'City',
  state: 'State / region',
  country: 'Country',
  industry: 'Industry',
  company: 'Company name',
  company_website: 'Company website',
  company_linkedin: 'Company LinkedIn',
  company_size: 'Company size',
  company_industry: 'Company industry',
  company_location: 'Company location',
  company_phone: 'Company phone (HQ)',
  email_status: 'Email status from your old tool',
  do_not_contact: 'Unsubscribed / bounced flag',
  tags: 'Tags (comma-separated)',
  __custom__: 'Custom field (keep column name)',
};

/** The mapping dropdown, grouped the way a person thinks about a lead. */
export const IMPORT_TARGET_GROUPS: ReadonlyArray<{ label: string; targets: ImportTarget[] }> = [
  { label: 'Person', targets: ['email', 'first_name', 'last_name', 'full_name', 'job_title', 'phone', 'linkedin_url', 'website', 'location', 'city', 'state', 'country', 'industry'] },
  { label: 'Company', targets: ['company', 'company_website', 'company_linkedin', 'company_size', 'company_industry', 'company_location', 'company_phone'] },
  { label: 'Other', targets: ['tags', 'email_status', 'do_not_contact', '__custom__', ''] },
];

/** Targets that write to the company record rather than the person. */
export const COMPANY_TARGETS: ReadonlySet<ImportTarget> = new Set<ImportTarget>([
  'company_website', 'company_linkedin', 'company_size', 'company_industry', 'company_location', 'company_phone',
]);

/** Targets a file may map only once. Custom fields, skips and flags may repeat. */
const SINGLE: ReadonlySet<ImportTarget> = new Set<ImportTarget>([
  'email', 'first_name', 'last_name', 'full_name', 'job_title', 'phone', 'linkedin_url',
  'website', 'location', 'city', 'state', 'country', 'industry',
  'company', 'company_website', 'company_linkedin', 'company_size', 'company_industry',
  'company_location', 'company_phone', 'email_status', 'tags',
]);

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

function isAddress(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function normHeader(header: string): string {
  return header.toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
}

/* ---- the dictionary --------------------------------------------------- */

const set = (...xs: string[]) => new Set(xs);

/** Columns that describe the export, not the person. */
const NOISE_EXACT = set(
  'id', 'uuid', 'guid', 'recordid', 'objectid', 'rowid', 'row', 'rownumber', 'index', 'no', 'number',
  'added', 'adddate', 'dateadded', 'addedon', 'addedat', 'addeddate',
  'created', 'createdat', 'createdon', 'createdate', 'createddate', 'creationdate', 'datecreated',
  'updated', 'updatedat', 'lastupdated', 'lastupdate', 'modified', 'modifiedat', 'modifieddate',
  'lastmodified', 'lastmodifieddate', 'importedat', 'importdate', 'imported', 'exportdate', 'exportedat',
  'scrapedat', 'scrapedate', 'enrichedat', 'importedfrom', 'importsource',
  // Sincerely's own export: true of the old record, meaningless on a new one.
  'source', 'lifecycle', 'lists', 'list', 'engagementscore', 'dcsscore', 'verifiedat', 'emailverifiedat',
);
const NOISE_ID = /(contact|lead|person|account|record|apollo|hubspot|salesforce|crm|external|prospect|company|user|lemlist|campaign|org|organization)id$/;

const EMAIL_STATUS = set(
  'emailstatus', 'emailverification', 'emailverificationstatus', 'verificationstatus', 'verification',
  'emailvalidation', 'emailvalidationstatus', 'deliverability', 'emaildeliverability', 'emailconfidence',
  'emailverified', 'emailquality', 'emailresult', 'mxstatus', 'emailscore', 'emailvalidity',
);
const DO_NOT_CONTACT = set(
  'unsubscribed', 'isunsubscribed', 'optedout', 'optout', 'emailoptout', 'donotemail', 'donotcontact',
  'donotcall', 'bounced', 'isbounced', 'emailbounced', 'hardbounce', 'suppressed', 'blacklisted', 'blocklisted',
);
const TAGS = set('tags', 'tag', 'labels', 'label');

/** After the company prefix is taken off: what the rest names. */
const COMPANY_REST: Array<[ImportTarget, number, Set<string>]> = [
  ['company', 100, set('', 'name', 'names', 'nameforemails', 'legalname', 'title', 'displayname')],
  ['company_website', 100, set('url', 'website', 'websiteurl', 'site', 'web', 'domain', 'domainname', 'homepage')],
  ['company_linkedin', 100, set('linkedin', 'linkedinurl', 'linkedinpage', 'linkedinprofile', 'social', 'socialurl', 'linkedinprofileurl')],
  ['company_size', 100, set('size', 'employees', 'headcount', 'employeecount', 'numberofemployees', 'noofemployees', 'staff', 'staffcount', 'employeesize', 'employeerange', 'sizerange')],
  ['company_industry', 100, set('industry', 'sector', 'vertical', 'industries', 'primaryindustry')],
  ['company_location', 100, set('location', 'address', 'fulladdress', 'hqlocation', 'headquarters', 'hq', 'hqaddress', 'streetaddress')],
  ['company_location', 60, set('country', 'city', 'state', 'region', 'countryregion', 'stateregion', 'postcode', 'zip', 'zipcode', 'postalcode', 'hqcountry', 'hqcity')],
  ['company_phone', 100, set('phone', 'phonenumber', 'hqphone', 'tel', 'telephone', 'mainphone', 'switchboard', 'officephone')],
];
/* Longest first is not enough: "Company social" starts with "companys"
   too, so every prefix that fits is tried until one leaves a known rest. */
const COMPANY_PREFIXES = ['companys', 'company', 'organisations', 'organizations', 'organisation', 'organization', 'employers', 'employer', 'accounts', 'account', 'headquarters', 'hq'];
/** Company columns that carry no prefix at all. */
const COMPANY_BARE: Array<[ImportTarget, number, Set<string>]> = [
  ['company', 100, set('company', 'companyname', 'organization', 'organisation', 'org', 'account', 'accountname', 'employer', 'business', 'businessname', 'currentcompany', 'firm', 'companynameforemails', 'currentemployer', 'workplace')],
  ['company_size', 100, set('employees', 'numberofemployees', 'noofemployees', 'headcount', 'employeecount', 'staffcount', 'employeerange')],
  ['company_phone', 100, set('hqphone', 'corporatephone', 'mainphone', 'switchboard', 'officephone', 'headofficephone')],
  ['company_website', 90, set('domain', 'domainname', 'companydomain', 'emaildomain')],
];

const PERSON: Array<[ImportTarget, number, Set<string>]> = [
  ['first_name', 100, set('firstname', 'fname', 'first', 'given', 'givenname', 'forename', 'prenom', 'firstnames')],
  ['last_name', 100, set('lastname', 'lname', 'last', 'surname', 'familyname', 'nom', 'lastnames')],
  ['full_name', 100, set('name', 'fullname', 'contactname', 'contact', 'person', 'leadname', 'prospectname', 'displayname', 'personname', 'username', 'profilename')],
  ['job_title', 100, set('jobtitle', 'title', 'role', 'position', 'jobposition', 'jobrole', 'designation', 'occupation', 'currenttitle', 'currentposition', 'currentrole', 'positiontitle', 'currentjobtitle', 'jobtitles')],
  ['job_title', 70, set('headline', 'linkedinheadline', 'profileheadline')],
  ['phone', 100, set('phone', 'phonenumber', 'mobile', 'mobilephone', 'mobilenumber', 'cell', 'cellphone', 'tel', 'telephone', 'workphone', 'directphone', 'directdial', 'directphonenumber', 'workdirectphone', 'firstphone', 'personalphone', 'phone1', 'primaryphone', 'mobilephonenumber')],
  ['phone', 70, set('homephone', 'otherphone', 'phone2', 'secondaryphone')],
  ['website', 100, set('website', 'websiteurl', 'url', 'site', 'web', 'homepage', 'personalwebsite')],
  ['location', 100, set('location', 'address', 'fulladdress', 'geo', 'area', 'locality', 'personlocation', 'geography', 'basedin')],
  ['city', 100, set('city', 'town', 'personcity')],
  ['state', 100, set('state', 'province', 'county', 'region', 'stateregion', 'stateprovince', 'personstate')],
  ['country', 100, set('country', 'countryregion', 'nation', 'countryname', 'personcountry')],
  ['industry', 100, set('industry', 'sector', 'vertical', 'primaryindustry', 'industries')],
];
/** "Person city", "Contact phone", "Lead LinkedIn": the prefix says nothing. */
const PERSON_PREFIXES = ['personal', 'person', 'contact', 'prospect', 'lead', 'user', 'profile', 'member'];

function fromTable(h: string, table: Array<[ImportTarget, number, Set<string>]>): { target: ImportTarget; score: number } | null {
  for (const [target, score, names] of table) if (names.has(h)) return { target, score };
  return null;
}

/* ---- value tests ------------------------------------------------------ */

const isPersonLinkedin = (v: string) => /linkedin\.com\/(in|pub|sales\/(lead|people))\//i.test(v);
const isCompanyLinkedin = (v: string) => /linkedin\.com\/(company|school|showcase)\//i.test(v);
const isUrl = (v: string) => /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v) && !v.includes('@');
const isPhone = (v: string) => /^\+?[\d\s().-]{7,20}$/.test(v) && (v.match(/\d/g) || []).length >= 7;

function shareOf(vals: string[], test: (v: string) => boolean): number {
  return vals.length ? vals.filter(test).length / vals.length : 0;
}

/** What the header alone says. Empty when it says nothing. */
export function targetFromHeader(header: string): ImportTarget {
  return headerCandidate(header)?.target ?? '';
}

function headerCandidate(header: string): { target: ImportTarget; score: number } | null {
  const h = normHeader(header);
  if (!h) return null;
  if (EMAIL_STATUS.has(h)) return { target: 'email_status', score: 100 };
  if (DO_NOT_CONTACT.has(h)) return { target: 'do_not_contact', score: 100 };
  if (h === 'email' || h === 'emailaddress' || h === 'mail' || h === 'emails' || h.endsWith('email') || h.startsWith('email') || h.endsWith('emailaddress')) {
    return { target: 'email', score: 100 };
  }
  if (TAGS.has(h)) return { target: 'tags', score: 100 };

  const bare = fromTable(h, COMPANY_BARE);
  if (bare) return bare;
  const prefixes = COMPANY_PREFIXES.filter((p) => h.startsWith(p));
  for (const p of prefixes) {
    const rest = h.slice(p.length);
    const hit = fromTable(rest, COMPANY_REST);
    if (hit) return hit;
    if (rest.includes('linkedin')) return { target: 'company_linkedin', score: 90 };
  }
  // "Company owner", "Account stage": about the company, not a field we hold.
  if (prefixes.length) return null;

  const direct = fromTable(h, PERSON);
  if (direct) return direct;
  if (h.includes('linkedin')) return { target: 'linkedin_url', score: 100 };
  for (const p of PERSON_PREFIXES) {
    if (!h.startsWith(p)) continue;
    const hit = fromTable(h.slice(p.length), PERSON);
    if (hit) return { target: hit.target, score: hit.score - 5 };
  }
  if (h.includes('title') && !h.includes('company')) return { target: 'job_title', score: 60 };
  if (h.endsWith('phone') || h.endsWith('phonenumber')) return { target: 'phone', score: 60 };
  return null;
}

function isNoise(header: string): boolean {
  const h = normHeader(header);
  return NOISE_EXACT.has(h) || NOISE_ID.test(h);
}

/** What the values say, for a header that said nothing. */
export function targetFromValues(values: string[]): ImportTarget {
  const vals = values.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (vals.length === 0) return '';
  if (shareOf(vals, isAddress) >= 0.8) return 'email';
  if (shareOf(vals, isPersonLinkedin) >= 0.8) return 'linkedin_url';
  if (shareOf(vals, isCompanyLinkedin) >= 0.8) return 'company_linkedin';
  if (shareOf(vals, isUrl) >= 0.8) return 'website';
  if (shareOf(vals, isPhone) >= 0.8) return 'phone';
  return '';
}

/* ---- the plan --------------------------------------------------------- */

export interface ImportPlan {
  mapping: Record<string, ImportTarget>;
  /**
   * Why a column was skipped or kept aside, in words, for the review
   * screen. Columns that went where their name says have no note.
   */
  notes: Record<string, string>;
  /** The column the email comes from, or null when none was found. */
  emailColumn: string | null;
  /**
   * Sure enough to go straight to "ready". True only when one column is
   * the email beyond reasonable doubt: named like one, or not named like
   * one but full of addresses - and in both cases, mostly addresses.
   */
  confident: boolean;
  /** Share of non-empty values in the email column that are addresses. */
  emailShare: number;
}

function cmpValue(v: string): string {
  return String(v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

/** Two columns that say the same thing, row for row. */
function sameValues(rows: Array<Record<string, string>>, a: string, b: string): boolean {
  let both = 0;
  let equal = 0;
  for (const r of rows) {
    const x = cmpValue(r[a]);
    const y = cmpValue(r[b]);
    if (!x && !y) continue;
    both++;
    if (x === y || !x) equal++; // nothing in the loser loses nothing
  }
  return both > 0 && equal / both >= 0.95;
}

/** Share of rows (where `col` has a value) in which it is inside `other`. */
function containedShare(rows: Array<Record<string, string>>, col: string, other: string | null): number {
  if (!other) return 0;
  let n = 0;
  let hit = 0;
  for (const r of rows) {
    const v = cmpValue(r[col]);
    if (!v) continue;
    n++;
    if (cmpValue(r[other]).includes(v)) hit++;
  }
  return n ? hit / n : 0;
}

/**
 * Work out where every column goes.
 *
 * Every column proposes a target with a score; the strongest claim on a
 * target wins it, whatever order the columns are in. A losing column that
 * repeats the winner's values is skipped; one that holds something else is
 * kept as a custom field, so nothing is lost and no field is silently
 * overwritten row by row.
 */
export function planImport(headers: string[], rows: Array<Record<string, string>>, sampleSize = 200): ImportPlan {
  const sample = rows.slice(0, sampleSize);
  const valuesOf = (h: string) => sample.map((r) => String(r[h] ?? '').trim()).filter(Boolean);
  const mapping: Record<string, ImportTarget> = {};
  const notes: Record<string, string> = {};

  type Claim = { h: string; idx: number; target: ImportTarget; score: number };
  const claims: Claim[] = [];

  headers.forEach((h, idx) => {
    if (isNoise(h)) {
      mapping[h] = '';
      notes[h] = 'Bookkeeping from the tool it came from - not about the person';
      return;
    }
    const vals = valuesOf(h);
    let c = headerCandidate(h);

    if (c?.target === 'email') {
      // Named like an email, but is it? "Email sent: TRUE" is not.
      const addresses = vals.filter(isAddress).length;
      if (vals.length === 0) c = { target: 'email', score: 40 };
      else if (addresses / vals.length >= 0.5) c = { target: 'email', score: 100 + addresses / (vals.length + 1) };
      else c = null;
    }
    if (c && (c.target === 'linkedin_url' || c.target === 'company_linkedin' || c.target === 'website' || c.target === 'company_website') && vals.length) {
      // The values decide whose profile it is - and a "Profile URL" full of
      // linkedin.com/in links is the LinkedIn, not a website.
      if (shareOf(vals, isCompanyLinkedin) >= 0.6) c = { target: 'company_linkedin', score: c.score };
      else if (shareOf(vals, isPersonLinkedin) >= 0.6) c = { target: 'linkedin_url', score: c.score };
    }
    if (!c) {
      const t = targetFromValues(vals);
      if (t) c = { target: t, score: t === 'email' ? 50 + vals.filter(isAddress).length / (vals.length + 1) : 50 };
    }
    if (c) claims.push({ h, idx, ...c });
    else mapping[h] = '__custom__';
  });

  const winner = new Map<ImportTarget, string>();
  claims.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const losers: Claim[] = [];
  for (const cl of claims) {
    if (SINGLE.has(cl.target)) {
      if (winner.has(cl.target)) { losers.push(cl); continue; }
      winner.set(cl.target, cl.h);
    }
    mapping[cl.h] = cl.target;
  }
  for (const cl of losers) {
    const won = winner.get(cl.target)!;
    if (sameValues(sample, won, cl.h)) {
      mapping[cl.h] = '';
      notes[cl.h] = `Same values as "${won}"`;
    } else if (containedShare(sample, cl.h, won) >= 0.95) {
      mapping[cl.h] = '';
      notes[cl.h] = `Already part of "${won}"`;
    } else {
      mapping[cl.h] = '__custom__';
      notes[cl.h] = `Kept as a custom field - "${won}" is already the ${IMPORT_TARGET_LABELS[cl.target].toLowerCase()}`;
    }
  }

  // First + last present: a "Name" column alongside them is redundant.
  if (winner.has('first_name') && winner.has('last_name') && winner.has('full_name')) {
    const h = winner.get('full_name')!;
    mapping[h] = '';
    notes[h] = 'First and last name are already mapped';
    winner.delete('full_name');
  }

  // A bare City/State/Country that is the company's, not the person's.
  const companyLoc = winner.get('company_location') ?? null;
  const personLoc = winner.get('location') ?? null;
  for (const t of ['city', 'state', 'country'] as const) {
    const h = winner.get(t);
    if (!h || !companyLoc) continue;
    const inCompany = containedShare(sample, h, companyLoc);
    const inPerson = containedShare(sample, h, personLoc);
    if (inCompany >= 0.8 && inCompany > inPerson) {
      mapping[h] = '';
      notes[h] = `The company's ${t}, already in "${companyLoc}"`;
      winner.delete(t);
    }
  }

  const emailColumn = winner.get('email') ?? null;
  let emailShare = 0;
  if (emailColumn) {
    const vals = valuesOf(emailColumn);
    emailShare = vals.length ? vals.filter(isAddress).length / vals.length : 0;
  }
  // A column that calls itself Email and is mostly addresses is the email:
  // the odd bad row is reported and left out, not a reason to doubt the
  // column. A column found by its values alone has to be nearly all
  // addresses before it is trusted without asking.
  const named = !!emailColumn && targetFromHeader(emailColumn) === 'email';
  const confident = !!emailColumn && emailShare >= (named ? 0.6 : 0.9);
  return { mapping, notes, emailColumn, confident, emailShare };
}

/**
 * The same layout of columns, whatever order or casing: the key a saved
 * mapping is remembered under, so the next export from the same tool maps
 * itself the way it was corrected last time.
 */
export function headerSignature(headers: string[]): string {
  return [...new Set(headers.map(normHeader).filter(Boolean))].sort().join('|');
}

/** Problems that stop an import from starting at all. */
export function mappingProblems(mapping: Record<string, string>): string[] {
  const targets = Object.values(mapping).filter((t) => t && SINGLE.has(t as ImportTarget));
  const problems: string[] = [];
  if (!targets.includes('email')) problems.push('Choose which column holds the email address.');
  const dupes = [...new Set(targets.filter((t, i) => targets.indexOf(t) !== i))];
  if (dupes.length) {
    problems.push(`${dupes.map((d) => IMPORT_TARGET_LABELS[d as ImportTarget]).join(', ')} ${dupes.length === 1 ? 'is' : 'are'} chosen for more than one column.`);
  }
  return problems;
}

/** "Ada Lovelace" -> Ada / Lovelace; "Lovelace, Ada" -> Ada / Lovelace. */
export function splitFullName(full: string): { first: string; last: string } {
  const s = full.trim().replace(/\s+/g, ' ');
  if (!s) return { first: '', last: '' };
  if (s.includes(',')) {
    const [last, first] = s.split(',', 2).map((x) => x.trim());
    return { first: first || '', last: last || '' };
  }
  const parts = s.split(' ');
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * What another tool's verdict on an address means here. Only a clear
 * "this address is bad" counts: "unknown", "risky" and "catch-all" are
 * the normal state of a cold list and are verified here as usual.
 */
export function sourceSaysInvalid(status: string): boolean {
  const s = status.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  return /^(invalid|undeliverable|not deliverable|bounced?|hard bounce|bad|failed|fail|disposable|spam ?trap|do not mail|unverifiable|rejected|syntax error|no mx|mailbox not found|not found)$/.test(s);
}

/** "Yes", "TRUE", "1", "x", "unsubscribed": the flag is set. */
export function flagIsSet(v: string): boolean {
  return /^(yes|y|true|1|x|unsubscribed|opted out|optout|bounced|suppressed|blocked)$/i.test(v.trim());
}

export function splitTags(v: string): string[] {
  const out: string[] = [];
  for (const raw of v.split(/[,;|]/)) {
    const t = raw.trim().replace(/\s+/g, ' ').slice(0, 50);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

export interface PreparedContact {
  email: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  phone?: string;
  linkedin_url?: string;
  website?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  industry?: string;
  company?: string;
  company_website?: string;
  company_linkedin?: string;
  company_size?: string;
  company_industry?: string;
  company_location?: string;
  company_phone?: string;
  tags?: string[];
  custom_fields?: Record<string, string>;
}

export type SetAsideReason = 'no_email' | 'invalid_email' | 'flagged';

export interface SetAsideRow {
  row: Record<string, string>;
  reason: SetAsideReason;
  /** In words, for the downloadable file. */
  detail: string;
}

export interface PrepareOptions {
  /**
   * Leave out rows the old tool marked invalid, unsubscribed or bounced.
   * On by default: importing them would only send to people who asked not
   * to be emailed, or to addresses already known to bounce.
   */
  skipFlagged?: boolean;
}

export interface PreparedImport {
  contacts: PreparedContact[];
  /** Rows folded into an earlier row for the same address. */
  duplicates: number;
  /** Rows whose email is present but is not an address. */
  invalid: number;
  /** Rows with nothing in the email column. */
  blank: number;
  /** Of `blank`, how many still have a LinkedIn profile - worth finding an email for. */
  blankWithLinkedin: number;
  /** Rows the old tool marked invalid, unsubscribed or bounced, left out. */
  flagged: number;
  /** Rows the old tool marked, whether or not they were left out. */
  flaggedTotal: number;
  /** A few of the invalid values, to show what was set aside. */
  invalidSamples: string[];
  /** Every row that was not imported, whole, with why. */
  setAside: SetAsideRow[];
}

/**
 * Turn rows into contacts under a mapping.
 *
 * The same address twice becomes one contact: the first row wins, and a
 * later row only fills fields the first left empty - a second row never
 * overwrites what the first said.
 */
export function prepareImport(
  rows: Array<Record<string, string>>,
  mapping: Record<string, string>,
  options: PrepareOptions = {},
): PreparedImport {
  const skipFlagged = options.skipFlagged !== false;
  const byEmail = new Map<string, PreparedContact>();
  let duplicates = 0;
  let invalid = 0;
  let blank = 0;
  let blankWithLinkedin = 0;
  let flagged = 0;
  let flaggedTotal = 0;
  const invalidSamples: string[] = [];
  const setAside: SetAsideRow[] = [];

  for (const row of rows) {
    const c: Record<string, any> = {};
    let flag: string | null = null;
    for (const [col, target] of Object.entries(mapping)) {
      if (!target) continue;
      const raw = row[col];
      if (raw == null) continue;
      const v = String(raw).trim();
      if (!v) continue;
      if (target === '__custom__') {
        (c.custom_fields ||= {})[col] = v;
      } else if (target === 'email_status') {
        // Kept, so the old verdict is still visible on the contact.
        (c.custom_fields ||= {})[col] = v;
        if (!flag && sourceSaysInvalid(v)) flag = `Marked "${v}" by the tool it came from`;
      } else if (target === 'do_not_contact') {
        if (!flag && flagIsSet(v)) flag = `Marked "${col}" by the tool it came from`;
      } else if (target === 'tags') {
        const tags = splitTags(v);
        if (tags.length) c.tags = [...new Set([...(c.tags || []), ...tags])];
      } else if (target === 'full_name') {
        const { first, last } = splitFullName(v);
        if (first && !c.first_name) c.first_name = first;
        if (last && !c.last_name) c.last_name = last;
      } else if (target === 'email') {
        c.email = v.replace(/^mailto:/i, '').replace(/^<|>$/g, '').trim().toLowerCase();
      } else {
        c[target] = v;
      }
    }

    if (!c.email) {
      blank++;
      const hasLinkedin = !!c.linkedin_url;
      if (hasLinkedin) blankWithLinkedin++;
      setAside.push({ row, reason: 'no_email', detail: hasLinkedin ? 'No email address (has a LinkedIn profile - find their email and re-import)' : 'No email address' });
      continue;
    }
    if (!isAddress(c.email)) {
      invalid++;
      if (invalidSamples.length < 3) invalidSamples.push(c.email);
      setAside.push({ row, reason: 'invalid_email', detail: `"${c.email}" is not an email address` });
      continue;
    }
    if (flag) {
      flaggedTotal++;
      if (skipFlagged) {
        flagged++;
        setAside.push({ row, reason: 'flagged', detail: flag });
        continue;
      }
    }

    const prior = byEmail.get(c.email);
    if (!prior) { byEmail.set(c.email, c as PreparedContact); continue; }
    duplicates++;
    for (const [k, v] of Object.entries(c)) {
      if (k === 'custom_fields') {
        prior.custom_fields = { ...(v as Record<string, string>), ...(prior.custom_fields || {}) };
      } else if (k === 'tags') {
        prior.tags = [...new Set([...(prior.tags || []), ...(v as string[])])];
      } else if ((prior as any)[k] == null || (prior as any)[k] === '') {
        (prior as any)[k] = v;
      }
    }
  }

  return {
    contacts: [...byEmail.values()],
    duplicates, invalid, blank, blankWithLinkedin, flagged, flaggedTotal, invalidSamples, setAside,
  };
}

/* ---- what the server accepts ------------------------------------------ */

/**
 * What a re-import does to someone already here.
 *   fill      - only their empty fields are filled (the default)
 *   overwrite - values in the file replace stored ones; blanks never blank
 *   skip      - they are left exactly as they are
 */
export type ImportMode = 'fill' | 'overwrite' | 'skip';
export const IMPORT_MODES: ImportMode[] = ['fill', 'overwrite', 'skip'];

/** The fields /contacts/bulk writes. Anything else on a row is dropped. */
export const IMPORT_FIELDS = [
  'email', 'first_name', 'last_name', 'company', 'job_title', 'phone', 'linkedin_url', 'website',
  'location', 'country', 'city', 'state', 'industry',
  'company_website', 'company_linkedin', 'company_size', 'company_industry', 'company_location', 'company_phone',
] as const;
