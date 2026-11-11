/* ═══════════════════════════════════════════════════════════════════════
   Two-way CRM sync: HubSpot and Pipedrive (migration 118).

   Sincerely -> CRM, as things happen (the event bus calls handleCrmEvent):
     - a person is created in the CRM when they reply (or, if chosen, when
       the first email goes out), with the mapped fields;
     - every email sent, open, click, reply, Relay's read of the reply,
       bounce and unsubscribe goes on their CRM timeline;
     - an interested or meeting reply opens a deal in the chosen pipeline
       and stage;
     - an unsubscribe opts them out of email in the CRM.

   Both ways, on a schedule (runCrmSync, every 2 minutes and on "Sync now"):
     - people edited in the CRM since the last run are read back; people
       edited in Sincerely since the last run are written out. Each linked
       person keeps a snapshot of the mapped values both sides last agreed
       on: the side that differs from it was edited, and when both were,
       the most recent edit wins;
     - an opt-out or hard bounce recorded in the CRM unsubscribes or stops
       the person here;
     - a deal marked won or lost ends the person's sequences (if chosen);
     - each HubSpot list or Pipedrive filter chosen is pulled into its
       Sincerely list (new people added, nobody removed);
     - failures that can be sent again are retried a few times on their own.

   Everything moved, and every failure with its reason, goes in
   crm_sync_log for the status page, where a failure can be retried.

   Nobody is ever deleted on either side, and the CRM is only read for
   people already in Sincerely or in a list someone chose to pull.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { ensureFreshHubspotToken } from './integrations-oauth.service.js';
import { contactsService } from './contacts.service.js';
import { listsService } from './lists.service.js';
import { unsubscribeContact, markContactBounced } from './optout.service.js';
import { fireEvent } from './webhook.service.js';
import { chunk } from '../utils/batch.js';
import { campaignContactsService } from './campaign-contacts.service.js';
import { hubspotAdapter } from './crm-sync/hubspot.js';
import { pipedriveAdapter } from './crm-sync/pipedrive.js';
import { CrmHttpError } from './crm-sync/http.js';
import type { CrmAdapter, CrmActivity, CrmActivityKind, CrmPerson, CrmAccount } from './crm-sync/types.js';
import { recordUrl } from './crm-sync/types.js';
import {
  MANUAL_PAUSE_PREFIX,
  emailDomain,
  isFreeMailDomain,
  isCrmSyncProvider,
  sanitizeCrmSyncSettings,
  type CrmFieldMap,
  type CrmListSync,
  type CrmSyncKind,
  type CrmSyncLogEntry,
  type CrmSyncOptions,
  type CrmSyncOverview,
  type CrmSyncProvider,
  type CrmSyncSettings,
  type CrmBackfillInput,
  type CrmContactStatus,
} from '@lemlist/shared';

// ── Constants ─────────────────────────────────────────────────────

export const CRM_SYNC_EVERY_MS = 2 * 60 * 1000;
const LIST_SYNC_EVERY_MS = 6 * 60 * 60 * 1000;
const LOG_KEEP_DAYS = 30;
const AUTO_RETRY_MAX_ATTEMPTS = 4;
const AUTO_RETRY_PER_RUN = 20;
const OUTBOUND_PER_RUN = 500;
const LIST_PAGES_PER_RUN = 20;
const IMPORT_BATCH = 500;

const MISSING = /crm_links|crm_sync_log|crm_list_syncs|sync_settings|sync_cursors|last_sync|next_sync|schema cache|PGRST20[0-5]|42P01|42703/i;
const isMissing = (e: any) => !!e && MISSING.test(`${e.message || ''} ${e.code || ''}`);
const NEEDS_MIGRATION = 'Two-way CRM sync needs the latest database update (migration 118).';

const CONTACT_FIELDS =
  'id, email, first_name, last_name, company, job_title, phone, website, linkedin_url, city, state, country, industry, custom_fields, is_unsubscribed, is_bounced, updated_at';

const POSITIVE_INTENTS = new Set(['interested', 'meeting']);

// ── Types ─────────────────────────────────────────────────────────

interface IntegrationRow {
  id: string;
  user_id: string;
  provider: string;
  config: Record<string, string>;
  events: string[];
  is_active: boolean;
  sync_settings?: unknown;
  sync_cursors?: Record<string, string> | null;
  last_sync_error?: string | null;
}

interface LinkRow {
  id: string;
  contact_id: string;
  external_id: string;
  snapshot: Record<string, string | null>;
  deal_id: string | null;
  deal_status: string | null;
}

type ContactRow = Record<string, any> & { id: string; email: string | null; updated_at: string };

/** Everything one sync step needs. */
interface Ctx {
  userId: string;
  integrationId: string;
  provider: CrmSyncProvider;
  label: string;
  adapter: CrmAdapter;
  settings: CrmSyncSettings;
  events: string[];
  config: Record<string, string>;
  /** Retrying a logged failure: a new failure updates that row instead of adding another. */
  retrying?: boolean;
}

/** What to do again for a failed item. */
type RetryPayload =
  | { step: 'event'; event_type: string; data: Record<string, any> }
  | { step: 'push'; contact_id: string }
  | { step: 'send'; contact_id: string };

// ── Adapters ──────────────────────────────────────────────────────

export function adapterFor(provider: CrmSyncProvider, config: Record<string, string>): CrmAdapter {
  if (provider === 'hubspot') {
    if (!config.access_token) throw new AppError('HubSpot is not connected (no access token).', 400);
    return hubspotAdapter(config.access_token);
  }
  if (!config.api_token) throw new AppError('Pipedrive is not connected (no API token).', 400);
  return pipedriveAdapter(config.api_token);
}

async function freshConfig(row: IntegrationRow): Promise<Record<string, string>> {
  return row.provider === 'hubspot' ? ensureFreshHubspotToken(row.id, row.config || {}) : row.config || {};
}

async function buildCtx(row: IntegrationRow, config?: Record<string, string>): Promise<Ctx> {
  if (!isCrmSyncProvider(row.provider)) throw new AppError('Two-way sync is for HubSpot and Pipedrive.', 400);
  const cfg = config ?? (await freshConfig(row));
  const adapter = adapterFor(row.provider, cfg);
  return {
    userId: row.user_id,
    integrationId: row.id,
    provider: row.provider,
    label: adapter.label,
    adapter,
    settings: sanitizeCrmSyncSettings(row.provider, row.sync_settings),
    events: row.events || [],
    config: cfg,
  };
}

// ── Field mapping ─────────────────────────────────────────────────

function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

const mapKey = (m: CrmFieldMap) => `${m.sincerely}|${m.crm}`;
const toCrm = (m: CrmFieldMap) => m.direction !== 'from_crm';
const fromCrm = (m: CrmFieldMap) => m.direction !== 'to_crm';

function localValue(contact: ContactRow, key: string): string | null {
  if (key.startsWith('custom:')) return norm(contact.custom_fields?.[key.slice(7)]);
  return norm(contact[key]);
}

/** Labels for log lines: "first name, company". */
function fieldLabel(key: string): string {
  return key.startsWith('custom:') ? key.slice(7) : key.replace(/_/g, ' ');
}

/** A contact update from mapped CRM values (custom fields merged, not replaced). */
function contactPatch(contact: ContactRow, changes: Record<string, string | null>): Record<string, any> {
  const patch: Record<string, any> = {};
  let custom: Record<string, any> | null = null;
  for (const [key, value] of Object.entries(changes)) {
    if (key.startsWith('custom:')) {
      const c: Record<string, any> = custom ?? { ...(contact.custom_fields || {}) };
      if (value === null) delete c[key.slice(7)];
      else c[key.slice(7)] = value;
      custom = c;
    } else {
      patch[key] = value;
    }
  }
  if (custom) patch.custom_fields = custom;
  return patch;
}

/**
 * Compare both sides with what they last agreed on. Returns what to write
 * here, what to write in the CRM, and the new agreed values.
 */
export function reconcile(
  mapping: CrmFieldMap[],
  contact: ContactRow,
  person: CrmPerson,
  snapshot: Record<string, string | null>,
): { local: Record<string, string | null>; remote: Record<string, string>; snapshot: Record<string, string | null> } {
  const local: Record<string, string | null> = {};
  const remote: Record<string, string> = {};
  const next: Record<string, string | null> = { ...snapshot };
  const localTime = Date.parse(contact.updated_at || '') || 0;
  const remoteTime = Date.parse(person.updatedAt || '') || 0;

  for (const m of mapping) {
    const key = mapKey(m);
    const L = localValue(contact, m.sincerely);
    const R = norm(person.values[m.crm]);
    const S = key in snapshot ? snapshot[key] : undefined;
    if (L === R) { next[key] = L; continue; }

    const crmEdited = S === undefined ? R !== null : R !== S;
    const localEdited = S === undefined ? L !== null : L !== S;
    let winner: 'local' | 'remote' | null;
    if (crmEdited && !localEdited) winner = 'remote';
    else if (localEdited && !crmEdited) winner = 'local';
    else winner = remoteTime > localTime ? 'remote' : 'local'; // both edited: the most recent edit wins

    // A field that travels one way only moves when its own side is edited:
    // an edit on the other side is left where it is, never overwritten.
    if (winner === 'remote' && !fromCrm(m)) winner = null;
    if (winner === 'local' && !toCrm(m)) winner = null;

    if (winner === 'remote') {
      local[m.sincerely] = R;
      next[key] = R;
    } else if (winner === 'local') {
      remote[m.crm] = L ?? '';
      next[key] = L;
    }
  }
  return { local, remote, snapshot: next };
}

/** The mapped values to send for a person the CRM may not have yet: only what Sincerely knows. */
function outboundValues(mapping: CrmFieldMap[], contact: ContactRow): { values: Record<string, string>; snapshot: Record<string, string | null> } {
  const values: Record<string, string> = {};
  const snapshot: Record<string, string | null> = {};
  for (const m of mapping) {
    if (!toCrm(m)) continue;
    const v = localValue(contact, m.sincerely);
    if (v !== null) {
      values[m.crm] = v;
      snapshot[mapKey(m)] = v;
    }
  }
  return { values, snapshot };
}

// ── Log ───────────────────────────────────────────────────────────

async function log(
  ctx: Pick<Ctx, 'userId' | 'integrationId' | 'retrying'>,
  entry: {
    direction: 'to_crm' | 'from_crm';
    kind: CrmSyncKind;
    status: 'ok' | 'failed' | 'skipped';
    summary: string;
    contact_id?: string | null;
    email?: string | null;
    error?: string | null;
    retry?: RetryPayload | null;
  },
): Promise<void> {
  if (ctx.retrying && entry.status === 'failed') return;
  const { error } = await supabaseAdmin.from('crm_sync_log').insert({
    user_id: ctx.userId,
    integration_id: ctx.integrationId,
    direction: entry.direction,
    kind: entry.kind,
    status: entry.status,
    summary: entry.summary.slice(0, 500),
    contact_id: entry.contact_id ?? null,
    email: entry.email ?? null,
    error: entry.error ? entry.error.slice(0, 1000) : null,
    retry: entry.status === 'failed' ? entry.retry ?? null : null,
  });
  if (error && !isMissing(error)) console.warn('[CrmSync] log:', error.message);
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err || 'Failed'));
/** Worth sending again: not a bad token, a missing permission or bad data. */
const retryable = (err: unknown) => !(err instanceof CrmHttpError) || err.transient;

// ── Links ─────────────────────────────────────────────────────────

async function linkForContact(ctx: Ctx, contactId: string): Promise<LinkRow | null> {
  const { data, error } = await supabaseAdmin
    .from('crm_links')
    .select('id, contact_id, external_id, snapshot, deal_id, deal_status')
    .eq('integration_id', ctx.integrationId)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return (data as LinkRow) || null;
}

async function saveLink(
  ctx: Ctx,
  contactId: string,
  externalId: string,
  patch: { snapshot?: Record<string, string | null>; remote_updated_at?: string | null; deal_id?: string | null; deal_status?: string | null },
): Promise<void> {
  const row: Record<string, any> = {
    user_id: ctx.userId,
    integration_id: ctx.integrationId,
    contact_id: contactId,
    external_id: externalId,
    synced_at: new Date().toISOString(),
    ...patch,
  };
  // The CRM record for a contact can change (merged in the CRM): the contact is the key.
  const { error } = await supabaseAdmin.from('crm_links').upsert(row, { onConflict: 'integration_id,contact_id' });
  if (!error) return;
  if (isMissing(error)) return;
  // Another contact already holds this CRM record (two addresses merged in the CRM): move the link.
  if (/duplicate key|23505/i.test(`${error.message} ${(error as any).code}`)) {
    await supabaseAdmin.from('crm_links').delete().eq('integration_id', ctx.integrationId).eq('external_id', externalId);
    const retry = await supabaseAdmin.from('crm_links').upsert(row, { onConflict: 'integration_id,contact_id' });
    if (retry.error && !isMissing(retry.error)) throw retry.error;
    return;
  }
  throw error;
}

async function loadContact(userId: string, contactId: string): Promise<ContactRow | null> {
  const { data, error } = await supabaseAdmin.from('contacts').select(CONTACT_FIELDS).eq('id', contactId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data as unknown as ContactRow) || null;
}

const displayName = (c: ContactRow) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Someone';

/**
 * Make sure the CRM has this person and Sincerely knows which record it is.
 * An existing link is used as it is (field edits travel on the schedule).
 */
async function ensurePerson(ctx: Ctx, contact: ContactRow, link: LinkRow | null): Promise<LinkRow> {
  if (link) return link;
  if (!contact.email) throw new AppError('This contact has no email address to match in the CRM.', 400);
  const { values, snapshot } = outboundValues(ctx.settings.mapping, contact);
  const { id, created } = await ctx.adapter.upsertPerson(contact.email, values);
  await saveLink(ctx, contact.id, id, { snapshot });
  await log(ctx, {
    direction: 'to_crm', kind: 'contact', status: 'ok', contact_id: contact.id, email: contact.email,
    summary: `${created ? 'Created' : 'Matched'} ${displayName(contact)} in ${ctx.label}`,
  });
  if (created) await afterCreate(ctx, [{ personId: id, contact }]);
  return { id: '', contact_id: contact.id, external_id: id, snapshot, deal_id: null, deal_status: null };
}

/** The company a contact belongs to, by website or a work email's domain. */
function companyOf(contact: ContactRow): { domain: string; name: string } | null {
  let domain = '';
  const site = norm(contact.website);
  if (site) {
    try { domain = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).hostname.replace(/^www\./i, '').toLowerCase(); } catch { /* not a URL */ }
  }
  if (!domain && contact.email) {
    const d = emailDomain(contact.email);
    if (d && !isFreeMailDomain(d)) domain = d;
  }
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return { domain, name: norm(contact.company) || domain };
}

/**
 * For people Sincerely just created in the CRM: give them the chosen owner,
 * and (HubSpot) attach them to their company. Neither is ever done to
 * someone who was already there: their owner and company are the CRM's.
 * A failure here is logged, never fatal: the person is in the CRM.
 */
async function afterCreate(ctx: Ctx, created: { personId: string; contact: ContactRow }[]): Promise<void> {
  if (created.length === 0) return;
  if (ctx.settings.owner_id) {
    try {
      await ctx.adapter.assignOwner(created.map((c) => c.personId), ctx.settings.owner_id);
    } catch (err) {
      await log(ctx, { direction: 'to_crm', kind: 'contact', status: 'failed', summary: `Could not set the ${ctx.label} owner for ${created.length === 1 ? displayName(created[0].contact) : `${created.length} people`}`, error: errText(err) });
    }
  }
  if (ctx.settings.companies) {
    for (const c of created) {
      const company = companyOf(c.contact);
      if (!company) continue;
      try {
        await ctx.adapter.linkCompany(c.personId, company);
      } catch (err) {
        await log(ctx, {
          direction: 'to_crm', kind: 'contact', status: 'skipped', contact_id: c.contact.id, email: c.contact.email,
          summary: `Could not attach ${displayName(c.contact)} to ${company.name} in ${ctx.label}`, error: errText(err),
        });
        // A missing permission will not fix itself for the next person: stop trying this run.
        if (err instanceof CrmHttpError && (err.status === 401 || err.status === 403)) break;
      }
    }
  }
}

// ── Sincerely -> CRM: events ──────────────────────────────────────

const ACTIVITY_KIND: Record<string, CrmActivityKind> = {
  'email.sent': 'sent',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.replied': 'replied',
  'sara.intent_classified': 'intent',
  'email.bounced': 'bounced',
  'lead.unsubscribed': 'unsubscribed',
  // Internal: a meeting booked through a Sincerely link, Calendly or Cal.com (never on the public bus).
  'meeting.booked': 'meeting',
};

const INTENT_LABEL: Record<string, string> = {
  interested: 'interested',
  meeting: 'asking for a meeting',
  not_interested: 'not interested',
  not_now: 'not now',
  out_of_office: 'out of office',
  wrong_person: 'the wrong person',
  unsubscribe: 'asking to unsubscribe',
  question: 'a question',
};

export function activityFor(eventType: string, data: Record<string, any>, campaignName: string | null, at = new Date().toISOString()): CrmActivity | null {
  const kind = ACTIVITY_KIND[eventType];
  if (!kind) return null;
  const campaign = campaignName ? `Campaign: ${campaignName}` : null;
  const lines = (...xs: (string | null | undefined | false)[]) => xs.filter((x): x is string => !!x);
  switch (kind) {
    case 'sent':
      return { kind, at, title: `Sincerely: email sent${data.subject ? ` - ${data.subject}` : ''}`, lines: lines(campaign, data.to && `To: ${data.to}`) };
    case 'opened':
      return { kind, at, title: 'Sincerely: email opened', lines: lines(campaign) };
    case 'clicked':
      return { kind, at, title: 'Sincerely: link clicked', lines: lines(campaign, data.url && `Link: ${String(data.url).slice(0, 500)}`) };
    case 'replied':
      return {
        kind, at,
        title: `Sincerely: replied${data.subject ? ` - ${data.subject}` : ''}`,
        lines: lines(campaign, data.excerpt && `"${String(data.excerpt).slice(0, 400)}"`),
      };
    case 'intent': {
      const intent = String(data.intent || 'unknown');
      const conf = typeof data.confidence === 'number' ? ` (${Math.round(data.confidence * 100)}% sure)` : '';
      return { kind, at, title: `Sincerely Relay: the reply reads as ${INTENT_LABEL[intent] || intent.replace(/_/g, ' ')}${conf}`, lines: lines(campaign) };
    }
    case 'bounced':
      return { kind, at, title: 'Sincerely: email bounced', lines: lines(campaign, data.reason && `Reason: ${String(data.reason).slice(0, 300)}`) };
    case 'unsubscribed':
      return { kind, at, title: 'Sincerely: unsubscribed from emails', lines: lines(data.source && data.source !== 'link' ? `Source: ${data.source}` : null) };
    case 'meeting': {
      const when = data.starts_at ? new Date(data.starts_at).toUTCString().replace(/:\d\d GMT$/, ' UTC') : null;
      return {
        kind, at,
        title: `Sincerely: meeting booked${data.via ? ` via ${data.via}` : ''}${data.title ? ` - ${data.title}` : ''}`,
        lines: lines(when && `When: ${when}`, campaign),
      };
    }
  }
}

/** Does this event put a person in the CRM who is not there yet? */
function createsPerson(settings: CrmSyncSettings, eventType: string, data: Record<string, any>): boolean {
  if (settings.push_when === 'off') return false;
  const engaged = eventType === 'email.replied' || eventType === 'meeting.booked' || (eventType === 'sara.intent_classified' && POSITIVE_INTENTS.has(data.intent));
  if (settings.push_when === 'replied') return engaged;
  return engaged || eventType === 'email.sent' || eventType === 'email.opened' || eventType === 'email.clicked';
}

async function campaignNameFor(userId: string, data: Record<string, any>, known?: string | null): Promise<string | null> {
  if (known) return known;
  if (data.campaign?.name) return data.campaign.name;
  if (!data.campaign_id) return null;
  const { data: row } = await supabaseAdmin.from('campaigns').select('name').eq('id', data.campaign_id).eq('user_id', userId).maybeSingle();
  return (row as any)?.name ?? null;
}

/** One event, every step. Returns a line for the integration's activity, or null when nothing applied. */
async function runEvent(ctx: Ctx, eventType: string, data: Record<string, any>, campaignName?: string | null): Promise<{ summary: string | null; failures: string[] }> {
  // It came from this CRM (an unsubscribe the sync itself made): do not send it back.
  if (data.source === ctx.provider) return { summary: null, failures: [] };
  if (!data.contact_id) return { summary: null, failures: [] };
  const contact = await loadContact(ctx.userId, data.contact_id);
  if (!contact?.email) return { summary: null, failures: [] };

  let link = await linkForContact(ctx, contact.id);
  if (!link && !createsPerson(ctx.settings, eventType, data)) return { summary: null, failures: [] };

  const retry: RetryPayload = { step: 'event', event_type: eventType, data };
  const done: string[] = [];
  const failures: string[] = [];

  try {
    link = await ensurePerson(ctx, contact, link);
  } catch (err) {
    const msg = errText(err);
    await log(ctx, {
      direction: 'to_crm', kind: 'contact', status: 'failed', contact_id: contact.id, email: contact.email,
      summary: `Could not save ${displayName(contact)} in ${ctx.label}`, error: msg, retry: retryable(err) ? retry : null,
    });
    throw err;
  }

  // A retry of one step does that step only: a note is never posted twice.
  const only = typeof data._only === 'string' ? data._only : null;
  const doing = (step: 'activity' | 'deal' | 'optout' | 'lifecycle' | 'task') => !only || only === step;

  // On the timeline.
  const activity = doing('activity') && (ctx.events.includes(eventType) || eventType === 'meeting.booked') ? activityFor(eventType, data, await campaignNameFor(ctx.userId, data, campaignName)) : null;
  if (activity) {
    try {
      await ctx.adapter.logActivity(link.external_id, activity);
      done.push(activity.kind === 'intent' ? 'Relay read on the timeline' : `${activity.kind} on the timeline`);
      await log(ctx, { direction: 'to_crm', kind: 'activity', status: 'ok', contact_id: contact.id, email: contact.email, summary: activity.title });
    } catch (err) {
      failures.push(errText(err));
      await log(ctx, {
        direction: 'to_crm', kind: 'activity', status: 'failed', contact_id: contact.id, email: contact.email,
        summary: `Could not add "${activity.title}" to ${ctx.label}`, error: errText(err),
        retry: retryable(err) ? { step: 'event', event_type: eventType, data: { ...data, _only: 'activity' } } : null,
      });
    }
  }

  // A deal for an interested reply, unless one is already open.
  const booked = eventType === 'meeting.booked';
  const positive = booked || (eventType === 'sara.intent_classified' && POSITIVE_INTENTS.has(data.intent));
  if (positive && doing('deal') && ctx.config.create_deals !== 'no' && !(link.deal_id && link.deal_status === 'open')) {
    const title = `${displayName(contact)}${contact.company ? ` (${contact.company})` : ''} - Sincerely`;
    try {
      const stage = (data.intent === 'meeting' || booked) && ctx.settings.deal_stage_meeting ? ctx.settings.deal_stage_meeting : ctx.settings.deal_stage;
      const deal = await ctx.adapter.createDeal(link.external_id, { title, pipeline: ctx.settings.deal_pipeline, stage, ownerId: ctx.settings.owner_id || undefined });
      await saveLink(ctx, contact.id, link.external_id, { deal_id: deal.id, deal_status: 'open' });
      done.push('deal created');
      await log(ctx, { direction: 'to_crm', kind: 'deal', status: 'ok', contact_id: contact.id, email: contact.email, summary: `Deal created: ${title}` });
    } catch (err) {
      failures.push(errText(err));
      await log(ctx, {
        direction: 'to_crm', kind: 'deal', status: 'failed', contact_id: contact.id, email: contact.email,
        summary: `Could not create the deal "${title}"`, error: errText(err),
        retry: retryable(err) ? { step: 'event', event_type: eventType, data: { ...data, _only: 'deal' } } : null,
      });
    }
  }

  // HubSpot lifecycle: a reply makes them a lead, interest an SQL, a meeting request an opportunity.
  const stageFor = eventType === 'email.replied' ? 'lead'
    : eventType === 'sara.intent_classified' && data.intent === 'interested' ? 'salesqualifiedlead'
      : (eventType === 'sara.intent_classified' && data.intent === 'meeting') || booked ? 'opportunity' : null;
  if (stageFor && ctx.settings.lifecycle && doing('lifecycle')) {
    try {
      if ((await ctx.adapter.setLifecycle(link.external_id, stageFor)) === 'done') done.push(`lifecycle ${stageFor}`);
    } catch (err) {
      await log(ctx, {
        direction: 'to_crm', kind: 'contact', status: 'failed', contact_id: contact.id, email: contact.email,
        summary: `Could not set the ${ctx.label} lifecycle stage for ${displayName(contact)}`, error: errText(err),
        retry: retryable(err) ? { step: 'event', event_type: eventType, data: { ...data, _only: 'lifecycle' } } : null,
      });
    }
  }

  // A follow-up task for the owner when someone is interested or wants to meet.
  // (Not for a booked meeting: the meeting is the follow-up.)
  if (positive && !booked && ctx.settings.create_tasks && doing('task')) {
    const subject = `Follow up with ${displayName(contact)}: ${data.intent === 'meeting' ? 'asked for a meeting' : 'interested'}`;
    try {
      await ctx.adapter.createTask(link.external_id, {
        subject,
        body: [
          `Sincerely Relay read their reply as ${INTENT_LABEL[data.intent] || data.intent}.`,
          campaignName || data.campaign?.name ? `Campaign: ${campaignName || data.campaign?.name}` : '',
          contact.company ? `Company: ${contact.company}` : '',
        ].filter(Boolean).join('\n'),
        dueAt: new Date().toISOString(),
        ownerId: ctx.settings.owner_id || undefined,
      });
      done.push('task created');
      await log(ctx, { direction: 'to_crm', kind: 'activity', status: 'ok', contact_id: contact.id, email: contact.email, summary: `Task: ${subject}` });
    } catch (err) {
      failures.push(errText(err));
      await log(ctx, {
        direction: 'to_crm', kind: 'activity', status: 'failed', contact_id: contact.id, email: contact.email,
        summary: `Could not create the task "${subject}"`, error: errText(err),
        retry: retryable(err) ? { step: 'event', event_type: eventType, data: { ...data, _only: 'task' } } : null,
      });
    }
  }

  // An unsubscribe opts them out in the CRM too.
  if (eventType === 'lead.unsubscribed' && doing('optout') && ctx.settings.sync_optouts) {
    try {
      const r = await ctx.adapter.optOut(link.external_id, contact.email);
      if (r === 'done') {
        done.push('opted out');
        await log(ctx, { direction: 'to_crm', kind: 'optout', status: 'ok', contact_id: contact.id, email: contact.email, summary: `Opted ${displayName(contact)} out of email in ${ctx.label}` });
      } else {
        await log(ctx, {
          direction: 'to_crm', kind: 'optout', status: 'skipped', contact_id: contact.id, email: contact.email,
          summary: `${ctx.label} could not record the unsubscribe`,
          error: ctx.provider === 'hubspot'
            ? 'Give the HubSpot connection the communication_preferences.read_write permission. The unsubscribe is on their timeline.'
            : 'Pipedrive records unsubscribes with Campaigns by Pipedrive, which this account does not have. The unsubscribe is on their timeline.',
        });
      }
    } catch (err) {
      failures.push(errText(err));
      await log(ctx, {
        direction: 'to_crm', kind: 'optout', status: 'failed', contact_id: contact.id, email: contact.email,
        summary: `Could not opt ${displayName(contact)} out in ${ctx.label}`, error: errText(err),
        retry: retryable(err) ? { step: 'event', event_type: eventType, data: { ...data, _only: 'optout' } } : null,
      });
    }
  }

  const who = contact.email;
  const summary = done.length ? `${ctx.label}: ${who} - ${done.join(', ')}` : `${ctx.label}: ${who} is up to date`;
  return { summary, failures };
}

/**
 * Called by the integrations event bus for a HubSpot or Pipedrive
 * connection. Failures are in the sync log with what is needed to retry;
 * a failure is also thrown so the connection's card shows it.
 */
export async function handleCrmEvent(
  integration: IntegrationRow,
  config: Record<string, string>,
  eventType: string,
  data: Record<string, any>,
  campaignName?: string | null,
): Promise<string | null> {
  const ctx = await buildCtx(integration, config);
  const { summary, failures } = await runEvent(ctx, eventType, data, campaignName);
  if (failures.length) throw new Error(failures[0]);
  return summary;
}

/**
 * A meeting was booked (through a Sincerely link, Calendly or Cal.com):
 * tell every connected HubSpot and Pipedrive. On the timeline, the deal in
 * the meeting stage, HubSpot lifecycle to opportunity. Never throws:
 * failures are in each connection's sync log, with a retry.
 */
export async function notifyCrmsOfMeeting(
  userId: string,
  data: { contact_id: string; title?: string; starts_at?: string; via?: string; campaign_id?: string | null },
): Promise<void> {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('user_integrations').select('*').eq('user_id', userId).eq('is_active', true).in('provider', ['hubspot', 'pipedrive']);
    if (error || !rows) return;
    for (const row of rows as IntegrationRow[]) {
      try {
        const summary = await handleCrmEvent(row, await freshConfig(row), 'meeting.booked', data);
        if (summary) {
          await supabaseAdmin.from('integration_activity').insert({
            integration_id: row.id, event_type: 'meeting.booked', summary: summary.slice(0, 500), success: true,
          });
        }
      } catch (err) {
        console.warn(`[CrmSync] meeting to ${row.provider}: ${errText(err)}`);
      }
    }
  } catch (err) {
    console.warn(`[CrmSync] meeting: ${errText(err)}`);
  }
}

// ── Sequences ─────────────────────────────────────────────────────

/** End a person's live sequences because of a CRM decision. Shown as Sequence ended. */
async function stopSequences(ctx: Ctx, contactId: string, why: string): Promise<number> {
  const { data: live, error } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id, campaigns!inner(user_id)')
    .eq('contact_id', contactId)
    .eq('campaigns.user_id', ctx.userId)
    .in('status', ['pending', 'active']);
  if (error) throw error;
  let stopped = 0;
  for (const slice of chunk((live || []).map((r: any) => r.id as string))) {
    const { data, error: upErr } = await supabaseAdmin
      .from('campaign_contacts')
      .update({ status: 'paused', next_send_at: null, error_message: `${MANUAL_PAUSE_PREFIX} in ${ctx.label}: ${why}` })
      .in('id', slice)
      .in('status', ['pending', 'active'])
      .select('id');
    if (upErr) throw upErr;
    stopped += (data || []).length;
  }
  return stopped;
}

// ── CRM -> Sincerely and Sincerely -> CRM: the scheduled run ─────

/** Apply one CRM person to the Sincerely contact it is (or matches by email). */
async function pullPerson(ctx: Ctx, person: CrmPerson, linkByExternal: Map<string, LinkRow>): Promise<'updated' | 'pushed' | 'same' | 'unknown'> {
  let link = linkByExternal.get(person.id) ?? null;
  let contact: ContactRow | null = null;
  if (link) contact = await loadContact(ctx.userId, link.contact_id);
  if (!contact && person.email) {
    const { data, error } = await supabaseAdmin.from('contacts').select(CONTACT_FIELDS).eq('user_id', ctx.userId).eq('email', person.email).maybeSingle();
    if (error) throw error;
    contact = (data as unknown as ContactRow) || null;
    if (contact) {
      // Someone already in Sincerely: link them, so their edits travel from now on.
      const existing = await linkForContact(ctx, contact.id);
      link = existing ?? { id: '', contact_id: contact.id, external_id: person.id, snapshot: {}, deal_id: null, deal_status: null };
    }
  }
  if (!contact || !link) return 'unknown'; // not someone Sincerely knows: lists bring people in, not every CRM edit

  let result: 'updated' | 'pushed' | 'same' = 'same';
  const mapping = ctx.settings.mapping;
  // With CRM edits switched off, nothing comes back; Sincerely's own edits still go (pushEdits).
  const r = ctx.settings.pull_updates
    ? reconcile(mapping, contact, person, link.snapshot || {})
    : { local: {}, remote: {} as Record<string, string>, snapshot: link.snapshot || {} };

  if (Object.keys(r.local).length) {
    const patch = contactPatch(contact, r.local);
    const { error } = await supabaseAdmin.from('contacts').update(patch).eq('id', contact.id).eq('user_id', ctx.userId);
    if (error) throw error;
    fireEvent(ctx.userId, 'contact.updated', { contact_id: contact.id, source: ctx.provider, fields: Object.keys(r.local) }).catch(() => {});
    result = 'updated';
    await log(ctx, {
      direction: 'from_crm', kind: 'contact', status: 'ok', contact_id: contact.id, email: contact.email,
      summary: `Updated ${displayName(contact)} from ${ctx.label}: ${Object.keys(r.local).map(fieldLabel).join(', ')}`,
    });
  }
  if (Object.keys(r.remote).length) {
    try {
      await ctx.adapter.updatePerson(person.id, r.remote);
      if (result === 'same') result = 'pushed';
      await log(ctx, {
        direction: 'to_crm', kind: 'contact', status: 'ok', contact_id: contact.id, email: contact.email,
        summary: `Updated ${displayName(contact)} in ${ctx.label}: ${Object.keys(r.remote).join(', ')}`,
      });
    } catch (err) {
      await log(ctx, {
        direction: 'to_crm', kind: 'contact', status: 'failed', contact_id: contact.id, email: contact.email,
        summary: `Could not update ${displayName(contact)} in ${ctx.label}`, error: errText(err),
        retry: retryable(err) ? { step: 'push', contact_id: contact.id } : null,
      });
      // Keep the old agreed values for what did not go, so the next run tries again.
      for (const m of mapping) if (mapKey(m) in r.snapshot && m.crm in r.remote) r.snapshot[mapKey(m)] = link.snapshot?.[mapKey(m)] ?? null;
    }
  }
  await saveLink(ctx, contact.id, person.id, { snapshot: r.snapshot, remote_updated_at: person.updatedAt });
  linkByExternal.set(person.id, { ...link, external_id: person.id, snapshot: r.snapshot });

  // Opt-outs and hard bounces recorded in the CRM.
  if (ctx.settings.sync_optouts && person.optedOut && !contact.is_unsubscribed) {
    await unsubscribeContact(ctx.userId, contact.id, { source: ctx.provider, note: `Opted out in ${ctx.label}` });
    await log(ctx, { direction: 'from_crm', kind: 'optout', status: 'ok', contact_id: contact.id, email: contact.email, summary: `${displayName(contact)} opted out in ${ctx.label}: unsubscribed here and their sequences stopped` });
    result = 'updated';
  }
  if (ctx.settings.sync_optouts && person.bounced && !contact.is_bounced) {
    await markContactBounced(ctx.userId, contact.id, { note: `Hard bounce recorded in ${ctx.label}` });
    await log(ctx, { direction: 'from_crm', kind: 'optout', status: 'ok', contact_id: contact.id, email: contact.email, summary: `${ctx.label} has a hard bounce for ${contact.email}: marked bounced and their sequences stopped` });
    result = 'updated';
  }
  return result;
}

async function linksFor(ctx: Ctx, externalIds: string[]): Promise<Map<string, LinkRow>> {
  const map = new Map<string, LinkRow>();
  for (const slice of chunk([...new Set(externalIds)], 200)) {
    const { data, error } = await supabaseAdmin
      .from('crm_links')
      .select('id, contact_id, external_id, snapshot, deal_id, deal_status')
      .eq('integration_id', ctx.integrationId)
      .in('external_id', slice);
    if (error) throw error;
    for (const l of (data || []) as LinkRow[]) map.set(l.external_id, l);
  }
  return map;
}

/** Step 1: people edited in the CRM. */
async function pullPeople(ctx: Ctx, cursors: Record<string, string>): Promise<{ updated: number; pushed: number }> {
  const properties = [...new Set(ctx.settings.mapping.map((m) => m.crm))];
  const page = await ctx.adapter.changedPeople(cursors.people || '', properties);
  const links = await linksFor(ctx, page.items.map((p) => p.id));
  let updated = 0;
  let pushed = 0;
  for (const person of page.items) {
    try {
      const r = await pullPerson(ctx, person, links);
      if (r === 'updated') updated++;
      if (r === 'pushed') pushed++;
    } catch (err) {
      await log(ctx, {
        direction: 'from_crm', kind: 'contact', status: 'failed', email: person.email,
        summary: `Could not apply the ${ctx.label} changes for ${person.email || `record ${person.id}`}`, error: errText(err),
      });
    }
  }
  cursors.people = page.cursor;
  return { updated, pushed };
}

/** Step 2: contacts edited in Sincerely since the last run, for people the CRM has. */
async function pushEdits(ctx: Ctx, cursors: Record<string, string>): Promise<number> {
  if (!cursors.out) {
    cursors.out = new Date().toISOString();
    return 0;
  }
  // The cursor is the last (updated_at, id) sent: a bulk edit gives thousands
  // of contacts the same updated_at, and none of them may be skipped.
  const lastTime = cursors.out;
  const lastId = cursors.out_id || '00000000-0000-0000-0000-000000000000';
  const { data, error } = await supabaseAdmin
    .from('contacts')
    .select('id, email, first_name, last_name, company, job_title, phone, website, linkedin_url, city, state, country, industry, custom_fields, is_unsubscribed, is_bounced, updated_at, crm_links!inner(id, contact_id, external_id, snapshot, deal_id, deal_status, integration_id)')
    .eq('user_id', ctx.userId)
    .eq('crm_links.integration_id', ctx.integrationId)
    .or(`updated_at.gt."${lastTime}",and(updated_at.eq."${lastTime}",id.gt.${lastId})`)
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(OUTBOUND_PER_RUN);
  if (error) throw error;
  let pushed = 0;
  for (const row of (data || []) as any[]) {
    const link: LinkRow | undefined = (row.crm_links || []).find((l: any) => l.integration_id === ctx.integrationId);
    cursors.out = row.updated_at;
    cursors.out_id = row.id;
    if (!link) continue;
    try {
      if (await pushChanged(ctx, row as ContactRow, link)) pushed++;
    } catch {
      // Logged with a retry by pushChanged.
    }
  }
  return pushed;
}

/** Send the fields edited here since the last agreement. True when something was sent. */
async function pushChanged(ctx: Ctx, contact: ContactRow, link: LinkRow): Promise<boolean> {
  const values: Record<string, string> = {};
  const snapshot = { ...(link.snapshot || {}) };
  for (const m of ctx.settings.mapping) {
    if (!toCrm(m)) continue;
    const key = mapKey(m);
    const L = localValue(contact, m.sincerely);
    const S = key in snapshot ? snapshot[key] : undefined;
    // Unknown agreement and nothing here: nothing to say.
    if (S === undefined ? L === null : L === S) continue;
    values[m.crm] = L ?? '';
    snapshot[key] = L;
  }
  if (Object.keys(values).length === 0) return false;
  try {
    await ctx.adapter.updatePerson(link.external_id, values);
  } catch (err) {
    await log(ctx, {
      direction: 'to_crm', kind: 'contact', status: 'failed', contact_id: contact.id, email: contact.email,
      summary: `Could not update ${displayName(contact)} in ${ctx.label}`, error: errText(err),
      retry: retryable(err) ? { step: 'push', contact_id: contact.id } : null,
    });
    throw err;
  }
  await saveLink(ctx, contact.id, link.external_id, { snapshot });
  await log(ctx, {
    direction: 'to_crm', kind: 'contact', status: 'ok', contact_id: contact.id, email: contact.email,
    summary: `Updated ${displayName(contact)} in ${ctx.label}: ${Object.keys(values).join(', ')}`,
  });
  return true;
}

/** Step 3: deals won or lost in the CRM. */
async function pullDeals(ctx: Ctx, cursors: Record<string, string>): Promise<number> {
  const page = await ctx.adapter.changedDeals(cursors.deals || '');
  const closed = page.items.filter((d) => d.status !== 'open');
  const links = await linksFor(ctx, closed.flatMap((d) => d.personIds));
  let acted = 0;
  for (const deal of closed) {
    for (const pid of deal.personIds) {
      const link = links.get(pid);
      if (!link) continue;
      if (link.deal_id === deal.id && link.deal_status === deal.status) continue; // already acted on
      const contact = await loadContact(ctx.userId, link.contact_id);
      if (!contact) continue;
      const action = deal.status === 'won' ? ctx.settings.on_deal_won : ctx.settings.on_deal_lost;
      try {
        const stopped = action === 'stop' ? await stopSequences(ctx, contact.id, `deal ${deal.status}`) : 0;
        await saveLink(ctx, contact.id, pid, { deal_id: deal.id, deal_status: deal.status });
        links.set(pid, { ...link, deal_id: deal.id, deal_status: deal.status });
        acted++;
        await log(ctx, {
          direction: 'from_crm', kind: 'deal', status: 'ok', contact_id: contact.id, email: contact.email,
          summary: `Deal ${deal.status} in ${ctx.label} for ${displayName(contact)}${stopped ? `: ${stopped} sequence${stopped === 1 ? '' : 's'} ended` : action === 'stop' ? ': no sequence was running' : ''}`,
        });
      } catch (err) {
        await log(ctx, {
          direction: 'from_crm', kind: 'deal', status: 'failed', contact_id: contact.id, email: contact.email,
          summary: `Could not act on the ${deal.status} deal for ${displayName(contact)}`, error: errText(err),
        });
      }
    }
  }
  cursors.deals = page.cursor;
  return acted;
}

/**
 * Bring CRM people into a Sincerely list: new people are added, people
 * already here only have blanks filled, and everyone is linked so their
 * edits travel both ways from then on. An opt-out recorded in the CRM is
 * applied here.
 */
async function importPeople(ctx: Ctx, people: CrmPerson[], listId: string, source: string): Promise<{ added: number; updated: number; withEmail: CrmPerson[]; contactIds: string[] }> {
  const withEmail = people.filter((p) => p.email);
  const rows = withEmail.map((p) => {
    const row: Record<string, any> = { email: p.email };
    for (const m of ctx.settings.mapping) {
      if (!fromCrm(m)) continue;
      const v = norm(p.values[m.crm]);
      if (v === null) continue;
      if (m.sincerely.startsWith('custom:')) {
        row.custom_fields = { ...(row.custom_fields || {}), [m.sincerely.slice(7)]: v };
      } else {
        row[m.sincerely] = v;
      }
    }
    return row;
  });

  let added = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += IMPORT_BATCH) {
    const r = await contactsService.bulkCreate(ctx.userId, rows.slice(i, i + IMPORT_BATCH), listId, source, undefined, { mode: 'fill' });
    added += r.created ?? 0;
    updated += r.updated ?? 0;
  }

  const byEmail = new Map(withEmail.map((p) => [p.email!, p]));
  const contactIds: string[] = [];
  for (const slice of chunk([...byEmail.keys()], 200)) {
    const { data, error } = await supabaseAdmin.from('contacts').select('id, email, is_unsubscribed').eq('user_id', ctx.userId).in('email', slice);
    if (error) throw error;
    contactIds.push(...((data || []) as any[]).map((c) => c.id as string));
    const existing = await supabaseAdmin.from('crm_links').select('contact_id').eq('integration_id', ctx.integrationId).in('contact_id', (data || []).map((c: any) => c.id));
    if (existing.error) throw existing.error;
    const linked = new Set((existing.data || []).map((l: any) => l.contact_id));
    for (const c of (data || []) as any[]) {
      const p = byEmail.get(String(c.email).toLowerCase());
      if (!p) continue;
      if (!linked.has(c.id)) await saveLink(ctx, c.id, p.id, { snapshot: {}, remote_updated_at: p.updatedAt });
      if (ctx.settings.sync_optouts && p.optedOut && !c.is_unsubscribed) {
        await unsubscribeContact(ctx.userId, c.id, { source: ctx.provider, note: `Opted out in ${ctx.label}` });
      }
    }
  }
  return { added, updated, withEmail, contactIds };
}

/** Step 4: lists and filters pulled into Sincerely lists. */
export async function runListSync(ctx: Ctx, ls: { id: string; external_id: string; external_name: string; list_id: string | null; campaign_id?: string | null }): Promise<{ added: number; updated: number; total: number; enrolled?: number }> {
  const now = new Date().toISOString();
  try {
    if (!ls.list_id) throw new AppError('The Sincerely list it fills was deleted. Choose a list for it again.', 400);
    const properties = [...new Set(ctx.settings.mapping.map((m) => m.crm))];
    const people: CrmPerson[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < LIST_PAGES_PER_RUN; page++) {
      const r = await ctx.adapter.listMembers(ls.external_id, cursor);
      people.push(...(r.people ?? (r.ids.length ? await ctx.adapter.getPeople(r.ids, properties) : [])));
      cursor = r.next;
      if (!cursor) break;
    }

    const { added, updated, withEmail, contactIds } = await importPeople(ctx, people, ls.list_id, `${ctx.label}: ${ls.external_name}`);
    const enrolled = ls.campaign_id ? await enrolFromList(ctx, ls.campaign_id, contactIds, ls.external_name) : 0;

    const status = `${added.toLocaleString('en-GB')} added, ${updated.toLocaleString('en-GB')} updated${enrolled ? `, ${enrolled.toLocaleString('en-GB')} put in the campaign` : ''}${people.length > withEmail.length ? `, ${(people.length - withEmail.length).toLocaleString('en-GB')} without an email skipped` : ''}${cursor ? ' (more next run)' : ''}`;
    await supabaseAdmin.from('crm_list_syncs').update({ last_run_at: now, last_status: status, last_error: null }).eq('id', ls.id);
    await log(ctx, { direction: 'from_crm', kind: 'list', status: 'ok', summary: `${ls.external_name}: ${status}` });
    return { added, updated, total: people.length, enrolled };
  } catch (err) {
    await supabaseAdmin.from('crm_list_syncs').update({ last_run_at: now, last_status: 'failed', last_error: errText(err).slice(0, 300) }).eq('id', ls.id);
    await log(ctx, { direction: 'from_crm', kind: 'list', status: 'failed', summary: `Could not sync ${ls.external_name}`, error: errText(err) });
    throw err;
  }
}

/**
 * Put people a list brought in into its campaign. The campaign's own rules
 * decide who it can take (already in it, unsubscribed, bounced, suppressed
 * are skipped), exactly as adding them by hand would.
 */
async function enrolFromList(ctx: Ctx, campaignId: string, contactIds: string[], listName: string): Promise<number> {
  if (contactIds.length === 0) return 0;
  const { data: camp } = await supabaseAdmin.from('campaigns').select('id, name').eq('id', campaignId).eq('user_id', ctx.userId).maybeSingle();
  if (!camp) return 0;
  let added = 0;
  for (const slice of chunk(contactIds, 500)) {
    try {
      const r = await campaignContactsService.add(campaignId, slice);
      added += r.added;
    } catch (err) {
      await log(ctx, { direction: 'from_crm', kind: 'list', status: 'failed', summary: `Could not add people from ${listName} to ${(camp as any).name}`, error: errText(err) });
      return added;
    }
  }
  if (added) await log(ctx, { direction: 'from_crm', kind: 'list', status: 'ok', summary: `${added.toLocaleString('en-GB')} from ${listName} put in the campaign ${(camp as any).name}` });
  return added;
}

async function runDueListSyncs(ctx: Ctx, force: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('crm_list_syncs')
    .select('*')
    .eq('integration_id', ctx.integrationId)
    .eq('enabled', true);
  if (error) throw error;
  for (const ls of (data || []) as any[]) {
    const due = force || !ls.last_run_at || Date.now() - Date.parse(ls.last_run_at) >= LIST_SYNC_EVERY_MS;
    if (!due) continue;
    await runListSync(ctx, ls).catch(() => undefined); // recorded on the list sync and in the log
  }
}

/** Step 5: failures worth sending again, a few times, further apart each time. */
async function autoRetry(ctx: Ctx): Promise<void> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('crm_sync_log')
    .select('id, attempts, retried_at, created_at')
    .eq('integration_id', ctx.integrationId)
    .eq('status', 'failed')
    .not('retry', 'is', null)
    .lt('attempts', AUTO_RETRY_MAX_ATTEMPTS)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(AUTO_RETRY_PER_RUN);
  if (error) throw error;
  for (const row of (data || []) as any[]) {
    const last = Date.parse(row.retried_at || row.created_at);
    if (Date.now() - last < row.attempts * CRM_SYNC_EVERY_MS) continue;
    await retryOne(ctx, row.id).catch(() => undefined);
  }
}

async function retryOne(baseCtx: Ctx, logId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx: Ctx = { ...baseCtx, retrying: true };
  const { data: row, error } = await supabaseAdmin
    .from('crm_sync_log')
    .select('id, retry, attempts, status')
    .eq('id', logId)
    .eq('integration_id', ctx.integrationId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new AppError('Not found', 404);
  const payload = (row as any).retry as RetryPayload | null;
  if ((row as any).status !== 'failed' || !payload) throw new AppError('That item cannot be retried.', 400);

  let failure: string | undefined;
  try {
    if (payload.step === 'event') {
      const r = await runEvent(ctx, payload.event_type, payload.data);
      if (r.failures.length) failure = r.failures[0];
    } else if (payload.step === 'send') {
      const contact = await loadContact(ctx.userId, payload.contact_id);
      if (contact) await ensurePerson(ctx, contact, await linkForContact(ctx, contact.id));
    } else {
      const contact = await loadContact(ctx.userId, payload.contact_id);
      const link = contact ? await linkForContact(ctx, contact.id) : null;
      if (contact && link) await pushChanged(ctx, contact, link);
    }
  } catch (err) {
    failure = errText(err);
  }
  await supabaseAdmin.from('crm_sync_log').update({
    attempts: ((row as any).attempts || 1) + 1,
    retried_at: new Date().toISOString(),
    // The retry itself logged what it did; this row is settled either way, unless it failed again.
    ...(failure ? { error: failure.slice(0, 1000) } : { status: 'ok', retry: null, error: null }),
  }).eq('id', logId);
  return failure ? { ok: false, error: failure } : { ok: true };
}

const running = new Set<string>();

async function loadIntegration(userId: string | null, integrationId: string): Promise<IntegrationRow> {
  let q = supabaseAdmin.from('user_integrations').select('*').eq('id', integrationId);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError('Not found', 404);
  if (!isCrmSyncProvider((data as any).provider)) throw new AppError('Two-way sync is for HubSpot and Pipedrive.', 400);
  return data as IntegrationRow;
}

/**
 * One full run for one connection. Each step is independent: one failing
 * (often a permission the token lacks) is recorded and the others still run.
 */
export async function runCrmSync(
  userId: string,
  integrationId: string,
  opts: { force?: boolean } = {},
): Promise<{ people_updated: number; pushed: number; deals: number; error: string | null }> {
  const row = await loadIntegration(userId, integrationId);
  if (!row.is_active) throw new AppError('This connection is paused. Turn it on to sync.', 400);
  if (!('sync_cursors' in row)) throw new AppError(NEEDS_MIGRATION, 503);
  const key = row.id;
  if (running.has(key)) throw new AppError('A sync is already running for this connection.', 409);
  running.add(key);
  const cursors: Record<string, string> = { ...(row.sync_cursors || {}) };
  const errors: string[] = [];
  let peopleUpdated = 0;
  let pushed = 0;
  let deals = 0;
  try {
    const ctx = await buildCtx(row).catch((err) => {
      errors.push(errText(err));
      throw err;
    });
    const step = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        const msg = `${name}: ${errText(err)}`;
        errors.push(msg);
        // Once, not every run: a missing permission stays missing until someone adds it.
        if (!(row.last_sync_error || '').includes(msg)) {
          await log(ctx, { direction: 'from_crm', kind: 'sync', status: 'failed', summary: `${name} did not run`, error: errText(err) });
        }
        if (err instanceof CrmHttpError && err.status === 401) throw err; // the token is dead; nothing else will work
      }
    };
    await step('Reading changes', async () => {
      const r = await pullPeople(ctx, cursors);
      peopleUpdated += r.updated;
      pushed += r.pushed;
    });
    await step('Sending Sincerely edits', async () => { pushed += await pushEdits(ctx, cursors); });
    await step('Reading deals', async () => { deals += await pullDeals(ctx, cursors); });
    await step('Syncing lists', () => runDueListSyncs(ctx, !!opts.force));
    await step('Retrying failures', () => autoRetry(ctx));
  } catch {
    // Recorded in errors.
  } finally {
    running.delete(key);
    const now = Date.now();
    await supabaseAdmin.from('user_integrations').update({
      sync_cursors: cursors,
      last_sync_at: new Date(now).toISOString(),
      next_sync_at: new Date(now + CRM_SYNC_EVERY_MS).toISOString(),
      last_sync_error: errors.length ? errors.join(' | ').slice(0, 1000) : null,
    }).eq('id', row.id);
    await supabaseAdmin.from('crm_sync_log').delete().eq('integration_id', row.id)
      .lt('created_at', new Date(now - LOG_KEEP_DAYS * 86_400_000).toISOString());
  }
  return { people_updated: peopleUpdated, pushed, deals, error: errors.length ? errors.join(' | ') : null };
}

/** For the scheduler: connections due a run, oldest first. Cross-tenant. */
export async function dueCrmSyncs(limit = 10): Promise<Array<{ id: string; user_id: string }>> {
  const { data, error } = await supabaseAdmin
    .from('user_integrations')
    .select('id, user_id')
    .in('provider', ['hubspot', 'pipedrive'])
    .eq('is_active', true)
    .lte('next_sync_at', new Date().toISOString())
    .order('next_sync_at', { ascending: true })
    .limit(limit);
  if (error) {
    if (!isMissing(error)) console.warn('[CrmSync] due:', error.message);
    return [];
  }
  return (data || []) as any;
}

// ── The first sync, and "send these people" ──────────────────────

/** How long one push of the first sync works before saving and handing back. */
const BACKFILL_BUDGET_MS = 4 * 60_000;
const BACKFILL_LEASE_MS = 5 * 60_000;
const BACKFILL_BATCH = 100;
/** Up to this many picked people are sent straight away; more go through the background run. */
const SEND_NOW_MAX = 25;
const MAX_IDS = 10_000;

interface BackfillState {
  status: 'idle' | 'running' | 'done' | 'failed';
  setup_done_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  lease_until?: string | null;
  to_crm: null | {
    scope: 'all' | 'list' | 'ids' | 'none';
    list_id?: string | null;
    ids?: string[];
    total: number | null;
    done: number;
    failed: number;
    cursor: string | null;
    finished: boolean;
  };
  from_crm: null | {
    scope: 'all' | 'list' | 'none';
    external_id?: string | null;
    external_name?: string | null;
    list_id?: string | null;
    total: number | null;
    done: number;
    added: number;
    cursor: string | null;
    finished: boolean;
  };
}

function readBackfill(raw: unknown): BackfillState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BackfillState>;
  return {
    status: r.status === 'running' || r.status === 'done' || r.status === 'failed' ? r.status : 'idle',
    setup_done_at: r.setup_done_at ?? null,
    started_at: r.started_at ?? null,
    finished_at: r.finished_at ?? null,
    error: r.error ?? null,
    lease_until: r.lease_until ?? null,
    to_crm: r.to_crm ?? null,
    from_crm: r.from_crm ?? null,
  };
}

/** What the page sees: progress, never the id list or cursors. */
export function publicBackfill(raw: unknown) {
  const b = readBackfill(raw);
  return {
    status: b.status,
    setup_done_at: b.setup_done_at,
    started_at: b.started_at,
    finished_at: b.finished_at,
    error: b.error,
    to_crm: b.to_crm && b.to_crm.scope !== 'none'
      ? { scope: b.to_crm.scope, list_id: b.to_crm.list_id ?? null, total: b.to_crm.total, done: b.to_crm.done, failed: b.to_crm.failed }
      : null,
    from_crm: b.from_crm && b.from_crm.scope !== 'none'
      ? { scope: b.from_crm.scope, external_id: b.from_crm.external_id ?? null, external_name: b.from_crm.external_name ?? null, list_id: b.from_crm.list_id ?? null, total: b.from_crm.total, done: b.from_crm.done, added: b.from_crm.added }
      : null,
  };
}

async function saveBackfill(integrationId: string, state: BackfillState): Promise<void> {
  const { error } = await supabaseAdmin.from('user_integrations').update({ sync_backfill: state }).eq('id', integrationId);
  if (error) {
    if (isMissing(error)) throw new AppError('The first sync needs the latest database update (migration 119).', 503);
    throw new AppError(error.message, 500);
  }
}

/** The next contacts to send: after the cursor, with an email, not already in the CRM. */
async function nextToSend(ctx: Ctx, side: NonNullable<BackfillState['to_crm']>): Promise<{ contacts: ContactRow[]; cursor: string | null; seen: number; end: boolean }> {
  let ids: string[] = [];
  let end = false;
  let cursor = side.cursor;
  if (side.scope === 'ids') {
    const all = side.ids || [];
    const from = Number(cursor || 0);
    ids = all.slice(from, from + BACKFILL_BATCH);
    cursor = String(from + ids.length);
    end = from + ids.length >= all.length;
  } else if (side.scope === 'list') {
    let q = supabaseAdmin.from('list_contacts').select('contact_id').eq('list_id', side.list_id!).order('contact_id', { ascending: true }).limit(BACKFILL_BATCH);
    if (cursor) q = q.gt('contact_id', cursor);
    const { data, error } = await q;
    if (error) throw error;
    ids = (data || []).map((r: any) => r.contact_id as string);
    end = ids.length < BACKFILL_BATCH;
    if (ids.length) cursor = ids[ids.length - 1];
  } else {
    let q = supabaseAdmin.from('contacts').select('id').eq('user_id', ctx.userId).not('email', 'is', null).order('id', { ascending: true }).limit(BACKFILL_BATCH);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (error) throw error;
    ids = (data || []).map((r: any) => r.id as string);
    end = ids.length < BACKFILL_BATCH;
    if (ids.length) cursor = ids[ids.length - 1];
  }
  if (ids.length === 0) return { contacts: [], cursor, seen: 0, end: true };

  const { data: rows, error } = await supabaseAdmin.from('contacts').select(CONTACT_FIELDS).eq('user_id', ctx.userId).in('id', ids);
  if (error) throw error;
  const { data: links, error: lErr } = await supabaseAdmin.from('crm_links').select('contact_id').eq('integration_id', ctx.integrationId).in('contact_id', ids);
  if (lErr) throw lErr;
  const linked = new Set((links || []).map((l: any) => l.contact_id));
  const contacts = ((rows || []) as unknown as ContactRow[]).filter((c) => c.email && !linked.has(c.id));
  return { contacts, cursor, seen: ids.length, end };
}

/** Send one batch to the CRM in as few calls as it allows. */
async function sendBatch(ctx: Ctx, contacts: ContactRow[]): Promise<{ sent: number; created: number; failed: number }> {
  if (contacts.length === 0) return { sent: 0, created: 0, failed: 0 };
  const prepared = contacts.map((c) => ({ contact: c, ...outboundValues(ctx.settings.mapping, c) }));
  const results = await ctx.adapter.upsertPeople(prepared.map((p) => ({ email: p.contact.email!, values: p.values })));
  let sent = 0;
  let created = 0;
  let failed = 0;
  const newlyCreated: { personId: string; contact: ContactRow }[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    const r = results[i];
    if (r?.id) {
      await saveLink(ctx, p.contact.id, r.id, { snapshot: p.snapshot });
      sent++;
      if (r.created) {
        created++;
        newlyCreated.push({ personId: r.id, contact: p.contact });
      }
    } else {
      failed++;
      await log(ctx, {
        direction: 'to_crm', kind: 'contact', status: 'failed', contact_id: p.contact.id, email: p.contact.email,
        summary: `Could not send ${displayName(p.contact)} to ${ctx.label}`, error: r?.error || 'No answer for this person',
        retry: { step: 'send', contact_id: p.contact.id },
      });
    }
  }
  await afterCreate(ctx, newlyCreated);
  return { sent, created, failed };
}

/** Make sure a Sincerely list exists for what comes in; returns its id. */
async function ensureIncomingList(ctx: Ctx, side: NonNullable<BackfillState['from_crm']>): Promise<string> {
  if (side.list_id) {
    const { data } = await supabaseAdmin.from('contact_lists').select('id').eq('id', side.list_id).eq('user_id', ctx.userId).maybeSingle();
    if (data) return side.list_id;
  }
  const base = side.scope === 'list' && side.external_name ? `${ctx.label}: ${side.external_name}` : `From ${ctx.label}`;
  for (let n = 1; n <= 20; n++) {
    try {
      const list = await listsService.create(ctx.userId, { name: n === 1 ? base : `${base} (${n})` } as any);
      return (list as any).id;
    } catch (err) {
      if (!(err instanceof AppError && err.statusCode === 409)) throw err;
    }
  }
  throw new AppError('Could not create a list for the people coming in.', 500);
}

/**
 * Work on a running first sync until it is done or the time budget runs
 * out, saving progress after every batch. Safe to call again: it resumes
 * from the saved cursors, and a lease keeps two workers off the same one.
 */
export async function driveBackfill(integrationId: string): Promise<void> {
  const key = `backfill:${integrationId}`;
  if (running.has(key)) return;
  running.add(key);
  try {
    const row = await loadIntegration(null, integrationId);
    let state = readBackfill((row as any).sync_backfill);
    if (state.status !== 'running') return;
    if (state.lease_until && Date.parse(state.lease_until) > Date.now()) return;
    const ctx = await buildCtx(row);
    const deadline = Date.now() + BACKFILL_BUDGET_MS;
    state.lease_until = new Date(Date.now() + BACKFILL_LEASE_MS).toISOString();
    await saveBackfill(row.id, state);

    try {
      // CRM people first: whoever comes in is linked, so the send below skips them.
      const from = state.from_crm;
      if (from && from.scope !== 'none' && !from.finished) {
        from.list_id = await ensureIncomingList(ctx, from);
        const properties = [...new Set(ctx.settings.mapping.map((m) => m.crm))];
        while (!from.finished && Date.now() < deadline) {
          const page = from.scope === 'list'
            ? await ctx.adapter.listMembers(from.external_id!, from.cursor)
            : { ...(await ctx.adapter.allPeople(from.cursor, properties)), ids: [] as string[] };
          const people = (page as any).people ?? (page.ids.length ? await ctx.adapter.getPeople(page.ids, properties) : []);
          const r = await importPeople(ctx, people, from.list_id, `${ctx.label}${from.external_name ? `: ${from.external_name}` : ''}`);
          from.done += people.length;
          from.added += r.added;
          from.cursor = page.next;
          from.finished = !page.next;
          state = await refreshed(row.id, state);
          if (state.status !== 'running') return;
          await saveBackfill(row.id, state);
        }
        if (from.finished && from.scope === 'list' && from.external_id) {
          // Kept in step from now on, like any list pulled in from the sync page.
          const { error } = await supabaseAdmin.from('crm_list_syncs').upsert({
            user_id: ctx.userId, integration_id: ctx.integrationId, external_id: from.external_id,
            external_name: from.external_name || from.external_id, list_id: from.list_id, enabled: true,
            last_run_at: new Date().toISOString(), last_status: `${from.added.toLocaleString('en-GB')} added by the first sync`,
          }, { onConflict: 'integration_id,external_id' });
          if (error && !isMissing(error)) throw error;
        }
      }

      const to = state.to_crm;
      if (to && to.scope !== 'none' && !to.finished && (!from || from.scope === 'none' || from.finished)) {
        while (!to.finished && Date.now() < deadline) {
          const batch = await nextToSend(ctx, to);
          const r = await sendBatch(ctx, batch.contacts);
          to.done += batch.seen;
          to.failed += r.failed;
          to.cursor = batch.cursor;
          to.finished = batch.end;
          if (r.sent) {
            await log(ctx, {
              direction: 'to_crm', kind: 'contact', status: 'ok',
              summary: `Sent ${r.sent.toLocaleString('en-GB')} ${r.sent === 1 ? 'person' : 'people'} to ${ctx.label} (${r.created.toLocaleString('en-GB')} new, ${(r.sent - r.created).toLocaleString('en-GB')} already there)`,
            });
          }
          state = await refreshed(row.id, state);
          if (state.status !== 'running') return;
          await saveBackfill(row.id, state);
        }
      }

      const fromDone = !state.from_crm || state.from_crm.scope === 'none' || state.from_crm.finished;
      const toDone = !state.to_crm || state.to_crm.scope === 'none' || state.to_crm.finished;
      if (fromDone && toDone) {
        state.status = 'done';
        state.finished_at = new Date().toISOString();
        const parts: string[] = [];
        if (state.from_crm && state.from_crm.scope !== 'none') parts.push(`${state.from_crm.added.toLocaleString('en-GB')} added from ${ctx.label}`);
        if (state.to_crm && state.to_crm.scope !== 'none') parts.push(`${(state.to_crm.done - state.to_crm.failed).toLocaleString('en-GB')} checked and sent to ${ctx.label}${state.to_crm.failed ? `, ${state.to_crm.failed} failed` : ''}`);
        await log(ctx, { direction: 'to_crm', kind: 'sync', status: 'ok', summary: `First sync finished: ${parts.join('; ') || 'nothing to move'}` });
      }
      state.lease_until = null;
      await saveBackfill(row.id, state);
      // More to do: carry straight on rather than waiting for the scheduler.
      if (state.status === 'running') setTimeout(() => { driveBackfill(integrationId).catch(() => undefined); }, 1_000);
    } catch (err) {
      const transient = !(err instanceof CrmHttpError) || err.transient;
      state.lease_until = null;
      if (transient) {
        // Kept running: the scheduler picks it up again in a minute or two.
        state.error = `Paused for a moment: ${errText(err)}`;
      } else {
        state.status = 'failed';
        state.error = errText(err);
        state.finished_at = new Date().toISOString();
        await log(ctx, { direction: 'to_crm', kind: 'sync', status: 'failed', summary: 'The first sync stopped', error: errText(err) });
      }
      await saveBackfill(row.id, state).catch(() => undefined);
    }
  } catch (err) {
    console.warn(`[CrmSync] first sync ${integrationId}: ${errText(err)}`);
  } finally {
    running.delete(key);
  }
}

/** Progress so far, unless someone stopped it in the meantime. */
async function refreshed(integrationId: string, state: BackfillState): Promise<BackfillState> {
  const { data } = await supabaseAdmin.from('user_integrations').select('sync_backfill').eq('id', integrationId).maybeSingle();
  const now = readBackfill((data as any)?.sync_backfill);
  if (now.status !== 'running') return now;
  state.error = null;
  return state;
}

/** For the scheduler: first syncs still running (a restart, or more than one budget's worth). */
export async function runningBackfills(limit = 10): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('user_integrations')
    .select('id')
    .in('provider', ['hubspot', 'pipedrive'])
    .eq('is_active', true)
    .eq('sync_backfill->>status', 'running')
    .limit(limit);
  if (error) {
    if (!isMissing(error)) console.warn('[CrmSync] backfills:', error.message);
    return [];
  }
  return (data || []).map((r: any) => r.id);
}

async function startBackfill(row: IntegrationRow, state: BackfillState): Promise<void> {
  await saveBackfill(row.id, state);
  driveBackfill(row.id).catch(() => undefined);
}

// ── For the status page ───────────────────────────────────────────

function shapeList(r: any): CrmListSync {
  return {
    id: r.id,
    external_id: r.external_id,
    external_name: r.external_name,
    list_id: r.list_id,
    list_name: r.contact_lists?.name ?? null,
    enabled: r.enabled,
    last_run_at: r.last_run_at,
    last_status: r.last_status,
    last_error: r.last_error,
    campaign_id: r.campaign_id ?? null,
    campaign_name: r.campaign_name ?? null,
  };
}

/** Campaign names for list syncs that feed one (read separately: before migration 120 there is no column). */
async function withCampaignNames(rows: any[]): Promise<any[]> {
  const ids = [...new Set(rows.map((r) => r.campaign_id).filter(Boolean))];
  if (ids.length === 0) return rows;
  const { data } = await supabaseAdmin.from('campaigns').select('id, name').in('id', ids);
  const names = new Map(((data || []) as any[]).map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...r, campaign_name: names.get(r.campaign_id) ?? null }));
}

async function countLog(integrationId: string, f: (q: any) => any): Promise<number> {
  const { count, error } = await f(supabaseAdmin.from('crm_sync_log').select('id', { count: 'exact', head: true }).eq('integration_id', integrationId));
  if (error) throw error;
  return count || 0;
}

/** Where the account lives in the CRM's own app, read once and kept on the connection. */
async function accountFor(row: IntegrationRow): Promise<CrmAccount | null> {
  const c = row.config || {};
  if (c.portal_id || c.company_domain) return { portal_id: c.portal_id, ui_domain: c.ui_domain, company_domain: c.company_domain };
  try {
    const ctx = await buildCtx(row);
    const account = await ctx.adapter.account();
    if (!account) return null;
    // The connection's current credentials (a HubSpot sign-in may have just been refreshed), plus the account.
    const config = { ...ctx.config, ...Object.fromEntries(Object.entries(account).filter(([, v]) => v)) };
    await supabaseAdmin.from('user_integrations').update({ config }).eq('id', row.id);
    row.config = config;
    return account;
  } catch {
    return null;
  }
}

export const crmSyncService = {
  async overview(userId: string, integrationId: string): Promise<CrmSyncOverview> {
    const row = await loadIntegration(userId, integrationId);
    const provider = row.provider as CrmSyncProvider;
    const base: CrmSyncOverview = {
      integration_id: row.id,
      provider,
      settings: sanitizeCrmSyncSettings(provider, row.sync_settings),
      last_sync_at: (row as any).last_sync_at ?? null,
      next_sync_at: (row as any).next_sync_at ?? null,
      last_sync_error: row.last_sync_error ?? null,
      linked: 0,
      moved_24h: { to_crm: 0, from_crm: 0 },
      failed_24h: 0,
      retryable: 0,
      list_syncs: [],
      backfill: 'sync_backfill' in row ? (publicBackfill((row as any).sync_backfill) as any) : null,
    };
    if (!('sync_cursors' in row)) return { ...base, unavailable: true };
    try {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const [linked, toCrm24, fromCrm24, failed24, retry, lists] = await Promise.all([
        supabaseAdmin.from('crm_links').select('id', { count: 'exact', head: true }).eq('integration_id', row.id).then((r) => { if (r.error) throw r.error; return r.count || 0; }),
        countLog(row.id, (q) => q.eq('direction', 'to_crm').eq('status', 'ok').gte('created_at', since)),
        countLog(row.id, (q) => q.eq('direction', 'from_crm').eq('status', 'ok').gte('created_at', since)),
        countLog(row.id, (q) => q.eq('status', 'failed').gte('created_at', since)),
        countLog(row.id, (q) => q.eq('status', 'failed').not('retry', 'is', null)),
        supabaseAdmin.from('crm_list_syncs').select('*, contact_lists(name)').eq('integration_id', row.id).order('created_at', { ascending: true }),
      ]);
      if (lists.error) throw lists.error;
      return {
        ...base,
        linked,
        moved_24h: { to_crm: toCrm24, from_crm: fromCrm24 },
        failed_24h: failed24,
        retryable: retry,
        list_syncs: (await withCampaignNames(lists.data || [])).map(shapeList),
      };
    } catch (err: any) {
      if (isMissing(err)) return { ...base, unavailable: true };
      throw new AppError(err?.message || 'Could not read the sync status', 500);
    }
  },

  async updateSettings(userId: string, integrationId: string, input: unknown): Promise<CrmSyncSettings> {
    const row = await loadIntegration(userId, integrationId);
    const provider = row.provider as CrmSyncProvider;
    const current = sanitizeCrmSyncSettings(provider, row.sync_settings);
    const merged = sanitizeCrmSyncSettings(provider, { ...current, ...(input && typeof input === 'object' ? input : {}) });
    if (merged.deal_stage && !merged.deal_pipeline) throw new AppError('Choose the pipeline the stage belongs to.', 400);
    const { error } = await supabaseAdmin.from('user_integrations').update({ sync_settings: merged }).eq('id', row.id).eq('user_id', userId);
    if (error) {
      if (isMissing(error)) throw new AppError(NEEDS_MIGRATION, 503);
      throw new AppError(error.message, 500);
    }
    return merged;
  },

  async options(userId: string, integrationId: string): Promise<CrmSyncOptions> {
    const row = await loadIntegration(userId, integrationId);
    const ctx = await buildCtx(row);
    return ctx.adapter.options();
  },

  async log(
    userId: string,
    integrationId: string,
    params: { status?: string; direction?: string; before?: string; limit?: number },
  ): Promise<{ data: CrmSyncLogEntry[]; has_more: boolean; unavailable?: boolean }> {
    await loadIntegration(userId, integrationId);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 50));
    let q = supabaseAdmin
      .from('crm_sync_log')
      .select('id, direction, kind, contact_id, email, status, summary, error, retry, attempts, created_at')
      .eq('integration_id', integrationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (params.status === 'ok' || params.status === 'failed' || params.status === 'skipped') q = q.eq('status', params.status);
    if (params.direction === 'to_crm' || params.direction === 'from_crm') q = q.eq('direction', params.direction);
    if (params.before && !Number.isNaN(Date.parse(params.before))) q = q.lt('created_at', params.before);
    const { data, error } = await q;
    if (error) {
      if (isMissing(error)) return { data: [], has_more: false, unavailable: true };
      throw new AppError(error.message, 500);
    }
    const rows = (data || []) as any[];
    return {
      data: rows.slice(0, limit).map((r) => {
        const { retry, ...rest } = r;
        return { ...rest, retryable: r.status === 'failed' && !!retry } as CrmSyncLogEntry;
      }),
      has_more: rows.length > limit,
    };
  },

  async retry(userId: string, integrationId: string, logId: string) {
    const ctx = await buildCtx(await loadIntegration(userId, integrationId));
    return retryOne(ctx, logId);
  },

  async retryAll(userId: string, integrationId: string): Promise<{ retried: number; fixed: number }> {
    const ctx = await buildCtx(await loadIntegration(userId, integrationId));
    const { data, error } = await supabaseAdmin
      .from('crm_sync_log')
      .select('id')
      .eq('integration_id', integrationId)
      .eq('status', 'failed')
      .not('retry', 'is', null)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) throw new AppError(error.message, 500);
    let fixed = 0;
    for (const r of (data || []) as any[]) {
      const res = await retryOne(ctx, r.id).catch(() => ({ ok: false }));
      if (res.ok) fixed++;
    }
    return { retried: (data || []).length, fixed };
  },

  /** The setup on the sync page: what goes each way first. */
  async startFirstSync(userId: string, integrationId: string, input: CrmBackfillInput) {
    const row = await loadIntegration(userId, integrationId);
    if (!('sync_backfill' in row)) throw new AppError('The first sync needs the latest database update (migration 119).', 503);
    if (!row.is_active) throw new AppError('This connection is paused. Turn it on first.', 400);
    const current = readBackfill((row as any).sync_backfill);
    if (current.status === 'running') throw new AppError('A sync is already running. Wait for it to finish, or stop it.', 409);
    const ctx = await buildCtx(row);

    const toScope = (['all', 'list', 'none'] as const).includes(input?.to_crm?.scope as any) ? input.to_crm.scope : 'none';
    const fromScope = (['all', 'list', 'none'] as const).includes(input?.from_crm?.scope as any) ? input.from_crm.scope : 'none';
    const uuid = /^[0-9a-f-]{36}$/i;

    let toList: string | null = null;
    if (toScope === 'list') {
      toList = String(input.to_crm.list_id || '');
      if (!uuid.test(toList)) throw new AppError('Choose the Sincerely list to send.', 400);
      const { data } = await supabaseAdmin.from('contact_lists').select('id').eq('id', toList).eq('user_id', userId).maybeSingle();
      if (!data) throw new AppError('That Sincerely list was not found.', 404);
    }
    let fromList: string | null = null;
    if (fromScope !== 'none' && input.from_crm.list_id) {
      fromList = String(input.from_crm.list_id);
      if (!uuid.test(fromList)) throw new AppError('That Sincerely list was not found.', 404);
      const { data } = await supabaseAdmin.from('contact_lists').select('id').eq('id', fromList).eq('user_id', userId).maybeSingle();
      if (!data) throw new AppError('That Sincerely list was not found.', 404);
    }
    const externalId = fromScope === 'list' ? String(input.from_crm.external_id || '').trim().slice(0, 100) : null;
    if (fromScope === 'list' && !externalId) throw new AppError(`Choose the ${ctx.label} ${ctx.provider === 'hubspot' ? 'list' : 'filter'} to bring in.`, 400);

    // Totals for the progress bar, where they can be known up front.
    let toTotal: number | null = null;
    if (toScope === 'all') {
      const { count } = await supabaseAdmin.from('contacts').select('id', { count: 'exact', head: true }).eq('user_id', userId).not('email', 'is', null);
      toTotal = count ?? null;
    } else if (toScope === 'list') {
      const { count } = await supabaseAdmin.from('list_contacts').select('contact_id', { count: 'exact', head: true }).eq('list_id', toList!);
      toTotal = count ?? null;
    }
    const fromTotal = fromScope === 'none' ? null : await ctx.adapter.countPeople(externalId || undefined);

    const now = new Date().toISOString();
    const state: BackfillState = {
      status: toScope === 'none' && fromScope === 'none' ? 'done' : 'running',
      setup_done_at: now,
      started_at: now,
      finished_at: toScope === 'none' && fromScope === 'none' ? now : null,
      error: null,
      lease_until: null,
      to_crm: { scope: toScope, list_id: toList, total: toTotal, done: 0, failed: 0, cursor: null, finished: toScope === 'none' },
      from_crm: {
        scope: fromScope, external_id: externalId, external_name: fromScope === 'list' ? String(input.from_crm.external_name || externalId).slice(0, 200) : null,
        list_id: fromList, total: fromTotal, done: 0, added: 0, cursor: null, finished: fromScope === 'none',
      },
    };
    await startBackfill(row, state);
    return publicBackfill(state);
  },

  /** Stop a running first sync. What already moved stays. */
  async stopFirstSync(userId: string, integrationId: string) {
    const row = await loadIntegration(userId, integrationId);
    const state = readBackfill((row as any).sync_backfill);
    if (state.status !== 'running') return publicBackfill(state);
    state.status = 'done';
    state.error = 'Stopped. What had already moved stays.';
    state.finished_at = new Date().toISOString();
    state.lease_until = null;
    await saveBackfill(row.id, state);
    return publicBackfill(state);
  },

  /** Picked people, sent to the CRM: straight away for a few, in the background for many. */
  async sendPeople(userId: string, integrationId: string, contactIds: unknown): Promise<{ queued: boolean; sent: number; failed: number; total: number }> {
    const ids = [...new Set((Array.isArray(contactIds) ? contactIds : []).filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))] as string[];
    if (ids.length === 0) throw new AppError('Pick at least one person.', 400);
    if (ids.length > MAX_IDS) throw new AppError(`Send up to ${MAX_IDS.toLocaleString('en-GB')} at a time.`, 400);
    const row = await loadIntegration(userId, integrationId);
    if (!row.is_active) throw new AppError('This connection is paused. Turn it on first.', 400);
    const ctx = await buildCtx(row);

    if (ids.length <= SEND_NOW_MAX) {
      const side = { scope: 'ids' as const, ids, total: ids.length, done: 0, failed: 0, cursor: null, finished: false };
      const batch = await nextToSend(ctx, side);
      const r = await sendBatch(ctx, batch.contacts);
      if (r.sent) await log(ctx, { direction: 'to_crm', kind: 'contact', status: 'ok', summary: `Sent ${r.sent} ${r.sent === 1 ? 'person' : 'people'} to ${ctx.label} (${r.created} new, ${r.sent - r.created} already there)` });
      return { queued: false, sent: r.sent, failed: r.failed, total: ids.length };
    }

    if (!('sync_backfill' in row)) throw new AppError('Sending many people at once needs the latest database update (migration 119).', 503);
    const current = readBackfill((row as any).sync_backfill);
    if (current.status === 'running') throw new AppError(`A sync with ${ctx.label} is already running. Try again when it finishes.`, 409);
    const now = new Date().toISOString();
    await startBackfill(row, {
      status: 'running', setup_done_at: current.setup_done_at ?? now, started_at: now, finished_at: null, error: null, lease_until: null,
      to_crm: { scope: 'ids', ids, total: ids.length, done: 0, failed: 0, cursor: null, finished: false },
      from_crm: { scope: 'none', total: null, done: 0, added: 0, cursor: null, finished: true },
    });
    return { queued: true, sent: 0, failed: 0, total: ids.length };
  },

  /** How one contact stands in each connected CRM, for the contact page. */
  async contactStatus(userId: string, contactId: string): Promise<CrmContactStatus[]> {
    const { data: rows, error } = await supabaseAdmin
      .from('user_integrations').select('*').eq('user_id', userId).eq('is_active', true).in('provider', ['hubspot', 'pipedrive']);
    if (error) throw new AppError(error.message, 500);
    const out: CrmContactStatus[] = [];
    for (const row of (rows || []) as IntegrationRow[]) {
      const provider = row.provider as CrmSyncProvider;
      const { data: link, error: lErr } = await supabaseAdmin
        .from('crm_links').select('external_id, synced_at, deal_id, deal_status').eq('integration_id', row.id).eq('contact_id', contactId).maybeSingle();
      if (lErr && !isMissing(lErr)) throw new AppError(lErr.message, 500);
      const account = await accountFor(row);
      const { data: recent } = await supabaseAdmin
        .from('crm_sync_log').select('summary, status, created_at').eq('integration_id', row.id).eq('contact_id', contactId)
        .order('created_at', { ascending: false }).limit(3);
      const l = link as any;
      out.push({
        integration_id: row.id,
        provider,
        linked: !!l,
        external_id: l?.external_id ?? null,
        url: l ? recordUrl(provider, account, 'person', l.external_id) : null,
        synced_at: l?.synced_at ?? null,
        deal: l?.deal_id ? { id: l.deal_id, status: l.deal_status ?? null, url: recordUrl(provider, account, 'deal', l.deal_id) } : null,
        recent: ((recent || []) as any[]).map((r) => ({ summary: r.summary, status: r.status, created_at: r.created_at })),
      });
    }
    return out;
  },

  /** "Sync now" on one contact: send them (creating them if needed), then read them back. */
  async syncContactNow(userId: string, integrationId: string, contactId: string): Promise<CrmContactStatus | null> {
    const row = await loadIntegration(userId, integrationId);
    if (!row.is_active) throw new AppError('This connection is paused. Turn it on first.', 400);
    const ctx = await buildCtx(row);
    const contact = await loadContact(userId, contactId);
    if (!contact) throw new AppError('Not found', 404);
    if (!contact.email) throw new AppError('This contact has no email address to match in the CRM.', 400);
    let link = await linkForContact(ctx, contact.id);
    if (!link) {
      link = await ensurePerson(ctx, contact, null);
    } else {
      await pushChanged(ctx, contact, link);
      const [person] = await ctx.adapter.getPeople([link.external_id], [...new Set(ctx.settings.mapping.map((m) => m.crm))]);
      if (person) {
        const fresh = await loadContact(userId, contactId);
        const links = new Map([[link.external_id, { ...link, snapshot: (await linkForContact(ctx, contact.id))?.snapshot ?? link.snapshot }]]);
        if (fresh) await pullPerson(ctx, person, links);
      } else {
        // Gone from the CRM (deleted or merged away): make them again.
        await supabaseAdmin.from('crm_links').delete().eq('integration_id', ctx.integrationId).eq('contact_id', contact.id);
        await ensurePerson(ctx, contact, null);
      }
    }
    const all = await crmSyncService.contactStatus(userId, contactId);
    return all.find((s) => s.integration_id === integrationId) ?? null;
  },

  async addListSync(userId: string, integrationId: string, input: any): Promise<CrmListSync> {
    const row = await loadIntegration(userId, integrationId);
    const externalId = String(input?.external_id || '').trim().slice(0, 100);
    const externalName = String(input?.external_name || '').trim().slice(0, 200) || externalId;
    if (!externalId) throw new AppError('Choose the list to pull in.', 400);

    let listId: string | null = typeof input?.list_id === 'string' && input.list_id ? input.list_id : null;
    if (listId) {
      const { data: list } = await supabaseAdmin.from('contact_lists').select('id').eq('id', listId).eq('user_id', userId).maybeSingle();
      if (!list) throw new AppError('That Sincerely list was not found.', 404);
    } else {
      const name = String(input?.new_list_name || '').trim().slice(0, 120) || `${row.provider === 'hubspot' ? 'HubSpot' : 'Pipedrive'}: ${externalName}`;
      const list = await listsService.create(userId, { name } as any);
      listId = (list as any).id;
    }

    const { data, error } = await supabaseAdmin.from('crm_list_syncs').insert({
      user_id: userId, integration_id: row.id, external_id: externalId, external_name: externalName, list_id: listId,
    }).select('*, contact_lists(name)').single();
    if (error) {
      if (isMissing(error)) throw new AppError(NEEDS_MIGRATION, 503);
      if (/duplicate key|23505/i.test(`${error.message} ${(error as any).code}`)) throw new AppError('That list is already being pulled in.', 409);
      throw new AppError(error.message, 500);
    }
    // The first pull straight away; the schedule keeps it up to date from there.
    const ctx = await buildCtx(row);
    await runListSync(ctx, data as any).catch(() => undefined);
    const { data: fresh } = await supabaseAdmin.from('crm_list_syncs').select('*, contact_lists(name)').eq('id', (data as any).id).single();
    return shapeList((await withCampaignNames([fresh || data]))[0]);
  },

  async updateListSync(userId: string, integrationId: string, id: string, input: any): Promise<CrmListSync> {
    await loadIntegration(userId, integrationId);
    const patch: Record<string, any> = {};
    if (typeof input?.enabled === 'boolean') patch.enabled = input.enabled;
    if (typeof input?.list_id === 'string' && input.list_id) {
      const { data: list } = await supabaseAdmin.from('contact_lists').select('id').eq('id', input.list_id).eq('user_id', userId).maybeSingle();
      if (!list) throw new AppError('That Sincerely list was not found.', 404);
      patch.list_id = input.list_id;
    }
    if (input && 'campaign_id' in input) {
      if (input.campaign_id) {
        const { data: camp } = await supabaseAdmin.from('campaigns').select('id').eq('id', String(input.campaign_id)).eq('user_id', userId).maybeSingle();
        if (!camp) throw new AppError('That campaign was not found.', 404);
        patch.campaign_id = String(input.campaign_id);
      } else {
        patch.campaign_id = null;
      }
    }
    const { data, error } = await supabaseAdmin.from('crm_list_syncs').update(patch)
      .eq('id', id).eq('integration_id', integrationId).eq('user_id', userId)
      .select('*, contact_lists(name)').maybeSingle();
    if (error) {
      if (isMissing(error)) throw new AppError('Feeding a campaign needs the latest database update (migration 120).', 503);
      throw new AppError(error.message, 500);
    }
    if (!data) throw new AppError('Not found', 404);
    return shapeList((await withCampaignNames([data]))[0]);
  },

  async removeListSync(userId: string, integrationId: string, id: string): Promise<{ deleted: true }> {
    await loadIntegration(userId, integrationId);
    const { error } = await supabaseAdmin.from('crm_list_syncs').delete().eq('id', id).eq('integration_id', integrationId).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    return { deleted: true };
  },

  async runListNow(userId: string, integrationId: string, id: string) {
    const row = await loadIntegration(userId, integrationId);
    const { data, error } = await supabaseAdmin.from('crm_list_syncs').select('*').eq('id', id).eq('integration_id', integrationId).eq('user_id', userId).maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Not found', 404);
    return runListSync(await buildCtx(row), data as any);
  },
};
