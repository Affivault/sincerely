import type { Lifecycle } from './lifecycle.types.js';
import type { CampaignStatus, ContactCampaignStatus } from './enums.js';

export interface Contact {
  id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  website: string | null;
  location: string | null;
  custom_fields: Record<string, string>;
  source: string;
  /** Stranger, relationship, or customer. See lifecycle.types.ts. */
  lifecycle?: Lifecycle | null;
  /** When they stopped being a stranger. Null for prospects. */
  engaged_at?: string | null;
  /** What promoted them, so it is auditable rather than mysterious. */
  promoted_by?: string | null;
  is_unsubscribed: boolean;
  is_bounced: boolean;
  dcs_score: number | null;
  dcs_syntax_ok: boolean | null;
  dcs_domain_ok: boolean | null;
  dcs_smtp_ok: boolean | null;
  dcs_verified_at: string | null;
  dcs_fail_reason: string | null;
  /** How many live lead lists this contact belongs to (migration 036). */
  list_count?: number;
  /** The company this contact belongs to (migration 038). */
  company_id?: string | null;
  /** Filename of the CSV this contact was imported from, if any. */
  import_source?: string | null;
  imported_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DcsVerificationResult {
  email: string;
  syntax_ok: boolean;
  domain_ok: boolean;
  /** Not known to be bad. Only evidence when `smtp_checked` is also true. */
  smtp_ok: boolean;
  /**
   * A mail server actually gave a verdict.
   *
   * False when nothing could be established — outbound port 25 blocked by the
   * host, a server that timed out, or a greylisting reply. The score credits the
   * SMTP layer only when this is true, so an unrun check caps the total at 60
   * instead of reading as a clean 100.
   */
  smtp_checked: boolean;
  score: number;
  fail_reason: string | null;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ContactWithTags extends Contact {
  tags: Tag[];
  lists?: { id: string; name: string }[];
}

/**
 * One campaign a contact is enrolled in, flattened for display.
 * Returned by GET /contacts/:id/campaigns.
 */
export interface ContactCampaignMembership {
  campaign_contact_id: string;
  campaign_id: string;
  campaign_name: string | null;
  campaign_status: CampaignStatus | null;
  /** Lead list the campaign is bound to; null when it isn't bound to one. */
  campaign_list_id: string | null;
  status: ContactCampaignStatus;
  current_step_order: number;
  next_send_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  enrolled_at: string;
  /** Campaign is draft/scheduled/running/paused — i.e. removal still matters. */
  is_active: boolean;
}

export interface CreateContactInput {
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
  tag_ids?: string[];
}

export interface UpdateContactInput extends Partial<CreateContactInput> {}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

// ============================================
// CONTACT LISTS
// ============================================

/**
 * What a list is for, which decides whether cold email may ever reach it.
 *
 * A lead list is an outreach audience: people you are pitching, and the only
 * thing a campaign is allowed to point at. A contact list is CRM
 * organisation - customers, live accounts, anyone you have a relationship
 * with - and no sequence may bind one. The database enforces that with a
 * trigger (migration 058) rather than trusting the six code paths that can
 * reach campaigns.list_id, because the failure here is not a broken page, it
 * is a cold pitch landing on a customer.
 */
export type ListKind = 'lead' | 'contact';

export const LIST_KINDS: { id: ListKind; label: string; one: string; hint: string }[] = [
  {
    id: 'lead',
    label: 'Lead lists',
    one: 'Lead list',
    hint: 'Outreach audiences. Campaigns send to these.',
  },
  {
    id: 'contact',
    label: 'Contact lists',
    one: 'Contact list',
    hint: 'CRM organisation. Cold campaigns can never send to these.',
  },
];

/**
 * Whether a cold campaign may reach somebody, given where they are filed.
 *
 * The rule in one place, because it is answered twice and the two answers
 * must never differ: the server applies it when enrolling, and the profile
 * page states it to your face. If the page says "can be added to campaigns"
 * and enrolment then silently drops them, the page has lied about the one
 * thing it exists to tell you.
 *
 * Being in the CRM is what protects somebody, and being in an outreach
 * audience is what overrides it - putting a customer on a lead list is a
 * deliberate act that says pitch this one anyway. Somebody on no list at all
 * is unfiled, not protected, and stays reachable; blocking them would break
 * importing straight into a campaign, which is how most people start.
 */
export function isColdEmailable(where: { onLeadList: boolean; onContactList: boolean }): boolean {
  if (!where.onContactList) return true;
  return where.onLeadList;
}

export interface ContactList {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  kind: ListKind;
  folder_id?: string | null;
  is_default: boolean;
  contact_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ListFolder {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  kind: ListKind;
  position: number;
  created_at: string;
  updated_at?: string;
}

export interface CreateContactListInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  kind?: ListKind;
  folder_id?: string | null;
}

export interface UpdateContactListInput extends Partial<CreateContactListInput> {}

/**
 * Sentinel `list_id` for the automatic "Not in Lists" view — every contact
 * that belongs to no live (non-trashed) lead list. It is not a row in
 * contact_lists; the server resolves it against contacts.list_count.
 */
export const UNLISTED_LIST_ID = '__unlisted__';
export const UNLISTED_LIST_NAME = 'Not in Lists';

// ============================================
// SAVED SEGMENTS (Dynamic Filters)
// ============================================

export type SegmentOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'less_than'
  | 'is_true'
  | 'is_false';

export type SegmentField =
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'company'
  | 'job_title'
  | 'phone'
  | 'source'
  | 'is_unsubscribed'
  | 'is_bounced'
  | 'dcs_score'
  | 'created_at'
  | 'tag';

export interface SegmentCondition {
  field: SegmentField;
  operator: SegmentOperator;
  value: string | number | boolean | null;
}

export interface FilterConfig {
  conditions: SegmentCondition[];
  logic: 'and' | 'or';
}

export interface SavedSegment {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  filter_config: FilterConfig;
  cached_count: number;
  cached_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSegmentInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  filter_config: FilterConfig;
}

export interface UpdateSegmentInput extends Partial<CreateSegmentInput> {}

// ============================================
// EXTENDED LIST PARAMS
// ============================================

export interface ContactsListParams {
  page?: number;
  limit?: number;
  search?: string;
  company?: string;
  tag_ids?: string[];
  list_id?: string;
  segment_id?: string;
  is_unsubscribed?: boolean;
  is_bounced?: boolean;
  dcs_min?: number;
  dcs_max?: number;
  verification_status?: 'valid' | 'risky' | 'invalid' | 'not_found' | 'unverified';
  /**
   * Which population to list.
   *
   * 'engaged' is contacts plus customers, and is what the CRM contact list
   * means. Omit it, or pass 'all', to include prospects — which is what
   * campaign audiences and lead lists want, since reaching strangers is
   * the entire job.
   */
  lifecycle?: 'engaged' | 'all' | 'prospect' | 'contact' | 'customer';
  sort_by?: 'created_at' | 'email' | 'first_name' | 'company' | 'dcs_score';
  sort_order?: 'asc' | 'desc';
}

// ============================================
// BULK OPERATIONS
// ============================================

export interface BulkActionResult {
  success: number;
  failed: number;
  errors?: string[];
}

export interface BulkAddToListInput {
  contact_ids: string[];
  list_id: string;
}

export interface BulkRemoveFromListInput {
  contact_ids: string[];
  list_id: string;
}

export interface BulkDeleteInput {
  contact_ids: string[];
}

export interface BulkTagInput {
  contact_ids: string[];
  tag_ids: string[];
}

export interface ExportContactsInput {
  contact_ids?: string[];
  list_id?: string;
  segment_id?: string;
  format?: 'csv' | 'json';
}
