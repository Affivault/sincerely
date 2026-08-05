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
  campaign_status: string | null;
  /** Lead list the campaign is bound to; null when it isn't bound to one. */
  campaign_list_id: string | null;
  status: string;
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

export interface ContactList {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  is_default: boolean;
  contact_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateContactListInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
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
