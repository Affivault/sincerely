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
  created_at: string;
  updated_at: string;
}

export interface DcsVerificationResult {
  email: string;
  syntax_ok: boolean;
  domain_ok: boolean;
  smtp_ok: boolean;
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
