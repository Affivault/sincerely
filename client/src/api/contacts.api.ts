import { apiClient } from './client';
import type {
  Contact,
  ContactCampaignMembership,
  ContactWithTags,
  CreateContactInput,
  UpdateContactInput,
  PaginatedResponse,
  ContactsListParams,
  Tag,
  ContactList,
  ListKind,
  CreateContactListInput,
  UpdateContactListInput,
  SavedSegment,
  CreateSegmentInput,
  UpdateSegmentInput,
  FilterConfig,
  BulkActionResult,
  DuplicateGroup,
  SavedView,
  SavedViewConfig,
  SavedViewPage,
  BulkEditInput,
  EngagementResult,
} from '@lemlist/shared';

export interface ContactStats {
  total: number;
  unsubscribed: number;
  bounced: number;
  verified: number;
  active: number;
}

export interface BulkImportResult {
  total: number;
  imported: number;
  /** Of imported: new addresses, and existing ones that only had blanks filled. */
  created?: number;
  updated?: number;
  /** Addresses in the batch that are on the suppression list. */
  suppressed?: number;
  errors: number;
  duplicates_collapsed?: number;
  error_details: { email: string; reason: string }[];
}

// The duplicates UI reads groups.length and total straight away, so an
// unexpected body (a proxy error page, an older server) is an error here
// rather than a crash on the contacts list and every contact page.
function duplicateGroups(data: unknown): { groups: DuplicateGroup[]; total: number } {
  const body = data as { groups?: unknown; total?: unknown } | null;
  if (!body || !Array.isArray(body.groups)) throw new Error('Duplicates could not be loaded');
  return { groups: body.groups as DuplicateGroup[], total: typeof body.total === 'number' ? body.total : body.groups.length };
}

export const contactsApi = {
  /** How many prospects, contacts and customers there are. */
  lifecycleCounts: async () => {
    const { data } = await apiClient.get<{ prospect: number; contact: number; customer: number; total: number }>(
      '/contacts/lifecycle-counts',
    );
    return data;
  },

  list: async (params?: ContactsListParams) => {
    const { data } = await apiClient.get<PaginatedResponse<ContactWithTags>>('/contacts', { params });
    return data;
  },

  verificationBreakdown: async (listId?: string) => {
    const { data } = await apiClient.get<{
      total: number; valid: number; risky: number; invalid: number; not_found: number; unverified: number; with_linkedin: number;
    }>('/contacts/verification-breakdown', { params: listId ? { list_id: listId } : undefined });
    return data;
  },

  companies: async () => {
    const { data } = await apiClient.get<{ company: string; count: number }[]>('/contacts/companies');
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<ContactWithTags>(`/contacts/${id}`);
    return data;
  },

  getCampaigns: async (id: string) => {
    const { data } = await apiClient.get<ContactCampaignMembership[]>(`/contacts/${id}/campaigns`);
    return data;
  },

  create: async (input: CreateContactInput) => {
    const { data } = await apiClient.post<Contact>('/contacts', input);
    return data;
  },

  update: async (id: string, input: UpdateContactInput) => {
    const { data } = await apiClient.put<Contact>(`/contacts/${id}`, input);
    return data;
  },

  delete: async (id: string) => {
    await apiClient.delete(`/contacts/${id}`);
  },

  import: async (file: File, columnMapping: Record<string, string>) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('columnMapping', JSON.stringify(columnMapping));
    // Do NOT set Content-Type here — axios will set it to
    // 'multipart/form-data; boundary=...' automatically when it
    // detects FormData. Setting it manually drops the boundary and
    // makes multer reject the request as malformed.
    const { data } = await apiClient.post<{ imported: number; errors: number }>(
      '/contacts/import',
      formData
    );
    return data;
  },

  bulkCreate: async (
    contacts: Array<Record<string, any>>,
    listId?: string,
    /** CSV filename, recorded on each contact as its origin. */
    importSource?: string,
    /** 'contacts' files everyone in the batch as a contact, not a prospect. */
    context?: 'contacts',
  ) => {
    const { data } = await apiClient.post<BulkImportResult>(
      '/contacts/bulk',
      { contacts, list_id: listId, import_source: importSource, context }
    );
    return data;
  },

  export: async (contactIds?: string[], format: 'csv' | 'json' = 'csv', listId?: string, segmentId?: string) => {
    const { data } = await apiClient.post('/contacts/export', { contact_ids: contactIds, format, list_id: listId, segment_id: segmentId }, {
      responseType: format === 'csv' ? 'blob' : 'json',
    });
    return data;
  },

  bulkTag: async (contactIds: string[], tagIds: string[]) => {
    await apiClient.post('/contacts/bulk-tag', { contact_ids: contactIds, tag_ids: tagIds });
  },

  bulkUntag: async (contactIds: string[], tagIds: string[]) => {
    await apiClient.delete('/contacts/bulk-tag', {
      data: { contact_ids: contactIds, tag_ids: tagIds },
    });
  },

  /** Move people between Prospects / Contacts / Customers by hand, either way. */
  setLifecycle: async (contactIds: string[], lifecycle: 'prospect' | 'contact' | 'customer') => {
    const { data } = await apiClient.post<{ updated: number; lifecycle: string }>('/contacts/lifecycle', { contact_ids: contactIds, lifecycle });
    return data;
  },

  bulkDelete: async (contactIds: string[]) => {
    const { data } = await apiClient.post<{ deleted: number }>('/contacts/bulk-delete', { contact_ids: contactIds });
    return data;
  },

  getStats: async () => {
    const { data } = await apiClient.get<ContactStats>('/contacts/stats');
    return data;
  },

  /* ── Duplicates and merging (migration 096) ── */
  duplicates: async (limit?: number) => {
    const { data } = await apiClient.get<{ groups: DuplicateGroup[]; total: number }>('/contacts/duplicates', {
      params: limit ? { limit } : undefined,
    });
    return duplicateGroups(data);
  },

  duplicatesFor: async (id: string) => {
    const { data } = await apiClient.get<{ groups: DuplicateGroup[]; total: number }>(`/contacts/${id}/duplicates`);
    return duplicateGroups(data);
  },

  dismissDuplicate: async (contactIds: string[]) => {
    await apiClient.post('/contacts/duplicates/dismiss', { contact_ids: contactIds });
  },

  merge: async (primaryId: string, otherIds: string[], fields: Record<string, string | null>) => {
    const { data } = await apiClient.post<{ primary_id: string; merged: number; moved: Record<string, number>; contact: ContactWithTags }>(
      '/contacts/merge', { primary_id: primaryId, other_ids: otherIds, fields },
    );
    return data;
  },

  /* ── Saved views ── */
  views: async (page: SavedViewPage) => {
    const { data } = await apiClient.get<SavedView[] | { unavailable: string }>('/contacts/views', { params: { page } });
    return data;
  },

  createView: async (page: SavedViewPage, name: string, config: SavedViewConfig) => {
    const { data } = await apiClient.post<SavedView>('/contacts/views', { page, name, config });
    return data;
  },

  updateView: async (id: string, patch: { name?: string; config?: SavedViewConfig }) => {
    const { data } = await apiClient.put<SavedView>(`/contacts/views/${id}`, patch);
    return data;
  },

  deleteView: async (id: string) => {
    await apiClient.delete(`/contacts/views/${id}`);
  },

  /** One change to many contacts: set or clear a field, a custom field, or tags. */
  bulkEdit: async (contactIds: string[], edit: BulkEditInput) => {
    const { data } = await apiClient.post<{ updated: number; op: string }>('/contacts/bulk-edit', { contact_ids: contactIds, ...edit });
    return data;
  },

  /** The 0-100 score, recounted now, and what it is made of. */
  engagement: async (id: string) => {
    const { data } = await apiClient.get<EngagementResult & { stored: boolean }>(`/contacts/${id}/engagement`);
    // The panel reads factors.length and the score at once; anything else is an error, not a crash.
    if (!data || typeof data.score !== 'number' || !Array.isArray(data.factors)) {
      throw new Error('Engagement could not be loaded');
    }
    return data;
  },
};

// Lists API
export const listsApi = {
  /**
   * @param kind Omitted returns both kinds, which is what a contact's own
   *   memberships want. Pass one to fill a rail section, and pass 'lead'
   *   anywhere a campaign audience is being chosen.
   */
  list: async (kind?: ListKind) => {
    const { data } = await apiClient.get<ContactList[]>('/lists', {
      params: kind ? { kind } : undefined,
    });
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<ContactList>(`/lists/${id}`);
    return data;
  },

  create: async (input: CreateContactListInput) => {
    const { data } = await apiClient.post<ContactList>('/lists', input);
    return data;
  },

  update: async (id: string, input: UpdateContactListInput) => {
    const { data } = await apiClient.put<ContactList>(`/lists/${id}`, input);
    return data;
  },

  delete: async (id: string) => {
    await apiClient.delete(`/lists/${id}`);
  },

  addContacts: async (listId: string, contactIds: string[]) => {
    const { data } = await apiClient.post<BulkActionResult>(`/lists/${listId}/contacts`, { contact_ids: contactIds });
    return data;
  },

  removeContacts: async (listId: string, contactIds: string[]) => {
    const { data } = await apiClient.delete<BulkActionResult>(`/lists/${listId}/contacts`, {
      data: { contact_ids: contactIds },
    });
    return data;
  },

  getContacts: async (listId: string) => {
    const { data } = await apiClient.get<{ contact_ids: string[] }>(`/lists/${listId}/contacts`);
    return data.contact_ids;
  },

  getListsForContact: async (contactId: string) => {
    const { data } = await apiClient.get<(ContactList & { is_member: boolean })[]>(`/lists/contact/${contactId}`);
    return data;
  },

  moveContact: async (contactId: string, fromListId: string, toListId: string) => {
    const { data } = await apiClient.post<{ success: boolean }>('/lists/move-contact', {
      contact_id: contactId,
      from_list_id: fromListId,
      to_list_id: toListId,
    });
    return data;
  },
};

// Segments API
export const segmentsApi = {
  list: async () => {
    const { data } = await apiClient.get<SavedSegment[]>('/segments');
    return data;
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<SavedSegment>(`/segments/${id}`);
    return data;
  },

  create: async (input: CreateSegmentInput) => {
    const { data } = await apiClient.post<SavedSegment>('/segments', input);
    return data;
  },

  update: async (id: string, input: UpdateSegmentInput) => {
    const { data } = await apiClient.put<SavedSegment>(`/segments/${id}`, input);
    return data;
  },

  delete: async (id: string) => {
    await apiClient.delete(`/segments/${id}`);
  },

  getContacts: async (segmentId: string) => {
    const { data } = await apiClient.get<{ contact_ids: string[] }>(`/segments/${segmentId}/contacts`);
    return data.contact_ids;
  },

  refresh: async (id: string) => {
    const { data } = await apiClient.post<SavedSegment>(`/segments/${id}/refresh`);
    return data;
  },

  preview: async (filterConfig: FilterConfig) => {
    const { data } = await apiClient.post<{ count: number }>('/segments/preview', { filter_config: filterConfig });
    return data.count;
  },
};

export const tagsApi = {
  list: async () => {
    const { data } = await apiClient.get<Tag[]>('/tags');
    return data;
  },

  create: async (input: { name: string; color?: string }) => {
    const { data } = await apiClient.post<Tag>('/tags', input);
    return data;
  },

  update: async (id: string, input: { name?: string; color?: string }) => {
    const { data } = await apiClient.put<Tag>(`/tags/${id}`, input);
    return data;
  },

  delete: async (id: string) => {
    await apiClient.delete(`/tags/${id}`);
  },
};
