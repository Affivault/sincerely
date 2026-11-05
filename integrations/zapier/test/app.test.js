'use strict';

/*
 * The Zapier app, step by step, against a mocked Sincerely API (nock).
 * The end-to-end version - this app driving the real server - is
 * server/scripts/public-api-check.mts.
 *
 * Run: npm test
 */

process.env.SINCERELY_API_URL = 'https://api.test.sincerely';

const test = require('node:test');
const assert = require('node:assert');
const nock = require('nock');
const zapier = require('zapier-platform-core');
const schema = require('zapier-platform-core/src/tools/schema');

const App = require('../index');
const appTester = zapier.createAppTester(App);
const API = 'https://api.test.sincerely';
const auth = { api_key: 'sk_live_test' };

nock.disableNetConnect();
test.afterEach(() => nock.cleanAll());

const contact = (extra = {}) => ({
  id: '6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f', object: 'contact', email: 'ada@example.com', first_name: 'Ada', last_name: null,
  full_name: 'Ada', tags: ['a', 'b'], list_ids: [], lifecycle: 'lead', email_status: 'valid', unsubscribed: false, created_at: '2026-11-03T09:41:00.000Z', ...extra,
});
const errorBody = (code, message, status) => ({ error: { type: 'x', code, message, doc_url: 'd' }, request_id: 'req_abc' });

test('the app definition is valid for Zapier', () => {
  const errors = schema.validateApp(schema.prepareApp(App));
  assert.deepStrictEqual(errors.map((e) => e.stack || e.message), []);
});

test('every visible trigger, action and search has a description Zapier accepts', () => {
  for (const kind of ['triggers', 'creates', 'searches']) {
    for (const [key, def] of Object.entries(App[kind])) {
      if (def.display.hidden) continue;
      assert.ok(def.display.description.length >= 20, `${kind}.${key} description too short`);
      if (kind === 'triggers') assert.match(def.display.description, /^Triggers when /, `${kind}.${key}`);
      assert.ok(def.operation.sample, `${kind}.${key} has a sample`);
    }
  }
});

test('auth: the key is sent as a bearer token, and a read-only key is refused with a reason', async () => {
  nock(API, { reqheaders: { authorization: 'Bearer sk_live_test', 'user-agent': /Zapier/ } })
    .get('/v1/me').reply(200, { object: 'account', email: 'alex@affivault.com', api_key: { name: 'Zapier', scopes: ['read', 'write'] } });
  const me = await appTester(App.authentication.test, { authData: auth });
  assert.strictEqual(me.email, 'alex@affivault.com');

  nock(API).get('/v1/me').reply(200, { object: 'account', email: 'a@b.co', api_key: { scopes: ['read'] } });
  await assert.rejects(appTester(App.authentication.test, { authData: auth }), /read-only/);
});

test('auth: a revoked key asks for a reconnect, not a generic failure', async () => {
  nock(API).get('/v1/me').reply(401, errorBody('invalid_api_key', 'This API key is wrong, revoked or expired.'));
  await assert.rejects(appTester(App.authentication.test, { authData: auth }), (e) => e.name === 'ExpiredAuthError' && /Reconnect/.test(e.message));
});

test('rate limited: Zapier is told to wait for as long as Sincerely says', async () => {
  nock(API).get('/v1/me').reply(429, errorBody('rate_limited', 'Slow down.'), { 'Retry-After': '17' });
  await assert.rejects(appTester(App.authentication.test, { authData: auth }), (e) => e.name === 'ThrottledError' && JSON.parse(e.message).delay === 17);
});

test('other errors carry the API\'s own sentence and reference', async () => {
  nock(API).post('/v1/contacts').reply(409, errorBody('contact_exists', 'A contact with this email already exists.'));
  await assert.rejects(
    appTester(App.creates.create_contact.operation.perform, { authData: auth, inputData: { email: 'ada@example.com', update_existing: false } }),
    (e) => { const m = JSON.parse(e.message); return /already exists/.test(m.message) && /req_abc/.test(m.message) && m.code === 'contact_exists' && m.status === 409; },
  );
});

test('create or update: blanks are left out, tags split, update by default, list and lifecycle passed', async () => {
  let sent;
  nock(API).post('/v1/contacts', (b) => { sent = b; return true; }).reply(200, contact());
  const out = await appTester(App.creates.create_contact.operation.perform, {
    authData: auth,
    inputData: { email: ' ada@example.com ', first_name: 'Ada', company: '', phone: '   ', tags: 'webinar, uk ,', list_id: 'L1', lifecycle: 'customer', custom_fields: { deal: '50k', empty: '' } },
  });
  assert.deepStrictEqual(sent, { email: 'ada@example.com', first_name: 'Ada', tags: ['webinar', 'uk'], custom_fields: { deal: '50k' }, list_ids: ['L1'], lifecycle: 'customer', upsert: true });
  assert.strictEqual(out.tags_text, 'a, b');
});

test('create: "no" to updating sends upsert false', async () => {
  let sent;
  nock(API).post('/v1/contacts', (b) => { sent = b; return true; }).reply(201, contact());
  await appTester(App.creates.create_contact.operation.perform, { authData: auth, inputData: { email: 'ada@example.com', update_existing: 'no' } });
  assert.strictEqual(sent.upsert, false);
});

test('add to campaign: added', async () => {
  let sent;
  nock(API).post('/v1/campaigns/C1/contacts', (b) => { sent = b; return true; })
    .reply(200, { object: 'enrolment_result', added: 1, skipped: 0, total: 9, reasons: {}, skips: [], not_found: [], created_contacts: 1 });
  const out = await appTester(App.creates.add_to_campaign.operation.perform, { authData: auth, inputData: { campaign_id: 'C1', email: 'ada@example.com', first_name: 'Ada' } });
  assert.deepStrictEqual(sent, { contacts: [{ email: 'ada@example.com', first_name: 'Ada' }] });
  assert.strictEqual(out.outcome, 'added');
  assert.strictEqual(out.contact_created, true);
  assert.strictEqual(out.campaign_total, 9);
});

test('add to campaign: skipped says why, in words, and carries on by default', async () => {
  nock(API).post('/v1/campaigns/C1/contacts')
    .reply(200, { added: 0, skipped: 1, total: 9, reasons: { unsubscribed: 1 }, skips: [{ reason: 'unsubscribed', detail: null }], not_found: [] });
  const out = await appTester(App.creates.add_to_campaign.operation.perform, { authData: auth, inputData: { campaign_id: 'C1', email: 'ada@example.com' } });
  assert.strictEqual(out.outcome, 'skipped');
  assert.strictEqual(out.reason, 'unsubscribed');
  assert.strictEqual(out.reason_code, 'unsubscribed');
});

test('add to campaign: "stop if not added" halts the Zap rather than failing it', async () => {
  nock(API).post('/v1/campaigns/C1/contacts')
    .reply(200, { added: 0, skipped: 1, total: 9, reasons: { in_other_campaign: 1 }, skips: [{ reason: 'in_other_campaign', detail: 'Q3 outreach' }], not_found: [] });
  await assert.rejects(
    appTester(App.creates.add_to_campaign.operation.perform, { authData: auth, inputData: { campaign_id: 'C1', email: 'ada@example.com', stop_if_skipped: true } }),
    (e) => e.name === 'HaltedError' && /in another active campaign/.test(e.message),
  );
});

test('unsubscribe: a contact is unsubscribed; an unknown address is suppressed instead', async () => {
  nock(API).get('/v1/contacts').query({ email: 'ada@example.com', limit: 1 }).reply(200, { object: 'list', data: [contact()], has_more: false, next_cursor: null });
  nock(API).post(`/v1/contacts/${contact().id}/unsubscribe`).reply(200, contact({ unsubscribed: true }));
  const a = await appTester(App.creates.unsubscribe.operation.perform, { authData: auth, inputData: { email: 'ADA@example.com' } });
  assert.strictEqual(a.was_contact, true);

  let sent;
  nock(API).get('/v1/contacts').query({ email: 'new@example.com', limit: 1 }).reply(200, { object: 'list', data: [], has_more: false, next_cursor: null });
  nock(API).post('/v1/suppressions', (b) => { sent = b; return true; }).reply(201, { added: 1, already_suppressed: 0, invalid: [] });
  const b = await appTester(App.creates.unsubscribe.operation.perform, { authData: auth, inputData: { email: 'new@example.com' } });
  assert.deepStrictEqual(sent, { emails: ['new@example.com'] });
  assert.strictEqual(b.was_contact, false);
});

test('remove from campaign: an unknown address is a clear error', async () => {
  nock(API).get('/v1/contacts').query(true).reply(200, { object: 'list', data: [], has_more: false, next_cursor: null });
  await assert.rejects(appTester(App.creates.remove_from_campaign.operation.perform, { authData: auth, inputData: { campaign_id: 'C1', email: 'x@example.com' } }), /no contact with the address/);
});

test('find contact: found and not found', async () => {
  nock(API).get('/v1/contacts').query(true).reply(200, { object: 'list', data: [contact()], has_more: false, next_cursor: null });
  assert.strictEqual((await appTester(App.searches.find_contact.operation.perform, { authData: auth, inputData: { email: 'ada@example.com' } })).length, 1);
  nock(API).get('/v1/contacts').query(true).reply(200, { object: 'list', data: [], has_more: false, next_cursor: null });
  assert.deepStrictEqual(await appTester(App.searches.find_contact.operation.perform, { authData: auth, inputData: { email: 'nobody@example.com' } }), []);
});

test('find campaign: matches the name on a later page', async () => {
  nock(API).get('/v1/campaigns').query({ limit: 100 }).reply(200, { data: [{ id: 'A', name: 'Other' }], has_more: true, next_cursor: 'c2' });
  nock(API).get('/v1/campaigns').query({ limit: 100, cursor: 'c2' }).reply(200, { data: [{ id: 'B', name: 'Q4 Partnerships ' }], has_more: false, next_cursor: null });
  nock(API).get('/v1/campaigns/B').reply(200, { id: 'B', object: 'campaign', name: 'Q4 Partnerships', status: 'running' });
  const out = await appTester(App.searches.find_campaign.operation.perform, { authData: auth, inputData: { name: 'q4 partnerships' } });
  assert.strictEqual(out[0].id, 'B');
});

test('trigger: subscribing creates a webhook for exactly that event; unsubscribing deletes it, and a gone one is fine', async () => {
  let sent;
  nock(API).post('/v1/webhooks', (b) => { sent = b; return true; }).reply(201, { id: 'W1', object: 'webhook', secret: 'whsec_x' });
  const sub = await appTester(App.triggers.reply_interested.operation.performSubscribe, { authData: auth, targetUrl: 'https://hooks.zapier.com/abc', inputData: {} });
  assert.deepStrictEqual(sent.events, ['reply.interested']);
  assert.strictEqual(sent.url, 'https://hooks.zapier.com/abc');
  assert.strictEqual(sub.id, 'W1');

  nock(API).delete('/v1/webhooks/W1').reply(200, { deleted: true });
  await appTester(App.triggers.reply_interested.operation.performUnsubscribe, { authData: auth, subscribeData: { id: 'W1' } });
  nock(API).delete('/v1/webhooks/W2').reply(404, errorBody('resource_not_found', 'No such webhook.'));
  await appTester(App.triggers.reply_interested.operation.performUnsubscribe, { authData: auth, subscribeData: { id: 'W2' } });
  nock(API).delete('/v1/webhooks/W3').reply(500, errorBody('internal_error', 'Broken.'));
  await assert.rejects(appTester(App.triggers.reply_interested.operation.performUnsubscribe, { authData: auth, subscribeData: { id: 'W3' } }));
});

const delivery = (type, campaignId = 'C1') => ({
  id: 'evt_1', object: 'event', type, created_at: '2026-11-03T09:41:00.000Z',
  data: { contact: contact(), campaign: { id: campaignId, name: 'Q4' }, reply: { id: 'R1', text: 'Thursday?', intent: 'meeting' } },
});

test('trigger: a delivery becomes one item, with the contact, campaign and reply', async () => {
  const out = await appTester(App.triggers.reply_interested.operation.perform, { authData: auth, inputData: {}, cleanedRequest: delivery('reply.interested') });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'evt_1');
  assert.strictEqual(out[0].contact.email, 'ada@example.com');
  assert.strictEqual(out[0].contact.tags_text, 'a, b');
  assert.strictEqual(out[0].reply.intent, 'meeting');
});

test('trigger: the campaign filter keeps only that campaign', async () => {
  const keep = await appTester(App.triggers.reply_received.operation.perform, { authData: auth, inputData: { campaign_id: 'C1' }, cleanedRequest: delivery('reply.received', 'C1') });
  const drop = await appTester(App.triggers.reply_received.operation.perform, { authData: auth, inputData: { campaign_id: 'C1' }, cleanedRequest: delivery('reply.received', 'C2') });
  assert.strictEqual(keep.length, 1);
  assert.strictEqual(drop.length, 0);
});

test('trigger: a delivery of another event type is ignored', async () => {
  const out = await appTester(App.triggers.reply_interested.operation.perform, { authData: auth, inputData: {}, cleanedRequest: delivery('reply.received') });
  assert.deepStrictEqual(out, []);
});

test('trigger: the test record comes from the account\'s own data', async () => {
  nock(API).get('/v1/events/types/reply.interested/sample').reply(200, delivery('reply.interested'));
  const out = await appTester(App.triggers.reply_interested.operation.performList, { authData: auth, inputData: {} });
  assert.strictEqual(out[0].reply.text, 'Thursday?');
});

test('dropdowns: lists page through Sincerely\'s cursor; finished campaigns are not offered for adding people', async () => {
  nock(API).get('/v1/lists').query({ limit: 100 }).reply(200, { data: [{ id: 'L1', name: 'UK', kind: 'lead', contact_count: 3 }], has_more: true, next_cursor: 'n2' });
  nock(API).get('/v1/lists').query({ limit: 100, cursor: 'n2' }).reply(200, { data: [{ id: 'L2', name: 'Customers', kind: 'contact', contact_count: 40 }], has_more: false, next_cursor: null });
  const lists = await appTester(App.triggers.list_list.operation.perform, { authData: auth, meta: { page: 0 } });
  assert.deepStrictEqual(lists.map((l) => l.name), ['UK (lead list, 3)', 'Customers (contact list, 40)']);

  nock(API).get('/v1/campaigns').query({ limit: 100 }).reply(200, { data: [{ id: 'A', name: 'Live', status: 'running' }, { id: 'B', name: 'Old', status: 'completed' }], has_more: false, next_cursor: null });
  const open = await appTester(App.triggers.campaign_list_open.operation.perform, { authData: auth, meta: { page: 0 } });
  assert.deepStrictEqual(open.map((c) => c.id), ['A']);
});
