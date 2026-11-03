import { emailState } from './email-light.js';

/* ═══════════════════════════════════════════════════════════════════════
   Google Drive backup: what the backup spreadsheet holds (migration 112).

   One spreadsheet per account, in the customer's own Google Drive, kept a
   minute or so behind Sincerely. Tabs:

     About       what this is, and when it was last brought up to date
     People      every lead and contact, one row each, keyed by id. A lead
                 becoming a contact is a change to its Type cell, so the
                 row never moves. Deleted people stay, marked Deleted.
     Companies   every company record
     No email    people held without an address
     Lists       every list, its kind and how many people are in it
     Change log  one line per change, newest at the bottom: added, moved
                 between lists, became a contact, enriched, deleted...

   Columns are fixed (custom fields share one column) so a row written
   today lines up with one written in a year. Everything is written as
   plain text: a value starting with "=" stays text and never runs.
   ═══════════════════════════════════════════════════════════════════════ */

export type BackupTab = 'About' | 'People' | 'Companies' | 'No email' | 'Lists' | 'Change log';
export const BACKUP_TABS: BackupTab[] = ['About', 'People', 'Companies', 'No email', 'Lists', 'Change log'];
/** Tabs whose rows are keyed by a record id in column A. */
export const KEYED_TABS: BackupTab[] = ['People', 'Companies', 'No email'];

export type Cell = string | number;

export const PEOPLE_COLUMNS = [
  'Sincerely ID', 'Record', 'Type', 'Email', 'First name', 'Last name', 'Job title', 'Phone', 'LinkedIn', 'Website',
  'Location', 'City', 'State', 'Country', 'Industry',
  'Company name', 'Company website', 'Company LinkedIn', 'Company size', 'Company industry', 'Company location', 'Company phone',
  'Lists', 'Tags', 'Email status', 'Verification score', 'Unsubscribed', 'Bounced', 'Engagement',
  'Source', 'Imported from', 'Added', 'Last changed', 'Deleted', 'Custom fields',
] as const;

export const COMPANY_COLUMNS = [
  'Sincerely ID', 'Record', 'Name', 'Domain', 'Website', 'LinkedIn', 'Industry', 'Size', 'Location', 'Phone', 'Notes',
  'Added', 'Last changed', 'Deleted',
] as const;

export const HELD_COLUMNS = [
  'Sincerely ID', 'Record', 'Type', 'First name', 'Last name', 'Job title', 'Company', 'LinkedIn',
  'What the email column said', 'Why there is no email', 'List', 'Imported from', 'Other fields', 'Added', 'Last changed', 'Deleted',
] as const;

export const LIST_COLUMNS = ['Sincerely ID', 'Name', 'Kind', 'People', 'Description', 'Added'] as const;
export const LOG_COLUMNS = ['When', 'What', 'Who', 'Email', 'Details'] as const;

export const TAB_COLUMNS: Record<Exclude<BackupTab, 'About'>, readonly string[]> = {
  People: PEOPLE_COLUMNS,
  Companies: COMPANY_COLUMNS,
  'No email': HELD_COLUMNS,
  Lists: LIST_COLUMNS,
  'Change log': LOG_COLUMNS,
};

/** Google's cap is 10 million cells a spreadsheet; this leaves room for the log. */
export const BACKUP_CELL_BUDGET = 9_000_000;
/** Change log rows kept; the oldest go first past this. */
export const LOG_MAX_ROWS = 100_000;

const LIFECYCLE: Record<string, string> = { prospect: 'Lead', contact: 'Contact', customer: 'Customer' };
const STATE_WORD: Record<string, string> = {
  valid: 'Valid', risky: 'Risky', unverified: 'Unverified', invalid: 'Invalid',
  not_found: 'Not found', bounced: 'Bounced', no_email: 'No email',
};

/** Sheets cell limit is 50,000 characters. */
function txt(v: unknown): Cell {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 49_000 ? `${s.slice(0, 49_000)}...` : s;
}

/** "2026-11-03 14:05" in UTC: sortable, and the same for everyone who opens it. */
export function backupTime(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function customFields(cf: unknown): string {
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return '';
  return Object.entries(cf as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' | ');
}

/** A contact as the backup reads it: the row plus its joins. */
export interface BackupPersonSource {
  [k: string]: any;
  list_names?: string[];
  tag_names?: string[];
  company_rec?: Record<string, any> | null;
}

export function personRow(c: BackupPersonSource, opts: { deletedAt?: string | null } = {}): Cell[] {
  const co = c.company_rec || {};
  const state = c.email ? emailState(c as any) : 'no_email';
  return [
    txt(c.id), opts.deletedAt ? 'Deleted' : 'Active', LIFECYCLE[c.lifecycle] || 'Lead', txt(c.email),
    txt(c.first_name), txt(c.last_name), txt(c.job_title), txt(c.phone), txt(c.linkedin_url), txt(c.website),
    txt(c.location), txt(c.city), txt(c.state), txt(c.country), txt(c.industry),
    txt(c.company), txt(co.website), txt(co.linkedin_url), txt(co.size), txt(co.industry), txt(co.location), txt(co.phone),
    (c.list_names || []).join(', '), (c.tag_names || []).join(', '),
    STATE_WORD[state] || '', c.dcs_score == null ? '' : txt(Number(c.dcs_score)),
    c.is_unsubscribed ? 'Yes' : 'No', c.is_bounced ? 'Yes' : 'No',
    c.engagement_score == null ? '' : txt(Number(c.engagement_score)),
    txt(c.source), txt(c.import_source), backupTime(c.created_at), backupTime(c.updated_at),
    opts.deletedAt ? backupTime(opts.deletedAt) : '', customFields(c.custom_fields),
  ];
}

export function companyRow(c: Record<string, any>, opts: { deletedAt?: string | null } = {}): Cell[] {
  return [
    txt(c.id), opts.deletedAt ? 'Deleted' : 'Active', txt(c.name), txt(c.domain), txt(c.website), txt(c.linkedin_url),
    txt(c.industry), txt(c.size), txt(c.location), txt(c.phone), txt(c.notes),
    backupTime(c.created_at), backupTime(c.updated_at), opts.deletedAt ? backupTime(opts.deletedAt) : '',
  ];
}

export function heldRow(h: Record<string, any>, opts: { deletedAt?: string | null; listName?: string | null } = {}): Cell[] {
  const data = h.data && typeof h.data === 'object' ? { ...h.data } : {};
  delete (data as any).enrichment;
  return [
    txt(h.id), opts.deletedAt ? 'Removed' : 'Waiting for an email', h.kind === 'contact' ? 'Contact' : 'Lead',
    txt(h.first_name), txt(h.last_name), txt(h.job_title), txt(h.company), txt(h.linkedin_url),
    txt(h.raw_email), h.reason === 'invalid_email' ? 'Not a valid address' : 'No address in the file',
    txt(opts.listName ?? ''), txt(h.import_source), customFields(data),
    backupTime(h.created_at), backupTime(h.updated_at), opts.deletedAt ? backupTime(opts.deletedAt) : '',
  ];
}

export function listRow(l: Record<string, any>): Cell[] {
  return [txt(l.id), txt(l.name), l.kind === 'contact' ? 'Contacts' : 'Leads', Number(l.contact_count ?? l.member_count ?? 0) || 0, txt(l.description), backupTime(l.created_at)];
}

/* ── The change log ──────────────────────────────────────────────────── */

export type OutboxEntity = 'person' | 'company' | 'held' | 'list';
export type OutboxAction = 'created' | 'updated' | 'deleted' | 'list_added' | 'list_removed' | 'tagged' | 'untagged';

export interface OutboxEvent {
  id: number;
  entity: OutboxEntity;
  entity_id: string;
  action: OutboxAction;
  detail: string | null;
  snapshot?: Record<string, any> | null;
  created_at: string;
}

/** Contact columns that mean something to a person reading the log. */
const FIELD_WORD: Record<string, string> = {
  email: 'email', first_name: 'first name', last_name: 'last name', company: 'company', job_title: 'job title',
  phone: 'phone', linkedin_url: 'LinkedIn', website: 'website', location: 'location', city: 'city', state: 'state',
  country: 'country', industry: 'industry', custom_fields: 'custom fields', company_id: 'company link',
  is_unsubscribed: 'unsubscribed', is_bounced: 'bounced', notes: 'notes', name: 'name', domain: 'domain',
  size: 'size', linkedin_headline: 'LinkedIn headline', source: 'source', kind: 'kind', description: 'description',
  raw_email: 'email column', list_id: 'list', data: 'details',
};
const VERIFY_FIELDS = new Set(['dcs_score', 'dcs_verified_at', 'dcs_syntax_ok', 'dcs_domain_ok', 'dcs_smtp_ok', 'dcs_fail_reason', 'email_verified_by']);
const ENRICH_FIELDS = new Set(['enrichment', 'profile_enriched_at']);

/** What an update changed, in words; null when nothing worth a line. */
export function describeUpdate(entity: OutboxEntity, changedCsv: string | null, now: Record<string, any> | null): { what: string; details: string } | null {
  const changed = (changedCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (changed.length === 0) return null;
  if (entity === 'person' && changed.includes('lifecycle')) {
    const to = LIFECYCLE[now?.lifecycle] || now?.lifecycle || 'changed';
    return { what: to === 'Lead' ? 'Moved back to leads' : `Became a ${to.toLowerCase()}`, details: '' };
  }
  const words = changed.map((k) => FIELD_WORD[k]).filter(Boolean);
  if (changed.some((k) => ENRICH_FIELDS.has(k))) {
    return { what: 'Enriched', details: words.length ? `Filled: ${words.join(', ')}` : '' };
  }
  if (entity === 'person' && changed.some((k) => VERIFY_FIELDS.has(k))) {
    const state = now?.email ? emailState(now as any) : 'no_email';
    return { what: 'Email checked', details: `${STATE_WORD[state] || ''}${words.length ? `; also changed ${words.join(', ')}` : ''}` };
  }
  if (words.length === 0) return null;
  return { what: 'Edited', details: `Changed ${words.join(', ')}` };
}

const NOUN: Record<OutboxEntity, string> = { person: 'person', company: 'company', held: 'person without an email', list: 'list' };

/** One change-log row. `who` is the record as it is now, or its snapshot when deleted. */
export function logRow(e: OutboxEvent, who: Record<string, any> | null): Cell[] | null {
  const name = who
    ? (e.entity === 'company' || e.entity === 'list'
      ? txt(who.name)
      : [who.first_name, who.last_name].filter(Boolean).join(' ') || txt(who.email) || 'Unnamed')
    : '';
  const email = e.entity === 'person' ? txt(who?.email) : '';
  const when = backupTime(e.created_at);
  let what = '';
  let details = '';
  switch (e.action) {
    case 'created':
      what = e.entity === 'held' ? 'Held without an email' : e.entity === 'list' ? 'List created' : e.entity === 'company' ? 'Company added' : 'Added';
      details = e.detail ? `From ${e.detail}` : '';
      break;
    case 'deleted':
      what = e.entity === 'held' ? 'No longer waiting for an email' : e.entity === 'list' ? 'List deleted' : `Deleted (${NOUN[e.entity]})`;
      details = e.entity === 'held' ? 'Given an email, or removed' : '';
      break;
    case 'list_added': what = 'Added to list'; details = e.detail || ''; break;
    case 'list_removed': what = 'Removed from list'; details = e.detail || ''; break;
    case 'tagged': what = 'Tagged'; details = e.detail || ''; break;
    case 'untagged': what = 'Tag removed'; details = e.detail || ''; break;
    case 'updated': {
      const d = describeUpdate(e.entity, e.detail, who);
      if (!d) return null;
      what = e.entity === 'list' ? 'List changed' : e.entity === 'company' && d.what === 'Edited' ? 'Company edited' : d.what;
      details = d.details;
      break;
    }
  }
  return [when, what, name, email, details];
}

/**
 * A run of near-identical lines collapses into one, so a 5,000-row import
 * reads "Added 5,000 people, from leads.csv" instead of burying the log.
 */
export function collapseLog(rows: Cell[][], threshold = 50): Cell[][] {
  const groups = new Map<string, Cell[][]>();
  for (const r of rows) {
    const key = `${r[1]}\u0000${r[4]}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const out: Cell[][] = [];
  for (const g of groups.values()) {
    if (g.length < threshold) { out.push(...g); continue; }
    const last = g[g.length - 1];
    out.push([last[0], `${last[1]} (${g.length.toLocaleString('en-GB')} at once)`, `${g.length.toLocaleString('en-GB')} records`, '', last[4]]);
  }
  return out.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

/** A1 column letter for a 1-based index. */
export function columnLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

/** A tab name quoted for an A1 range: 'No email'!A2. */
export function a1(tab: BackupTab, range: string): string {
  return `'${tab.replace(/'/g, "''")}'!${range}`;
}

/** Status for the settings panel. */
export interface DriveBackupStatus {
  configured: boolean;
  unavailable?: boolean;
  connected: boolean;
  account_email: string | null;
  enabled: boolean;
  spreadsheet_url: string | null;
  broken_reason: string | null;
  last_error: string | null;
  last_flush_at: string | null;
  last_full_at: string | null;
  pending: number;
  needs_full: boolean;
  rows: { people: number; companies: number; held: number; lists: number };
}
