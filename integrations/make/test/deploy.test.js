'use strict';

/*
 * deploy.js against a stand-in for Make's SDK API: what it creates, that a
 * second run updates instead of duplicating, what each upload carries, and
 * how it reports Make's refusals.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { deploy, settings } = require('../deploy');
const app = require('../app/definition');

function fakeMake({ failOn } = {}) {
  const state = { connections: [], webhooks: [], rpcs: [], modules: [], sections: {}, calls: [] };
  let n = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/^\/api\/v2\/sdk\/apps/, '');
      state.calls.push({ method: req.method, path: p, auth: req.headers.authorization, type: req.headers['content-type'], body: raw });
      const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (failOn && failOn(req.method, p)) return send(400, { message: 'Validation failed', suberrors: [{ message: 'Invalid IML' }] });
      if (req.headers.authorization !== 'Token tok_123') return send(401, { message: 'Unauthorized' });

      let m;
      if (req.method === 'GET' && p === '/sincerely-a1b2/1') return send(200, { app: { name: 'sincerely-a1b2', label: 'Sincerely' } });
      if (req.method === 'GET' && p === '/nope/1') return send(404, { message: 'App not found' });
      if (req.method === 'GET' && p === '/sincerely-a1b2/connections') return send(200, { appConnections: state.connections });
      if (req.method === 'POST' && p === '/sincerely-a1b2/connections') {
        const c = { name: n++ ? `sincerely${n}` : 'sincerely', ...JSON.parse(raw) };
        state.connections.push(c);
        return send(200, { appConnection: c });
      }
      if (req.method === 'GET' && p === '/sincerely-a1b2/webhooks') return send(200, { appWebhooks: state.webhooks });
      if (req.method === 'POST' && p === '/sincerely-a1b2/webhooks') {
        const w = { name: `sincerely${++n}`, ...JSON.parse(raw) };
        state.webhooks.push(w);
        return send(200, { appWebhook: w });
      }
      if (req.method === 'GET' && p === '/sincerely-a1b2/1/rpcs') return send(200, { appRpcs: state.rpcs });
      if (req.method === 'POST' && p === '/sincerely-a1b2/1/rpcs') { state.rpcs.push(JSON.parse(raw)); return send(200, { appRpc: JSON.parse(raw) }); }
      if (req.method === 'GET' && p === '/sincerely-a1b2/1/modules') return send(200, { appModules: state.modules });
      if (req.method === 'POST' && p === '/sincerely-a1b2/1/modules') { state.modules.push(JSON.parse(raw)); return send(200, { appModule: JSON.parse(raw) }); }
      if (req.method === 'PATCH') return send(200, {});
      if (req.method === 'PUT' && (m = p.match(/^(.*)\/(base|common|groups|api|parameters|attach|detach|expect|interface|samples)$/))) {
        state.sections[p] = { type: req.headers['content-type'], body: raw };
        return send(200, {});
      }
      send(404, { message: `no route ${req.method} ${p}` });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}

const cfgFor = (base, extra = {}) => settings({
  MAKE_API_TOKEN: 'tok_123', MAKE_ZONE: 'eu1.make.com', MAKE_APP_ID: 'sincerely-a1b2', MAKE_BASE_URL: base, ...extra,
});
const quiet = { log: () => {} };

test('settings: what is missing or malformed is named', () => {
  assert.throws(() => settings({}), /Missing MAKE_API_TOKEN, MAKE_ZONE, MAKE_APP_ID/);
  assert.throws(() => settings({ MAKE_API_TOKEN: 't', MAKE_ZONE: 'example.org', MAKE_APP_ID: 'a' }), /eu1\.make\.com/);
  const s = settings({ MAKE_API_TOKEN: ' t ', MAKE_ZONE: 'https://us2.make.com/', MAKE_APP_ID: 'a' });
  assert.strictEqual(s.sdk, 'https://us2.make.com/api/v2/sdk/apps');
  assert.strictEqual(s.version, 1);
  assert.strictEqual(s.token, 't');
});

test('first deploy creates every component, in an order that keeps references valid', async () => {
  const { server, state, base } = await fakeMake();
  try {
    const out = await deploy(cfgFor(base), quiet);
    assert.strictEqual(state.connections.length, 1);
    assert.strictEqual(state.webhooks.length, app.webhooks.length);
    assert.strictEqual(state.rpcs.length, app.rpcs.length);
    assert.strictEqual(state.modules.length, app.modules.length);
    assert.strictEqual(out.created.length, 1 + app.webhooks.length + app.rpcs.length + app.modules.length);

    // Every call carries the token the way Make expects it.
    assert.ok(state.calls.every((c) => c.auth === 'Token tok_123'));

    // Webhooks and modules point at the names Make gave, not ours.
    const conn = state.connections[0].name;
    assert.ok(state.webhooks.every((w) => w.connection === conn && w.type === 'web'));
    const trig = state.modules.find((m) => m.name === 'replyInterested');
    const hook = state.webhooks.find((w) => w.label === 'Sincerely: Interested Replies');
    assert.strictEqual(trig.webhook, hook.name);
    assert.strictEqual(trig.typeId, 10);
    assert.strictEqual(state.modules.find((m) => m.name === 'makeApiCall').subtype, 'Universal');
    assert.strictEqual(state.modules.find((m) => m.name === 'createContact').crud, 'create');

    // Groups are uploaded after the modules they name.
    const lastModule = Math.max(...state.calls.map((c, i) => (c.method === 'POST' && c.path.endsWith('/modules') ? i : -1)));
    const groups = state.calls.findIndex((c) => c.path.endsWith('/groups'));
    assert.ok(groups > lastModule);
  } finally { server.close(); }
});

test('sections are uploaded as Make stores them: IML as JSONC, common and groups as JSON', async () => {
  const { server, state, base } = await fakeMake();
  try {
    await deploy(cfgFor(base, { SINCERELY_API_URL: 'https://api.usesincerely.com' }), quiet);
    const s = state.sections;
    assert.strictEqual(s['/sincerely-a1b2/1/base'].type, 'application/jsonc');
    assert.deepStrictEqual(JSON.parse(s['/sincerely-a1b2/1/base'].body), app.forApi('https://api.usesincerely.com').base);
    assert.strictEqual(JSON.parse(s['/connections/sincerely/api'].body).url, 'https://api.usesincerely.com/v1/me', 'the connection test calls the configured API, written out in full');
    assert.strictEqual(s['/sincerely-a1b2/1/common'].type, 'application/json');
    assert.deepStrictEqual(JSON.parse(s['/sincerely-a1b2/1/common'].body), { apiUrl: 'https://api.usesincerely.com/v1' });
    assert.deepStrictEqual(JSON.parse(s['/sincerely-a1b2/1/groups'].body), app.groups);
    assert.deepStrictEqual(JSON.parse(s['/connections/sincerely/parameters'].body), app.connection.parameters);
    const hook = state.webhooks[0].name;
    assert.deepStrictEqual(JSON.parse(s[`/webhooks/${hook}/attach`].body), app.webhooks[0].attach);
    assert.deepStrictEqual(JSON.parse(s['/sincerely-a1b2/1/modules/addToCampaign/expect'].body), app.modules.find((m) => m.key === 'addToCampaign').expect);
    // Five sections for every module, four for every webhook.
    for (const m of app.modules) for (const sec of ['api', 'parameters', 'expect', 'interface', 'samples']) assert.ok(s[`/sincerely-a1b2/1/modules/${m.key}/${sec}`], `${m.key}/${sec}`);
  } finally { server.close(); }
});

test('a second deploy updates in place and creates nothing', async () => {
  const { server, state, base } = await fakeMake();
  try {
    await deploy(cfgFor(base), quiet);
    const counts = [state.connections.length, state.webhooks.length, state.rpcs.length, state.modules.length];
    const again = await deploy(cfgFor(base), quiet);
    assert.deepStrictEqual([state.connections.length, state.webhooks.length, state.rpcs.length, state.modules.length], counts);
    assert.strictEqual(again.created.length, 0);
    assert.strictEqual(again.updated.length, 1 + app.webhooks.length + app.rpcs.length + app.modules.length);
  } finally { server.close(); }
});

test('a dry run reads but writes nothing', async () => {
  const { server, state, base } = await fakeMake();
  try {
    await deploy(cfgFor(base), { ...quiet, dryRun: true });
    assert.ok(state.calls.every((c) => c.method === 'GET'));
  } finally { server.close(); }
});

test('Make\'s refusals are reported with what Make said and a hint', async () => {
  const { server, base } = await fakeMake({ failOn: (method, p) => method === 'PUT' && p.endsWith('/modules/createContact/api') });
  try {
    await assert.rejects(deploy(cfgFor(base), quiet), /modules\/createContact\/api answered 400: Validation failed - Invalid IML/);
  } finally { server.close(); }
  const f = await fakeMake();
  try {
    await assert.rejects(deploy(cfgFor(f.base, { MAKE_API_TOKEN: 'wrong' }), quiet), /401.*token is wrong or expired/);
    await assert.rejects(deploy(cfgFor(f.base, { MAKE_APP_ID: 'nope' }), quiet), /404.*Check MAKE_APP_ID and MAKE_ZONE/);
  } finally { f.server.close(); }
});
