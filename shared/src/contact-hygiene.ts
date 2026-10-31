/* ═══════════════════════════════════════════════════════════════════════
   Keeping the contact list honest: duplicates, merges, saved views and
   bulk edits.

   Duplicates are the slow rot of a CRM that imports. The same person
   arrives from a CSV as ada.lovelace@gmail.com, replies from
   adalovelace+news@gmail.com and books a meeting as Ada Lovelace at
   Analytical - three rows, three histories, and a sequence that emails one
   of them after another has already said yes.

   Finding them happens in Postgres (find_contact_duplicates, migration 096)
   because it has to look at every contact an account owns. The rules for
   what counts as "the same" live here too, so the merge screen can say WHY
   two rows were matched, and the two copies are kept in step by the check
   in server/scripts/contact-hygiene-check.mts.
   ═══════════════════════════════════════════════════════════════════════ */

import type { Lifecycle } from './lifecycle.types.js';

/* ── Matching ─────────────────────────────────────────────────────────── */

/**
 * An address reduced to the mailbox it reaches.
 *
 * Case never matters, a +tag never changes the mailbox, and Gmail ignores
 * dots in the local part (and answers to googlemail.com). Plus tags are
 * dropped for every domain because nearly every business host honours them,
 * and the result is only ever a suggestion somebody confirms.
 *
 * Must agree with contact_match_email() in migration 096.
 */
export function matchEmail(email: string | null | undefined): string | null {
  const v = String(email ?? '').trim().toLowerCase();
  const at = v.lastIndexOf('@');
  if (!v || at < 0) return null;
  let local = v.slice(0, at);
  let domain = v.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  local = local.split('+')[0];
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local || !domain) return null;
  return `${local}@${domain}`;
}

/**
 * A LinkedIn profile however it was pasted: scheme or not, www or a country
 * subdomain, trailing slash, tracking query. "in/ada-lovelace".
 *
 * Must agree with contact_match_linkedin() in migration 096.
 */
export function matchLinkedin(url: string | null | undefined): string | null {
  let v = String(url ?? '').trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  const m = /(?:^|\.)linkedin\.com\/(?:in|pub)\/([^/]+)/.exec(v);
  if (m && m[1]) return `in/${m[1]}`;
  if (/(^|\.)linkedin\.com\/.+/.test(v)) return v.replace(/^([a-z]{2,3}\.|www\.)/, '');
  return null;
}

/** Why a group of contacts was offered as one person. */
export type DuplicateReason = 'email' | 'linkedin' | 'name_company' | 'name_domain';

export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  email: 'Same email address',
  linkedin: 'Same LinkedIn profile',
  name_company: 'Same name, same company',
  name_domain: 'Same name, same company domain',
};

/** The fields a duplicate card shows, and a merge chooses between. */
export interface DuplicateContact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  website: string | null;
  location: string | null;
  lifecycle: Lifecycle | null;
  custom_fields: Record<string, string> | null;
  created_at: string;
  updated_at: string;
  /** Enrolments, meetings and notes - what would be carried across. */
  activity?: { campaigns: number; meetings: number; notes: number; deals: number };
}

/** One likely person, possibly matched by several rules at once. */
export interface DuplicateGroup {
  /** Sorted ids, joined: stable across requests, and what a dismissal stores. */
  key: string;
  reasons: DuplicateReason[];
  contacts: DuplicateContact[];
}

/** The key a group is remembered by when somebody says "not the same". */
export function duplicateGroupKey(ids: string[]): string {
  return [...new Set(ids)].sort().join(',');
}

/* ── Merging ──────────────────────────────────────────────────────────── */

/** The fields a person chooses between when merging, in display order. */
export const MERGE_FIELDS = [
  'email', 'first_name', 'last_name', 'company', 'job_title',
  'phone', 'linkedin_url', 'website', 'location',
] as const;
export type MergeField = typeof MERGE_FIELDS[number];

export const MERGE_FIELD_LABEL: Record<MergeField, string> = {
  email: 'Email',
  first_name: 'First name',
  last_name: 'Last name',
  company: 'Company',
  job_title: 'Job title',
  phone: 'Phone',
  linkedin_url: 'LinkedIn',
  website: 'Website',
  location: 'Location',
};

const LIFECYCLE_RANK: Record<Lifecycle, number> = { prospect: 1, contact: 2, customer: 3 };

/** customer > contact > prospect. A merge never demotes anybody. */
export function bestLifecycle(values: Array<Lifecycle | null | undefined>): Lifecycle {
  let best: Lifecycle = 'prospect';
  for (const v of values) {
    if (v && LIFECYCLE_RANK[v] > LIFECYCLE_RANK[best]) best = v;
  }
  return best;
}

function filled(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

/**
 * Which contact's value each field starts on.
 *
 * Filled beats blank, and among filled values the most recently edited
 * contact wins - it is the likeliest to be current. The primary only wins a
 * tie, so picking a primary decides whose history the merged record is,
 * not whose stale job title it keeps.
 */
export function defaultMergeChoices(
  contacts: Array<Pick<DuplicateContact, 'id' | 'updated_at'> & Partial<Record<MergeField, string | null>>>,
  primaryId: string,
): Record<MergeField, string> {
  const byNewest = [...contacts].sort((a, b) => {
    const t = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    if (t !== 0 && Number.isFinite(t)) return t;
    return (a.id === primaryId ? -1 : 0) - (b.id === primaryId ? -1 : 0);
  });
  const out = {} as Record<MergeField, string>;
  for (const field of MERGE_FIELDS) {
    const primary = contacts.find((c) => c.id === primaryId);
    // The address is the one field that is never blank, and the one where
    // "newest" is least meaningful: keep the primary's unless told otherwise.
    if (field === 'email' && primary) { out[field] = primary.id; continue; }
    const winner = byNewest.find((c) => filled(c[field])) ?? primary ?? byNewest[0];
    if (winner) out[field] = winner.id;
  }
  return out;
}

/**
 * Turn per-field choices (field -> contact id) into the values to write.
 * Only fields whose value differs from the primary's are sent.
 */
export function mergeFieldValues(
  contacts: Array<{ id: string } & Partial<Record<MergeField, string | null>>>,
  primaryId: string,
  choices: Partial<Record<MergeField, string>>,
): Partial<Record<MergeField, string | null>> {
  const primary = contacts.find((c) => c.id === primaryId);
  const out: Partial<Record<MergeField, string | null>> = {};
  for (const field of MERGE_FIELDS) {
    const source = contacts.find((c) => c.id === choices[field]);
    if (!source || !primary) continue;
    const value = source[field] ?? null;
    if ((value ?? null) !== (primary[field] ?? null)) out[field] = value;
  }
  return out;
}

/* ── Saved views ──────────────────────────────────────────────────────── */

export type SavedViewPage = 'lead' | 'contact';

/** Everything a view restores. Anything else in a stored config is ignored. */
export interface SavedViewConfig {
  /**
   * Which stage on the Contacts page: 'engaged' is both, or one of them.
   * 'prospect' and 'all' are from before Leads and Contacts were split and
   * are read as the page's own default.
   */
  lifecycle?: 'engaged' | 'prospect' | 'all' | 'contact' | 'customer';
  /** Leads page only: where they are in the outbound cycle. */
  outreach?: 'none' | 'queued' | 'in_sequence' | 'finished' | 'replied';
  search?: string;
  status?: '' | 'valid' | 'risky' | 'invalid' | 'not_found' | 'unverified';
  company?: string | null;
  list_id?: string | null;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}

export interface SavedView {
  id: string;
  page: SavedViewPage;
  name: string;
  config: SavedViewConfig;
  position: number;
  created_at: string;
  updated_at: string;
}

const VIEW_LIFECYCLES = new Set(['engaged', 'prospect', 'all', 'contact', 'customer']);
const VIEW_OUTREACH = new Set(['none', 'queued', 'in_sequence', 'finished', 'replied']);
const VIEW_STATUSES = new Set(['', 'valid', 'risky', 'invalid', 'not_found', 'unverified']);
export const VIEW_SORT_KEYS = ['first_name', 'email', 'company', 'dcs_score', 'created_at', 'engagement_score'] as const;

/**
 * A stored config, cut down to what a view can mean.
 *
 * Run on the way in, so a crafted body cannot park arbitrary JSON in the
 * table, and on the way out, so a view saved by an older version of the page
 * still opens.
 */
export function sanitizeViewConfig(raw: unknown): SavedViewConfig {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const out: SavedViewConfig = {};
  if (typeof r.lifecycle === 'string' && VIEW_LIFECYCLES.has(r.lifecycle)) out.lifecycle = r.lifecycle as SavedViewConfig['lifecycle'];
  if (typeof r.outreach === 'string' && VIEW_OUTREACH.has(r.outreach)) out.outreach = r.outreach as SavedViewConfig['outreach'];
  if (typeof r.search === 'string' && r.search.trim()) out.search = r.search.trim().slice(0, 200);
  if (typeof r.status === 'string' && VIEW_STATUSES.has(r.status)) out.status = r.status as SavedViewConfig['status'];
  if (typeof r.company === 'string' && r.company.trim()) out.company = r.company.trim().slice(0, 200);
  if (typeof r.list_id === 'string' && /^[0-9a-f-]{36}$/i.test(r.list_id)) out.list_id = r.list_id;
  if (typeof r.sort_by === 'string' && (VIEW_SORT_KEYS as readonly string[]).includes(r.sort_by)) out.sort_by = r.sort_by;
  if (r.sort_dir === 'asc' || r.sort_dir === 'desc') out.sort_dir = r.sort_dir;
  return out;
}

/** Two configs that would show the same rows. Drives "Update view". */
export function sameViewConfig(a: SavedViewConfig, b: SavedViewConfig): boolean {
  const x = sanitizeViewConfig(a);
  const y = sanitizeViewConfig(b);
  const keys: (keyof SavedViewConfig)[] = ['lifecycle', 'outreach', 'search', 'status', 'company', 'list_id', 'sort_by', 'sort_dir'];
  return keys.every((k) => (x[k] ?? '') === (y[k] ?? ''));
}

/* ── Bulk edit ────────────────────────────────────────────────────────── */

/**
 * The columns bulk edit may touch. Everything identifying (the address),
 * everything the app maintains (lifecycle, verification, list_count) and
 * everything owned by another feature is deliberately absent.
 */
export const BULK_EDIT_FIELDS = ['company', 'job_title', 'location', 'phone', 'website'] as const;
export type BulkEditField = typeof BULK_EDIT_FIELDS[number];

export const BULK_EDIT_FIELD_LABEL: Record<BulkEditField, string> = {
  company: 'Company',
  job_title: 'Job title',
  location: 'Location',
  phone: 'Phone',
  website: 'Website',
};

/** The most contacts one bulk edit may change. */
export const BULK_EDIT_MAX = 5000;

export type BulkEditInput =
  | { op: 'set'; field: BulkEditField; value: string }
  | { op: 'clear'; field: BulkEditField }
  | { op: 'set_custom'; key: string; value: string }
  | { op: 'clear_custom'; key: string }
  | { op: 'add_tags'; tag_ids: string[] }
  | { op: 'remove_tags'; tag_ids: string[] };

/** A custom field's name, as a key that is safe to store and to show. */
export function cleanCustomFieldKey(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v || v.length > 64) return null;
  return v;
}
