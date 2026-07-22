import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import type { CreateSegmentInput, UpdateSegmentInput, FilterConfig, SegmentCondition } from '@lemlist/shared';

// Column names a segment condition may filter on. `field`/`operator` arrive
// as untyped JSON from the request body (SegmentField is a compile-time-only
// type), and `buildConditionString` interpolates `field` directly into a raw
// PostgREST filter string — without this allow-list an attacker could inject
// arbitrary filter syntax (e.g. extra operators, references to columns
// outside the intended set) via the `field` value.
const ALLOWED_SEGMENT_FIELDS = new Set([
  'email', 'first_name', 'last_name', 'company', 'job_title', 'phone',
  'source', 'is_unsubscribed', 'is_bounced', 'dcs_score', 'created_at', 'tag',
]);

function assertValidField(field: string): void {
  if (!ALLOWED_SEGMENT_FIELDS.has(field)) {
    throw new AppError(`Invalid segment field: ${field}`, 400);
  }
}

const CONTACT_PAGE_SIZE = 1000;

// Supabase caps a single select at ~1000 rows (see lists.service.ts's
// getContactsInList), so any contacts query backing a segment must page
// through the full result or silently truncate past the first 1000 matches.
async function fetchAllContactIds(buildQuery: (from: number, to: number) => any): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += CONTACT_PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + CONTACT_PAGE_SIZE - 1);
    if (error) throw new AppError(error.message, 500);
    const rows = data || [];
    for (const row of rows) ids.push(row.id);
    if (rows.length < CONTACT_PAGE_SIZE) break;
  }
  return ids;
}

export const segmentsService = {
  async list(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('saved_segments')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async get(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('saved_segments')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Segment not found', 404);

    return data;
  },

  async create(userId: string, input: CreateSegmentInput) {
    // Count contacts matching the filter
    const count = await this.countMatchingContacts(userId, input.filter_config);

    const { data, error } = await supabaseAdmin
      .from('saved_segments')
      .insert({
        ...input,
        user_id: userId,
        cached_count: count,
        cached_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new AppError('Segment with this name already exists', 409);
      throw new AppError(error.message, 500);
    }

    return data;
  },

  async update(userId: string, id: string, input: UpdateSegmentInput) {
    let updateData: any = { ...input };

    // If filter_config changed, recalculate count
    if (input.filter_config) {
      const count = await this.countMatchingContacts(userId, input.filter_config);
      updateData.cached_count = count;
      updateData.cached_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('saved_segments')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Segment not found', 404);

    return data;
  },

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('saved_segments')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
  },

  async refreshCount(userId: string, id: string) {
    const segment = await this.get(userId, id);
    const count = await this.countMatchingContacts(userId, segment.filter_config);

    const { data, error } = await supabaseAdmin
      .from('saved_segments')
      .update({ cached_count: count, cached_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async countMatchingContacts(userId: string, filterConfig: FilterConfig): Promise<number> {
    const ids = await this.getMatchingContactIds(userId, filterConfig);
    return ids.length;
  },

  // Tag conditions can't be expressed as a plain column filter (they require a
  // join through contact_tags), so they're resolved to a contact-id set here
  // and combined with the rest of the filter in getMatchingContactIds. Scoping
  // the join by contacts.user_id also means a tag id from another tenant just
  // resolves to an empty set instead of leaking anything.
  async getContactIdsWithTag(userId: string, tagId: string): Promise<string[]> {
    const { data, error } = await supabaseAdmin
      .from('contact_tags')
      .select('contact_id, contacts!inner(user_id)')
      .eq('tag_id', tagId)
      .eq('contacts.user_id', userId);
    if (error) throw new AppError(error.message, 500);
    return (data || []).map((r: any) => r.contact_id);
  },

  async getMatchingContactIds(userId: string, filterConfig: FilterConfig): Promise<string[]> {
    const { conditions, logic } = filterConfig;

    if (!conditions || conditions.length === 0) {
      return fetchAllContactIds((from, to) =>
        supabaseAdmin.from('contacts').select('id').eq('user_id', userId).range(from, to)
      );
    }

    const tagConditions = conditions.filter((c) => c.field === 'tag');
    const otherConditions = conditions.filter((c) => c.field !== 'tag');

    const tagIdSets = await Promise.all(
      tagConditions.map(async (c) => {
        const ids = await this.getContactIdsWithTag(userId, String(c.value));
        const idSet = new Set(ids);
        if (c.operator === 'not_equals') {
          const allIds = await fetchAllContactIds((from, to) =>
            supabaseAdmin.from('contacts').select('id').eq('user_id', userId).range(from, to)
          );
          return new Set(allIds.filter((id: string) => !idSet.has(id)));
        }
        return idSet;
      })
    );

    let otherIds: string[] | null = null;
    if (otherConditions.length > 0 || tagConditions.length === 0) {
      const buildBaseQuery = () => {
        let query = supabaseAdmin.from('contacts').select('id').eq('user_id', userId);

        if (logic === 'or' && otherConditions.length > 1) {
          const orConditions = otherConditions.map((c) => this.buildConditionString(c)).filter(Boolean) as string[];
          if (orConditions.length > 0) {
            query = query.or(orConditions.join(','));
          }
        } else {
          for (const condition of otherConditions) {
            query = this.applyCondition(query, condition);
          }
        }
        return query;
      };

      otherIds = await fetchAllContactIds((from, to) => buildBaseQuery().range(from, to));
    }

    if (tagIdSets.length === 0) {
      return otherIds || [];
    }

    if (logic === 'or') {
      const union = new Set<string>(otherIds || []);
      for (const set of tagIdSets) {
        for (const id of set) union.add(id);
      }
      return Array.from(union);
    }

    // AND logic: intersect every tag set, then intersect with the other conditions' result (if any)
    let result = tagIdSets[0];
    for (let i = 1; i < tagIdSets.length; i++) {
      const other = tagIdSets[i];
      result = new Set([...result].filter((id) => other.has(id)));
    }
    if (otherIds !== null) {
      const otherSet = new Set(otherIds);
      result = new Set([...result].filter((id) => otherSet.has(id)));
    }
    return Array.from(result);
  },

  buildConditionString(condition: SegmentCondition): string | null {
    const { field, operator, value } = condition;
    assertValidField(field);

    // Handle tag field separately (requires join)
    if (field === 'tag') return null;

    // Quote string values so commas and parens inside them don't break PostgREST OR parsing
    const q = (v: unknown): string => {
      const s = String(v ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };

    switch (operator) {
      case 'equals':
        return `${field}.eq.${q(value)}`;
      case 'not_equals':
        return `${field}.neq.${q(value)}`;
      case 'contains':
        return `${field}.ilike."%${String(value ?? '').replace(/"/g, '""')}%"`;
      case 'not_contains':
        return `${field}.not.ilike."%${String(value ?? '').replace(/"/g, '""')}%"`;
      case 'starts_with':
        return `${field}.ilike.${q(`${String(value ?? '')}%`)}`;
      case 'ends_with':
        return `${field}.ilike.${q(`%${String(value ?? '')}`)}`;
      case 'is_empty':
        return `${field}.is.null`;
      case 'is_not_empty':
        return `${field}.not.is.null`;
      case 'greater_than':
        return `${field}.gt.${q(value)}`;
      case 'less_than':
        return `${field}.lt.${q(value)}`;
      case 'is_true':
        return `${field}.eq.true`;
      case 'is_false':
        return `${field}.eq.false`;
      default:
        return null;
    }
  },

  applyCondition(query: any, condition: SegmentCondition): any {
    const { field, operator, value } = condition;
    assertValidField(field);

    // Skip tag field for now (would need separate handling)
    if (field === 'tag') return query;

    switch (operator) {
      case 'equals':
        return query.eq(field, value);
      case 'not_equals':
        return query.neq(field, value);
      case 'contains':
        return query.ilike(field, `%${value}%`);
      case 'not_contains':
        return query.not(field, 'ilike', `%${value}%`);
      case 'starts_with':
        return query.ilike(field, `${value}%`);
      case 'ends_with':
        return query.ilike(field, `%${value}`);
      case 'is_empty':
        return query.is(field, null);
      case 'is_not_empty':
        return query.not(field, 'is', null);
      case 'greater_than':
        return query.gt(field, value);
      case 'less_than':
        return query.lt(field, value);
      case 'is_true':
        return query.eq(field, true);
      case 'is_false':
        return query.eq(field, false);
      default:
        return query;
    }
  },

  // Built-in segment helpers
  getUnsubscribedFilter(): FilterConfig {
    return {
      conditions: [{ field: 'is_unsubscribed', operator: 'is_true', value: null }],
      logic: 'and',
    };
  },

  getBouncedFilter(): FilterConfig {
    return {
      conditions: [{ field: 'is_bounced', operator: 'is_true', value: null }],
      logic: 'and',
    };
  },

  getSuppressedFilter(): FilterConfig {
    return {
      conditions: [
        { field: 'is_unsubscribed', operator: 'is_true', value: null },
        { field: 'is_bounced', operator: 'is_true', value: null },
      ],
      logic: 'or',
    };
  },

  getVerifiedFilter(minScore: number = 70): FilterConfig {
    return {
      conditions: [{ field: 'dcs_score', operator: 'greater_than', value: minScore }],
      logic: 'and',
    };
  },
};
