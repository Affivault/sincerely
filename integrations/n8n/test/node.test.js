'use strict';

/*
 * The n8n nodes, run against a stand-in for n8n's runtime: what each
 * operation sends, how it pages, how errors read, and the trigger's whole
 * webhook lifecycle including the signature check. Runs on the built dist/.
 *
 * Run: npm test
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { Sincerely } = require('../dist/nodes/Sincerely/Sincerely.node.js');
const { SincerelyTrigger, verifySignature, EVENTS } = require('../dist/nodes/Sincerely/SincerelyTrigger.node.js');
const { apiRoot } = require('../dist/nodes/Sincerely/GenericFunctions.js');
const { SincerelyApi } = require('../dist/credentials/SincerelyApi.credentials.js');

const NODE = { id: 'n1', name: 'Sincerely', type: 'n8n-nodes-sincerely.sincerely', typeVersion: 1, position: [0, 0], parameters: {} };

/** A stand-in for IExecuteFunctions / IHookFunctions: parameters in, HTTP calls recorded, answers scripted. */
function ctx(params, answers = [], opts = {}) {
	const calls = [];
	const staticData = opts.staticData ?? {};
	const c = {
		calls,
		staticData,
		getInputData: () => (opts.items ?? [{ json: {} }]),
		getNodeParameter: (name, _i, fallback) => {
			const v = typeof _i === 'number' || _i === undefined ? params[name] : params[name];
			if (v === undefined) {
				if (fallback !== undefined) return fallback;
				if (typeof _i !== 'number' && _i !== undefined) return _i;
				throw new Error(`no parameter ${name}`);
			}
			return v;
		},
		getCredentials: async () => ({ apiKey: 'sk_live_test', baseUrl: opts.baseUrl ?? 'https://api.example.com/' }),
		getNode: () => NODE,
		continueOnFail: () => !!opts.continueOnFail,
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc/webhook',
		getWorkflow: () => ({ name: 'Interested replies to Slack' }),
		helpers: {
			httpRequestWithAuthentication: async function (credentialType, options) {
				assert.strictEqual(credentialType, 'sincerelyApi');
				calls.push(options);
				const next = answers.shift();
				if (typeof next === 'function') return next(options);
				if (next instanceof Error) throw next;
				return next ?? {};
			},
			returnJsonArray: (items) => items.map((json) => ({ json })),
		},
	};
	return c;
}

const httpError = (status, code, message) => Object.assign(new Error(`Request failed with status code ${status}`), {
	response: { status, data: { error: { type: 'x', code, message, doc_url: 'd' }, request_id: 'req_abc123' } },
});

const node = new Sincerely();
const run = (params, answers, opts) => {
	const c = ctx(params, answers, opts);
	return node.execute.call(c).then((out) => ({ out: out[0], calls: c.calls }));
};

test('the API root comes from the credential, with or without /v1 or a trailing slash', () => {
	assert.strictEqual(apiRoot('https://api.example.com'), 'https://api.example.com/v1');
	assert.strictEqual(apiRoot('https://api.example.com/'), 'https://api.example.com/v1');
	assert.strictEqual(apiRoot('https://api.example.com/v1'), 'https://api.example.com/v1');
	assert.strictEqual(apiRoot('https://api.example.com/api/v1/'), 'https://api.example.com/v1');
	assert.strictEqual(apiRoot(''), 'https://skysend-api.onrender.com/v1');
});

test('the credential sends the key as a bearer token and is tested against /v1/me', () => {
	const cred = new SincerelyApi();
	assert.strictEqual(cred.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.strictEqual(cred.test.request.url, '/me');
	assert.match(cred.test.request.baseURL, /\/v1$/);
	assert.ok(cred.properties.find((p) => p.name === 'apiKey').typeOptions.password, 'the key is a password field');
});

test('contact upsert: only filled fields are sent, tags split, custom fields and list attached', async () => {
	const { out, calls } = await run({
		resource: 'contact', operation: 'upsert', email: ' ada@example.com ', updateExisting: true,
		additionalFields: {
			first_name: 'Ada', company: '', phone: '  ', tags: 'webinar, uk,,webinar', listId: 'L1', lifecycle: 'customer',
			customFields: { field: [{ key: 'deal', value: '50k' }, { key: '', value: 'x' }, { key: 'empty', value: '' }] },
		},
	}, [{ id: 'c1', object: 'contact' }]);
	assert.strictEqual(calls[0].method, 'POST');
	assert.strictEqual(calls[0].url, 'https://api.example.com/v1/contacts');
	assert.deepStrictEqual(calls[0].body, {
		email: 'ada@example.com', first_name: 'Ada', lifecycle: 'customer', tags: ['webinar', 'uk'],
		custom_fields: { deal: '50k' }, list_ids: ['L1'], upsert: true,
	});
	assert.match(calls[0].headers['User-Agent'], /n8n/, 'Sincerely can tell the call came from n8n');
	assert.deepStrictEqual(out, [{ json: { id: 'c1', object: 'contact' }, pairedItem: { item: 0 } }]);
});

test('contact get: by id directly, by email through the list filter, and a missing address is a clear error', async () => {
	let r = await run({ resource: 'contact', operation: 'get', contactId: 'c1' }, [{ id: 'c1' }]);
	assert.strictEqual(r.calls[0].url, 'https://api.example.com/v1/contacts/c1');
	r = await run({ resource: 'contact', operation: 'get', contactId: 'Ada@Example.com' }, [{ data: [{ id: 'c1' }], has_more: false }]);
	assert.strictEqual(r.calls[0].url, 'https://api.example.com/v1/contacts');
	assert.strictEqual(r.calls[0].qs.email, 'Ada@Example.com');
	await assert.rejects(
		run({ resource: 'contact', operation: 'get', contactId: 'ghost@example.com' }, [{ data: [], has_more: false }]),
		/no contact with the address ghost@example.com/,
	);
});

test('get many: follows the cursor and stops at the limit', async () => {
	const { out, calls } = await run(
		{ resource: 'contact', operation: 'getAll', returnAll: false, limit: 3, filters: { lifecycle: 'lead', q: '' } },
		[{ data: [{ id: 'a' }, { id: 'b' }], has_more: true, next_cursor: 'cur2' }, { data: [{ id: 'c' }, { id: 'd' }], has_more: true, next_cursor: 'cur3' }],
	);
	assert.deepStrictEqual(out.map((o) => o.json.id), ['a', 'b', 'c']);
	assert.strictEqual(calls.length, 2);
	assert.deepStrictEqual(calls[0].qs, { lifecycle: 'lead', limit: 3 }, 'an empty filter is left out');
	assert.strictEqual(calls[1].qs.cursor, 'cur2');
	assert.strictEqual(calls[1].qs.limit, 1, 'the second page asks only for what is still needed');
});

test('get many with Return All reads to the last page', async () => {
	const { out } = await run({ resource: 'list', operation: 'getAll', returnAll: true },
		[{ data: [{ id: 'a' }], has_more: true, next_cursor: 'x' }, { data: [{ id: 'b' }], has_more: false, next_cursor: null }]);
	assert.deepStrictEqual(out.map((o) => o.json.id), ['a', 'b']);
});

test('add to campaign: the person\'s own answer comes out, with the campaign\'s totals', async () => {
	const { out, calls } = await run(
		{ resource: 'campaign', operation: 'addContact', campaignId: 'C 1', email: 'ada@example.com', additionalFields: { first_name: 'Ada' } },
		[{ object: 'enrolment_result', campaign_id: 'C 1', total: 9, created_contacts: 1, results: [{ email: 'ada@example.com', outcome: 'skipped', reason: 'unsubscribed', reason_code: 'unsubscribed' }] }],
	);
	assert.strictEqual(calls[0].url, 'https://api.example.com/v1/campaigns/C%201/contacts');
	assert.deepStrictEqual(calls[0].body, { contacts: [{ email: 'ada@example.com', first_name: 'Ada' }] });
	assert.deepStrictEqual(out[0].json, { email: 'ada@example.com', outcome: 'skipped', reason: 'unsubscribed', reason_code: 'unsubscribed', campaign_id: 'C 1', campaign_total: 9, contact_created: true });
});

test('remove from campaign and list name the person by email, encoded', async () => {
	let r = await run({ resource: 'campaign', operation: 'removeContact', campaignId: 'C1', email: 'a+b@example.com' }, [{ deleted: true }]);
	assert.strictEqual(r.calls[0].method, 'DELETE');
	assert.strictEqual(r.calls[0].url, 'https://api.example.com/v1/campaigns/C1/contacts/a%2Bb%40example.com');
	r = await run({ resource: 'list', operation: 'removeContact', listId: 'L1', email: 'a@example.com' }, [{ removed: 1 }]);
	assert.strictEqual(r.calls[0].url, 'https://api.example.com/v1/lists/L1/contacts/a%40example.com');
});

test('unsubscribe is one call, whether or not the address is a contact', async () => {
	const { calls } = await run({ resource: 'contact', operation: 'unsubscribe', email: ' no@example.com ' }, [{ object: 'unsubscribe', was_contact: false }]);
	assert.strictEqual(calls[0].url, 'https://api.example.com/v1/unsubscribes');
	assert.deepStrictEqual(calls[0].body, { email: 'no@example.com' });
});

test('pause and resume send an empty JSON body', async () => {
	const { calls } = await run({ resource: 'campaign', operation: 'pause', campaignId: 'C1' }, [{ status: 'paused' }]);
	assert.strictEqual(calls[0].url, 'https://api.example.com/v1/campaigns/C1/pause');
	assert.deepStrictEqual(calls[0].body, {});
});

test('an API error shows Sincerely\'s own sentence, its code and reference', async () => {
	await assert.rejects(
		run({ resource: 'contact', operation: 'upsert', email: 'ada@example.com', updateExisting: false, additionalFields: {} }, [httpError(409, 'contact_exists', 'A contact with this email already exists.')]),
		(e) => /already exists/.test(e.message) && /contact_exists/.test(e.description) && /req_abc123/.test(e.description),
	);
	// A bad key says what to do about it.
	await assert.rejects(
		run({ resource: 'contact', operation: 'unsubscribe', email: 'a@example.com' }, [httpError(401, 'invalid_api_key', 'This API key is wrong, revoked or expired.')]),
		(e) => /revoked/.test(e.message) && /Check the API key/.test(e.description),
	);
});

test('with Continue On Fail, the error becomes an item and the rest carry on', async () => {
	const { out } = await run({ resource: 'contact', operation: 'unsubscribe', email: 'x@example.com' },
		[httpError(400, 'parameter_invalid', 'Nope.'), { object: 'unsubscribe' }],
		{ continueOnFail: true, items: [{ json: {} }, { json: {} }] });
	assert.strictEqual(out.length, 2);
	assert.match(out[0].json.error, /Nope/);
	assert.strictEqual(out[1].json.object, 'unsubscribe');
});

test('the dropdowns list up to 1,000 lists and campaigns, named so they can be told apart', async () => {
	const c = ctx({}, [{ data: [{ id: 'L1', name: 'UK', kind: 'lead', contact_count: 3 }], has_more: false }, { data: [{ id: 'C1', name: 'Q4', status: 'running' }], has_more: false }]);
	assert.deepStrictEqual(await node.methods.loadOptions.getLists.call(c), [{ name: 'UK (lead list, 3)', value: 'L1' }]);
	assert.deepStrictEqual(await node.methods.loadOptions.getCampaigns.call(c), [{ name: 'Q4 (running)', value: 'C1' }]);
});

test('the node can be used by n8n AI agents as a tool', () => {
	assert.strictEqual(node.description.usableAsTool, true);
});

/* ── Trigger ───────────────────────────────────────────────────────────── */

const trigger = new SincerelyTrigger();
const hooks = trigger.webhookMethods.default;
const sign = (secret, body, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

test('the trigger offers every Sincerely event, the interested reply by default', () => {
	assert.strictEqual(EVENTS.length, 12);
	assert.deepStrictEqual(trigger.description.properties.find((p) => p.name === 'events').default, ['reply.interested']);
});

test('signature: Sincerely\'s format verifies; a changed body, wrong secret or old timestamp does not', () => {
	const body = '{"id":"evt_1","type":"reply.interested"}';
	assert.ok(verifySignature('whsec_x', body, sign('whsec_x', body)));
	assert.ok(!verifySignature('whsec_x', body.replace('interested', 'received'), sign('whsec_x', body)));
	assert.ok(!verifySignature('whsec_y', body, sign('whsec_x', body)));
	assert.ok(!verifySignature('whsec_x', body, sign('whsec_x', body, Math.floor(Date.now() / 1000) - 600)));
	assert.ok(!verifySignature('whsec_x', body, '') && !verifySignature('whsec_x', body, 'v1=00'));
});

test('activating creates one webhook for the chosen events and keeps its id and secret', async () => {
	const c = ctx({ events: ['reply.interested', 'contact.unsubscribed'] }, [{ id: 'W1', secret: 'whsec_s' }]);
	assert.strictEqual(await hooks.create.call(c), true);
	assert.deepStrictEqual(c.calls[0].body, { url: 'https://n8n.example.com/webhook/abc/webhook', events: ['reply.interested', 'contact.unsubscribed'], description: 'n8n: Interested replies to Slack' });
	assert.deepStrictEqual(c.staticData, { webhookId: 'W1', webhookSecret: 'whsec_s' });
});

test('checkExists: the same webhook is kept; a changed one is replaced; a deleted one is recreated', async () => {
	const same = { id: 'W1', url: 'https://n8n.example.com/webhook/abc/webhook', active: true, events: ['contact.unsubscribed', 'reply.interested'] };
	let c = ctx({ events: ['reply.interested', 'contact.unsubscribed'] }, [same], { staticData: { webhookId: 'W1', webhookSecret: 's' } });
	assert.strictEqual(await hooks.checkExists.call(c), true);

	c = ctx({ events: ['reply.interested'] }, [same, {}], { staticData: { webhookId: 'W1', webhookSecret: 's' } });
	assert.strictEqual(await hooks.checkExists.call(c), false);
	assert.strictEqual(c.calls[1].method, 'DELETE', 'the old one is removed, not left sending');
	assert.deepStrictEqual(c.staticData, {});

	c = ctx({ events: ['reply.interested'] }, [httpError(404, 'resource_not_found', 'No such webhook.')], { staticData: { webhookId: 'W1' } });
	assert.strictEqual(await hooks.checkExists.call(c), false);
	assert.deepStrictEqual(c.staticData, {});
});

test('deactivating deletes the webhook; one already gone is fine; any other failure says so', async () => {
	let c = ctx({}, [{}], { staticData: { webhookId: 'W1', webhookSecret: 's' } });
	assert.strictEqual(await hooks.delete.call(c), true);
	assert.strictEqual(c.calls[0].url, 'https://api.example.com/v1/webhooks/W1');
	assert.deepStrictEqual(c.staticData, {});
	c = ctx({}, [httpError(404, 'resource_not_found', 'gone')], { staticData: { webhookId: 'W1' } });
	assert.strictEqual(await hooks.delete.call(c), true);
	c = ctx({}, [httpError(500, 'internal_error', 'down')], { staticData: { webhookId: 'W1' } });
	assert.strictEqual(await hooks.delete.call(c), false);
});

function webhookCtx({ body, raw, signature, events = ['reply.interested'], campaignId, secret = 'whsec_s' }) {
	let responded = null;
	return {
		getRequestObject: () => ({ rawBody: raw === undefined ? undefined : Buffer.from(raw) }),
		getBodyData: () => body,
		getHeaderData: () => ({ 'sincerely-signature': signature }),
		getWorkflowStaticData: () => ({ webhookSecret: secret }),
		getNodeParameter: (name, fallback) => (name === 'events' ? events : name === 'options' ? (campaignId ? { campaignId } : fallback) : fallback),
		getResponseObject: () => ({ status: (s) => ({ json: (j) => { responded = { s, j }; } }) }),
		helpers: { returnJsonArray: (items) => items.map((json) => ({ json })) },
		responded: () => responded,
	};
}

test('a signed delivery starts the workflow with the event', async () => {
	const event = { id: 'evt_1', type: 'reply.interested', data: { contact: { email: 'ada@example.com' }, campaign: { id: 'C1' } } };
	const raw = JSON.stringify(event);
	const out = await trigger.webhook.call(webhookCtx({ body: event, raw, signature: sign('whsec_s', raw) }));
	assert.deepStrictEqual(out.workflowData, [[{ json: event }]]);
});

test('an unsigned or forged delivery is turned away with 401', async () => {
	const event = { id: 'evt_1', type: 'reply.interested', data: {} };
	const c = webhookCtx({ body: event, raw: JSON.stringify(event), signature: sign('someone-else', JSON.stringify(event)) });
	const out = await trigger.webhook.call(c);
	assert.deepStrictEqual(out, { noWebhookResponse: true });
	assert.strictEqual(c.responded().s, 401);
});

test('events not chosen, or from another campaign, do not start the workflow', async () => {
	const event = { id: 'evt_1', type: 'reply.received', data: { campaign: { id: 'C2' } } };
	const raw = JSON.stringify(event);
	assert.deepStrictEqual(await trigger.webhook.call(webhookCtx({ body: event, raw, signature: sign('whsec_s', raw) })), {});
	const right = { ...event, type: 'reply.interested' };
	const raw2 = JSON.stringify(right);
	assert.deepStrictEqual(await trigger.webhook.call(webhookCtx({ body: right, raw: raw2, signature: sign('whsec_s', raw2), campaignId: 'C1' })), {});
});

/* ── The package n8n installs ─────────────────────────────────────────── */

test('the package lists files that exist, and the icons ship with it', () => {
	const pkg = require('../package.json');
	assert.ok(pkg.keywords.includes('n8n-community-node-package'), 'n8n finds community nodes by this keyword');
	assert.match(pkg.name, /^n8n-nodes-/);
	for (const f of [...pkg.n8n.credentials, ...pkg.n8n.nodes]) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
	assert.ok(fs.existsSync(path.join(__dirname, '..', 'dist', 'icons', 'sincerely.svg')), 'icon in dist');
	assert.deepStrictEqual(pkg.files, ['dist', '!dist/tsconfig.tsbuildinfo'], 'only the build ships, without the TypeScript cache');
	assert.ok(!pkg.dependencies, 'verified community nodes may not have runtime dependencies');
});
