'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   The Sincerely app for Make, as data.

   Every section Make stores (base, connection, webhooks, modules, RPCs,
   groups) is built here as plain objects. deploy.js uploads them through
   Make's SDK API; the tests validate each one against Make's own IML JSON
   schemas (vendor/make-schemas) first.

   IML is kept to the functions every Make app uses (ifempty, if, first,
   encodeURL, toCollection). Anything cleverer is done by the Sincerely
   API instead, so it is tested there: one-call unsubscribe, removing by
   email, and a per-person `results` answer when adding to a campaign.
   ═══════════════════════════════════════════════════════════════════════ */

const DEFAULT_API = 'https://skysend-api.onrender.com';
const KEYS_URL = 'https://usesincerely.com/developer?tab=api-keys';

/**
 * The API's address, written straight into the base and the connection.
 * (Make does not fill in `{{common.*}}` when it tests a connection, so the
 * first version, which read the address from common, answered "Invalid URL".)
 */
function apiUrlOf(apiOrigin = DEFAULT_API) {
  const origin = String(apiOrigin).replace(/\/+$/, '').replace(/\/(api\/)?v1$/, '');
  return `${origin}/v1`;
}

/** Kept in the app's common data for reference only; nothing reads it. */
function common(apiOrigin = DEFAULT_API) {
  return { apiUrl: apiUrlOf(apiOrigin) };
}

const UA = 'Make (Sincerely app)';

/* ── Base: what every module and RPC request starts from ─────────────── */

const errorMessage = "{{ifempty(body.error.message, 'Sincerely answered ' + statusCode + '.')}} (Sincerely reference {{ifempty(body.request_id, 'none')}})";

const makeBase = (apiUrl) => ({
  baseUrl: apiUrl,
  headers: {
    authorization: 'Bearer {{connection.apiKey}}',
    'user-agent': UA,
  },
  response: {
    error: {
      message: errorMessage,
      type: 'RuntimeError',
      400: { type: 'DataError', message: errorMessage },
      401: { type: 'InvalidAccessTokenError', message: errorMessage },
      403: { type: 'InvalidConfigurationError', message: errorMessage },
      404: { type: 'DataError', message: errorMessage },
      409: { type: 'DuplicateDataError', message: errorMessage },
      422: { type: 'DataError', message: errorMessage },
      429: { type: 'RateLimitError', message: errorMessage },
    },
  },
  log: { sanitize: ['request.headers.authorization'] },
});

/* ── Connection: an API key, checked against /v1/me ──────────────────── */

const makeConnection = (apiUrl) => ({
  key: 'sincerely',
  label: 'Sincerely',
  type: 'basic',
  parameters: [
    {
      name: 'apiKey',
      type: 'password',
      label: 'API key',
      required: true,
      help: `Create one in Sincerely under Settings > API & webhooks > API keys (${KEYS_URL}). It starts with sk_live_. Give it read and write access so every module works.`,
    },
  ],
  api: {
    url: `${apiUrl}/me`,
    method: 'GET',
    headers: {
      authorization: 'Bearer {{parameters.apiKey}}',
      'user-agent': UA,
    },
    response: {
      metadata: { type: 'email', value: '{{body.email}}' },
      error: {
        message: errorMessage,
        401: { type: 'InvalidAccessTokenError', message: 'This API key is wrong, revoked or expired. Create a new one in Sincerely under Settings > API & webhooks.' },
      },
    },
    log: { sanitize: ['request.headers.authorization'] },
  },
});

/* ── Shared field specs ──────────────────────────────────────────────── */

const CONTACT_INPUT = [
  { name: 'first_name', type: 'text', label: 'First name' },
  { name: 'last_name', type: 'text', label: 'Last name' },
  { name: 'company', type: 'text', label: 'Company' },
  { name: 'job_title', type: 'text', label: 'Job title' },
  { name: 'phone', type: 'text', label: 'Phone' },
  { name: 'linkedin_url', type: 'url', label: 'LinkedIn URL' },
  { name: 'website', type: 'url', label: 'Website' },
  { name: 'location', type: 'text', label: 'Location', help: 'Free text, for example "London, United Kingdom".' },
  { name: 'city', type: 'text', label: 'City' },
  { name: 'state', type: 'text', label: 'State or region' },
  { name: 'country', type: 'text', label: 'Country' },
  { name: 'industry', type: 'text', label: 'Industry' },
];

const TAGS_INPUT = {
  name: 'tags', type: 'array', label: 'Tags',
  help: 'Tag names. Ones that do not exist yet are created. On an existing contact this replaces their tags.',
  spec: { name: 'value', type: 'text', label: 'Tag' },
};

const CUSTOM_INPUT = {
  name: 'custom_fields', type: 'array', label: 'Custom fields',
  help: 'Your own fields, as name and value. Merged with any the contact already has.',
  spec: [
    { name: 'key', type: 'text', label: 'Name', required: true },
    { name: 'value', type: 'text', label: 'Value' },
  ],
};

/** The contact fields of a request body. Unmapped ones are left out by Make; blanks are ignored by the API. */
const contactBody = (prefix = 'parameters') => ({
  email: `{{${prefix}.email}}`,
  ...Object.fromEntries(CONTACT_INPUT.map((f) => [f.name, `{{${prefix}.${f.name}}}`])),
  tags: `{{${prefix}.tags}}`,
  custom_fields: `{{toCollection(${prefix}.custom_fields, 'key', 'value')}}`,
});

const CONTACT_OUTPUT = [
  { name: 'id', type: 'text', label: 'Contact ID' },
  { name: 'email', type: 'email', label: 'Email' },
  { name: 'first_name', type: 'text', label: 'First name' },
  { name: 'last_name', type: 'text', label: 'Last name' },
  { name: 'full_name', type: 'text', label: 'Full name' },
  { name: 'company', type: 'text', label: 'Company' },
  { name: 'job_title', type: 'text', label: 'Job title' },
  { name: 'phone', type: 'text', label: 'Phone' },
  { name: 'linkedin_url', type: 'url', label: 'LinkedIn URL' },
  { name: 'website', type: 'url', label: 'Website' },
  { name: 'location', type: 'text', label: 'Location' },
  { name: 'city', type: 'text', label: 'City' },
  { name: 'state', type: 'text', label: 'State or region' },
  { name: 'country', type: 'text', label: 'Country' },
  { name: 'industry', type: 'text', label: 'Industry' },
  { name: 'lifecycle', type: 'text', label: 'Lifecycle (lead, contact or customer)' },
  { name: 'email_status', type: 'text', label: 'Email status' },
  { name: 'tags', type: 'array', label: 'Tags', spec: { type: 'text' } },
  { name: 'list_ids', type: 'array', label: 'List IDs', spec: { type: 'text' } },
  { name: 'custom_fields', type: 'any', label: 'Custom fields' },
  { name: 'unsubscribed', type: 'boolean', label: 'Unsubscribed' },
  { name: 'bounced', type: 'boolean', label: 'Bounced' },
  { name: 'engagement_score', type: 'number', label: 'Engagement score (0-100)' },
  { name: 'source', type: 'text', label: 'Source' },
  { name: 'created_at', type: 'date', label: 'Created' },
  { name: 'updated_at', type: 'date', label: 'Updated' },
];

const CAMPAIGN_OUTPUT = [
  { name: 'id', type: 'text', label: 'Campaign ID' },
  { name: 'name', type: 'text', label: 'Name' },
  { name: 'status', type: 'text', label: 'Status' },
];

const REPLY_OUTPUT = [
  { name: 'id', type: 'text', label: 'Reply ID' },
  { name: 'from_email', type: 'email', label: 'From email' },
  { name: 'from_name', type: 'text', label: 'From name' },
  { name: 'subject', type: 'text', label: 'Subject' },
  { name: 'text', type: 'text', label: 'Text' },
  { name: 'intent', type: 'text', label: 'Intent (interested, meeting, objection, ...)' },
  { name: 'intent_confidence', type: 'number', label: 'Intent confidence (0-1)' },
  { name: 'received_at', type: 'date', label: 'Received' },
];

/* ── Samples ─────────────────────────────────────────────────────────── */

const T = '2026-11-03T09:41:00.000Z';
const SAMPLE_CONTACT = {
  id: '6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f', object: 'contact', email: 'ada@analyticalengines.co.uk',
  first_name: 'Ada', last_name: 'Lovelace', full_name: 'Ada Lovelace', company: 'Analytical Engines',
  job_title: 'Head of Partnerships', phone: null, linkedin_url: 'https://www.linkedin.com/in/ada-lovelace',
  website: 'https://analyticalengines.co.uk', location: 'London, United Kingdom', city: 'London', state: null,
  country: 'United Kingdom', industry: 'Software', lifecycle: 'lead', custom_fields: {}, tags: ['webinar'],
  list_ids: [], email_status: 'valid', unsubscribed: false, bounced: false, engagement_score: 62, source: 'api',
  created_at: T, updated_at: T,
};
const SAMPLE_CAMPAIGN = { id: 'c3e5a7b9-2d4f-4b6c-9d8e-0f1a2b3c4d5e', name: 'Q4 partnerships', status: 'running' };
const SAMPLE_REPLY = {
  id: 'f6b8d0e2-5a7c-4e9f-8a1b-3c4d5e6f7a8b', object: 'reply', contact_id: SAMPLE_CONTACT.id, campaign_id: SAMPLE_CAMPAIGN.id,
  from_email: SAMPLE_CONTACT.email, from_name: 'Ada Lovelace', subject: 'Re: partnering with Analytical Engines',
  text: 'Thanks - this is timely. Could we talk on Thursday?', received_at: T, intent: 'meeting', intent_confidence: 0.94,
};

/* ── Instant triggers: one webhook per event ─────────────────────────── */

/** [key, event, label, description, has contact, extra output, extra sample] */
const EVENTS = [
  ['replyInterested', 'reply.interested', 'Watch Interested Replies', 'Triggers when Relay reads a reply as interested or asking for a meeting.', true,
    [{ name: 'reply', type: 'collection', label: 'Reply', spec: REPLY_OUTPUT }], { reply: SAMPLE_REPLY }],
  ['replyReceived', 'reply.received', 'Watch Replies', 'Triggers when a contact replies to a campaign email (auto-replies are left out).', true,
    [{ name: 'reply', type: 'collection', label: 'Reply', spec: REPLY_OUTPUT }], { reply: { ...SAMPLE_REPLY, intent: null, intent_confidence: null } }],
  ['replyClassified', 'reply.classified', 'Watch Classified Replies', 'Triggers when Relay has read a reply, whatever it found.', true,
    [{ name: 'reply', type: 'collection', label: 'Reply', spec: REPLY_OUTPUT }], { reply: SAMPLE_REPLY }],
  ['contactCreated', 'contact.created', 'Watch New Contacts', 'Triggers when a contact is added, by hand, import, the Prospector, the API or another integration.', true, [], {}],
  ['contactUpdated', 'contact.updated', 'Watch Updated Contacts', 'Triggers when a contact\'s details change.', true, [], {}],
  ['contactUnsubscribed', 'contact.unsubscribed', 'Watch Unsubscribes', 'Triggers when a contact unsubscribes, by the link in an email or a reply Relay reads as one.', true,
    [{ name: 'source', type: 'text', label: 'How they unsubscribed' }], { source: 'link' }],
  ['emailOpened', 'email.opened', 'Watch Opens', 'Triggers when a campaign email is opened.', true,
    [{ name: 'email', type: 'collection', label: 'Email', spec: [{ name: 'step_id', type: 'text', label: 'Step ID' }] }], { email: { step_id: 'd4f6b8c0-3e5a-4c7d-8e9f-1a2b3c4d5e6f' } }],
  ['emailClicked', 'email.clicked', 'Watch Link Clicks', 'Triggers when a link in a campaign email is clicked.', true,
    [{ name: 'email', type: 'collection', label: 'Email', spec: [{ name: 'step_id', type: 'text', label: 'Step ID' }, { name: 'url', type: 'url', label: 'Clicked URL' }] }],
    { email: { step_id: 'd4f6b8c0-3e5a-4c7d-8e9f-1a2b3c4d5e6f', url: 'https://analyticalengines.co.uk/demo' } }],
  ['emailBounced', 'email.bounced', 'Watch Bounces', 'Triggers when a campaign email bounces.', true,
    [{ name: 'email', type: 'collection', label: 'Email', spec: [{ name: 'kind', type: 'text', label: 'Bounce kind' }, { name: 'to', type: 'email', label: 'Address' }, { name: 'reason', type: 'text', label: 'Reason' }] }],
    { email: { kind: 'hard', to: SAMPLE_CONTACT.email, reason: '550 5.1.1 User unknown' } }],
  ['emailSent', 'email.sent', 'Watch Sent Emails', 'Triggers when a campaign email goes out. Can be a lot of operations on a busy account.', true,
    [{ name: 'email', type: 'collection', label: 'Email', spec: [{ name: 'step_id', type: 'text', label: 'Step ID' }, { name: 'subject', type: 'text', label: 'Subject' }, { name: 'to', type: 'email', label: 'To' }] }],
    { email: { step_id: 'd4f6b8c0-3e5a-4c7d-8e9f-1a2b3c4d5e6f', subject: 'Partnering with Analytical Engines', to: SAMPLE_CONTACT.email } }],
  ['campaignCompleted', 'campaign.completed', 'Watch Completed Campaigns', 'Triggers when every contact in a campaign has finished its sequence.', false, [], {}],
  ['campaignPaused', 'campaign.paused', 'Watch Paused Campaigns', 'Triggers when a campaign is paused, by a person or by the deliverability autopilot.', false,
    [{ name: 'reason', type: 'text', label: 'Why it was paused' }], { reason: null }],
];

const webhooks = EVENTS.map(([key, type, label]) => ({
  key: `${key}Hook`,
  label: `Sincerely: ${label.replace(/^Watch /, '')}`,
  type: 'web',
  parameters: [],
  // A delivery becomes one bundle: the v1 event as Sincerely sent it.
  api: { respond: { status: 200, body: { received: true } }, output: '{{body}}' },
  // Turning a scenario's trigger on creates a v1 webhook in Sincerely for this one event...
  attach: {
    url: '/webhooks',
    method: 'POST',
    body: { url: '{{webhook.url}}', events: [type], description: `Make: ${label}` },
    response: { data: { externalHookId: '{{body.id}}' } },
  },
  // ...and deleting it removes that webhook. Already gone (404) is fine.
  detach: {
    url: '/webhooks/{{webhook.externalHookId}}',
    method: 'DELETE',
    response: { valid: '{{statusCode < 300 || statusCode == 404}}' },
  },
}));

const instantTriggers = EVENTS.map(([key, type, label, description, hasContact, extraOut, extraSample]) => ({
  key,
  label,
  description,
  moduleType: 'instant_trigger',
  webhook: `${key}Hook`,
  api: {},
  parameters: [],
  expect: [],
  interface: [
    { name: 'id', type: 'text', label: 'Event ID' },
    { name: 'type', type: 'text', label: 'Event type' },
    { name: 'created_at', type: 'date', label: 'Occurred' },
    {
      name: 'data', type: 'collection', label: 'Data',
      spec: [
        ...(hasContact ? [{ name: 'contact', type: 'collection', label: 'Contact', spec: CONTACT_OUTPUT }] : []),
        { name: 'campaign', type: 'collection', label: 'Campaign', spec: CAMPAIGN_OUTPUT },
        ...extraOut,
      ],
    },
  ],
  samples: {
    id: 'evt_9b2f6c1e8a4d4e0f9c1a2b3c', object: 'event', type, created_at: T, api_version: '2026-11-01',
    data: { ...(hasContact ? { contact: SAMPLE_CONTACT } : {}), campaign: SAMPLE_CAMPAIGN, ...extraSample },
  },
}));

/* ── RPCs: dropdowns ─────────────────────────────────────────────────── */

const pagedList = (path, label) => ({
  url: path,
  method: 'GET',
  qs: { limit: 100 },
  response: {
    iterate: '{{body.data}}',
    output: { label, value: '{{item.id}}' },
  },
  pagination: {
    qs: { cursor: '{{body.next_cursor}}' },
    condition: '{{body.has_more}}',
  },
});

const rpcs = [
  { key: 'listLists', label: 'List lists', parameters: [], api: pagedList('/lists', '{{item.name}} ({{item.kind}} list, {{item.contact_count}})') },
  { key: 'listCampaigns', label: 'List campaigns', parameters: [], api: pagedList('/campaigns', '{{item.name}} ({{item.status}})') },
];

const campaignSelect = { name: 'campaign_id', type: 'select', label: 'Campaign', required: true, options: 'rpc://listCampaigns' };
const listSelect = (required) => ({ name: 'list_id', type: 'select', label: required ? 'List' : 'Add to list', required, options: 'rpc://listLists' });
const emailInput = { name: 'email', type: 'email', label: 'Email', required: true };

/* ── Actions ─────────────────────────────────────────────────────────── */

const actions = [
  {
    key: 'createContact',
    label: 'Create or Update a Contact',
    description: 'Adds a contact, or updates the one with that email address. Fields left empty never clear anything.',
    moduleType: 'action',
    crud: 'create',
    parameters: [],
    expect: [
      { ...emailInput, help: 'One contact per address. Any case: it is stored lower-case.' },
      ...CONTACT_INPUT,
      listSelect(false),
      TAGS_INPUT,
      {
        name: 'lifecycle', type: 'select', label: 'Lifecycle',
        help: 'New contacts are leads unless you choose otherwise. Leave empty to keep an existing contact as they are.',
        options: [
          { label: 'Lead (someone you are prospecting)', value: 'lead' },
          { label: 'Contact (a relationship)', value: 'contact' },
          { label: 'Customer', value: 'customer' },
        ],
      },
      CUSTOM_INPUT,
      { name: 'update_existing', type: 'boolean', label: 'Update the contact if the email already exists', default: true, help: 'No: the step fails if the email is already in Sincerely.' },
    ],
    api: {
      url: '/contacts',
      method: 'POST',
      body: {
        ...contactBody(),
        list_ids: ['{{parameters.list_id}}'],
        lifecycle: '{{parameters.lifecycle}}',
        upsert: '{{parameters.update_existing}}',
      },
      response: { output: '{{body}}' },
    },
    interface: CONTACT_OUTPUT,
    samples: SAMPLE_CONTACT,
  },
  {
    key: 'addToCampaign',
    label: 'Add a Contact to a Campaign',
    description: 'Puts a person into a campaign\'s sequence, creating or updating the contact first. Nobody unsubscribed, suppressed or bounced is ever added; the output says what happened and why.',
    moduleType: 'action',
    crud: 'create',
    parameters: [],
    expect: [campaignSelect, emailInput, ...CONTACT_INPUT, TAGS_INPUT, CUSTOM_INPUT],
    api: {
      url: '/campaigns/{{parameters.campaign_id}}/contacts',
      method: 'POST',
      body: { contacts: [contactBody()] },
      response: { output: '{{first(body.results)}}' },
    },
    interface: [
      { name: 'outcome', type: 'text', label: 'Outcome (added, skipped, not_found or invalid)' },
      { name: 'reason', type: 'text', label: 'Why not added' },
      { name: 'reason_code', type: 'text', label: 'Why not added (code)' },
      { name: 'detail', type: 'text', label: 'Detail' },
      { name: 'email', type: 'email', label: 'Email' },
      { name: 'contact_id', type: 'text', label: 'Contact ID' },
    ],
    samples: { email: SAMPLE_CONTACT.email, contact_id: SAMPLE_CONTACT.id, outcome: 'added', reason_code: null, reason: null, detail: null },
  },
  {
    key: 'removeFromCampaign',
    label: 'Remove a Contact from a Campaign',
    description: 'Stops a person\'s sequence and takes them out of a campaign.',
    moduleType: 'action',
    crud: 'delete',
    parameters: [],
    expect: [campaignSelect, emailInput],
    api: {
      url: '/campaigns/{{parameters.campaign_id}}/contacts/{{encodeURL(parameters.email)}}',
      method: 'DELETE',
      response: { output: '{{body}}' },
    },
    interface: [{ name: 'campaign_id', type: 'text', label: 'Campaign ID' }, { name: 'contact_id', type: 'text', label: 'Contact ID' }, { name: 'deleted', type: 'boolean', label: 'Removed' }],
    samples: { object: 'enrolment', campaign_id: SAMPLE_CAMPAIGN.id, contact_id: SAMPLE_CONTACT.id, deleted: true },
  },
  {
    key: 'addToList',
    label: 'Add a Contact to a List',
    description: 'Adds a person to a list, creating the contact if the address is new.',
    moduleType: 'action',
    crud: 'update',
    parameters: [],
    expect: [listSelect(true), emailInput],
    api: {
      url: '/lists/{{parameters.list_id}}/contacts',
      method: 'POST',
      body: { emails: ['{{parameters.email}}'] },
      response: { output: '{{body}}' },
    },
    interface: [
      { name: 'list_id', type: 'text', label: 'List ID' },
      { name: 'added', type: 'number', label: 'Added' },
      { name: 'already_there', type: 'number', label: 'Already in the list' },
      { name: 'created_contacts', type: 'number', label: 'New contacts created' },
    ],
    samples: { object: 'list_change', list_id: 'b2d4f6a8-1c3e-4a5b-8c7d-9e0f1a2b3c4d', added: 1, already_there: 0, created_contacts: 0 },
  },
  {
    key: 'unsubscribe',
    label: 'Unsubscribe an Email Address',
    description: 'Stops every campaign emailing this address, now and in future, whether or not it is a contact yet.',
    moduleType: 'action',
    crud: 'update',
    parameters: [],
    expect: [emailInput],
    api: { url: '/unsubscribes', method: 'POST', body: { email: '{{parameters.email}}' }, response: { output: '{{body}}' } },
    interface: [
      { name: 'email', type: 'email', label: 'Email' },
      { name: 'was_contact', type: 'boolean', label: 'Was a contact' },
      { name: 'contact_id', type: 'text', label: 'Contact ID' },
    ],
    samples: { object: 'unsubscribe', email: 'no-thanks@example.com', was_contact: true, contact_id: SAMPLE_CONTACT.id },
  },
  ...['pause', 'resume'].map((verb) => ({
    key: `${verb}Campaign`,
    label: verb === 'pause' ? 'Pause a Campaign' : 'Resume a Campaign',
    description: verb === 'pause' ? 'Stops a campaign sending until it is resumed.' : 'Starts a paused campaign sending again.',
    moduleType: 'action',
    crud: 'update',
    parameters: [],
    expect: [campaignSelect],
    api: { url: `/campaigns/{{parameters.campaign_id}}/${verb}`, method: 'POST', body: {}, response: { output: '{{body}}' } },
    interface: [
      ...CAMPAIGN_OUTPUT,
      { name: 'stats', type: 'collection', label: 'Totals', spec: ['enrolled', 'sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed'].map((n) => ({ name: n, type: 'number', label: n[0].toUpperCase() + n.slice(1) })) },
    ],
    samples: { ...SAMPLE_CAMPAIGN, object: 'campaign', status: verb === 'pause' ? 'paused' : 'running' },
  })),
];

/* ── Searches: lists, paged with Sincerely's cursor ──────────────────── */

const LIMIT = { name: 'limit', type: 'uinteger', label: 'Maximum number of results', default: 10, help: 'Make stops after this many.' };

const pagedSearch = (path, qs) => ({
  url: path,
  method: 'GET',
  qs: { ...qs, limit: 100 },
  response: { iterate: '{{body.data}}', output: '{{item}}', limit: '{{parameters.limit}}' },
  pagination: { qs: { cursor: '{{body.next_cursor}}' }, condition: '{{body.has_more}}' },
});

const searches = [
  {
    key: 'searchContacts',
    label: 'Search Contacts',
    description: 'Finds contacts by email, name, company, list, tag or lifecycle. Newest first.',
    moduleType: 'search',
    parameters: [],
    expect: [
      { name: 'email', type: 'email', label: 'Email', help: 'An exact address.' },
      { name: 'q', type: 'text', label: 'Search', help: 'Words to find in name, email and company.' },
      listSelect(false),
      { name: 'tag', type: 'text', label: 'Tag' },
      { name: 'lifecycle', type: 'select', label: 'Lifecycle', options: [{ label: 'Leads', value: 'lead' }, { label: 'Contacts', value: 'contact' }, { label: 'Customers', value: 'customer' }] },
      { name: 'updated_after', type: 'date', label: 'Changed after', help: 'For syncing: the time of your last run.' },
      LIMIT,
    ],
    api: pagedSearch('/contacts', {
      email: '{{parameters.email}}', q: '{{parameters.q}}', list_id: '{{parameters.list_id}}', tag: '{{parameters.tag}}',
      lifecycle: '{{parameters.lifecycle}}', updated_after: '{{parameters.updated_after}}',
    }),
    interface: CONTACT_OUTPUT,
    samples: SAMPLE_CONTACT,
  },
  {
    key: 'searchReplies',
    label: 'Search Replies',
    description: 'Finds replies, with what Relay read in each. Filter by intent, campaign or time.',
    moduleType: 'search',
    parameters: [],
    expect: [
      {
        name: 'intent', type: 'select', label: 'Intent',
        options: ['interested', 'meeting', 'objection', 'not_now', 'unsubscribe', 'out_of_office', 'other'].map((v) => ({ label: v.replace('_', ' '), value: v })),
      },
      { ...campaignSelect, required: false },
      { name: 'after', type: 'date', label: 'Received after' },
      LIMIT,
    ],
    api: pagedSearch('/replies', { intent: '{{parameters.intent}}', campaign_id: '{{parameters.campaign_id}}', after: '{{parameters.after}}' }),
    interface: [...REPLY_OUTPUT, { name: 'contact_id', type: 'text', label: 'Contact ID' }, { name: 'campaign_id', type: 'text', label: 'Campaign ID' }],
    samples: SAMPLE_REPLY,
  },
  {
    key: 'searchCampaigns',
    label: 'Search Campaigns',
    description: 'Lists your campaigns, newest first, optionally only those in one state.',
    moduleType: 'search',
    parameters: [],
    expect: [
      {
        name: 'status', type: 'select', label: 'Status',
        options: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'].map((v) => ({ label: v[0].toUpperCase() + v.slice(1), value: v })),
      },
      LIMIT,
    ],
    api: pagedSearch('/campaigns', { status: '{{parameters.status}}' }),
    interface: [...CAMPAIGN_OUTPUT, { name: 'list_id', type: 'text', label: 'List ID' }, { name: 'created_at', type: 'date', label: 'Created' }],
    samples: { ...SAMPLE_CAMPAIGN, object: 'campaign', list_id: null, created_at: T },
  },
];

/* ── Make an API call ────────────────────────────────────────────────── */

const universal = {
  key: 'makeApiCall',
  label: 'Make an API Call',
  description: 'Calls any endpoint of the Sincerely API with this connection. See the API reference in Sincerely under Settings > API & webhooks.',
  moduleType: 'universal',
  parameters: [],
  expect: [
    { name: 'url', type: 'text', label: 'URL', required: true, help: 'The path after /v1, with any query string, for example /contacts?email=ada@example.com or /campaigns/{id}/contacts.' },
    {
      name: 'method', type: 'select', label: 'Method', required: true, default: 'GET',
      options: ['GET', 'POST', 'PATCH', 'DELETE'].map((m) => ({ label: m, value: m })),
    },
    { name: 'body', type: 'any', label: 'Body', help: 'JSON, for POST and PATCH.' },
  ],
  api: {
    url: '{{parameters.url}}',
    method: '{{parameters.method}}',
    body: '{{parameters.body}}',
    response: { output: { body: '{{body}}', headers: '{{headers}}', statusCode: '{{statusCode}}' } },
  },
  interface: [
    { name: 'body', type: 'any', label: 'Body' },
    { name: 'headers', type: 'collection', label: 'Headers' },
    { name: 'statusCode', type: 'number', label: 'Status code' },
  ],
  samples: { body: { object: 'account' }, headers: {}, statusCode: 200 },
};

const modules = [...instantTriggers, ...actions, ...searches, universal];

const groups = [
  { label: 'Replies', modules: ['replyInterested', 'replyReceived', 'replyClassified', 'searchReplies'] },
  { label: 'Contacts', modules: ['contactCreated', 'contactUpdated', 'contactUnsubscribed', 'createContact', 'addToList', 'unsubscribe', 'searchContacts'] },
  { label: 'Campaigns', modules: ['addToCampaign', 'removeFromCampaign', 'pauseCampaign', 'resumeCampaign', 'searchCampaigns', 'campaignCompleted', 'campaignPaused'] },
  { label: 'Email activity', modules: ['emailOpened', 'emailClicked', 'emailBounced', 'emailSent'] },
  { label: 'Other', modules: ['makeApiCall'] },
];

/** The parts that carry the API's address, for a given API origin. */
function forApi(apiOrigin = DEFAULT_API) {
  const apiUrl = apiUrlOf(apiOrigin);
  return { base: makeBase(apiUrl), connection: makeConnection(apiUrl), common: common(apiOrigin) };
}

const { base, connection } = forApi();

module.exports = { base, common, connection, forApi, webhooks, rpcs, modules, groups, EVENTS, DEFAULT_API };
