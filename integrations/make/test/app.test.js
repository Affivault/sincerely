'use strict';

/*
 * The Make app, checked before anything reaches Make:
 *   - every section against Make's own IML JSON schemas (vendor/make-schemas)
 *   - the rules the schemas cannot express: references resolve, names are
 *     unique, every endpoint it calls exists in the public API, the IML uses
 *     only functions we rely on, and the groups cover every module.
 *
 * Run: npm test
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');

const app = require('../app/definition');

const SCHEMAS = path.join(__dirname, '..', 'vendor', 'make-schemas');
const ajv = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false });
for (const f of fs.readdirSync(SCHEMAS).filter((f) => f.endsWith('.json'))) {
  ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMAS, f), 'utf8')), f);
}

function valid(schema, data, where) {
  const check = ajv.getSchema(schema);
  const ok = check(data);
  assert.ok(ok, `${where} does not match Make's ${schema}:\n${ajv.errorsText(check.errors, { separator: '\n' })}`);
}

test('base matches Make\'s schema', () => valid('base.json', app.base, 'base'));
test('common matches Make\'s schema', () => valid('common.json', app.common(), 'common'));
test('groups match Make\'s schema', () => valid('groups.json', app.groups, 'groups'));

test('the connection matches Make\'s schemas', () => {
  valid('api.json', app.connection.api, 'connection api');
  valid('parameters.json', app.connection.parameters, 'connection parameters');
});

test('every webhook matches Make\'s schemas', () => {
  for (const w of app.webhooks) {
    valid('api.json', w.api, `${w.key} api`);
    valid('api.json', w.attach, `${w.key} attach`);
    valid('api.json', w.detach, `${w.key} detach`);
    valid('parameters.json', w.parameters, `${w.key} parameters`);
  }
});

test('every RPC matches Make\'s schemas', () => {
  for (const r of app.rpcs) {
    valid('api.json', r.api, `${r.key} api`);
    valid('parameters.json', r.parameters, `${r.key} parameters`);
  }
});

test('every module matches Make\'s schemas', () => {
  for (const m of app.modules) {
    valid('api.json', m.api, `${m.key} api`);
    valid('parameters.json', m.parameters, `${m.key} static parameters`);
    valid('parameters.json', m.expect, `${m.key} mappable parameters`);
    valid('parameters.json', m.interface, `${m.key} interface`);
    valid('samples.json', m.samples, `${m.key} samples`);
  }
});

test('names are unique and in the form Make accepts', () => {
  for (const [kind, items] of [['module', app.modules], ['webhook', app.webhooks], ['rpc', app.rpcs]]) {
    const keys = items.map((i) => i.key);
    assert.strictEqual(new Set(keys).size, keys.length, `duplicate ${kind} key`);
    for (const k of keys) assert.match(k, /^[a-zA-Z][0-9a-zA-Z]+[0-9a-zA-Z]$/, `${kind} "${k}"`);
  }
  const labels = app.webhooks.map((w) => w.label);
  assert.strictEqual(new Set(labels).size, labels.length, 'webhook labels are how deploys find them again, so they must be unique');
});

test('references resolve: instant triggers to webhooks, dropdowns to RPCs', () => {
  const hooks = new Set(app.webhooks.map((w) => w.key));
  const rpcs = new Set(app.rpcs.map((r) => r.key));
  for (const m of app.modules) {
    if (m.moduleType === 'instant_trigger') assert.ok(hooks.has(m.webhook), `${m.key} -> ${m.webhook}`);
    else assert.strictEqual(m.webhook, undefined, `${m.key} is not an instant trigger`);
    for (const p of [...m.expect, ...m.parameters]) {
      if (typeof p.options === 'string') assert.ok(rpcs.has(p.options.replace('rpc://', '')), `${m.key}.${p.name} -> ${p.options}`);
    }
  }
  const used = new Set(app.modules.filter((m) => m.webhook).map((m) => m.webhook));
  for (const h of hooks) assert.ok(used.has(h), `webhook ${h} has no trigger`);
});

test('every module type is one Make has, and actions say what they do', () => {
  const types = ['trigger', 'action', 'search', 'instant_trigger', 'responder', 'universal'];
  for (const m of app.modules) {
    assert.ok(types.includes(m.moduleType), m.key);
    if (m.moduleType === 'action') assert.ok(['create', 'read', 'update', 'delete'].includes(m.crud), `${m.key} crud`);
    assert.ok(m.label && m.description && m.description.length >= 20, `${m.key} label and description`);
  }
});

test('the groups list every module exactly once', () => {
  const grouped = app.groups.flatMap((g) => g.modules);
  assert.strictEqual(new Set(grouped).size, grouped.length, 'a module is in two groups');
  assert.deepStrictEqual([...grouped].sort(), app.modules.map((m) => m.key).sort());
});

test('each instant trigger subscribes to exactly its own event', () => {
  for (const [key, type] of app.EVENTS) {
    const hook = app.webhooks.find((w) => w.key === `${key}Hook`);
    assert.deepStrictEqual(hook.attach.body.events, [type], key);
    assert.match(hook.detach.url, /\{\{webhook\.externalHookId\}\}/, `${key} detach uses the id attach saved`);
    assert.strictEqual(hook.attach.response.data.externalHookId, '{{body.id}}', key);
    const trigger = app.modules.find((m) => m.key === key);
    assert.strictEqual(trigger.samples.type, type, `${key} sample`);
  }
});

/* The API it calls, read from the public API definition so a renamed endpoint fails here. */
const shared = (() => {
  try { return require('../../../shared/dist/public-api.js'); } catch { return null; }
})();

test('every endpoint the app calls exists in the Sincerely public API', { skip: !shared && 'build shared first (npm run build:shared)' }, () => {
  const routes = shared.API_ENDPOINTS.map((e) => ({ method: e.method, re: new RegExp(`^${e.path.replace(/^\/v1/, '').replace(/\{\w+\}/g, '[^/]+')}$`) }));
  const calls = [
    ...app.modules.filter((m) => m.moduleType !== 'universal' && m.api.url).map((m) => [m.key, m.api.method || 'GET', m.api.url]),
    ...app.rpcs.map((r) => [r.key, r.api.method || 'GET', r.api.url]),
    ...app.webhooks.flatMap((w) => [[`${w.key} attach`, w.attach.method, w.attach.url], [`${w.key} detach`, w.detach.method, w.detach.url]]),
  ];
  for (const [who, method, url] of calls) {
    const concrete = url.replace(/\{\{[^}]+\}\}/g, 'X');
    assert.ok(routes.some((r) => r.method === method && r.re.test(concrete)), `${who}: ${method} ${url} is not a public API endpoint`);
  }
  // The connection test calls /me on the full URL.
  assert.match(app.connection.api.url, /\/me$/);
});

test('every event the app subscribes to is a public event type', { skip: !shared && 'build shared first' }, () => {
  for (const [key, type] of app.EVENTS) assert.ok(shared.PUBLIC_EVENT_TYPES.includes(type), `${key}: ${type}`);
});

test('IML: braces balance, and only functions we rely on are used', () => {
  const ALLOWED = new Set(['ifempty', 'if', 'first', 'encodeURL', 'toCollection']);
  const walk = (v, where) => {
    if (typeof v === 'string') {
      const opens = (v.match(/\{\{/g) || []).length;
      const closes = (v.match(/\}\}/g) || []).length;
      assert.strictEqual(opens, closes, `${where}: unbalanced {{ }} in ${v}`);
      for (const expr of v.match(/\{\{(.*?)\}\}/g) || []) {
        for (const fn of expr.matchAll(/([a-zA-Z_]\w*)\s*\(/g)) assert.ok(ALLOWED.has(fn[1]), `${where}: IML function ${fn[1]}() in ${expr}`);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
  };
  walk(app.base, 'base');
  walk(app.connection, 'connection');
  for (const w of app.webhooks) walk(w, w.key);
  for (const r of app.rpcs) walk(r, r.key);
  for (const m of app.modules) walk(m.api, m.key);
});

test('the API key is never written to Make\'s logs', () => {
  assert.ok(app.base.log.sanitize.includes('request.headers.authorization'));
  assert.ok(app.connection.api.log.sanitize.includes('request.headers.authorization'));
});

test('nothing depends on common data: the API address is written into the base and the connection', () => {
  const live = app.forApi('https://api.usesincerely.com');
  assert.strictEqual(live.base.baseUrl, 'https://api.usesincerely.com/v1');
  assert.strictEqual(live.connection.api.url, 'https://api.usesincerely.com/v1/me');
  assert.strictEqual(app.connection.api.url, 'https://skysend-api.onrender.com/v1/me');
  const everything = JSON.stringify([app.base, app.connection, app.webhooks, app.rpcs, app.modules]);
  assert.ok(!everything.includes('common.'), 'a section still reads {{common.*}}');
});

test('common points at the API, from a bare origin or one with /v1', () => {
  assert.deepStrictEqual(app.common(), { apiUrl: 'https://skysend-api.onrender.com/v1' });
  assert.deepStrictEqual(app.common('https://api.usesincerely.com/'), { apiUrl: 'https://api.usesincerely.com/v1' });
  assert.deepStrictEqual(app.common('https://api.usesincerely.com/v1'), { apiUrl: 'https://api.usesincerely.com/v1' });
});
