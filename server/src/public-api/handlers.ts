/* ═══════════════════════════════════════════════════════════════════════
   The /v1 endpoints. One handler per endpoint id in the shared definition.

   They go through the same services the app uses, so the API cannot do
   anything the app would refuse (enrol someone suppressed, touch another
   account's rows), and everything the app does on a change - webhooks,
   integrations, lifecycle promotion, enrichment - happens here too.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  ACTIVITY_TYPES, API_LIST_KINDS, CAMPAIGN_STATUSES, CONTACT_WRITE_FIELDS, PUBLIC_API_VERSION,
  PUBLIC_EVENT_TYPES, REPLY_CHECK_CAMPAIGN_NAME, REPLY_INTENTS, SUPPRESSION_REASONS,
  type PublicEventType,
} from '@lemlist/shared';
import crypto from 'crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { contactsService } from '../services/contacts.service.js';
import { listsService } from '../services/lists.service.js';
import { campaignsService } from '../services/campaigns.service.js';
import { campaignContactsService } from '../services/campaign-contacts.service.js';
import { suppressionService } from '../services/suppression.service.js';
import { assertSafeWebhookUrl, fireEvent } from '../services/webhook.service.js';
import { chunk, selectInChunks } from '../utils/batch.js';
import {
  PublicApiError, bodyBool, bodyString, bodyStringArray, bodyUuidArray, invalid, isUuid, keyset, missing,
  notFound, onlyKeys, pageArgs, pageInMemory, pageOf, pathId, queryString, queryTime, queryUuid,
  type ApiReq, type Handler,
} from './core.js';
import {
  CONTACT_SELECT, REPLY_SELECT, activityOut, campaignOut, contactOut, enrolmentOut, lifecycleIn, listOut,
  replyOut, suppressionOut, tagOut, webhookOut,
} from './serialize.js';
import { EVENT_TYPE_LIST, deliverV1, sampleEvent } from './events.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BATCH_MAX = 1000;
const body = (req: ApiReq) => (req.body || {}) as Record<string, unknown>;

/* ── Contacts: reading the body ──────────────────────────────────────── */

const SCALAR_FIELDS = CONTACT_WRITE_FIELDS
  .filter((f) => f.type === 'string' && f.name !== 'lifecycle')
  .map((f) => f.name);
const FIELD_MAX: Record<string, number> = { email: 254, linkedin_url: 500, website: 500 };

interface ContactInput {
  fields: Record<string, string | null>;
  custom?: Record<string, string | null>;
  tags?: string[];
  listIds?: string[];
  lifecycle?: 'lead' | 'contact' | 'customer';
}

function readContact(raw: Record<string, unknown>, opts: { creating: boolean; prefix?: string; extraKeys?: string[]; noLists?: boolean }): ContactInput {
  const prefix = opts.prefix || '';
  const allowed = [...SCALAR_FIELDS, 'custom_fields', 'tags', ...(opts.noLists ? [] : ['list_ids', 'lifecycle']), ...(opts.extraKeys || [])];
  onlyKeys(raw, allowed, prefix);

  const fields: Record<string, string | null> = {};
  for (const name of SCALAR_FIELDS) {
    const v = bodyString(raw, name, { max: FIELD_MAX[name] ?? 300, prefix, required: name === 'email' && opts.creating });
    if (v === undefined) continue;
    if (name === 'email') {
      if (v === null) throw invalid(`${prefix}email`, 'email cannot be cleared.');
      const e = v.toLowerCase();
      if (!EMAIL_RE.test(e)) throw invalid(`${prefix}email`, `"${v}" is not a valid email address.`);
      fields.email = e;
    } else {
      fields[name] = v;
    }
  }

  let custom: Record<string, string | null> | undefined;
  const cf = raw.custom_fields;
  if (cf !== undefined && cf !== null && cf !== '') {
    if (typeof cf !== 'object' || Array.isArray(cf)) throw invalid(`${prefix}custom_fields`, 'custom_fields must be an object, like { "deal_size": "50k" }.');
    custom = {};
    const entries = Object.entries(cf as Record<string, unknown>);
    if (entries.length > 100) throw invalid(`${prefix}custom_fields`, 'custom_fields can hold at most 100 fields.');
    for (const [k, v] of entries) {
      const key = k.trim();
      if (!key || key.length > 100) throw invalid(`${prefix}custom_fields`, 'Each custom field needs a name of 1 to 100 characters.');
      if (v === null) { custom[key] = null; continue; }
      if (v === undefined || v === '') continue;
      if (typeof v === 'object') throw invalid(`${prefix}custom_fields.${key}`, 'Custom field values must be text, numbers or true/false.');
      const s = String(v).trim();
      if (s.length > 2000) throw invalid(`${prefix}custom_fields.${key}`, 'A custom field value can be at most 2,000 characters.');
      if (s) custom[key] = s;
    }
  }

  const tags = bodyStringArray(raw, 'tags', { max: 20, itemMax: 50, prefix })?.map((t) => t.replace(/\s+/g, ' '));
  const listIds = opts.noLists ? undefined : bodyUuidArray(raw, 'list_ids', 20);
  const lifecycle = opts.noLists ? undefined : bodyString(raw, 'lifecycle', { enum: ['lead', 'contact', 'customer'], prefix }) as ContactInput['lifecycle'] | null | undefined;
  if (lifecycle === null) throw invalid(`${prefix}lifecycle`, 'lifecycle cannot be cleared.');

  return { fields, custom, tags, listIds, lifecycle: lifecycle ?? undefined };
}

/** Tag names -> ids, creating the ones that do not exist yet. */
async function tagIdsForNames(userId: string, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const { data: existing, error } = await supabaseAdmin.from('tags').select('id, name').eq('user_id', userId);
  if (error) throw error;
  const byName = new Map((existing || []).map((t: any) => [String(t.name).toLowerCase(), t.id as string]));
  const toCreate = [...new Map(names.filter((n) => !byName.has(n.toLowerCase())).map((n) => [n.toLowerCase(), n])).values()];
  if (toCreate.length) {
    const { data: created, error: cErr } = await supabaseAdmin
      .from('tags')
      .upsert(toCreate.map((name) => ({ user_id: userId, name, color: '#6B7280' })), { onConflict: 'user_id,name', ignoreDuplicates: true })
      .select('id, name');
    if (cErr) throw cErr;
    for (const t of created || []) byName.set(String((t as any).name).toLowerCase(), (t as any).id);
    // ignoreDuplicates returns nothing for a name created concurrently: read those back.
    const still = toCreate.filter((n) => !byName.has(n.toLowerCase()));
    if (still.length) {
      const { data: again } = await supabaseAdmin.from('tags').select('id, name').eq('user_id', userId).in('name', still);
      for (const t of again || []) byName.set(String((t as any).name).toLowerCase(), (t as any).id);
    }
  }
  return [...new Set(names.map((n) => byName.get(n.toLowerCase())).filter((x): x is string => !!x))];
}

async function assertListsOwned(userId: string, ids: string[], param = 'list_ids'): Promise<void> {
  if (!ids.length) return;
  const { data, error } = await supabaseAdmin.from('contact_lists').select('id')
    .eq('user_id', userId).eq('is_trashed', false).in('id', ids);
  if (error) throw error;
  const have = new Set((data || []).map((r: any) => r.id));
  const missingId = ids.find((id) => !have.has(id));
  if (missingId) throw new PublicApiError('resource_not_found', `No such list: ${missingId}.`, param);
}

async function readContactRow(userId: string, id: string) {
  const { data, error } = await supabaseAdmin.from('contacts').select(CONTACT_SELECT).eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('contact', 'id');
  return data;
}

async function contactIdByEmail(userId: string, email: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('contacts').select('id').eq('user_id', userId).eq('email', email.toLowerCase()).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

function contactExists(id: string): PublicApiError {
  return new PublicApiError('contact_exists', 'A contact with this email already exists. Send "upsert": true to update it instead.', 'email', { existing_id: id });
}

/** Apply an update to an existing contact: the same path PATCH and upsert take. */
async function applyContactUpdate(userId: string, id: string, input: ContactInput): Promise<void> {
  const patch: Record<string, unknown> = { ...input.fields };

  if (input.custom && Object.keys(input.custom).length) {
    const { data: cur, error } = await supabaseAdmin.from('contacts').select('custom_fields').eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!cur) throw notFound('contact', 'id');
    const merged: Record<string, string> = { ...((cur as any).custom_fields || {}) };
    for (const [k, v] of Object.entries(input.custom)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    patch.custom_fields = merged;
  }

  const tagIds = input.tags ? await tagIdsForNames(userId, input.tags) : undefined;
  if (input.listIds) await assertListsOwned(userId, input.listIds);

  if (Object.keys(patch).length || tagIds) {
    try {
      await contactsService.update(userId, id, { ...patch, ...(tagIds ? { tag_ids: tagIds } : {}) });
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 409 && patch.email) {
        const other = await contactIdByEmail(userId, String(patch.email));
        throw contactExists(other || '');
      }
      throw err;
    }
  }
  if (input.lifecycle) await contactsService.setLifecycle(userId, [id], lifecycleIn(input.lifecycle));
  for (const listId of input.listIds || []) await listsService.addContacts(userId, listId, [id]);
}

async function createContact(userId: string, input: ContactInput): Promise<string> {
  if (input.listIds) await assertListsOwned(userId, input.listIds);
  const tagIds = input.tags ? await tagIdsForNames(userId, input.tags) : [];
  const custom = Object.fromEntries(Object.entries(input.custom || {}).filter(([, v]) => v !== null)) as Record<string, string>;
  const fields = Object.fromEntries(Object.entries(input.fields).filter(([, v]) => v !== null));
  const created = await contactsService.create(
    userId,
    { ...fields, ...(Object.keys(custom).length ? { custom_fields: custom } : {}), tag_ids: tagIds },
    { source: 'api', lifecycle: lifecycleIn(input.lifecycle || 'lead') },
  );
  for (const listId of input.listIds || []) await listsService.addContacts(userId, listId, [created.id]);
  return created.id;
}

/* ── Contacts ────────────────────────────────────────────────────────── */

const contactsList: Handler = async (req) => {
  const email = queryString(req, 'email', { max: 254 });
  const lifecycle = queryString(req, 'lifecycle', { enum: ['lead', 'contact', 'customer'] });
  const listId = queryUuid(req, 'list_id');
  const tag = queryString(req, 'tag', { max: 50 });
  const search = queryString(req, 'q', { max: 100 });
  const createdAfter = queryTime(req, 'created_after');
  const updatedAfter = queryTime(req, 'updated_after');
  const sort = updatedAfter ? 'updated_at' : 'created_at';
  const page = pageArgs(req, sort);

  let select = CONTACT_SELECT;
  if (listId) select += ', in_list:list_contacts!inner(list_id)';
  let tagId: string | null = null;
  if (tag) {
    const { data } = await supabaseAdmin.from('tags').select('id').eq('user_id', req.userId).ilike('name', tag.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(1).maybeSingle();
    if (!data) return { body: { object: 'list', data: [], has_more: false, next_cursor: null } };
    tagId = data.id;
    select += ', has_tag:contact_tags!inner(tag_id)';
  }

  let query: any = supabaseAdmin.from('contacts').select(select).eq('user_id', req.userId);
  if (email) query = query.eq('email', email.toLowerCase());
  if (lifecycle) query = query.eq('lifecycle', lifecycleIn(lifecycle));
  if (listId) query = query.eq('in_list.list_id', listId);
  if (tagId) query = query.eq('has_tag.tag_id', tagId);
  if (createdAfter) query = query.gt('created_at', createdAfter);
  if (updatedAfter) query = query.gt('updated_at', updatedAfter);
  if (search) {
    const term = search.replace(/[%_\\,()"]/g, ' ').trim();
    if (term) {
      // Each word must match somewhere, so "ada analytical" finds Ada at Analytical Engines.
      for (const word of term.split(/\s+/).slice(0, 4)) {
        query = query.or(`email.ilike.%${word}%,first_name.ilike.%${word}%,last_name.ilike.%${word}%,company.ilike.%${word}%`);
      }
    }
  }
  const { data, error } = await keyset(query, sort, page);
  if (error) throw error;
  return { body: pageOf(data || [], sort, page, contactOut) };
};

const contactsCreate: Handler = async (req) => {
  const b = body(req);
  const input = readContact(b, { creating: true, extraKeys: ['upsert'] });
  const upsert = bodyBool(b, 'upsert') === true;
  const email = input.fields.email!;

  const existing = await contactIdByEmail(req.userId, email);
  if (existing) {
    if (!upsert) throw contactExists(existing);
    await applyContactUpdate(req.userId, existing, input);
    return { status: 200, body: contactOut(await readContactRow(req.userId, existing)) };
  }
  try {
    const id = await createContact(req.userId, input);
    return { status: 201, body: contactOut(await readContactRow(req.userId, id)) };
  } catch (err) {
    // Two requests for one new address at once: the loser updates (or reports) the winner's row.
    if (err instanceof AppError && err.statusCode === 409) {
      const raced = await contactIdByEmail(req.userId, email);
      if (raced && upsert) {
        await applyContactUpdate(req.userId, raced, input);
        return { status: 200, body: contactOut(await readContactRow(req.userId, raced)) };
      }
      if (raced) throw contactExists(raced);
    }
    throw err;
  }
};

const contactsBulk: Handler = async (req) => {
  const b = body(req);
  onlyKeys(b, ['contacts', 'list_id', 'on_conflict']);
  if (b.contacts === undefined || b.contacts === null) throw missing('contacts');
  if (!Array.isArray(b.contacts)) throw invalid('contacts', 'contacts must be a list of contact objects.');
  if (b.contacts.length === 0) throw invalid('contacts', 'contacts is empty.');
  if (b.contacts.length > BATCH_MAX) throw invalid('contacts', `Send at most ${BATCH_MAX.toLocaleString('en-GB')} contacts per request.`);
  const listId = bodyString(b, 'list_id') ?? undefined;
  if (listId && !isUuid(listId)) throw invalid('list_id', 'list_id is not a valid id.');
  if (listId) await assertListsOwned(req.userId, [listId], 'list_id');
  const mode = (bodyString(b, 'on_conflict', { enum: ['fill', 'overwrite', 'skip'] }) || 'fill') as 'fill' | 'overwrite' | 'skip';

  const rows = b.contacts.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid(`contacts[${i}]`, `contacts[${i}] must be an object.`);
    const input = readContact(raw as Record<string, unknown>, { creating: true, prefix: `contacts[${i}].`, noLists: true });
    const fields = Object.fromEntries(Object.entries(input.fields).filter(([, v]) => v !== null));
    const custom = Object.fromEntries(Object.entries(input.custom || {}).filter(([, v]) => v !== null));
    return { ...fields, ...(Object.keys(custom).length ? { custom_fields: custom } : {}), ...(input.tags ? { tags: input.tags } : {}) };
  });

  const result = await contactsService.bulkCreate(req.userId, rows, listId, 'API', undefined, { mode });
  const errors = (result.error_details || []).map((e) => ({ email: e.email, reason: e.reason }));
  return {
    body: {
      object: 'bulk_result',
      total: result.total,
      created: result.created ?? 0,
      updated: result.updated ?? Math.max(0, result.imported - (result.created ?? 0)),
      failed: result.errors,
      created_ids: result.created_ids || [],
      errors,
    },
  };
};

const contactsGet: Handler = async (req) => ({ body: contactOut(await readContactRow(req.userId, pathId(req, 'id', 'contact'))) });

const contactsUpdate: Handler = async (req) => {
  const id = pathId(req, 'id', 'contact');
  const input = readContact(body(req), { creating: false });
  const nothing = !Object.keys(input.fields).length && !input.custom && !input.tags && !input.listIds && !input.lifecycle;
  await readContactRow(req.userId, id);
  if (!nothing) await applyContactUpdate(req.userId, id, input);
  return { body: contactOut(await readContactRow(req.userId, id)) };
};

const contactsDelete: Handler = async (req) => {
  const id = pathId(req, 'id', 'contact');
  await readContactRow(req.userId, id);
  await contactsService.delete(req.userId, id);
  return { body: { object: 'contact', id, deleted: true } };
};

const contactsUnsubscribe: Handler = async (req) => {
  const id = pathId(req, 'id', 'contact');
  const row = await readContactRow(req.userId, id);
  const already = !!(row as any).is_unsubscribed;

  const { error } = await supabaseAdmin.from('contacts').update({ is_unsubscribed: true }).eq('id', id).eq('user_id', req.userId);
  if (error) throw error;

  // Stop every sequence they are in, as the unsubscribe link does.
  const { data: live, error: liveErr } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id, campaign_id, campaigns!inner(user_id)')
    .eq('contact_id', id).eq('campaigns.user_id', req.userId)
    .in('status', ['pending', 'active', 'paused']);
  if (liveErr) throw liveErr;
  for (const slice of chunk((live || []).map((r: any) => r.id))) {
    const { error: stopErr } = await supabaseAdmin.from('campaign_contacts').update({ status: 'unsubscribed', next_send_at: null }).in('id', slice);
    if (stopErr) throw stopErr;
  }
  await suppressionService.add(req.userId, (row as any).email, 'unsubscribed', 'Unsubscribed through the API');
  if (!already) fireEvent(req.userId, 'lead.unsubscribed', { contact_id: id, source: 'api' }).catch(() => {});
  return { body: contactOut(await readContactRow(req.userId, id)) };
};

const contactsActivities: Handler = async (req) => {
  const id = pathId(req, 'id', 'contact');
  await readContactRow(req.userId, id);
  const type = queryString(req, 'type', { enum: ACTIVITY_TYPES });
  const page = pageArgs(req, 'occurred_at');
  let query: any = supabaseAdmin.from('campaign_activities')
    .select('id, activity_type, contact_id, campaign_id, step_id, occurred_at, metadata, campaigns!inner(user_id)')
    .eq('campaigns.user_id', req.userId).eq('contact_id', id);
  if (type) query = query.eq('activity_type', type);
  const { data, error } = await keyset(query, 'occurred_at', page);
  if (error) throw error;
  return { body: pageOf(data || [], 'occurred_at', page, activityOut) };
};

/* ── Lists ───────────────────────────────────────────────────────────── */

const listsList: Handler = async (req) => {
  const kind = queryString(req, 'kind', { enum: API_LIST_KINDS }) as 'lead' | 'contact' | undefined;
  const page = pageArgs(req, 'created_at');
  const all = await listsService.list(req.userId, kind);
  return { body: pageInMemory(all as any[], 'created_at', page, listOut) };
};

const listsCreate: Handler = async (req) => {
  const b = body(req);
  onlyKeys(b, ['name', 'description', 'kind']);
  const name = bodyString(b, 'name', { required: true, max: 100 })!;
  const description = bodyString(b, 'description', { max: 500 }) ?? undefined;
  const kind = (bodyString(b, 'kind', { enum: API_LIST_KINDS }) || 'lead') as 'lead' | 'contact';
  try {
    const list = await listsService.create(req.userId, { name, description: description || undefined, kind });
    return { status: 201, body: listOut(list) };
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) throw new PublicApiError('list_exists', `You already have a list called "${name}".`, 'name');
    throw err;
  }
};

const listsGet: Handler = async (req) => ({ body: listOut(await listsService.get(req.userId, pathId(req, 'id', 'list'))) });

const listsUpdate: Handler = async (req) => {
  const id = pathId(req, 'id', 'list');
  const b = body(req);
  onlyKeys(b, ['name', 'description']);
  const name = bodyString(b, 'name', { max: 100 });
  if (name === null) throw invalid('name', 'name cannot be cleared.');
  const description = bodyString(b, 'description', { max: 500 });
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (Object.keys(patch).length) {
    try {
      await listsService.update(req.userId, id, patch);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 409) throw new PublicApiError('list_exists', `You already have a list called "${name}".`, 'name');
      throw err;
    }
  }
  return { body: listOut(await listsService.get(req.userId, id)) };
};

const listsDelete: Handler = async (req) => {
  const id = pathId(req, 'id', 'list');
  await listsService.delete(req.userId, id);
  return { body: { object: 'list', id, deleted: true } };
};

const listsContacts: Handler = async (req) => {
  const id = pathId(req, 'id', 'list');
  await listsService.get(req.userId, id);
  const page = pageArgs(req, 'created_at');
  const select = `${CONTACT_SELECT}, in_list:list_contacts!inner(list_id)`;
  const query = supabaseAdmin.from('contacts').select(select)
    .eq('user_id', req.userId).eq('in_list.list_id', id);
  const { data, error } = await keyset(query as any, 'created_at', page);
  if (error) throw error;
  return { body: pageOf(data || [], 'created_at', page, contactOut) };
};

/** contact_ids and/or emails -> owned contact ids, creating contacts for new emails when asked. */
async function resolveContacts(userId: string, b: Record<string, unknown>, opts: { createMissing: boolean }) {
  const ids = bodyUuidArray(b, 'contact_ids', BATCH_MAX) || [];
  const emails = (bodyStringArray(b, 'emails', { max: BATCH_MAX, itemMax: 254 }) || []).map((e) => e.toLowerCase());
  const invalidEmails = emails.filter((e) => !EMAIL_RE.test(e));
  const goodEmails = emails.filter((e) => EMAIL_RE.test(e));

  const owned = ids.length
    ? (await selectInChunks(ids, (slice) => supabaseAdmin.from('contacts').select('id').eq('user_id', userId).in('id', slice))).map((r: any) => r.id as string)
    : [];
  const notFoundIds = ids.filter((id) => !owned.includes(id));

  let createdContacts = 0;
  let found: { id: string; email: string }[] = [];
  if (goodEmails.length) {
    found = (await selectInChunks(goodEmails, (slice) => supabaseAdmin.from('contacts').select('id, email').eq('user_id', userId).in('email', slice))) as any[];
    const have = new Set(found.map((r) => r.email));
    const missingEmails = goodEmails.filter((e) => !have.has(e));
    if (missingEmails.length && opts.createMissing) {
      const result = await contactsService.bulkCreate(userId, missingEmails.map((email) => ({ email })), undefined, 'API');
      createdContacts = result.created ?? 0;
      const more = (await selectInChunks(missingEmails, (slice) => supabaseAdmin.from('contacts').select('id, email').eq('user_id', userId).in('email', slice))) as any[];
      found = found.concat(more);
    }
  }
  const foundEmails = new Set(found.map((r) => r.email));
  return {
    ids: [...new Set([...owned, ...found.map((r) => r.id)])],
    notFound: [...notFoundIds, ...goodEmails.filter((e) => !foundEmails.has(e))],
    invalidEmails,
    createdContacts,
  };
}

const listsAdd: Handler = async (req) => {
  const id = pathId(req, 'id', 'list');
  const b = body(req);
  onlyKeys(b, ['contact_ids', 'emails']);
  if (b.contact_ids === undefined && b.emails === undefined) throw missing('contact_ids', 'Send contact_ids or emails.');
  await listsService.get(req.userId, id);
  const r = await resolveContacts(req.userId, b, { createMissing: true });

  let already = 0;
  if (r.ids.length) {
    const there = await selectInChunks(r.ids, (slice) => supabaseAdmin.from('list_contacts').select('contact_id').eq('list_id', id).in('contact_id', slice));
    already = there.length;
  }
  const res = r.ids.length ? await listsService.addContacts(req.userId, id, r.ids) : { success: 0, failed: 0 };
  return {
    body: {
      object: 'list_change', list_id: id,
      added: Math.max(0, res.success - already), already_there: already, created_contacts: r.createdContacts,
      not_found: r.notFound, invalid_emails: r.invalidEmails,
    },
  };
};

const listsRemove: Handler = async (req) => {
  const id = pathId(req, 'id', 'list');
  const contactId = pathId(req, 'contact_id', 'contact');
  const res = await listsService.removeContacts(req.userId, id, [contactId]);
  return { body: { object: 'list_change', list_id: id, removed: res.success } };
};

/* ── Campaigns ───────────────────────────────────────────────────────── */

async function ownedCampaign(userId: string, id: string) {
  const { data, error } = await supabaseAdmin.from('campaigns').select('id, name, status, list_id, created_at, updated_at')
    .eq('id', id).eq('user_id', userId).neq('name', REPLY_CHECK_CAMPAIGN_NAME).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('campaign', 'id');
  return data;
}

const campaignsList: Handler = async (req) => {
  const status = queryString(req, 'status', { enum: CAMPAIGN_STATUSES });
  const page = pageArgs(req, 'created_at');
  let query: any = supabaseAdmin.from('campaigns').select('id, name, status, list_id, created_at, updated_at')
    .eq('user_id', req.userId).neq('name', REPLY_CHECK_CAMPAIGN_NAME);
  if (status) query = query.eq('status', status);
  const { data, error } = await keyset(query, 'created_at', page);
  if (error) throw error;
  return { body: pageOf(data || [], 'created_at', page, (r) => campaignOut(r)) };
};

const campaignsGet: Handler = async (req) => {
  const c = await ownedCampaign(req.userId, pathId(req, 'id', 'campaign'));
  return { body: campaignOut(c, await campaignsService.getStats(c.id)) };
};

const campaignsContacts: Handler = async (req) => {
  const c = await ownedCampaign(req.userId, pathId(req, 'id', 'campaign'));
  const status = queryString(req, 'status', { max: 30 });
  const page = pageArgs(req, 'created_at');
  let query: any = supabaseAdmin.from('campaign_contacts')
    .select('id, campaign_id, contact_id, status, current_step_order, next_send_at, completed_at, created_at, contacts(email)')
    .eq('campaign_id', c.id);
  if (status) query = query.eq('status', status);
  const { data, error } = await keyset(query, 'created_at', page);
  if (error) throw error;
  return { body: pageOf(data || [], 'created_at', page, enrolmentOut) };
};

const campaignsEnrol: Handler = async (req) => {
  const c = await ownedCampaign(req.userId, pathId(req, 'id', 'campaign'));
  const b = body(req);
  onlyKeys(b, ['contact_ids', 'emails', 'contacts']);
  if (b.contact_ids === undefined && b.emails === undefined && b.contacts === undefined) {
    throw missing('contact_ids', 'Send contact_ids, emails or contacts.');
  }
  if (c.status === 'completed' || c.status === 'cancelled') {
    throw new PublicApiError('campaign_finished', 'This campaign has finished, so nobody can be added to it.');
  }

  let createdContacts = 0;
  const extraEmails: string[] = [];
  if (b.contacts !== undefined && b.contacts !== null) {
    if (!Array.isArray(b.contacts)) throw invalid('contacts', 'contacts must be a list of contact objects.');
    if (b.contacts.length > BATCH_MAX) throw invalid('contacts', `Send at most ${BATCH_MAX.toLocaleString('en-GB')} contacts per request.`);
    const rows = b.contacts.map((raw, i) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid(`contacts[${i}]`, `contacts[${i}] must be an object.`);
      const input = readContact(raw as Record<string, unknown>, { creating: true, prefix: `contacts[${i}].`, noLists: true });
      const fields = Object.fromEntries(Object.entries(input.fields).filter(([, v]) => v !== null));
      const custom = Object.fromEntries(Object.entries(input.custom || {}).filter(([, v]) => v !== null));
      return { ...fields, ...(Object.keys(custom).length ? { custom_fields: custom } : {}), ...(input.tags ? { tags: input.tags } : {}) };
    });
    if (rows.length) {
      const result = await contactsService.bulkCreate(req.userId, rows, undefined, 'API', undefined, { mode: 'fill' });
      createdContacts = result.created ?? 0;
      extraEmails.push(...rows.map((r: any) => String(r.email)));
    }
  }
  const emails = [...(bodyStringArray(b, 'emails', { max: BATCH_MAX, itemMax: 254 }) || []), ...extraEmails];
  const r = await resolveContacts(req.userId, { contact_ids: b.contact_ids, emails }, { createMissing: false });
  if (r.ids.length > BATCH_MAX) throw invalid('contacts', `Add at most ${BATCH_MAX.toLocaleString('en-GB')} people per request.`);

  if (!r.ids.length) {
    return {
      body: {
        object: 'enrolment_result', campaign_id: c.id, added: 0, skipped: 0, total: null, reasons: {}, skips: [],
        not_found: r.notFound, invalid_emails: r.invalidEmails, created_contacts: createdContacts,
      },
    };
  }
  let result;
  try {
    result = await campaignContactsService.enroll(c.id, r.ids);
  } catch (err) {
    if (err instanceof AppError && /finished/i.test(err.message)) throw new PublicApiError('campaign_finished', 'This campaign has finished, so nobody can be added to it.');
    throw err;
  }
  return {
    body: {
      object: 'enrolment_result', campaign_id: c.id, added: result.added, skipped: result.skipped, total: result.total,
      reasons: result.reasons, skips: result.skips, not_found: r.notFound, invalid_emails: r.invalidEmails, created_contacts: createdContacts,
    },
  };
};

const campaignsUnenrol: Handler = async (req) => {
  const c = await ownedCampaign(req.userId, pathId(req, 'id', 'campaign'));
  const contactId = pathId(req, 'contact_id', 'contact');
  const { data, error } = await supabaseAdmin.from('campaign_contacts').select('id').eq('campaign_id', c.id).eq('contact_id', contactId).maybeSingle();
  if (error) throw error;
  if (!data) throw new PublicApiError('resource_not_found', 'That contact is not in this campaign.', 'contact_id');
  await campaignContactsService.remove(c.id, [contactId]);
  return { body: { object: 'enrolment', campaign_id: c.id, contact_id: contactId, deleted: true } };
};

function campaignStateError(err: unknown): never {
  if (err instanceof AppError && err.statusCode === 400) throw new PublicApiError('campaign_state', err.message);
  throw err;
}

const campaignsPause: Handler = async (req) => {
  const c = await ownedCampaign(req.userId, pathId(req, 'id', 'campaign'));
  if (c.status === 'paused') return { body: campaignOut(c, await campaignsService.getStats(c.id)) };
  const row = await campaignsService.pause(req.userId, c.id).catch(campaignStateError);
  return { body: campaignOut(row, await campaignsService.getStats(c.id)) };
};

const campaignsResume: Handler = async (req) => {
  const c = await ownedCampaign(req.userId, pathId(req, 'id', 'campaign'));
  if (c.status === 'running') return { body: campaignOut(c, await campaignsService.getStats(c.id)) };
  const row = await campaignsService.resume(req.userId, c.id).catch(campaignStateError);
  return { body: campaignOut(row, await campaignsService.getStats(c.id)) };
};

/* ── Tags, activity, replies ─────────────────────────────────────────── */

const tagsList: Handler = async (req) => {
  const page = pageArgs(req, 'created_at');
  const { data, error } = await keyset(supabaseAdmin.from('tags').select('id, name, color, created_at').eq('user_id', req.userId) as any, 'created_at', page);
  if (error) throw error;
  return { body: pageOf(data || [], 'created_at', page, tagOut) };
};

const activitiesList: Handler = async (req) => {
  const type = queryString(req, 'type', { enum: ACTIVITY_TYPES });
  const campaignId = queryUuid(req, 'campaign_id');
  const contactId = queryUuid(req, 'contact_id');
  const after = queryTime(req, 'after');
  const page = pageArgs(req, 'occurred_at');
  let query: any = supabaseAdmin.from('campaign_activities')
    .select('id, activity_type, contact_id, campaign_id, step_id, occurred_at, metadata, campaigns!inner(user_id)')
    .eq('campaigns.user_id', req.userId);
  if (type) query = query.eq('activity_type', type);
  if (campaignId) query = query.eq('campaign_id', campaignId);
  if (contactId) query = query.eq('contact_id', contactId);
  if (after) query = query.gt('occurred_at', after);
  const { data, error } = await keyset(query, 'occurred_at', page);
  if (error) throw error;
  return { body: pageOf(data || [], 'occurred_at', page, activityOut) };
};

const repliesList: Handler = async (req) => {
  const intent = queryString(req, 'intent', { enum: REPLY_INTENTS });
  const campaignId = queryUuid(req, 'campaign_id');
  const contactId = queryUuid(req, 'contact_id');
  const after = queryTime(req, 'after');
  const page = pageArgs(req, 'received_at');
  let query: any = supabaseAdmin.from('inbox_messages').select(REPLY_SELECT)
    .eq('user_id', req.userId).eq('direction', 'inbound').not('contact_id', 'is', null);
  if (intent) query = query.eq('sara_intent', intent);
  if (campaignId) query = query.eq('campaign_id', campaignId);
  if (contactId) query = query.eq('contact_id', contactId);
  if (after) query = query.gt('received_at', after);
  const { data, error } = await keyset(query, 'received_at', page);
  if (error) throw error;
  return { body: pageOf(data || [], 'received_at', page, replyOut) };
};

/* ── Suppressions ────────────────────────────────────────────────────── */

const suppressionsList: Handler = async (req) => {
  const reason = queryString(req, 'reason', { enum: SUPPRESSION_REASONS });
  const page = pageArgs(req, 'created_at');
  let query: any = supabaseAdmin.from('suppression_list').select('id, email, reason, created_at').eq('user_id', req.userId);
  if (reason) query = query.eq('reason', reason);
  const { data, error } = await keyset(query, 'created_at', page);
  if (error) throw error;
  return { body: pageOf(data || [], 'created_at', page, suppressionOut) };
};

const suppressionsCreate: Handler = async (req) => {
  const b = body(req);
  onlyKeys(b, ['emails']);
  const emails = (bodyStringArray(b, 'emails', { max: BATCH_MAX, itemMax: 254 }) || []).map((e) => e.toLowerCase());
  if (!emails.length) throw missing('emails');
  const bad = emails.filter((e) => !EMAIL_RE.test(e));
  const good = [...new Set(emails.filter((e) => EMAIL_RE.test(e)))];
  const there = good.length
    ? new Set((await selectInChunks(good, (slice) => supabaseAdmin.from('suppression_list').select('email').eq('user_id', req.userId).in('email', slice))).map((r: any) => String(r.email)))
    : new Set<string>();
  const fresh = good.filter((e) => !there.has(e));
  // Only new ones: an existing entry keeps its reason (an unsubscribe stays an unsubscribe).
  if (fresh.length) await suppressionService.addBulk(req.userId, fresh, 'manual');
  return { status: 201, body: { object: 'suppression_result', added: fresh.length, already_suppressed: there.size, invalid: bad } };
};

const suppressionsDelete: Handler = async (req) => {
  let email: string;
  try { email = decodeURIComponent(String(req.params.email || '')).trim().toLowerCase(); } catch { throw invalid('email', 'The address in the path is not URL-encoded correctly.'); }
  if (!EMAIL_RE.test(email)) throw invalid('email', 'That is not an email address.');
  const { data, error } = await supabaseAdmin.from('suppression_list').select('id').eq('user_id', req.userId).eq('email', email).maybeSingle();
  if (error) throw error;
  if (!data) throw new PublicApiError('resource_not_found', 'That address is not suppressed.', 'email');
  await suppressionService.remove(req.userId, email);
  return { body: { object: 'suppression', email, deleted: true } };
};

/* ── Webhooks ────────────────────────────────────────────────────────── */

const SOURCES = ['api', 'zapier', 'make', 'n8n'] as const;

/** Which tool is calling, from its User-Agent, so the app can say "made by Zapier". */
function sourceOf(req: ApiReq): (typeof SOURCES)[number] {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('zapier')) return 'zapier';
  if (ua.includes('make') || ua.includes('integromat')) return 'make';
  if (ua.includes('n8n')) return 'n8n';
  return 'api';
}

async function ownedWebhook(userId: string, id: string) {
  const { data, error } = await supabaseAdmin.from('webhook_endpoints').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data || (data as any).format !== 'v1') throw notFound('webhook', 'id');
  return data as any;
}

function readEvents(b: Record<string, unknown>, required: boolean): PublicEventType[] | undefined {
  const events = bodyStringArray(b, 'events', { max: PUBLIC_EVENT_TYPES.length });
  if (!events || !events.length) {
    if (required) throw missing('events', 'events is required: the event types to send, like ["reply.interested"].');
    return undefined;
  }
  const bad = events.find((e) => !PUBLIC_EVENT_TYPES.includes(e as PublicEventType));
  if (bad) throw invalid('events', `"${bad}" is not an event type. See GET /v1/events/types.`);
  return events as PublicEventType[];
}

async function readUrl(b: Record<string, unknown>, required: boolean): Promise<string | undefined> {
  const url = bodyString(b, 'url', { required, max: 2000 });
  if (url === null) throw invalid('url', 'url cannot be cleared.');
  if (url === undefined) return undefined;
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw invalid('url', 'url is not a valid URL.'); }
  if (parsed.protocol !== 'https:') throw invalid('url', 'url must start with https://.');
  try {
    await assertSafeWebhookUrl(url);
  } catch (err) {
    throw invalid('url', err instanceof Error ? err.message : 'That URL cannot be used.');
  }
  return url;
}

const webhooksList: Handler = async (req) => {
  const page = pageArgs(req, 'created_at');
  const { data, error } = await keyset(
    supabaseAdmin.from('webhook_endpoints').select('*').eq('user_id', req.userId).eq('format', 'v1') as any, 'created_at', page);
  if (error) throw error;
  return { body: pageOf(data || [], 'created_at', page, (r) => webhookOut(r)) };
};

const webhooksCreate: Handler = async (req) => {
  const b = body(req);
  onlyKeys(b, ['url', 'events', 'description']);
  const events = readEvents(b, true)!;
  const url = (await readUrl(b, true))!;
  const description = bodyString(b, 'description', { max: 200 }) ?? null;
  const { count } = await supabaseAdmin.from('webhook_endpoints').select('id', { count: 'exact', head: true }).eq('user_id', req.userId).eq('format', 'v1');
  if ((count || 0) >= 100) throw invalid('url', 'This account already has 100 API webhooks. Delete some you no longer use.');
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const { data, error } = await supabaseAdmin.from('webhook_endpoints').insert({
    user_id: req.userId, url, events, label: description || 'API webhook', secret, is_active: true, format: 'v1', source: sourceOf(req),
  }).select('*').single();
  if (error) throw error;
  return { status: 201, body: webhookOut(data, secret) };
};

const webhooksGet: Handler = async (req) => ({ body: webhookOut(await ownedWebhook(req.userId, pathId(req, 'id', 'webhook'))) });

const webhooksUpdate: Handler = async (req) => {
  const id = pathId(req, 'id', 'webhook');
  await ownedWebhook(req.userId, id);
  const b = body(req);
  onlyKeys(b, ['url', 'events', 'description', 'active']);
  const patch: Record<string, unknown> = {};
  const events = readEvents(b, false);
  if (events) patch.events = events;
  const url = await readUrl(b, false);
  if (url) patch.url = url;
  const description = bodyString(b, 'description', { max: 200 });
  if (description !== undefined) patch.label = description || 'API webhook';
  const active = bodyBool(b, 'active');
  if (active !== undefined) patch.is_active = active;
  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin.from('webhook_endpoints').update(patch).eq('id', id).eq('user_id', req.userId);
    if (error) throw error;
  }
  return { body: webhookOut(await ownedWebhook(req.userId, id)) };
};

const webhooksDelete: Handler = async (req) => {
  const id = pathId(req, 'id', 'webhook');
  await ownedWebhook(req.userId, id);
  const { error } = await supabaseAdmin.from('webhook_endpoints').delete().eq('id', id).eq('user_id', req.userId);
  if (error) throw error;
  return { body: { object: 'webhook', id, deleted: true } };
};

const webhooksTest: Handler = async (req) => {
  const id = pathId(req, 'id', 'webhook');
  const hook = await ownedWebhook(req.userId, id);
  const b = body(req);
  onlyKeys(b, ['type']);
  const type = (bodyString(b, 'type', { enum: PUBLIC_EVENT_TYPES }) || (hook.events || [])[0] || 'reply.interested') as PublicEventType;
  const event = await sampleEvent(req.userId, type);
  const out = await deliverV1(hook, event, { retries: false });
  return { body: { object: 'webhook_test', event_id: event.id, type, delivered: out.delivered, status: out.status, duration_ms: out.duration_ms, response: out.response.slice(0, 500) } };
};

/* ── Account and events ──────────────────────────────────────────────── */

const meGet: Handler = async (req) => {
  const { data } = await supabaseAdmin.from('api_keys').select('id, name, scopes, rate_limit').eq('id', req.apiKeyId).maybeSingle();
  return {
    body: {
      object: 'account',
      user_id: req.userId,
      email: req.userEmail,
      api_key: { id: req.apiKeyId, name: (data as any)?.name ?? null, scopes: req.apiKeyScopes, rate_limit_per_minute: req.apiKeyRateLimit },
      api_version: PUBLIC_API_VERSION,
    },
  };
};

const eventsList: Handler = async () => ({ body: { object: 'list', data: EVENT_TYPE_LIST, has_more: false, next_cursor: null } });

const eventsSample: Handler = async (req) => {
  const type = String(req.params.type || '');
  if (!PUBLIC_EVENT_TYPES.includes(type as PublicEventType)) throw new PublicApiError('resource_not_found', `"${type}" is not an event type. See GET /v1/events/types.`, 'type');
  return { body: await sampleEvent(req.userId, type as PublicEventType) };
};

export const HANDLERS: Record<string, Handler> = {
  'me.get': meGet,
  'events.list': eventsList,
  'events.sample': eventsSample,
  'contacts.list': contactsList,
  'contacts.create': contactsCreate,
  'contacts.bulk': contactsBulk,
  'contacts.get': contactsGet,
  'contacts.update': contactsUpdate,
  'contacts.delete': contactsDelete,
  'contacts.unsubscribe': contactsUnsubscribe,
  'contacts.activities': contactsActivities,
  'lists.list': listsList,
  'lists.create': listsCreate,
  'lists.get': listsGet,
  'lists.update': listsUpdate,
  'lists.delete': listsDelete,
  'lists.contacts': listsContacts,
  'lists.add': listsAdd,
  'lists.remove': listsRemove,
  'campaigns.list': campaignsList,
  'campaigns.get': campaignsGet,
  'campaigns.contacts': campaignsContacts,
  'campaigns.enrol': campaignsEnrol,
  'campaigns.unenrol': campaignsUnenrol,
  'campaigns.pause': campaignsPause,
  'campaigns.resume': campaignsResume,
  'tags.list': tagsList,
  'activities.list': activitiesList,
  'replies.list': repliesList,
  'suppressions.list': suppressionsList,
  'suppressions.create': suppressionsCreate,
  'suppressions.delete': suppressionsDelete,
  'webhooks.list': webhooksList,
  'webhooks.create': webhooksCreate,
  'webhooks.get': webhooksGet,
  'webhooks.update': webhooksUpdate,
  'webhooks.delete': webhooksDelete,
  'webhooks.test': webhooksTest,
};
