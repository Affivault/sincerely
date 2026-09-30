/* ═══════════════════════════════════════════════════════════════════════
   Importing a CSV without a mapping screen.

   Every import used to stop on a table of dropdowns, one per column, and
   for the common file - Email, First name, Company - every dropdown was
   already right. The screen asked the person to confirm what the software
   had worked out, column by column, which is work that proves nothing.

   So the plan is made here from the headers AND the values, and the
   mapping table is only shown when the plan is not sure of the one thing
   that matters: which column is the email. Everything else can be wrong
   and cost nothing - a column that is not recognised is kept as a custom
   field, never dropped, so a guess can lose a label but never the data.

   The rows are cleaned the same way on the way in: addresses trimmed and
   lower-cased, the same person twice merged into one row, a "Name" column
   split into first and last, and anything that is not an email address
   counted and set aside rather than sent to the server to fail.
   ═══════════════════════════════════════════════════════════════════════ */

export type ImportTarget =
  | ''
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'company'
  | 'job_title'
  | 'phone'
  | 'linkedin_url'
  | 'website'
  | 'location'
  | '__custom__';

export const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = {
  '': 'Skip this column',
  email: 'Email',
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Full name (split into first and last)',
  company: 'Company',
  job_title: 'Job title',
  phone: 'Phone',
  linkedin_url: 'LinkedIn URL',
  website: 'Website',
  location: 'Location',
  __custom__: 'Custom field (keep column name)',
};

/** Targets a file may map only once. Custom fields and skips may repeat. */
const SINGLE: ReadonlySet<ImportTarget> = new Set<ImportTarget>([
  'email', 'first_name', 'last_name', 'full_name', 'company', 'job_title',
  'phone', 'linkedin_url', 'website', 'location',
]);

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

function isAddress(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

function norm(header: string): string {
  return header.toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
}

/** What the header alone says. Empty when it says nothing. */
export function targetFromHeader(header: string): ImportTarget {
  const h = norm(header);
  if (!h) return '';
  if (h === 'email' || h === 'emailaddress' || h === 'mail' || h.endsWith('email') || h.startsWith('email')) return 'email';
  if (['firstname', 'fname', 'given', 'givenname', 'forename', 'prenom'].includes(h)) return 'first_name';
  if (['lastname', 'lname', 'surname', 'familyname', 'nom'].includes(h)) return 'last_name';
  if (['name', 'fullname', 'contactname', 'contact', 'person', 'leadname'].includes(h)) return 'full_name';
  if (['company', 'companyname', 'organization', 'organisation', 'org', 'account', 'accountname', 'employer', 'business'].includes(h)) return 'company';
  if (['jobtitle', 'title', 'role', 'position', 'headline', 'designation'].includes(h)) return 'job_title';
  if (['phone', 'phonenumber', 'mobile', 'mobilephone', 'tel', 'telephone', 'cell', 'workphone', 'directdial'].includes(h)) return 'phone';
  if (h.includes('linkedin')) return 'linkedin_url';
  if (['website', 'url', 'site', 'domain', 'companywebsite', 'companydomain', 'web'].includes(h)) return 'website';
  if (['location', 'city', 'country', 'region', 'address', 'state'].includes(h)) return 'location';
  return '';
}

/** What the values say, for a header that said nothing. */
export function targetFromValues(values: string[]): ImportTarget {
  const vals = values.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (vals.length === 0) return '';
  const share = (test: (v: string) => boolean) => vals.filter(test).length / vals.length;
  if (share(isAddress) >= 0.8) return 'email';
  if (share((v) => /linkedin\.com\//i.test(v)) >= 0.8) return 'linkedin_url';
  if (share((v) => /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v) && !v.includes('@')) >= 0.8) return 'website';
  if (share((v) => /^\+?[\d\s().-]{7,20}$/.test(v) && (v.match(/\d/g) || []).length >= 7) >= 0.8) return 'phone';
  return '';
}

export interface ImportPlan {
  mapping: Record<string, ImportTarget>;
  /** The column the email comes from, or null when none was found. */
  emailColumn: string | null;
  /**
   * Sure enough to skip the mapping table. True only when one column is
   * the email beyond reasonable doubt: named like one, or not named like
   * one but full of addresses - and in both cases, mostly addresses.
   */
  confident: boolean;
  /** Share of non-empty values in the email column that are addresses. */
  emailShare: number;
}

/**
 * Work out where every column goes.
 *
 * Headers are trusted first, values second, and a target claimed twice
 * keeps its first column - the second becomes a custom field, so nothing
 * is lost and no field is silently overwritten row by row.
 */
export function planImport(headers: string[], rows: Array<Record<string, string>>, sampleSize = 200): ImportPlan {
  const sample = rows.slice(0, sampleSize);
  const valuesOf = (h: string) => sample.map((r) => String(r[h] ?? ''));
  const mapping: Record<string, ImportTarget> = {};
  const taken = new Set<ImportTarget>();

  const claim = (h: string, t: ImportTarget) => {
    if (t && SINGLE.has(t)) {
      if (taken.has(t)) { mapping[h] = '__custom__'; return; }
      taken.add(t);
    }
    mapping[h] = t;
  };

  // Headers first, so a column called "Email" beats one that merely holds
  // addresses (a "Manager email" further along, say).
  const unnamed: string[] = [];
  for (const h of headers) {
    const t = targetFromHeader(h);
    // "Personal email" and "Work email" both name themselves as email. The
    // one with the most addresses in it wins below; until then, hold.
    if (t) claim(h, t); else unnamed.push(h);
  }
  for (const h of unnamed) {
    const t = targetFromValues(valuesOf(h));
    claim(h, t || '__custom__');
  }

  // Several columns named like email: keep the fullest one as the email.
  const emailish = headers.filter((h) => targetFromHeader(h) === 'email');
  if (emailish.length > 1) {
    const count = (h: string) => valuesOf(h).filter(isAddress).length;
    const best = [...emailish].sort((a, b) => count(b) - count(a))[0];
    for (const h of emailish) mapping[h] = h === best ? 'email' : '__custom__';
  }

  // First + last present: a "Name" column alongside them is redundant.
  if (taken.has('first_name') && taken.has('last_name')) {
    for (const h of headers) if (mapping[h] === 'full_name') mapping[h] = '__custom__';
  }

  const emailColumn = headers.find((h) => mapping[h] === 'email') ?? null;
  let emailShare = 0;
  if (emailColumn) {
    const vals = valuesOf(emailColumn).map((v) => v.trim()).filter(Boolean);
    emailShare = vals.length ? vals.filter(isAddress).length / vals.length : 0;
  }
  // A column that calls itself Email and is mostly addresses is the email:
  // the odd bad row is reported and left out, not a reason to doubt the
  // column. A column found by its values alone has to be nearly all
  // addresses before it is trusted without asking.
  const named = !!emailColumn && targetFromHeader(emailColumn) === 'email';
  const confident = !!emailColumn && emailShare >= (named ? 0.6 : 0.9);
  return { mapping, emailColumn, confident, emailShare };
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

export interface PreparedContact {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  phone?: string;
  linkedin_url?: string;
  website?: string;
  location?: string;
  custom_fields?: Record<string, string>;
}

export interface PreparedImport {
  contacts: PreparedContact[];
  /** Rows folded into an earlier row for the same address. */
  duplicates: number;
  /** Rows whose email is present but is not an address. */
  invalid: number;
  /** Rows with nothing in the email column. */
  blank: number;
  /** A few of the invalid values, to show what was set aside. */
  invalidSamples: string[];
}

/**
 * Turn rows into contacts under a mapping.
 *
 * The same address twice becomes one contact: the first row wins, and a
 * later row only fills fields the first left empty - a second row never
 * overwrites what the first said.
 */
export function prepareImport(rows: Array<Record<string, string>>, mapping: Record<string, string>): PreparedImport {
  const byEmail = new Map<string, PreparedContact>();
  let duplicates = 0;
  let invalid = 0;
  let blank = 0;
  const invalidSamples: string[] = [];

  for (const row of rows) {
    const c: Record<string, any> = {};
    for (const [col, target] of Object.entries(mapping)) {
      if (!target) continue;
      const raw = row[col];
      if (raw == null) continue;
      const v = String(raw).trim();
      if (!v) continue;
      if (target === '__custom__') {
        (c.custom_fields ||= {})[col] = v;
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

    if (!c.email) { blank++; continue; }
    if (!isAddress(c.email)) {
      invalid++;
      if (invalidSamples.length < 3) invalidSamples.push(c.email);
      continue;
    }

    const prior = byEmail.get(c.email);
    if (!prior) { byEmail.set(c.email, c as PreparedContact); continue; }
    duplicates++;
    for (const [k, v] of Object.entries(c)) {
      if (k === 'custom_fields') {
        prior.custom_fields = { ...(v as Record<string, string>), ...(prior.custom_fields || {}) };
      } else if ((prior as any)[k] == null || (prior as any)[k] === '') {
        (prior as any)[k] = v;
      }
    }
  }

  return { contacts: [...byEmail.values()], duplicates, invalid, blank, invalidSamples };
}
