/* ═══════════════════════════════════════════════════════════════════════
   Webhooks in the v1 format.

   The app's internal events carry whatever each sender had to hand - an
   id here, a half-row there. An endpoint made through the API (or by
   Zapier, Make, n8n) instead receives one stable shape per event type,
   with the whole contact and the campaign filled in, so a Zap can map
   "first name" without a second request:

     { id: "evt_...", object: "event", type: "reply.interested",
       created_at, api_version, data: { contact, campaign, reply } }

   Signed with Sincerely-Signature: t=<unix>,v1=<hmac of "t.body">. The
   timestamp is inside the signature, so a captured delivery cannot be
   replayed later. An endpoint that answers 410 Gone is switched off: that
   is how Zapier says a Zap was deleted.
   ═══════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto';
import {
  INTERESTED_INTENTS, INTERNAL_TO_PUBLIC, PUBLIC_API_VERSION, PUBLIC_EVENTS, SIGNATURE_HEADER,
  publicEventExample, type PublicEventType,
} from '@lemlist/shared';
import { supabaseAdmin } from '../config/supabase.js';
import { assertSafeWebhookUrl, pinnedPost } from '../services/webhook.service.js';
import { CONTACT_SELECT, REPLY_SELECT, contactOut, replyOut } from './serialize.js';

export interface PublicEvent {
  id: string;
  object: 'event';
  type: PublicEventType;
  created_at: string;
  api_version: string;
  data: Record<string, unknown>;
}

interface V1Endpoint { id: string; url: string; secret: string | null; events: string[]; is_active: boolean }

const newEventId = () => `evt_${crypto.randomBytes(12).toString('hex')}`;

/* ── Building ────────────────────────────────────────────────────────── */

async function contactById(userId: string, id: unknown) {
  if (typeof id !== 'string' || !id) return null;
  const { data } = await supabaseAdmin.from('contacts').select(CONTACT_SELECT).eq('id', id).eq('user_id', userId).maybeSingle();
  return data ? contactOut(data) : null;
}

async function campaignById(userId: string, id: unknown) {
  if (typeof id !== 'string' || !id) return null;
  const { data } = await supabaseAdmin.from('campaigns').select('id, name, status').eq('id', id).eq('user_id', userId).maybeSingle();
  return data ? { id: data.id, name: data.name, status: data.status } : null;
}

async function replyByInboxId(userId: string, id: unknown) {
  if (typeof id !== 'string' || !id) return null;
  const { data } = await supabaseAdmin.from('inbox_messages').select(REPLY_SELECT).eq('id', id).eq('user_id', userId).maybeSingle();
  return data ? replyOut(data) : null;
}

async function replyByMessageId(userId: string, messageId: unknown, contactId: unknown) {
  if (typeof messageId === 'string' && messageId) {
    const { data } = await supabaseAdmin.from('inbox_messages').select(REPLY_SELECT)
      .eq('user_id', userId).eq('message_id', messageId).eq('direction', 'inbound')
      .order('received_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return replyOut(data);
  }
  if (typeof contactId === 'string' && contactId) {
    const { data } = await supabaseAdmin.from('inbox_messages').select(REPLY_SELECT)
      .eq('user_id', userId).eq('contact_id', contactId).eq('direction', 'inbound')
      .order('received_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return replyOut(data);
  }
  return null;
}

const idOf = (data: Record<string, any>, key: 'contact' | 'campaign'): unknown =>
  data[`${key}_id`] ?? data[key]?.id;

/**
 * The public events one internal event becomes, filled in. Usually one;
 * a classified reply is also an "interested reply" when that is what it was.
 */
export async function publicEventsFor(userId: string, internalType: string, data: Record<string, any>): Promise<PublicEvent[]> {
  const types = INTERNAL_TO_PUBLIC[internalType];
  if (!types || !types.length) return [];
  // The auto-deal note repeats a classification that was already announced.
  if (internalType === 'sara.intent_classified' && data.auto_deal_created) return [];

  const wanted = types.filter((t) => t !== 'reply.interested' || INTERESTED_INTENTS.includes(String(data.intent)));
  if (!wanted.length) return [];

  const [contact, campaign] = await Promise.all([
    data.contact && typeof data.contact === 'object' && data.contact.email && data.contact.created_at
      ? contactById(userId, data.contact.id).then((c) => c ?? contactOut(data.contact))
      : contactById(userId, idOf(data, 'contact')),
    data.campaign && typeof data.campaign === 'object' && data.campaign.id
      ? Promise.resolve({ id: data.campaign.id, name: data.campaign.name ?? null, status: data.campaign.status ?? null })
      : campaignById(userId, idOf(data, 'campaign')),
  ]);

  let body: Record<string, unknown> = {};
  switch (internalType) {
    case 'contact.created':
    case 'contact.updated':
      if (!contact) return [];
      body = { contact };
      break;
    case 'lead.unsubscribed':
      if (!contact) return [];
      body = { contact, campaign, source: data.source ?? (campaign ? 'link' : null) };
      break;
    case 'email.sent':
      body = { contact, campaign, email: { step_id: data.step_id ?? null, subject: data.subject ?? null, to: data.to ?? contact?.email ?? null } };
      break;
    case 'email.opened':
      body = { contact, campaign, email: { step_id: data.step_id ?? null } };
      break;
    case 'email.clicked':
      body = { contact, campaign, email: { step_id: data.step_id ?? null, url: data.url ?? null } };
      break;
    case 'email.bounced':
      body = { contact, campaign, email: { kind: data.kind ?? null, to: data.to ?? contact?.email ?? null, reason: data.reason ?? null } };
      break;
    case 'email.replied': {
      const reply = (await replyByMessageId(userId, data.message_id, idOf(data, 'contact'))) ?? {
        id: null, object: 'reply', contact_id: contact?.id ?? null, campaign_id: campaign?.id ?? null,
        from_email: data.from ?? contact?.email ?? null, from_name: data.from_name ?? null, subject: data.subject ?? null,
        text: data.excerpt ?? null, received_at: new Date().toISOString(), intent: null, intent_confidence: null,
      };
      body = { contact, campaign, reply };
      break;
    }
    case 'sara.intent_classified': {
      const reply = await replyByInboxId(userId, data.message_id);
      if (!reply) return [];
      const [c2, k2] = await Promise.all([
        contact ?? contactById(userId, reply.contact_id),
        campaign ?? campaignById(userId, reply.campaign_id),
      ]);
      body = { contact: c2, campaign: k2, reply: { ...reply, intent: data.intent ?? reply.intent, intent_confidence: typeof data.confidence === 'number' ? Math.round(data.confidence * 100) / 100 : reply.intent_confidence } };
      break;
    }
    case 'campaign.launched':
    case 'campaign.paused':
    case 'campaign.completed': {
      const full = await campaignById(userId, idOf(data, 'campaign'));
      const c = full ?? campaign;
      if (!c) return [];
      body = { campaign: c, ...(internalType === 'campaign.paused' ? { reason: data.reason ?? null } : {}) };
      break;
    }
    default:
      return [];
  }

  const now = new Date().toISOString();
  return wanted.map((type) => ({ id: newEventId(), object: 'event', type, created_at: now, api_version: PUBLIC_API_VERSION, data: body }));
}

/* ── Delivering ──────────────────────────────────────────────────────── */

export function signV1(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** For receivers (and our tests): is this signature good and fresh? */
export function verifyV1(secret: string, body: string, header: string, toleranceSeconds = 300, now = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.trim().split('=')).filter((kv) => kv.length === 2)) as Record<string, string>;
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(now - t) > toleranceSeconds) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const a = Buffer.from(want, 'hex');
  const b = Buffer.from(parts.v1, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DeliveryOutcome { delivered: boolean; status: number | null; duration_ms: number; response: string; attempts: number }

/**
 * One event to one endpoint: up to three tries, 2 s then 4 s apart. A 4xx
 * is the receiver's answer and is not retried; 410 also switches the
 * endpoint off. Every delivery lands in webhook_deliveries, like the rest.
 */
export async function deliverV1(endpoint: V1Endpoint, event: PublicEvent, opts: { retries?: boolean } = {}): Promise<DeliveryOutcome> {
  const body = JSON.stringify(event);
  let addresses: string[];
  try {
    addresses = await assertSafeWebhookUrl(endpoint.url);
  } catch (err: any) {
    const response = `Blocked: ${err?.message || 'unsafe destination'}`;
    await logDelivery(endpoint.id, event, null, response, false, 0);
    return { delivered: false, status: null, duration_ms: 0, response, attempts: 0 };
  }

  const maxAttempts = opts.retries === false ? 1 : 3;
  let status: number | null = null;
  let response = '';
  let delivered = false;
  let attempts = 0;
  let duration = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const t0 = Date.now();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Sincerely-Webhooks/1.0 (+https://sincerely.app)',
        'Sincerely-Event': event.type,
        'Sincerely-Event-Id': event.id,
        'Sincerely-Delivery-Attempt': String(attempt),
      };
      if (endpoint.secret) headers[SIGNATURE_HEADER] = signV1(endpoint.secret, body);
      const res = await pinnedPost(endpoint.url, addresses, headers, body, 15_000);
      status = res.statusCode;
      response = res.body;
      delivered = status >= 200 && status < 300;
    } catch (err: any) {
      status = 0;
      response = err?.message || 'Network error';
      delivered = false;
    }
    duration = Date.now() - t0;
    if (delivered) break;
    if (status !== null && status >= 400 && status < 500) break;
    if (attempt < maxAttempts) await sleep(attempt * 2000);
  }

  await logDelivery(endpoint.id, event, status, response, delivered, attempts);

  if (status === 410) {
    const { error } = await supabaseAdmin.from('webhook_endpoints').update({ is_active: false }).eq('id', endpoint.id);
    if (error) console.error('[Webhook v1] could not switch off a 410 endpoint:', error.message);
    else console.log(`[Webhook v1] ${endpoint.id} answered 410 Gone, switched off`);
  }

  return { delivered, status, duration_ms: duration, response: response.slice(0, 1000), attempts };
}

async function logDelivery(endpointId: string, event: PublicEvent, status: number | null, response: string, success: boolean, attempts: number) {
  const { error } = await supabaseAdmin.from('webhook_deliveries').insert({
    endpoint_id: endpointId,
    event_type: event.type,
    payload: event,
    status_code: status,
    response_body: String(response || '').substring(0, 1000),
    success,
    attempts,
    last_attempt_at: new Date().toISOString(),
  });
  if (error) console.error('[Webhook v1] could not log a delivery:', error.message);
}

/**
 * Called by fireEvent for an account's v1 endpoints. Builds each public
 * event once and sends it to every endpoint that asked for it.
 */
export async function dispatchV1(userId: string, internalType: string, data: Record<string, any>, endpoints: V1Endpoint[]): Promise<void> {
  if (!INTERNAL_TO_PUBLIC[internalType]) return;
  const interested = endpoints.filter((e) => e.is_active && INTERNAL_TO_PUBLIC[internalType].some((t) => (e.events || []).includes(t)));
  if (!interested.length) return;
  const events = await publicEventsFor(userId, internalType, data);
  for (const event of events) {
    for (const endpoint of interested) {
      if (!(endpoint.events || []).includes(event.type)) continue;
      deliverV1(endpoint, event).catch((err) => console.error('[Webhook v1] delivery error:', err?.message || err));
    }
  }
}

/* ── Samples ─────────────────────────────────────────────────────────── */

/**
 * What an event of this type looks like, made from this account's own
 * latest data where there is some, so a Zap's field picker shows real
 * names. Falls back to the documented example.
 */
export async function sampleEvent(userId: string, type: PublicEventType): Promise<PublicEvent> {
  const fallback = (): PublicEvent => ({ ...publicEventExample(type), id: newEventId() } as PublicEvent);
  try {
    let internal: string | null = null;
    let data: Record<string, any> | null = null;

    if (type === 'contact.created' || type === 'contact.updated' || type === 'contact.unsubscribed') {
      let q = supabaseAdmin.from('contacts').select('id').eq('user_id', userId);
      if (type === 'contact.unsubscribed') q = q.eq('is_unsubscribed', true);
      const { data: row } = await q.order(type === 'contact.updated' ? 'updated_at' : 'created_at', { ascending: false }).limit(1).maybeSingle();
      if (row) {
        internal = type === 'contact.unsubscribed' ? 'lead.unsubscribed' : type;
        data = { contact_id: row.id, source: type === 'contact.unsubscribed' ? 'link' : undefined };
      }
    } else if (type.startsWith('email.')) {
      const activity = ({ 'email.sent': 'sent', 'email.opened': 'opened', 'email.clicked': 'clicked', 'email.bounced': 'bounced' } as Record<string, string>)[type];
      const { data: row } = await supabaseAdmin.from('campaign_activities')
        .select('contact_id, campaign_id, step_id, metadata, campaigns!inner(user_id)')
        .eq('campaigns.user_id', userId).eq('activity_type', activity)
        .order('occurred_at', { ascending: false }).limit(1).maybeSingle();
      if (row) {
        internal = type;
        const m: any = row.metadata || {};
        data = { contact_id: row.contact_id, campaign_id: row.campaign_id, step_id: row.step_id, url: m.url, subject: m.subject, kind: m.kind, reason: m.reason };
      }
    } else if (type.startsWith('reply.')) {
      let q = supabaseAdmin.from('inbox_messages').select('id, contact_id, campaign_id, message_id, sara_intent, sara_confidence')
        .eq('user_id', userId).eq('direction', 'inbound').not('contact_id', 'is', null);
      if (type === 'reply.interested') q = q.in('sara_intent', INTERESTED_INTENTS);
      if (type === 'reply.classified') q = q.not('sara_intent', 'is', null);
      const { data: row } = await q.order('received_at', { ascending: false }).limit(1).maybeSingle();
      if (row) {
        if (type === 'reply.received') {
          internal = 'email.replied';
          data = { contact_id: row.contact_id, campaign_id: row.campaign_id, message_id: row.message_id };
        } else {
          internal = 'sara.intent_classified';
          data = { message_id: row.id, intent: row.sara_intent, confidence: row.sara_confidence, contact_id: row.contact_id };
        }
      }
    } else if (type.startsWith('campaign.')) {
      const status = ({ 'campaign.launched': ['running', 'paused', 'completed'], 'campaign.paused': ['paused'], 'campaign.completed': ['completed'] } as Record<string, string[]>)[type];
      const { data: row } = await supabaseAdmin.from('campaigns').select('id').eq('user_id', userId).in('status', status)
        .order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (row) { internal = type; data = { campaign_id: row.id }; }
    }

    if (!internal || !data) return fallback();
    const events = await publicEventsFor(userId, internal, data);
    const match = events.find((e) => e.type === type);
    // A sample is for mapping fields: one missing the contact (since deleted) would hide them all.
    if (!match || (!type.startsWith('campaign.') && !(match.data as any).contact)) return fallback();
    return match;
  } catch (e: any) {
    console.warn('[Webhook v1] sample fell back to the example:', e?.message || e);
    return fallback();
  }
}

export const EVENT_TYPE_LIST = PUBLIC_EVENTS.map((e) => ({ object: 'event_type' as const, type: e.type, title: e.title, description: e.description }));
