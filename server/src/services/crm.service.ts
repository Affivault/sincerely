import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';

const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'];
const TASK_PRIORITIES = ['low', 'normal', 'high'];
const EVENT_TYPES = ['call', 'meeting'];

/** Embed the linked contact so the client can show live lead data on deals. */
const DEAL_SELECT = '*, contact:contacts(id, email, first_name, last_name, company, job_title, phone, linkedin_url)';

/** Keep only known columns from a request body so callers can't write arbitrary fields. */
function pick(body: any, keys: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

const DEAL_KEYS = ['title', 'company', 'contact_name', 'contact_email', 'contact_id', 'value', 'currency', 'stage', 'expected_close_date', 'notes', 'position'] as const;
const TASK_KEYS = ['title', 'due_date', 'priority', 'deal_id', 'contact_name', 'notes', 'is_done'] as const;
const EVENT_KEYS = ['title', 'type', 'starts_at', 'ends_at', 'contact_name', 'contact_email', 'location', 'notes', 'deal_id'] as const;

/** Coerce/validate deal input in place so bad payloads 400 instead of 500ing at the DB. */
function sanitizeDealInput(input: Record<string, any>) {
  if (input.stage && !DEAL_STAGES.includes(input.stage)) throw new AppError('Invalid stage', 400);
  if (input.value !== undefined && input.value !== null) {
    const n = Number(input.value);
    if (!Number.isFinite(n) || n < 0) throw new AppError('Deal value must be a non-negative number', 400);
    input.value = n;
  }
  if (input.position !== undefined && input.position !== null) {
    const p = Number(input.position);
    if (!Number.isInteger(p) || p < 0) throw new AppError('Invalid position', 400);
    input.position = p;
  }
  if (input.expected_close_date === '') input.expected_close_date = null;
  if (typeof input.contact_email === 'string') {
    input.contact_email = input.contact_email.trim().toLowerCase() || null;
  }
}

/** Reject a contact_id/deal_id that doesn't belong to this user before it's persisted. */
async function assertOwned(userId: string, table: string, id: string, label: string) {
  const { data } = await supabaseAdmin.from(table).select('id').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!data) throw new AppError(`${label} not found`, 404);
}

/**
 * Keep deals in sync with the contacts base: when a deal carries an email but
 * no linked lead, attach the matching contact (and backfill name/company).
 */
async function autoLinkContact(userId: string, input: Record<string, any>) {
  if (input.contact_id || !input.contact_email) return;
  const pattern = String(input.contact_email).replace(/([%_\\])/g, '\\$1');
  const { data } = await supabaseAdmin
    .from('contacts')
    .select('id, first_name, last_name, company')
    .eq('user_id', userId)
    .ilike('email', pattern)
    .maybeSingle();
  if (data) {
    input.contact_id = data.id;
    if (!input.contact_name) {
      input.contact_name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
    }
    if (!input.company && data.company) input.company = data.company;
  }
}

export const crmService = {
  /* ── Deals ── */
  async listDeals(userId: string, filters?: { contactId?: string; contactEmail?: string }) {
    let query = supabaseAdmin.from('deals').select(DEAL_SELECT).eq('user_id', userId);
    // Scope to a specific lead (used by the contact page) — match either the
    // linked contact_id or the captured contact_email. Values are quoted so
    // emails with reserved characters can't break the filter expression.
    const quote = (v: string) => `"${v.replace(/"/g, '')}"`;
    if (filters?.contactId && filters?.contactEmail) {
      query = query.or(`contact_id.eq.${filters.contactId},contact_email.eq.${quote(filters.contactEmail)}`);
    } else if (filters?.contactId) {
      query = query.eq('contact_id', filters.contactId);
    } else if (filters?.contactEmail) {
      query = query.eq('contact_email', filters.contactEmail);
    }
    const { data, error } = await query
      .order('position', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async createDeal(userId: string, body: any) {
    if (!body.title || !String(body.title).trim()) throw new AppError('Deal title is required', 400);
    const input = pick(body, DEAL_KEYS as any);
    sanitizeDealInput(input);
    if (input.contact_id) await assertOwned(userId, 'contacts', input.contact_id, 'Contact');
    await autoLinkContact(userId, input);
    const { data, error } = await supabaseAdmin
      .from('deals')
      .insert({ ...input, user_id: userId })
      .select(DEAL_SELECT)
      .single();
    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async updateDeal(userId: string, id: string, body: any) {
    const input = pick(body, DEAL_KEYS as any);
    sanitizeDealInput(input);
    if (input.contact_id) await assertOwned(userId, 'contacts', input.contact_id, 'Contact');
    if (input.contact_email !== undefined && input.contact_id === undefined) {
      await autoLinkContact(userId, input);
    }
    const { data, error } = await supabaseAdmin
      .from('deals')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select(DEAL_SELECT)
      .single();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Deal not found', 404);
    return data;
  },

  async deleteDeal(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('deals').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  /* ── Tasks ── */
  async listTasks(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('crm_tasks')
      .select('*')
      .eq('user_id', userId)
      .order('is_done', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async createTask(userId: string, body: any) {
    if (!body.title || !String(body.title).trim()) throw new AppError('Task title is required', 400);
    const input = pick(body, TASK_KEYS as any);
    if (input.priority && !TASK_PRIORITIES.includes(input.priority)) throw new AppError('Invalid priority', 400);
    if (input.deal_id) await assertOwned(userId, 'deals', input.deal_id, 'Deal');
    const { data, error } = await supabaseAdmin
      .from('crm_tasks')
      .insert({ ...input, user_id: userId })
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async updateTask(userId: string, id: string, body: any) {
    const input = pick(body, TASK_KEYS as any);
    if (input.priority && !TASK_PRIORITIES.includes(input.priority)) throw new AppError('Invalid priority', 400);
    if (input.deal_id) await assertOwned(userId, 'deals', input.deal_id, 'Deal');
    const { data, error } = await supabaseAdmin
      .from('crm_tasks')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Task not found', 404);
    return data;
  },

  async deleteTask(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('crm_tasks').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  /* ── Events (calendar) ── */
  async listEvents(userId: string, from?: string, to?: string) {
    let query = supabaseAdmin.from('crm_events').select('*').eq('user_id', userId);
    if (from) query = query.gte('starts_at', from);
    if (to) query = query.lte('starts_at', to);
    const { data, error } = await query.order('starts_at', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async createEvent(userId: string, body: any) {
    if (!body.title || !String(body.title).trim()) throw new AppError('Event title is required', 400);
    if (!body.starts_at) throw new AppError('Event start time is required', 400);
    const input = pick(body, EVENT_KEYS as any);
    if (input.type && !EVENT_TYPES.includes(input.type)) throw new AppError('Invalid event type', 400);
    if (input.deal_id) await assertOwned(userId, 'deals', input.deal_id, 'Deal');
    const { data, error } = await supabaseAdmin
      .from('crm_events')
      .insert({ ...input, user_id: userId })
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async updateEvent(userId: string, id: string, body: any) {
    const input = pick(body, EVENT_KEYS as any);
    if (input.type && !EVENT_TYPES.includes(input.type)) throw new AppError('Invalid event type', 400);
    if (input.deal_id) await assertOwned(userId, 'deals', input.deal_id, 'Deal');
    const { data, error } = await supabaseAdmin
      .from('crm_events')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Event not found', 404);
    return data;
  },

  async deleteEvent(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('crm_events').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },
};
