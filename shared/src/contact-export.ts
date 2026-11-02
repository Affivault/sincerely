import { emailState, type EmailState, type LightFields } from './email-light.js';

/* ═══════════════════════════════════════════════════════════════════════
   What a contact export contains, in one place.

   The export used to be a fixed list of database column names
   (first_name, dcs_score, is_bounced...) with custom fields spread across
   the end. No tags, no lists, no company details, and a custom field that
   shared a name with a real column silently vanished.

   Now the columns are chosen, by preset or one at a time, and carry the
   same plain labels the importer reads - so a Sincerely export imports
   back into Sincerely with no mapping at all, and the bookkeeping columns
   (Lists, Lifecycle, Added...) are skipped on the way back in rather than
   arriving as custom fields.
   ═══════════════════════════════════════════════════════════════════════ */

export type ExportColumnKey =
  | 'email' | 'first_name' | 'last_name' | 'job_title' | 'phone' | 'linkedin_url' | 'website'
  | 'location' | 'city' | 'state' | 'country' | 'industry'
  | 'company' | 'company_website' | 'company_linkedin' | 'company_size' | 'company_industry'
  | 'company_location' | 'company_phone'
  | 'tags' | 'lists' | 'lifecycle' | 'verification' | 'unsubscribed' | 'bounced' | 'source'
  | 'import_source' | 'created_at' | 'custom_fields';

export interface ExportColumn {
  key: ExportColumnKey;
  label: string;
  group: 'Person' | 'Company' | 'Status' | 'Other';
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'email', label: 'Email', group: 'Person' },
  { key: 'first_name', label: 'First name', group: 'Person' },
  { key: 'last_name', label: 'Last name', group: 'Person' },
  { key: 'job_title', label: 'Job title', group: 'Person' },
  { key: 'phone', label: 'Phone', group: 'Person' },
  { key: 'linkedin_url', label: 'LinkedIn', group: 'Person' },
  { key: 'website', label: 'Website', group: 'Person' },
  { key: 'location', label: 'Location', group: 'Person' },
  { key: 'city', label: 'City', group: 'Person' },
  { key: 'state', label: 'State', group: 'Person' },
  { key: 'country', label: 'Country', group: 'Person' },
  { key: 'industry', label: 'Industry', group: 'Person' },
  { key: 'company', label: 'Company name', group: 'Company' },
  { key: 'company_website', label: 'Company website', group: 'Company' },
  { key: 'company_linkedin', label: 'Company LinkedIn', group: 'Company' },
  { key: 'company_size', label: 'Company size', group: 'Company' },
  { key: 'company_industry', label: 'Company industry', group: 'Company' },
  { key: 'company_location', label: 'Company location', group: 'Company' },
  { key: 'company_phone', label: 'Company phone', group: 'Company' },
  { key: 'tags', label: 'Tags', group: 'Status' },
  { key: 'lists', label: 'Lists', group: 'Status' },
  { key: 'lifecycle', label: 'Lifecycle', group: 'Status' },
  { key: 'verification', label: 'Email status', group: 'Status' },
  { key: 'unsubscribed', label: 'Unsubscribed', group: 'Status' },
  { key: 'bounced', label: 'Bounced', group: 'Status' },
  { key: 'source', label: 'Source', group: 'Other' },
  { key: 'import_source', label: 'Imported from', group: 'Other' },
  { key: 'created_at', label: 'Added', group: 'Other' },
  { key: 'custom_fields', label: 'Custom fields', group: 'Other' },
];

const ALL_KEYS = EXPORT_COLUMNS.map((c) => c.key);

export interface ExportPreset {
  id: 'everything' | 'reimport' | 'crm' | 'outreach';
  label: string;
  hint: string;
  columns: ExportColumnKey[];
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'everything', label: 'Everything', hint: 'Every field, status and custom field', columns: ALL_KEYS },
  {
    id: 'reimport', label: 'For re-importing', hint: 'Imports back into Sincerely (or another account) with no mapping',
    columns: ['email', 'first_name', 'last_name', 'job_title', 'phone', 'linkedin_url', 'website', 'location', 'city', 'state', 'country', 'industry',
      'company', 'company_website', 'company_linkedin', 'company_size', 'company_industry', 'company_location', 'company_phone', 'tags', 'custom_fields'],
  },
  {
    id: 'crm', label: 'For a CRM', hint: 'People, companies and where they are in the funnel',
    columns: ['email', 'first_name', 'last_name', 'job_title', 'phone', 'company', 'company_website', 'company_size', 'company_industry',
      'location', 'country', 'lifecycle', 'tags', 'verification'],
  },
  {
    id: 'outreach', label: 'For another outreach tool', hint: 'What a sequencer or LinkedIn tool needs, and the do-not-contact flags',
    columns: ['email', 'first_name', 'last_name', 'job_title', 'company', 'company_website', 'linkedin_url', 'phone', 'country', 'verification', 'unsubscribed', 'bounced'],
  },
];

export const EXPORT_COLUMN_KEYS: ReadonlySet<string> = new Set(ALL_KEYS);

/** The columns a request asked for, in the canonical order; all when none. */
export function resolveExportColumns(requested?: unknown): ExportColumnKey[] {
  if (!Array.isArray(requested) || requested.length === 0) return ALL_KEYS;
  const want = new Set(requested.filter((k): k is string => typeof k === 'string'));
  const out = ALL_KEYS.filter((k) => want.has(k));
  return out.length ? out : ALL_KEYS;
}

/**
 * The address's state in words - the same buckets the contacts page uses
 * for its pills, so the file says what the screen said.
 */
export function verificationLabel(c: LightFields): string {
  return STATE_WORD[emailState({ email: 'x', ...c })];
}

const STATE_WORD: Record<EmailState, string> = {
  valid: 'Valid', risky: 'Risky', unverified: 'Unverified', invalid: 'Invalid',
  not_found: 'Not found', bounced: 'Bounced', no_email: 'No email',
};

const LIFECYCLE_LABEL: Record<string, string> = { prospect: 'Lead', contact: 'Contact', customer: 'Customer' };

/** One contact, as the export reads it: the row plus its joins. */
export interface ExportSourceRow {
  [k: string]: any;
  tag_names?: string[];
  list_names?: string[];
  company_rec?: Record<string, any> | null;
}

/**
 * Build the sheet: a header row and the rows under it. Custom fields get
 * a column each (the union across every contact, so one missing on the
 * first row is not dropped), and one whose name collides with a real
 * column is prefixed rather than lost.
 */
export function buildContactExport(rows: ExportSourceRow[], columns: ExportColumnKey[]): { header: string[]; rows: Array<Array<string | number | boolean | null>> } {
  const fixed = columns.filter((k) => k !== 'custom_fields');
  const withCustom = columns.includes('custom_fields');
  const labels = fixed.map((k) => EXPORT_COLUMNS.find((c) => c.key === k)!.label);
  const taken = new Set(labels.map((l) => l.toLowerCase()));

  const customKeys: string[] = [];
  if (withCustom) {
    const seen = new Set<string>();
    for (const r of rows) {
      const cf = r.custom_fields;
      if (!cf || typeof cf !== 'object' || Array.isArray(cf)) continue;
      for (const k of Object.keys(cf)) if (!seen.has(k)) { seen.add(k); customKeys.push(k); }
    }
  }
  const customHeaders = customKeys.map((k) => (taken.has(k.toLowerCase()) ? `Custom: ${k}` : k));

  const cell = (r: ExportSourceRow, k: ExportColumnKey): string | number | boolean | null => {
    const co = r.company_rec || {};
    switch (k) {
      case 'tags': return (r.tag_names || []).join(', ');
      case 'lists': return (r.list_names || []).join(', ');
      case 'lifecycle': return LIFECYCLE_LABEL[r.lifecycle] || r.lifecycle || '';
      case 'verification': return verificationLabel(r as Parameters<typeof verificationLabel>[0]);
      case 'unsubscribed': return r.is_unsubscribed ? 'Yes' : 'No';
      case 'bounced': return r.is_bounced ? 'Yes' : 'No';
      case 'created_at': return r.created_at ? String(r.created_at).slice(0, 10) : '';
      case 'company_website': return co.website || '';
      case 'company_linkedin': return co.linkedin_url || '';
      case 'company_size': return co.size || '';
      case 'company_industry': return co.industry || '';
      case 'company_location': return co.location || '';
      case 'company_phone': return co.phone || '';
      default: return r[k] ?? '';
    }
  };

  return {
    header: [...labels, ...customHeaders],
    rows: rows.map((r) => [
      ...fixed.map((k) => cell(r, k)),
      ...customKeys.map((k) => {
        const v = r.custom_fields?.[k];
        return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
      }),
    ]),
  };
}
