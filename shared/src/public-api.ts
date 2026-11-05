/* ═══════════════════════════════════════════════════════════════════════
   The Sincerely public API, v1: one definition for everything.

   Every endpoint, object, event and error code is defined here once. The
   server mounts its routes from it (and refuses to start a route that is
   not here), the OpenAPI document is generated from it, and the reference
   in the app and its code samples are drawn from it. So the docs cannot
   describe an endpoint that does not exist, or miss one that does.

   Conventions, the same everywhere:
   - JSON in and out, snake_case, ISO 8601 times in UTC, ids are UUIDs.
   - Every object carries `object` ("contact", "list", ...).
   - Lists return { object: "list", data, has_more, next_cursor }. Pass
     next_cursor back as `cursor` for the next page. Newest first.
   - Errors return { error: { type, code, message, param?, doc_url },
     request_id } with a matching HTTP status.
   - POST, PATCH and DELETE accept an Idempotency-Key header: the same key
     within 24 hours returns the first answer instead of acting twice.
   - Every response carries X-Request-Id and the rate-limit headers.
   - In a body, null clears a field; an empty string is treated as not sent
     (so an unmapped field in Zapier or Make never blanks your data).
   ═══════════════════════════════════════════════════════════════════════ */

export const PUBLIC_API_VERSION = '2026-11-01';
export const PUBLIC_API_PREFIX = '/v1';

export type ApiScope = 'read' | 'write' | 'none';
export type ApiType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'string[]' | 'object[]';

export interface ApiField {
  name: string;
  type: ApiType;
  description: string;
  required?: boolean;
  enum?: readonly string[];
  example?: unknown;
  nullable?: boolean;
}

export interface ApiParam extends ApiField {
  in: 'path' | 'query';
}

export type ApiGroup = 'Account' | 'Contacts' | 'Lists' | 'Campaigns' | 'Tags' | 'Activity' | 'Replies' | 'Suppressions' | 'Webhooks';

export interface ApiEndpoint {
  /** Stable id: what the server's handler is registered under. */
  id: string;
  group: ApiGroup;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** OpenAPI-style path, with {params}. */
  path: string;
  summary: string;
  description: string;
  scope: ApiScope;
  params?: ApiParam[];
  body?: ApiField[];
  bodyExample?: Record<string, unknown>;
  /** The object it returns, or 'list:<object>' for a page of them. */
  returns: string;
  status?: number;
  responseExample: unknown;
  /** Error codes this endpoint can return, beyond the common ones. */
  errors?: string[];
}

/* ── Errors ──────────────────────────────────────────────────────────── */

export type ApiErrorType =
  | 'invalid_request_error' | 'authentication_error' | 'permission_error' | 'not_found_error'
  | 'conflict_error' | 'idempotency_error' | 'rate_limit_error' | 'api_error';

export interface ApiErrorCode { code: string; status: number; type: ApiErrorType; meaning: string }

export const API_ERROR_CODES: ApiErrorCode[] = [
  { code: 'missing_api_key', status: 401, type: 'authentication_error', meaning: 'No API key was sent. Send it as "Authorization: Bearer sk_live_...".' },
  { code: 'invalid_api_key', status: 401, type: 'authentication_error', meaning: 'The key is wrong, revoked or expired.' },
  { code: 'insufficient_scope', status: 403, type: 'permission_error', meaning: 'The key does not have the scope this needs (read for GET, write for the rest).' },
  { code: 'parameter_invalid', status: 400, type: 'invalid_request_error', meaning: 'A field or parameter has a value that is not allowed; `param` names it.' },
  { code: 'parameter_missing', status: 400, type: 'invalid_request_error', meaning: 'A required field or parameter is missing; `param` names it.' },
  { code: 'body_invalid', status: 400, type: 'invalid_request_error', meaning: 'The body is not valid JSON, or not a JSON object.' },
  { code: 'cursor_invalid', status: 400, type: 'invalid_request_error', meaning: 'The cursor is not one this API gave out.' },
  { code: 'resource_not_found', status: 404, type: 'not_found_error', meaning: 'There is no such object in this account.' },
  { code: 'route_not_found', status: 404, type: 'not_found_error', meaning: 'There is no such endpoint. Check the method and path.' },
  { code: 'contact_exists', status: 409, type: 'conflict_error', meaning: 'A contact with this email already exists. Send "upsert": true to update it instead; its id is in `existing_id`.' },
  { code: 'list_exists', status: 409, type: 'conflict_error', meaning: 'You already have a list with this name.' },
  { code: 'campaign_finished', status: 409, type: 'conflict_error', meaning: 'The campaign has finished, so nobody can be added to it.' },
  { code: 'campaign_state', status: 409, type: 'conflict_error', meaning: 'The campaign is not in a state where that can be done.' },
  { code: 'idempotency_key_reused', status: 422, type: 'idempotency_error', meaning: 'This Idempotency-Key was used for a different request. Use a new key per request.' },
  { code: 'idempotency_key_in_flight', status: 409, type: 'idempotency_error', meaning: 'A request with this Idempotency-Key is still running. Retry shortly.' },
  { code: 'rate_limited', status: 429, type: 'rate_limit_error', meaning: 'Too many requests for this key this minute. Wait Retry-After seconds.' },
  { code: 'account_suspended', status: 403, type: 'permission_error', meaning: 'This Sincerely account is suspended. Contact support.' },
  { code: 'plan_limit', status: 403, type: 'permission_error', meaning: 'Your plan does not allow this (for example, more mailboxes or contacts).' },
  { code: 'internal_error', status: 500, type: 'api_error', meaning: 'Something went wrong on our side. It is safe to retry with the same Idempotency-Key.' },
];

/* ── Objects ─────────────────────────────────────────────────────────── */

const T = '2026-11-03T09:41:00.000Z';
const ID = {
  contact: '6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f',
  list: 'b2d4f6a8-1c3e-4a5b-8c7d-9e0f1a2b3c4d',
  campaign: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e',
  step: 'd4f6b8c0-3e5a-4c7d-8e9f-1a2b3c4d5e6f',
  activity: 'e5a7c9d1-4f6b-4d8e-9f0a-2b3c4d5e6f7a',
  reply: 'f6b8d0e2-5a7c-4e9f-8a1b-3c4d5e6f7a8b',
  webhook: 'a7c9e1f3-6b8d-4f0a-9b2c-4d5e6f7a8b9c',
};

export const CONTACT_EXAMPLE = {
  id: ID.contact,
  object: 'contact',
  email: 'ada@analyticalengines.co.uk',
  first_name: 'Ada',
  last_name: 'Lovelace',
  full_name: 'Ada Lovelace',
  job_title: 'Head of Partnerships',
  company: 'Analytical Engines',
  phone: '+44 20 7946 0000',
  linkedin_url: 'https://www.linkedin.com/in/ada-lovelace',
  website: 'https://analyticalengines.co.uk',
  location: 'London, United Kingdom',
  city: 'London',
  state: null,
  country: 'United Kingdom',
  industry: 'Software',
  lifecycle: 'lead',
  custom_fields: { source_campaign: 'Webinar Q4' },
  tags: ['webinar', 'uk'],
  list_ids: [ID.list],
  email_status: 'valid',
  unsubscribed: false,
  bounced: false,
  engagement_score: 62,
  source: 'api',
  created_at: T,
  updated_at: T,
};

export const LIST_EXAMPLE = {
  id: ID.list, object: 'list', name: 'UK partnerships', description: 'Heads of partnerships at UK fintechs',
  kind: 'lead', contact_count: 412, created_at: T, updated_at: T,
};

export const CAMPAIGN_EXAMPLE = {
  id: ID.campaign, object: 'campaign', name: 'Q4 partnerships', status: 'running', list_id: ID.list,
  created_at: T, updated_at: T,
  stats: { enrolled: 412, sent: 980, opened: 401, clicked: 57, replied: 38, bounced: 6, unsubscribed: 4 },
};

export const ENROLMENT_EXAMPLE = {
  object: 'enrolment', campaign_id: ID.campaign, contact_id: ID.contact, email: CONTACT_EXAMPLE.email,
  status: 'active', current_step: 2, enrolled_at: T, next_send_at: '2026-11-05T09:00:00.000Z', completed_at: null,
};

export const ACTIVITY_EXAMPLE = {
  id: ID.activity, object: 'activity', type: 'opened', contact_id: ID.contact, campaign_id: ID.campaign,
  step_id: ID.step, occurred_at: T, metadata: {},
};

export const REPLY_EXAMPLE = {
  id: ID.reply, object: 'reply', contact_id: ID.contact, campaign_id: ID.campaign,
  from_email: CONTACT_EXAMPLE.email, from_name: 'Ada Lovelace', subject: 'Re: partnering with Analytical Engines',
  text: 'Thanks - this is timely. Could we talk on Thursday?', received_at: T,
  intent: 'meeting', intent_confidence: 0.94,
};

export const TAG_EXAMPLE = { object: 'tag', id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'webinar', color: '#6B7280', created_at: T };
export const SUPPRESSION_EXAMPLE = { object: 'suppression', email: 'no-thanks@example.com', reason: 'manual', created_at: T };

export const WEBHOOK_EXAMPLE = {
  id: ID.webhook, object: 'webhook', url: 'https://hooks.example.com/sincerely', description: 'CRM sync',
  events: ['reply.received', 'reply.interested'], active: true, source: 'api', created_at: T, updated_at: T,
};

export const ME_EXAMPLE = {
  object: 'account', user_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', email: 'alex@affivault.com',
  api_key: { id: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e', name: 'Zapier', scopes: ['read', 'write'], rate_limit_per_minute: 100 },
  api_version: PUBLIC_API_VERSION,
};

const LIFECYCLES = ['lead', 'contact', 'customer'] as const;
const EMAIL_STATUSES = ['valid', 'risky', 'unverified', 'invalid', 'not_found', 'bounced', 'no_email'] as const;
export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'] as const;
export const API_LIST_KINDS = ['lead', 'contact'] as const;
export const ACTIVITY_TYPES = ['sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed', 'complained', 'auto_reply', 'deferred', 'skipped'] as const;
export const REPLY_INTENTS = ['interested', 'meeting', 'objection', 'not_now', 'unsubscribe', 'out_of_office', 'bounce', 'other'] as const;
export const SUPPRESSION_REASONS = ['unsubscribed', 'bounced', 'complained', 'manual'] as const;

/** The fields a contact can be created or updated with. */
export const CONTACT_WRITE_FIELDS: ApiField[] = [
  { name: 'email', type: 'string', required: true, description: 'Email address. Stored lower-case; one contact per address.', example: 'ada@analyticalengines.co.uk' },
  { name: 'first_name', type: 'string', description: 'First name.' },
  { name: 'last_name', type: 'string', description: 'Last name.' },
  { name: 'job_title', type: 'string', description: 'Job title.' },
  { name: 'company', type: 'string', description: 'Company name.' },
  { name: 'phone', type: 'string', description: 'Phone number, any format.' },
  { name: 'linkedin_url', type: 'string', description: 'LinkedIn profile URL.' },
  { name: 'website', type: 'string', description: 'Website.' },
  { name: 'location', type: 'string', description: 'Free-text location.' },
  { name: 'city', type: 'string', description: 'City.' },
  { name: 'state', type: 'string', description: 'State or region.' },
  { name: 'country', type: 'string', description: 'Country.' },
  { name: 'industry', type: 'string', description: 'Industry.' },
  { name: 'custom_fields', type: 'object', description: 'Your own fields, as { "name": "value" }. Merged with existing custom fields on update; send a value of null to remove one.' },
  { name: 'tags', type: 'string[]', description: 'Tag names. Created if they do not exist. On update this replaces the contact\'s tags.' },
  { name: 'list_ids', type: 'string[]', description: 'Lists to add the contact to. On update, lists are only ever added to, never removed from.' },
  { name: 'lifecycle', type: 'string', enum: LIFECYCLES, description: '"lead" (default for new contacts: someone you are prospecting), "contact" (a relationship) or "customer".' },
];

export interface ApiObject { name: string; description: string; fields: ApiField[]; example: unknown }

export const API_OBJECTS: ApiObject[] = [
  {
    name: 'contact',
    description: 'A person in Sincerely: a lead you are prospecting, a contact you have a relationship with, or a customer.',
    example: CONTACT_EXAMPLE,
    fields: [
      { name: 'id', type: 'string', description: 'Unique id.' },
      { name: 'object', type: 'string', description: 'Always "contact".' },
      ...CONTACT_WRITE_FIELDS.filter((f) => !['tags', 'list_ids', 'lifecycle'].includes(f.name)).map((f) => ({ ...f, required: f.name === 'email', nullable: f.name !== 'email' && f.name !== 'custom_fields' })),
      { name: 'full_name', type: 'string', nullable: true, description: 'First and last name together.' },
      { name: 'lifecycle', type: 'string', enum: LIFECYCLES, description: 'Where they are: lead, contact or customer.' },
      { name: 'tags', type: 'string[]', description: 'Tag names.' },
      { name: 'list_ids', type: 'string[]', description: 'Lists they are in.' },
      { name: 'email_status', type: 'string', enum: EMAIL_STATUSES, description: 'What verification says about the address.' },
      { name: 'unsubscribed', type: 'boolean', description: 'They asked not to be emailed.' },
      { name: 'bounced', type: 'boolean', description: 'Mail to them has hard-bounced.' },
      { name: 'engagement_score', type: 'integer', nullable: true, description: '0-100, from replies, meetings, clicks and opens.' },
      { name: 'source', type: 'string', description: 'How they arrived: api, csv_import, manual, prospector, ...' },
      { name: 'created_at', type: 'string', description: 'When they were added.' },
      { name: 'updated_at', type: 'string', description: 'When they last changed.' },
    ],
  },
  {
    name: 'list', description: 'A list of contacts. Lead lists feed campaigns; contact lists organise your CRM.', example: LIST_EXAMPLE,
    fields: [
      { name: 'id', type: 'string', description: 'Unique id.' },
      { name: 'name', type: 'string', description: 'Name.' },
      { name: 'description', type: 'string', nullable: true, description: 'Description.' },
      { name: 'kind', type: 'string', enum: API_LIST_KINDS, description: '"lead" (people campaigns send to) or "contact" (a CRM list).' },
      { name: 'contact_count', type: 'integer', description: 'How many contacts are in it.' },
      { name: 'created_at', type: 'string', description: 'Created.' },
      { name: 'updated_at', type: 'string', description: 'Last changed.' },
    ],
  },
  {
    name: 'campaign', description: 'An email sequence. Contacts are enrolled into it and move through its steps.', example: CAMPAIGN_EXAMPLE,
    fields: [
      { name: 'id', type: 'string', description: 'Unique id.' },
      { name: 'name', type: 'string', description: 'Name.' },
      { name: 'status', type: 'string', enum: CAMPAIGN_STATUSES, description: 'Where it is.' },
      { name: 'list_id', type: 'string', nullable: true, description: 'The lead list it sends to, if bound to one.' },
      { name: 'stats', type: 'object', description: 'Totals: enrolled, sent, opened, clicked, replied, bounced, unsubscribed. On the single-campaign endpoint.' },
      { name: 'created_at', type: 'string', description: 'Created.' },
      { name: 'updated_at', type: 'string', description: 'Last changed.' },
    ],
  },
  {
    name: 'enrolment', description: 'A contact in a campaign, and how far through it they are.', example: ENROLMENT_EXAMPLE,
    fields: [
      { name: 'campaign_id', type: 'string', description: 'The campaign.' },
      { name: 'contact_id', type: 'string', description: 'The contact.' },
      { name: 'email', type: 'string', description: 'Their address.' },
      { name: 'status', type: 'string', description: 'pending, active, completed, replied, bounced, unsubscribed, suppressed, paused, ...' },
      { name: 'current_step', type: 'integer', description: 'How many steps of the sequence they have reached (0 before the first email).' },
      { name: 'enrolled_at', type: 'string', description: 'When they were added.' },
      { name: 'next_send_at', type: 'string', nullable: true, description: 'When the next email is due.' },
      { name: 'completed_at', type: 'string', nullable: true, description: 'When they finished the sequence.' },
    ],
  },
  {
    name: 'activity', description: 'Something that happened to a contact in a campaign: an email sent, opened, clicked, replied to, bounced...', example: ACTIVITY_EXAMPLE,
    fields: [
      { name: 'id', type: 'string', description: 'Unique id.' },
      { name: 'type', type: 'string', enum: ACTIVITY_TYPES, description: 'What happened.' },
      { name: 'contact_id', type: 'string', description: 'Who.' },
      { name: 'campaign_id', type: 'string', description: 'In which campaign.' },
      { name: 'step_id', type: 'string', nullable: true, description: 'Which step\'s email.' },
      { name: 'occurred_at', type: 'string', description: 'When.' },
      { name: 'metadata', type: 'object', description: 'Details for the type (for a click, the link).' },
    ],
  },
  {
    name: 'reply', description: 'An email a contact sent back, with what Relay read in it.', example: REPLY_EXAMPLE,
    fields: [
      { name: 'id', type: 'string', description: 'Unique id.' },
      { name: 'contact_id', type: 'string', nullable: true, description: 'Who replied, when known.' },
      { name: 'campaign_id', type: 'string', nullable: true, description: 'The campaign it answers, when known.' },
      { name: 'from_email', type: 'string', description: 'Sender address.' },
      { name: 'from_name', type: 'string', nullable: true, description: 'Sender name.' },
      { name: 'subject', type: 'string', nullable: true, description: 'Subject.' },
      { name: 'text', type: 'string', nullable: true, description: 'The plain-text body (up to 10,000 characters).' },
      { name: 'received_at', type: 'string', description: 'When it arrived.' },
      { name: 'intent', type: 'string', enum: REPLY_INTENTS, nullable: true, description: 'What Relay read: interested, meeting, objection, not_now, ...' },
      { name: 'intent_confidence', type: 'number', nullable: true, description: '0-1.' },
    ],
  },
  {
    name: 'tag', description: 'A label on contacts.', example: TAG_EXAMPLE,
    fields: [
      { name: 'id', type: 'string', description: 'Unique id.' },
      { name: 'name', type: 'string', description: 'Name.' },
      { name: 'color', type: 'string', description: 'Hex colour.' },
      { name: 'created_at', type: 'string', description: 'Created.' },
    ],
  },
  {
    name: 'suppression', description: 'An address Sincerely will never email.', example: SUPPRESSION_EXAMPLE,
    fields: [
      { name: 'email', type: 'string', description: 'The address.' },
      { name: 'reason', type: 'string', enum: SUPPRESSION_REASONS, description: 'Why.' },
      { name: 'created_at', type: 'string', description: 'Since when.' },
    ],
  },
  {
    name: 'webhook', description: 'An address Sincerely sends events to as they happen.', example: WEBHOOK_EXAMPLE,
    fields: [
      { name: 'id', type: 'string', description: 'Unique id.' },
      { name: 'url', type: 'string', description: 'Where events are sent (https).' },
      { name: 'description', type: 'string', nullable: true, description: 'What it is for.' },
      { name: 'events', type: 'string[]', description: 'Event types it receives.' },
      { name: 'active', type: 'boolean', description: 'Whether events are being sent.' },
      { name: 'source', type: 'string', description: 'Who made it: api, zapier, make or n8n.' },
      { name: 'secret', type: 'string', description: 'The signing secret. Only returned when the webhook is created.' },
      { name: 'created_at', type: 'string', description: 'Created.' },
      { name: 'updated_at', type: 'string', description: 'Last changed.' },
    ],
  },
];

/* ── Events ──────────────────────────────────────────────────────────── */

export type PublicEventType =
  | 'contact.created' | 'contact.updated' | 'contact.unsubscribed'
  | 'email.sent' | 'email.opened' | 'email.clicked' | 'email.bounced'
  | 'reply.received' | 'reply.interested' | 'reply.classified'
  | 'campaign.launched' | 'campaign.paused' | 'campaign.completed';

export interface PublicEventDef { type: PublicEventType; title: string; description: string; data: Record<string, unknown> }

const C = { id: ID.campaign, name: 'Q4 partnerships' };

export const PUBLIC_EVENTS: PublicEventDef[] = [
  { type: 'reply.received', title: 'Reply received', description: 'A contact replied to a campaign email (auto-replies and out-of-office are not counted).', data: { contact: CONTACT_EXAMPLE, campaign: C, reply: { ...REPLY_EXAMPLE, intent: null, intent_confidence: null } } },
  { type: 'reply.interested', title: 'Interested reply', description: 'Relay read a reply as interested or asking for a meeting. The trigger most teams want.', data: { contact: CONTACT_EXAMPLE, campaign: C, reply: REPLY_EXAMPLE } },
  { type: 'reply.classified', title: 'Reply classified', description: 'Relay read a reply, whatever it found: interested, meeting, objection, not now, unsubscribe...', data: { contact: CONTACT_EXAMPLE, campaign: C, reply: REPLY_EXAMPLE } },
  { type: 'contact.created', title: 'Contact created', description: 'A contact was added, by hand, import, the Prospector, the API or an integration.', data: { contact: CONTACT_EXAMPLE } },
  { type: 'contact.updated', title: 'Contact updated', description: 'A contact\'s details changed.', data: { contact: CONTACT_EXAMPLE } },
  { type: 'contact.unsubscribed', title: 'Contact unsubscribed', description: 'A contact clicked unsubscribe, or Relay read their reply as one.', data: { contact: { ...CONTACT_EXAMPLE, unsubscribed: true }, campaign: C } },
  { type: 'email.sent', title: 'Email sent', description: 'A campaign email went out.', data: { contact: CONTACT_EXAMPLE, campaign: C, email: { step_id: ID.step, subject: 'Partnering with Analytical Engines', to: CONTACT_EXAMPLE.email } } },
  { type: 'email.opened', title: 'Email opened', description: 'A campaign email was opened (machine opens by mail scanners are filtered out where they can be told apart).', data: { contact: CONTACT_EXAMPLE, campaign: C, email: { step_id: ID.step } } },
  { type: 'email.clicked', title: 'Link clicked', description: 'A link in a campaign email was clicked.', data: { contact: CONTACT_EXAMPLE, campaign: C, email: { step_id: ID.step, url: 'https://analyticalengines.co.uk/demo' } } },
  { type: 'email.bounced', title: 'Email bounced', description: 'A campaign email bounced.', data: { contact: { ...CONTACT_EXAMPLE, bounced: true }, campaign: C, email: { kind: 'hard', to: CONTACT_EXAMPLE.email } } },
  { type: 'campaign.launched', title: 'Campaign launched', description: 'A campaign started sending.', data: { campaign: { ...C, status: 'running' } } },
  { type: 'campaign.paused', title: 'Campaign paused', description: 'A campaign was paused, by a person or by the deliverability autopilot.', data: { campaign: { ...C, status: 'paused' } } },
  { type: 'campaign.completed', title: 'Campaign completed', description: 'Every contact in a campaign has finished its sequence.', data: { campaign: { ...C, status: 'completed' } } },
];

export const PUBLIC_EVENT_TYPES = PUBLIC_EVENTS.map((e) => e.type);

/** Which internal event(s) each public event comes from. reply.* intents are filtered in the server. */
export const INTERNAL_TO_PUBLIC: Record<string, PublicEventType[]> = {
  'contact.created': ['contact.created'],
  'contact.updated': ['contact.updated'],
  'lead.unsubscribed': ['contact.unsubscribed'],
  'email.sent': ['email.sent'],
  'email.opened': ['email.opened'],
  'email.clicked': ['email.clicked'],
  'email.bounced': ['email.bounced'],
  'email.replied': ['reply.received'],
  'sara.intent_classified': ['reply.classified', 'reply.interested'],
  'campaign.launched': ['campaign.launched'],
  'campaign.paused': ['campaign.paused'],
  'campaign.completed': ['campaign.completed'],
};

export const INTERESTED_INTENTS = ['interested', 'meeting'];

/** The envelope every v1 webhook delivery has. */
export function publicEventExample(type: PublicEventType) {
  const def = PUBLIC_EVENTS.find((e) => e.type === type)!;
  return { id: 'evt_9b2f6c1e8a4d4e0f', object: 'event', type, created_at: T, api_version: PUBLIC_API_VERSION, data: def.data };
}

/* ── Endpoints ───────────────────────────────────────────────────────── */

const page = (example: unknown) => ({ object: 'list', data: [example], has_more: false, next_cursor: null });

const PAGINATION: ApiParam[] = [
  { name: 'limit', in: 'query', type: 'integer', description: 'How many to return, 1 to 100. Default 25.', example: 25 },
  { name: 'cursor', in: 'query', type: 'string', description: 'The next_cursor from the previous page.' },
];

const idParam = (what: string): ApiParam => ({ name: 'id', in: 'path', type: 'string', required: true, description: `The ${what}'s id.` });

export const API_ENDPOINTS: ApiEndpoint[] = [
  {
    id: 'me.get', group: 'Account', method: 'GET', path: '/v1/me', scope: 'read',
    summary: 'Check your key',
    description: 'Who the API key belongs to, its scopes and rate limit. Use it to test a connection.',
    returns: 'account', responseExample: ME_EXAMPLE,
  },
  {
    id: 'events.list', group: 'Webhooks', method: 'GET', path: '/v1/events/types', scope: 'read',
    summary: 'List event types',
    description: 'Every event a webhook can subscribe to, with what it means.',
    returns: 'list:event_type', responseExample: { object: 'list', data: PUBLIC_EVENTS.slice(0, 1).map((e) => ({ object: 'event_type', type: e.type, title: e.title, description: e.description })), has_more: false, next_cursor: null },
  },
  {
    id: 'events.sample', group: 'Webhooks', method: 'GET', path: '/v1/events/types/{type}/sample', scope: 'read',
    summary: 'Get a sample event',
    description: 'What a delivery of this event looks like, filled from your own most recent data where there is some (otherwise an example). Zapier and Make use this to map fields.',
    params: [{ name: 'type', in: 'path', type: 'string', required: true, enum: PUBLIC_EVENT_TYPES, description: 'The event type.' }],
    returns: 'event', responseExample: publicEventExample('reply.interested'),
  },

  // Contacts
  {
    id: 'contacts.list', group: 'Contacts', method: 'GET', path: '/v1/contacts', scope: 'read',
    summary: 'List contacts',
    description: 'Contacts, newest first. Filter by email, lifecycle, list, tag, or by when they were created or last changed (for syncing: pass updated_after the time of your last sync).',
    params: [
      { name: 'email', in: 'query', type: 'string', description: 'Exact address (any case).' },
      { name: 'lifecycle', in: 'query', type: 'string', enum: LIFECYCLES, description: 'Only leads, contacts or customers.' },
      { name: 'list_id', in: 'query', type: 'string', description: 'Only contacts in this list.' },
      { name: 'tag', in: 'query', type: 'string', description: 'Only contacts with this tag name.' },
      { name: 'q', in: 'query', type: 'string', description: 'Search name, email and company.' },
      { name: 'created_after', in: 'query', type: 'string', description: 'ISO time.' },
      { name: 'updated_after', in: 'query', type: 'string', description: 'ISO time. Sorts by updated_at instead, newest first.' },
      ...PAGINATION,
    ],
    returns: 'list:contact', responseExample: page(CONTACT_EXAMPLE),
  },
  {
    id: 'contacts.create', group: 'Contacts', method: 'POST', path: '/v1/contacts', scope: 'write', status: 201,
    summary: 'Create a contact',
    description: 'Adds a contact. If the email already exists you get a 409 with the existing id, unless you send "upsert": true, which updates that contact with the fields you sent instead (and answers 200). New contacts are leads unless you say otherwise.',
    body: [...CONTACT_WRITE_FIELDS, { name: 'upsert', type: 'boolean', description: 'Update the existing contact if the email is already there. Default false.' }],
    bodyExample: { email: 'ada@analyticalengines.co.uk', first_name: 'Ada', last_name: 'Lovelace', company: 'Analytical Engines', tags: ['webinar'], list_ids: [ID.list], upsert: true },
    returns: 'contact', responseExample: CONTACT_EXAMPLE, errors: ['contact_exists'],
  },
  {
    id: 'contacts.bulk', group: 'Contacts', method: 'POST', path: '/v1/contacts/bulk', scope: 'write',
    summary: 'Create or update many contacts',
    description: 'Up to 1,000 contacts in one call, matched by email. "on_conflict" decides what happens to contacts already here: "fill" (default) only fills empty fields, "overwrite" replaces them, "skip" leaves them alone. Bulk writes do not send contact.created webhooks (one call could send a thousand); create contacts one at a time when you need the events.',
    body: [
      { name: 'contacts', type: 'object[]', required: true, description: 'Contact objects: the fields of Create a contact except upsert, list_ids and lifecycle (use list_id for the whole batch).' },
      { name: 'list_id', type: 'string', description: 'Add every contact to this list.' },
      { name: 'on_conflict', type: 'string', enum: ['fill', 'overwrite', 'skip'], description: 'What happens to existing contacts. Default "fill".' },
    ],
    bodyExample: { contacts: [{ email: 'ada@analyticalengines.co.uk', first_name: 'Ada' }, { email: 'grace@cobol.dev', first_name: 'Grace' }], list_id: ID.list, on_conflict: 'fill' },
    returns: 'bulk_result',
    responseExample: { object: 'bulk_result', total: 2, created: 1, updated: 1, failed: 0, created_ids: [ID.contact], errors: [] },
  },
  {
    id: 'contacts.get', group: 'Contacts', method: 'GET', path: '/v1/contacts/{id}', scope: 'read',
    summary: 'Get a contact', description: 'One contact.', params: [idParam('contact')],
    returns: 'contact', responseExample: CONTACT_EXAMPLE,
  },
  {
    id: 'contacts.update', group: 'Contacts', method: 'PATCH', path: '/v1/contacts/{id}', scope: 'write',
    summary: 'Update a contact',
    description: 'Changes only the fields you send. "tags" replaces their tags; "list_ids" adds them to lists; "custom_fields" is merged.',
    params: [idParam('contact')],
    body: CONTACT_WRITE_FIELDS.map((f) => ({ ...f, required: false })),
    bodyExample: { job_title: 'VP Partnerships', custom_fields: { deal_size: '50k' } },
    returns: 'contact', responseExample: CONTACT_EXAMPLE, errors: ['contact_exists'],
  },
  {
    id: 'contacts.delete', group: 'Contacts', method: 'DELETE', path: '/v1/contacts/{id}', scope: 'write',
    summary: 'Delete a contact', description: 'Deletes the contact and takes them out of every list and campaign. This cannot be undone.',
    params: [idParam('contact')],
    returns: 'deleted', responseExample: { object: 'contact', id: ID.contact, deleted: true },
  },
  {
    id: 'contacts.unsubscribe', group: 'Contacts', method: 'POST', path: '/v1/contacts/{id}/unsubscribe', scope: 'write',
    summary: 'Unsubscribe a contact', description: 'Marks them unsubscribed and adds their address to your suppression list, so no campaign emails them again.',
    params: [idParam('contact')],
    returns: 'contact', responseExample: { ...CONTACT_EXAMPLE, unsubscribed: true },
  },
  {
    id: 'unsubscribes.create', group: 'Contacts', method: 'POST', path: '/v1/unsubscribes', scope: 'write',
    summary: 'Unsubscribe an email address',
    description: 'One call for "never email this address again", whether or not it is a contact yet. A contact is unsubscribed and taken out of every sequence; any other address is added to your suppression list. Safe to repeat.',
    body: [{ name: 'email', type: 'string', required: true, description: 'The address.' }],
    bodyExample: { email: 'no-thanks@example.com' },
    returns: 'unsubscribe', responseExample: { object: 'unsubscribe', email: 'no-thanks@example.com', was_contact: true, contact_id: ID.contact },
  },
  {
    id: 'contacts.activities', group: 'Contacts', method: 'GET', path: '/v1/contacts/{id}/activities', scope: 'read',
    summary: 'List a contact\'s activity', description: 'Everything that happened to this contact in campaigns, newest first.',
    params: [idParam('contact'), { name: 'type', in: 'query', type: 'string', enum: ACTIVITY_TYPES, description: 'Only this type.' }, ...PAGINATION],
    returns: 'list:activity', responseExample: page(ACTIVITY_EXAMPLE),
  },

  // Lists
  {
    id: 'lists.list', group: 'Lists', method: 'GET', path: '/v1/lists', scope: 'read',
    summary: 'List lists', description: 'Your lists, newest first.',
    params: [{ name: 'kind', in: 'query', type: 'string', enum: API_LIST_KINDS, description: 'Only lead lists or contact lists.' }, ...PAGINATION],
    returns: 'list:list', responseExample: page(LIST_EXAMPLE),
  },
  {
    id: 'lists.create', group: 'Lists', method: 'POST', path: '/v1/lists', scope: 'write', status: 201,
    summary: 'Create a list', description: 'Makes a list.',
    body: [
      { name: 'name', type: 'string', required: true, description: 'Name.' },
      { name: 'description', type: 'string', description: 'Description.' },
      { name: 'kind', type: 'string', enum: API_LIST_KINDS, description: 'Default "lead". Adding someone to a contact list makes them a contact.' },
    ],
    bodyExample: { name: 'UK partnerships', kind: 'lead' },
    returns: 'list', responseExample: LIST_EXAMPLE,
  },
  {
    id: 'lists.get', group: 'Lists', method: 'GET', path: '/v1/lists/{id}', scope: 'read',
    summary: 'Get a list', description: 'One list.', params: [idParam('list')], returns: 'list', responseExample: LIST_EXAMPLE,
  },
  {
    id: 'lists.update', group: 'Lists', method: 'PATCH', path: '/v1/lists/{id}', scope: 'write',
    summary: 'Update a list', description: 'Rename it or change its description.', params: [idParam('list')],
    body: [{ name: 'name', type: 'string', description: 'Name.' }, { name: 'description', type: 'string', description: 'Description.' }],
    bodyExample: { name: 'UK partnerships (Q4)' },
    returns: 'list', responseExample: LIST_EXAMPLE,
  },
  {
    id: 'lists.delete', group: 'Lists', method: 'DELETE', path: '/v1/lists/{id}', scope: 'write',
    summary: 'Delete a list', description: 'Deletes the list. The contacts in it are kept.', params: [idParam('list')],
    returns: 'deleted', responseExample: { object: 'list', id: ID.list, deleted: true },
  },
  {
    id: 'lists.contacts', group: 'Lists', method: 'GET', path: '/v1/lists/{id}/contacts', scope: 'read',
    summary: 'List contacts in a list', description: 'The contacts in a list, newest first.', params: [idParam('list'), ...PAGINATION],
    returns: 'list:contact', responseExample: page(CONTACT_EXAMPLE),
  },
  {
    id: 'lists.add', group: 'Lists', method: 'POST', path: '/v1/lists/{id}/contacts', scope: 'write',
    summary: 'Add contacts to a list', description: 'Adds contacts by id or by email (an email that is not a contact yet is created as one). Up to 1,000 at a time.',
    params: [idParam('list')],
    body: [
      { name: 'contact_ids', type: 'string[]', description: 'Contact ids.' },
      { name: 'emails', type: 'string[]', description: 'Email addresses.' },
    ],
    bodyExample: { emails: ['ada@analyticalengines.co.uk'] },
    returns: 'list_change', responseExample: { object: 'list_change', list_id: ID.list, added: 1, already_there: 0, created_contacts: 0 },
  },
  {
    id: 'lists.remove', group: 'Lists', method: 'DELETE', path: '/v1/lists/{id}/contacts/{contact_id}', scope: 'write',
    summary: 'Remove a contact from a list', description: 'Takes the contact out of the list. The contact is kept.',
    params: [idParam('list'), { name: 'contact_id', in: 'path', type: 'string', required: true, description: 'The contact\'s id, or their email address (URL-encoded).' }],
    returns: 'list_change', responseExample: { object: 'list_change', list_id: ID.list, removed: 1 },
  },

  // Campaigns
  {
    id: 'campaigns.list', group: 'Campaigns', method: 'GET', path: '/v1/campaigns', scope: 'read',
    summary: 'List campaigns', description: 'Your campaigns, newest first.',
    params: [{ name: 'status', in: 'query', type: 'string', enum: CAMPAIGN_STATUSES, description: 'Only campaigns in this state.' }, ...PAGINATION],
    returns: 'list:campaign', responseExample: page({ ...CAMPAIGN_EXAMPLE, stats: undefined }),
  },
  {
    id: 'campaigns.get', group: 'Campaigns', method: 'GET', path: '/v1/campaigns/{id}', scope: 'read',
    summary: 'Get a campaign', description: 'One campaign, with its totals.', params: [idParam('campaign')],
    returns: 'campaign', responseExample: CAMPAIGN_EXAMPLE,
  },
  {
    id: 'campaigns.contacts', group: 'Campaigns', method: 'GET', path: '/v1/campaigns/{id}/contacts', scope: 'read',
    summary: 'List a campaign\'s contacts', description: 'Who is in the campaign and how far through they are.',
    params: [idParam('campaign'), { name: 'status', in: 'query', type: 'string', description: 'Only this enrolment status (active, replied, completed, ...).' }, ...PAGINATION],
    returns: 'list:enrolment', responseExample: page(ENROLMENT_EXAMPLE),
  },
  {
    id: 'campaigns.enrol', group: 'Campaigns', method: 'POST', path: '/v1/campaigns/{id}/contacts', scope: 'write',
    summary: 'Add contacts to a campaign',
    description: 'Enrols contacts by id, by email, or as full contact objects (created or updated first, matched by email). The same checks as the app apply: nobody unsubscribed, suppressed, bounced or already in the campaign is added, and the answer says who was skipped and why. For up to 100 people, `results` has one entry per person asked for, in order: outcome (added, skipped, not_found or invalid) and the reason in words. Up to 1,000 at a time.',
    params: [idParam('campaign')],
    body: [
      { name: 'contact_ids', type: 'string[]', description: 'Contact ids.' },
      { name: 'emails', type: 'string[]', description: 'Email addresses of existing contacts.' },
      { name: 'contacts', type: 'object[]', description: 'Contact objects: created if new, otherwise empty fields are filled in. Then enrolled.' },
    ],
    bodyExample: { contacts: [{ email: 'ada@analyticalengines.co.uk', first_name: 'Ada', company: 'Analytical Engines' }] },
    returns: 'enrolment_result',
    responseExample: {
      object: 'enrolment_result', campaign_id: ID.campaign, added: 1, skipped: 0, total: 413, reasons: {}, skips: [], not_found: [], invalid_emails: [], created_contacts: 0,
      results: [{ email: 'ada@analyticalengines.co.uk', contact_id: ID.contact, outcome: 'added', reason_code: null, reason: null, detail: null }],
    },
    errors: ['campaign_finished'],
  },
  {
    id: 'campaigns.unenrol', group: 'Campaigns', method: 'DELETE', path: '/v1/campaigns/{id}/contacts/{contact_id}', scope: 'write',
    summary: 'Remove a contact from a campaign', description: 'Stops their sequence and takes them out of the campaign.',
    params: [idParam('campaign'), { name: 'contact_id', in: 'path', type: 'string', required: true, description: 'The contact\'s id, or their email address (URL-encoded).' }],
    returns: 'deleted', responseExample: { object: 'enrolment', campaign_id: ID.campaign, contact_id: ID.contact, deleted: true },
  },
  {
    id: 'campaigns.pause', group: 'Campaigns', method: 'POST', path: '/v1/campaigns/{id}/pause', scope: 'write',
    summary: 'Pause a campaign', description: 'Stops sending until it is resumed.', params: [idParam('campaign')],
    returns: 'campaign', responseExample: { ...CAMPAIGN_EXAMPLE, status: 'paused' }, errors: ['campaign_state'],
  },
  {
    id: 'campaigns.resume', group: 'Campaigns', method: 'POST', path: '/v1/campaigns/{id}/resume', scope: 'write',
    summary: 'Resume a campaign', description: 'Starts a paused campaign sending again.', params: [idParam('campaign')],
    returns: 'campaign', responseExample: CAMPAIGN_EXAMPLE, errors: ['campaign_state'],
  },

  // Tags
  {
    id: 'tags.list', group: 'Tags', method: 'GET', path: '/v1/tags', scope: 'read',
    summary: 'List tags', description: 'Your tags, newest first.', params: PAGINATION,
    returns: 'list:tag', responseExample: page(TAG_EXAMPLE),
  },

  // Activity & replies
  {
    id: 'activities.list', group: 'Activity', method: 'GET', path: '/v1/activities', scope: 'read',
    summary: 'List activity', description: 'Campaign activity across the account, newest first: sends, opens, clicks, replies, bounces, unsubscribes.',
    params: [
      { name: 'type', in: 'query', type: 'string', enum: ACTIVITY_TYPES, description: 'Only this type.' },
      { name: 'campaign_id', in: 'query', type: 'string', description: 'Only this campaign.' },
      { name: 'contact_id', in: 'query', type: 'string', description: 'Only this contact.' },
      { name: 'after', in: 'query', type: 'string', description: 'ISO time: only activity after this.' },
      ...PAGINATION,
    ],
    returns: 'list:activity', responseExample: page(ACTIVITY_EXAMPLE),
  },
  {
    id: 'replies.list', group: 'Replies', method: 'GET', path: '/v1/replies', scope: 'read',
    summary: 'List replies', description: 'Replies from contacts, newest first, with what Relay read in each.',
    params: [
      { name: 'intent', in: 'query', type: 'string', enum: REPLY_INTENTS, description: 'Only replies Relay read this way.' },
      { name: 'campaign_id', in: 'query', type: 'string', description: 'Only this campaign.' },
      { name: 'contact_id', in: 'query', type: 'string', description: 'Only this contact.' },
      { name: 'after', in: 'query', type: 'string', description: 'ISO time: only replies after this.' },
      ...PAGINATION,
    ],
    returns: 'list:reply', responseExample: page(REPLY_EXAMPLE),
  },

  // Suppressions
  {
    id: 'suppressions.list', group: 'Suppressions', method: 'GET', path: '/v1/suppressions', scope: 'read',
    summary: 'List suppressions', description: 'Addresses Sincerely will never email, newest first.',
    params: [{ name: 'reason', in: 'query', type: 'string', enum: SUPPRESSION_REASONS, description: 'Only this reason.' }, ...PAGINATION],
    returns: 'list:suppression', responseExample: page(SUPPRESSION_EXAMPLE),
  },
  {
    id: 'suppressions.create', group: 'Suppressions', method: 'POST', path: '/v1/suppressions', scope: 'write', status: 201,
    summary: 'Suppress addresses', description: 'Adds up to 1,000 addresses. Already-suppressed addresses are left as they are.',
    body: [{ name: 'emails', type: 'string[]', required: true, description: 'Addresses.' }],
    bodyExample: { emails: ['no-thanks@example.com'] },
    returns: 'suppression_result', responseExample: { object: 'suppression_result', added: 1, already_suppressed: 0, invalid: [] },
  },
  {
    id: 'suppressions.delete', group: 'Suppressions', method: 'DELETE', path: '/v1/suppressions/{email}', scope: 'write',
    summary: 'Remove a suppression', description: 'Lets campaigns email this address again.',
    params: [{ name: 'email', in: 'path', type: 'string', required: true, description: 'The address (URL-encoded).' }],
    returns: 'deleted', responseExample: { object: 'suppression', email: 'no-thanks@example.com', deleted: true },
  },

  // Webhooks
  {
    id: 'webhooks.list', group: 'Webhooks', method: 'GET', path: '/v1/webhooks', scope: 'read',
    summary: 'List webhooks', description: 'Webhooks created through the API, Zapier, Make and n8n.', params: PAGINATION,
    returns: 'list:webhook', responseExample: page(WEBHOOK_EXAMPLE),
  },
  {
    id: 'webhooks.create', group: 'Webhooks', method: 'POST', path: '/v1/webhooks', scope: 'write', status: 201,
    summary: 'Create a webhook',
    description: 'Sends the events you choose to your https URL as they happen. Each delivery is signed: check the Sincerely-Signature header (see "Verifying webhooks"). The signing secret is in this response only, so store it. A URL that answers 410 Gone is unsubscribed automatically.',
    body: [
      { name: 'url', type: 'string', required: true, description: 'Your https endpoint.' },
      { name: 'events', type: 'string[]', required: true, enum: PUBLIC_EVENT_TYPES, description: 'Event types to send.' },
      { name: 'description', type: 'string', description: 'What it is for.' },
    ],
    bodyExample: { url: 'https://hooks.example.com/sincerely', events: ['reply.interested'], description: 'Interested replies to CRM' },
    returns: 'webhook', responseExample: { ...WEBHOOK_EXAMPLE, secret: 'whsec_3f9a1c...' },
  },
  {
    id: 'webhooks.get', group: 'Webhooks', method: 'GET', path: '/v1/webhooks/{id}', scope: 'read',
    summary: 'Get a webhook', description: 'One webhook.', params: [idParam('webhook')], returns: 'webhook', responseExample: WEBHOOK_EXAMPLE,
  },
  {
    id: 'webhooks.update', group: 'Webhooks', method: 'PATCH', path: '/v1/webhooks/{id}', scope: 'write',
    summary: 'Update a webhook', description: 'Change its URL, events, description, or switch it off and on.', params: [idParam('webhook')],
    body: [
      { name: 'url', type: 'string', description: 'Your https endpoint.' },
      { name: 'events', type: 'string[]', enum: PUBLIC_EVENT_TYPES, description: 'Event types to send.' },
      { name: 'description', type: 'string', description: 'What it is for.' },
      { name: 'active', type: 'boolean', description: 'Send events or not.' },
    ],
    bodyExample: { active: false },
    returns: 'webhook', responseExample: { ...WEBHOOK_EXAMPLE, active: false },
  },
  {
    id: 'webhooks.delete', group: 'Webhooks', method: 'DELETE', path: '/v1/webhooks/{id}', scope: 'write',
    summary: 'Delete a webhook', description: 'Stops sending events to it.', params: [idParam('webhook')],
    returns: 'deleted', responseExample: { object: 'webhook', id: ID.webhook, deleted: true },
  },
  {
    id: 'webhooks.test', group: 'Webhooks', method: 'POST', path: '/v1/webhooks/{id}/test', scope: 'write',
    summary: 'Send a test event', description: 'Sends a sample of one of its events now, signed like a real one, and says what your endpoint answered.',
    params: [idParam('webhook')],
    body: [{ name: 'type', type: 'string', enum: PUBLIC_EVENT_TYPES, description: 'Which event to send. Default: its first.' }],
    bodyExample: { type: 'reply.interested' },
    returns: 'webhook_test', responseExample: { object: 'webhook_test', delivered: true, status: 200, duration_ms: 182, response: 'ok' },
  },
];

export const API_GROUPS: ApiGroup[] = ['Account', 'Contacts', 'Lists', 'Campaigns', 'Tags', 'Activity', 'Replies', 'Suppressions', 'Webhooks'];

/* ── Signing ─────────────────────────────────────────────────────────── */

/**
 * v1 deliveries carry Sincerely-Signature: t=<unix seconds>,v1=<hex>,
 * where v1 = HMAC-SHA256(secret, `${t}.${raw body}`). Reject a delivery
 * whose t is more than 5 minutes old (replay) or whose v1 does not match.
 */
export const SIGNATURE_HEADER = 'Sincerely-Signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/* ── Code samples ────────────────────────────────────────────────────── */

export function fillPath(path: string, ex: Record<string, string> = {}): string {
  return path.replace(/\{(\w+)\}/g, (_, k) => ex[k] || (k === 'email' ? 'no-thanks%40example.com' : k === 'type' ? 'reply.interested' : ID.contact));
}

/** curl, JavaScript (fetch) and Python (requests) for an endpoint. */
export function codeSamples(ep: ApiEndpoint, baseUrl: string, key = 'sk_live_YOUR_KEY'): { curl: string; javascript: string; python: string } {
  const url = `${baseUrl.replace(/\/+$/, '')}${fillPath(ep.path)}`;
  const hasBody = ep.method !== 'GET' && ep.method !== 'DELETE' && !!ep.bodyExample;
  const body = hasBody ? JSON.stringify(ep.bodyExample, null, 2) : null;
  const idem = ep.method === 'POST';
  const curl = [
    `curl -X ${ep.method} "${url}" \\`,
    `  -H "Authorization: Bearer ${key}"${hasBody || idem ? ' \\' : ''}`,
    ...(idem ? [`  -H "Idempotency-Key: $(uuidgen)"${hasBody ? ' \\' : ''}`] : []),
    ...(hasBody ? ['  -H "Content-Type: application/json" \\', `  -d '${JSON.stringify(ep.bodyExample)}'`] : []),
  ].join('\n');
  const javascript = [
    `const res = await fetch("${url}", {`,
    `  method: "${ep.method}",`,
    '  headers: {',
    `    Authorization: "Bearer ${key}",`,
    ...(hasBody ? ['    "Content-Type": "application/json",'] : []),
    ...(idem ? ['    "Idempotency-Key": crypto.randomUUID(),'] : []),
    '  },',
    ...(hasBody ? [`  body: JSON.stringify(${body!.replace(/\n/g, '\n  ')}),`] : []),
    '});',
    'const data = await res.json();',
    'if (!res.ok) throw new Error(`${data.error.code}: ${data.error.message}`);',
  ].join('\n');
  const python = [
    'import requests, uuid',
    '',
    `res = requests.${ep.method.toLowerCase()}(`,
    `    "${url}",`,
    `    headers={"Authorization": "Bearer ${key}"${idem ? ', "Idempotency-Key": str(uuid.uuid4())' : ''}},`,
    ...(hasBody ? [`    json=${body!.replace(/true/g, 'True').replace(/false/g, 'False').replace(/null/g, 'None').replace(/\n/g, '\n    ')},`] : []),
    ')',
    'res.raise_for_status()',
    'data = res.json()',
  ].join('\n');
  return { curl, javascript, python };
}

/* ── OpenAPI 3.1 ─────────────────────────────────────────────────────── */

function schemaOf(f: ApiField): Record<string, unknown> {
  const base: Record<string, unknown> =
    f.type === 'string[]' ? { type: 'array', items: { type: 'string', ...(f.enum ? { enum: f.enum } : {}) } }
      : f.type === 'object[]' ? { type: 'array', items: { type: 'object' } }
        : f.type === 'object' ? { type: 'object', additionalProperties: true }
          : { type: f.type, ...(f.enum ? { enum: f.enum } : {}) };
  if (f.nullable && typeof base.type === 'string') base.type = [base.type, 'null'];
  return { ...base, description: f.description, ...(f.example !== undefined ? { example: f.example } : {}) };
}

export function openApiDocument(serverUrl: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const ep of API_ENDPOINTS) {
    const op: Record<string, unknown> = {
      operationId: ep.id,
      tags: [ep.group],
      summary: ep.summary,
      description: ep.description,
      security: [{ bearerAuth: [] }],
      'x-sincerely-scope': ep.scope,
      parameters: (ep.params || []).map((p) => ({ name: p.name, in: p.in, required: p.in === 'path' ? true : !!p.required, description: p.description, schema: schemaOf(p) })),
      responses: {
        [String(ep.status || 200)]: { description: 'OK', content: { 'application/json': { example: ep.responseExample } } },
        default: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    };
    if (ep.method === 'POST' || ep.method === 'PATCH' || ep.method === 'DELETE') {
      (op.parameters as unknown[]).push({ name: 'Idempotency-Key', in: 'header', required: false, description: 'Do this once: the same key within 24 hours returns the first answer.', schema: { type: 'string' } });
    }
    if (ep.body) {
      op.requestBody = {
        required: ep.body.some((f) => f.required),
        content: {
          'application/json': {
            schema: { type: 'object', properties: Object.fromEntries(ep.body.map((f) => [f.name, schemaOf(f)])), required: ep.body.filter((f) => f.required).map((f) => f.name) },
            ...(ep.bodyExample ? { example: ep.bodyExample } : {}),
          },
        },
      };
    }
    const key = ep.path;
    paths[key] = { ...(paths[key] || {}), [ep.method.toLowerCase()]: op };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Sincerely API',
      version: PUBLIC_API_VERSION,
      description: 'Contacts, lists, campaigns, activity, replies and webhooks. Authenticate with an API key from Settings > Developer as "Authorization: Bearer sk_live_...".',
    },
    servers: [{ url: serverUrl.replace(/\/+$/, '') }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'sk_live_...' } },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                type: { type: 'string' }, code: { type: 'string', enum: API_ERROR_CODES.map((e) => e.code) },
                message: { type: 'string' }, param: { type: 'string' }, doc_url: { type: 'string' },
              },
              required: ['type', 'code', 'message'],
            },
            request_id: { type: 'string' },
          },
        },
        ...Object.fromEntries(API_OBJECTS.map((o) => [o.name[0].toUpperCase() + o.name.slice(1), {
          type: 'object', description: o.description,
          properties: Object.fromEntries(o.fields.map((f) => [f.name, schemaOf(f)])),
          example: o.example,
        }])),
      },
    },
    paths,
    'x-webhooks-events': PUBLIC_EVENTS.map((e) => ({ type: e.type, description: e.description, example: publicEventExample(e.type) })),
  };
}
