/**
 * Integrations stress bench.
 *
 * Swaps globalThis.fetch for a mock provider layer BEFORE importing the
 * service, then drives every provider runtime through success, auth-failure,
 * server-error, garbage-JSON, and network-failure paths, plus a concurrent
 * dispatch storm through a mocked Supabase REST API. No real network needed
 * except optional DNS for the n8n public-URL check.
 *
 * Run: npm run bench:integrations   (from server/)
 */

// ── Env stubs must exist before the server config module loads ──
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_ANON_KEY = 'stub-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service';
process.env.TRACKING_SECRET = 'stub-tracking-secret-16chars';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

// ── Mock fetch layer ─────────────────────────────────────────────
type Captured = { method: string; url: string; headers: Record<string, string>; body: any };
const captured: Captured[] = [];
type Responder = (req: Captured) => { status: number; body: any } | Promise<{ status: number; body: any }>;
const overrides = new Map<string, Responder>(); // key: hostname or hostname+pathPrefix

/** Canned Supabase rows the mock serves; tests mutate these. */
const db = {
  integrations: [] as any[],
  contacts: [] as any[],
  activityInserts: [] as any[],
  integrationPatches: [] as any[],
};

function defaultRoute(req: Captured): { status: number; body: any } {
  const url = new URL(req.url);
  const host = url.hostname;

  // — Supabase REST emulation —
  if (host === 'stub.supabase.co') {
    if (url.pathname.includes('/rest/v1/user_integrations')) {
      if (req.method === 'GET') return { status: 200, body: db.integrations };
      if (req.method === 'PATCH') { db.integrationPatches.push(req.body); return { status: 204, body: '' }; }
      return { status: 201, body: [] };
    }
    if (url.pathname.includes('/rest/v1/integration_activity')) {
      if (req.method === 'POST') { db.activityInserts.push(req.body); return { status: 201, body: '' }; }
      return { status: 200, body: [] };
    }
    if (url.pathname.includes('/rest/v1/contacts')) {
      return { status: 200, body: db.contacts[0] ?? null };
    }
    return { status: 200, body: [] };
  }

  // — Provider happy paths —
  if (host === 'hooks.slack.com') return { status: 200, body: 'ok' };
  if (host === 'discord.com' || host === 'discordapp.com') return { status: 204, body: '' };
  if (host === 'api.telegram.org') return { status: 200, body: { ok: true, result: { message_id: 1 } } };
  if (host.endsWith('.logic.azure.com') || host.endsWith('.webhook.office.com')) return { status: 202, body: '' };
  if (host === 'hooks.zapier.com') return { status: 200, body: { status: 'success' } };
  if (host === 'hook.eu1.make.com') return { status: 200, body: 'Accepted' };
  if (host === 'api.hubapi.com') {
    if (url.pathname.includes('/batch/upsert')) return { status: 200, body: { status: 'COMPLETE', results: [{ id: '101' }] } };
    return { status: 200, body: { results: [] } };
  }
  if (host === 'api.pipedrive.com') {
    if (url.pathname.includes('/users/me')) return { status: 200, body: { success: true, data: { name: 'Bench User', email: 'bench@x.com' } } };
    if (url.pathname.includes('/persons/search')) return { status: 200, body: { success: true, data: { items: [] } } };
    if (url.pathname.includes('/persons')) return { status: 201, body: { success: true, data: { id: 42 } } };
    if (url.pathname.includes('/notes')) return { status: 201, body: { success: true, data: { id: 7 } } };
  }
  if (host === 'api.notion.com') {
    if (req.method === 'GET' && url.pathname.startsWith('/v1/databases/')) {
      return { status: 200, body: { title: [{ plain_text: 'Leads DB' }], properties: { Name: { type: 'title' }, Status: { type: 'select' } } } };
    }
    if (url.pathname === '/v1/pages') return { status: 200, body: { id: 'page_1' } };
  }
  if (host === 'api.airtable.com') {
    if (url.pathname.includes('/meta/bases/')) {
      return { status: 200, body: { tables: [{ id: 'tbl1', name: 'Leads', fields: [{ name: 'Email' }, { name: 'Name' }, { name: 'Notes' }] }] } };
    }
    return { status: 200, body: { records: [{ id: 'rec1' }] } };
  }
  return { status: 599, body: `bench: unmocked host ${host}` };
}

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const headers: Record<string, string> = {};
  const rawHeaders = init.headers || (typeof input === 'object' ? input.headers : {}) || {};
  if (rawHeaders instanceof Headers) rawHeaders.forEach((v, k) => (headers[k.toLowerCase()] = v));
  else for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v);
  let body: any = init.body;
  try { body = body ? JSON.parse(body) : undefined; } catch { /* keep raw */ }
  const req: Captured = { method: (init.method || 'GET').toUpperCase(), url, headers, body };
  captured.push(req);

  const host = new URL(url).hostname;
  const key = [...overrides.keys()].find((k) => url.includes(k) || host === k);
  const responder = key ? overrides.get(key)! : defaultRoute;
  const result = await responder(req);
  if ((result as any).__throw) throw (result as any).__throw;

  const bodyStr = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
  return new Response(bodyStr === '' ? null : bodyStr, {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}) as any;

// ── Assertion harness ────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(cond: boolean, name: string, extra?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
async function rejects(fn: () => any, name: string, msgPart?: string) {
  try { await fn(); ok(false, name, 'expected a rejection but none happened'); }
  catch (err: any) { ok(!msgPart || String(err.message).toLowerCase().includes(msgPart.toLowerCase()), name, `got: ${err.message}`); }
}
async function accepts(fn: () => any, name: string) {
  try { await fn(); ok(true, name); }
  catch (err: any) { ok(false, name, `unexpected rejection: ${err.message}`); }
}
function section(title: string) { console.log(`\n━━ ${title} ━━`); }

// ── Import the service (after mocks) ─────────────────────────────
const svc = await import('../src/services/integrations.service.js');
const { PROVIDER_RUNTIMES: R, mergeConfig, sanitizeEvents, dispatchEvent, listIntegrations } = svc as any;

const GOOD: Record<string, Record<string, string>> = {
  slack: { webhook_url: 'https://hooks.slack.com/services/T0001/B0001/XXXXXXXXXXXXXXXXXXXXXXXX' },
  discord: { webhook_url: 'https://discord.com/api/webhooks/1234567890/abcdefg' },
  telegram: { bot_token: '123456789:AAFxx_yyzz-1234567890abcdefghijklmn', chat_id: '123456789' },
  teams: { webhook_url: 'https://prod-27.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke' },
  zapier: { webhook_url: 'https://hooks.zapier.com/hooks/catch/123456/abcdef/' },
  make: { webhook_url: 'https://hook.eu1.make.com/abcdef123456' },
  n8n: { webhook_url: 'https://n8n.example.com/webhook/abc-def' },
  // Deliberately NOT shaped like a real HubSpot token — GitHub push
  // protection blocks anything matching the pat-na1-<uuid> format, and the
  // runtime only requires a non-empty string anyway.
  hubspot: { access_token: 'bench-fake-hubspot-token' },
  pipedrive: { api_token: 'f23a1b2c3d4e5f60718293a4b5c6d7e8f9012345' },
  notion: { token: 'ntn_1234567890abcdef', database_id: '2f26ee68-df30-4251-aad4-8ddc420cba3d' },
  airtable: { token: 'patAbCdEf1234.567890', base_id: 'appABCDEF12345678', table_name: 'Leads' },
};

// ═════ 1. Config validation & SSRF matrix ═════
section('1. Config validation & SSRF matrix');
for (const [id, cfg] of Object.entries(GOOD)) {
  if (id === 'n8n') continue; // needs DNS; separate below
  await accepts(() => R[id].validate(cfg), `${id}: accepts a well-formed config`);
}
await rejects(() => R.slack.validate({ webhook_url: 'https://evil.com/services/x' }), 'slack: rejects non-Slack host');
await rejects(() => R.slack.validate({ webhook_url: 'https://hooks.slack.com.evil.io/services/x' }), 'slack: rejects lookalike domain suffix');
await rejects(() => R.slack.validate({ webhook_url: 'http://hooks.slack.com/services/x' }), 'slack: rejects plain http');
await rejects(() => R.slack.validate({ webhook_url: 'https://hooks.slack.com/other/x' }), 'slack: rejects non-/services/ path');
await rejects(() => R.slack.validate({ webhook_url: 'javascript:alert(1)' }), 'slack: rejects non-URL scheme');
await rejects(() => R.discord.validate({ webhook_url: 'https://discord.com/channels/123' }), 'discord: rejects non-webhook path');
await rejects(() => R.discord.validate({ webhook_url: 'https://mydiscord.com/api/webhooks/1/a' }), 'discord: rejects lookalike host');
await rejects(() => R.teams.validate({ webhook_url: 'https://logic.azure.com.evil.io/x' }), 'teams: rejects lookalike host');
await rejects(() => R.teams.validate({ webhook_url: 'https://azure.com/workflows/x' }), 'teams: rejects bare azure.com');
await accepts(() => R.teams.validate({ webhook_url: 'https://contoso.webhook.office.com/webhookb2/x' }), 'teams: accepts legacy office.com connector');
await rejects(() => R.telegram.validate({ bot_token: 'not-a-token', chat_id: '1' }), 'telegram: rejects malformed bot token');
await rejects(() => R.telegram.validate({ ...GOOD.telegram, chat_id: '@ab' }), 'telegram: rejects too-short @channel');
await accepts(() => R.telegram.validate({ ...GOOD.telegram, chat_id: '-1001234567890' }), 'telegram: accepts negative group id');
await rejects(() => R.zapier.validate({ webhook_url: 'https://zapier.com/hooks/catch/1/a' }), 'zapier: rejects non-hooks host');
await accepts(() => R.make.validate({ webhook_url: 'https://hook.us1.make.com/x' }), 'make: accepts regional host');
await rejects(() => R.make.validate({ webhook_url: 'https://make.com/x' }), 'make: rejects bare make.com');
await rejects(() => R.make.validate({ webhook_url: 'https://hook.eu1.make.com.evil.io/x' }), 'make: rejects lookalike suffix');
await rejects(() => R.hubspot.validate({ access_token: '   ' }), 'hubspot: rejects blank token');
await rejects(() => R.pipedrive.validate({ api_token: 'short' }), 'pipedrive: rejects malformed token');
await rejects(() => R.notion.validate({ token: 'ntn_x', database_id: 'not-an-id' }), 'notion: rejects malformed database id');
await accepts(() => R.notion.validate({ token: 'ntn_x', database_id: '2f26ee68df304251aad48ddc420cba3d' }), 'notion: accepts undashed database id');
await rejects(() => R.airtable.validate({ token: 'pat1', base_id: 'tblXXXX', table_name: 'Leads' }), 'airtable: rejects non-app base id');
await rejects(() => R.airtable.validate({ ...GOOD.airtable, table_name: '  ' }), 'airtable: rejects blank table name');
// n8n SSRF — IP-literal / localhost rejections need no DNS:
await rejects(() => R.n8n.validate({ webhook_url: 'http://localhost:5678/webhook/x' }), 'n8n: rejects localhost');
await rejects(() => R.n8n.validate({ webhook_url: 'http://127.0.0.1/webhook/x' }), 'n8n: rejects loopback IP');
await rejects(() => R.n8n.validate({ webhook_url: 'http://169.254.169.254/latest/meta-data/' }), 'n8n: rejects cloud metadata IP');
await rejects(() => R.n8n.validate({ webhook_url: 'http://10.1.2.3/webhook' }), 'n8n: rejects RFC1918 10.x');
await rejects(() => R.n8n.validate({ webhook_url: 'http://172.16.0.9/webhook' }), 'n8n: rejects RFC1918 172.16.x');
await rejects(() => R.n8n.validate({ webhook_url: 'http://192.168.1.1/webhook' }), 'n8n: rejects RFC1918 192.168.x');
await rejects(() => R.n8n.validate({ webhook_url: 'http://[::1]/webhook' }), 'n8n: rejects IPv6 loopback');
await rejects(() => R.n8n.validate({ webhook_url: 'ftp://n8n.example.com/webhook' }), 'n8n: rejects non-http scheme');
try {
  await R.n8n.validate({ webhook_url: 'https://example.com/webhook/abc' });
  ok(true, 'n8n: accepts a public https URL (DNS reachable)');
} catch (err: any) {
  console.log(`  ~ n8n public-URL check skipped (no DNS in sandbox: ${err.message})`);
}

// ═════ 2. mergeConfig / sanitizeEvents ═════
section('2. Config merge & event sanitization');
const merged = mergeConfig('telegram', { bot_token: 'stored-token', chat_id: '111' }, { bot_token: '', chat_id: '222' });
ok(merged.bot_token === 'stored-token' && merged.chat_id === '222', 'mergeConfig: blank secret keeps stored value, new value wins');
await rejects(() => mergeConfig('slack', {}, { webhook_url: '   ' }), 'mergeConfig: blank required field with no stored value rejects');
const sane = sanitizeEvents('slack', ['email.replied', 'not.a.real.event', 'email.opened']);
ok(sane.length === 2 && !sane.includes('not.a.real.event'), 'sanitizeEvents: strips unsupported events');
const defaulted = sanitizeEvents('slack', []);
ok(defaulted.length > 0, 'sanitizeEvents: empty selection falls back to provider defaults');
await rejects(() => sanitizeEvents('hubspot', ['email.opened']), 'sanitizeEvents: all-unsupported selection rejects');

// ═════ 3. Provider runtimes through the mock (happy paths) ═════
section('3. Runtime happy paths (mocked provider APIs)');
db.contacts = [{ id: 'c1', email: 'lead@acme.io', first_name: 'Ada', last_name: 'Lovelace', company: 'Acme', job_title: 'CTO', phone: '+1555', website: 'acme.io' }];
const REPLY = { campaign_id: 'cmp1', contact_id: 'c1', from: 'lead@acme.io', subject: 'Re: Quick question' };

for (const id of ['slack', 'discord', 'telegram', 'teams', 'zapier', 'make'] as const) {
  const t = await R[id].test(GOOD[id]);
  ok(t.success === true, `${id}: test() succeeds`, t.detail);
  const summary = await R[id].handleEvent('u1', GOOD[id], 'email.replied', REPLY);
  ok(typeof summary === 'string' && summary.length > 0 && !summary.includes('undefined'), `${id}: handleEvent(email.replied) returns clean summary`, String(summary));
}
const tgCall = captured.filter((c) => c.url.includes('api.telegram.org')).pop()!;
ok(tgCall.url.includes(`/bot${GOOD.telegram.bot_token}/sendMessage`) && tgCall.body.chat_id === GOOD.telegram.chat_id, 'telegram: URL and chat_id wired correctly');
const teamsCall = captured.filter((c) => c.url.includes('logic.azure.com')).pop()!;
ok(teamsCall.body?.type === 'message' && !!teamsCall.body?.attachments?.[0]?.content && typeof teamsCall.body.text === 'string', 'teams: payload carries both text and adaptive card');
const zapCall = captured.filter((c) => c.url.includes('hooks.zapier.com')).pop()!;
ok(zapCall.body?.event === 'email.replied' && zapCall.body?.data?.contact_id === 'c1', 'zapier: forwards full structured payload');

const hs = await R.hubspot.test(GOOD.hubspot);
ok(hs.success, 'hubspot: test() succeeds', hs.detail);
const hsSummary = await R.hubspot.handleEvent('u1', GOOD.hubspot, 'email.replied', REPLY);
const hsCall = captured.filter((c) => c.url.includes('batch/upsert')).pop()!;
ok(hsCall.body?.inputs?.[0]?.idProperty === 'email' && hsCall.body.inputs[0].properties.firstname === 'Ada', 'hubspot: upserts by email with mapped properties');
ok(String(hsSummary).includes('lead@acme.io'), 'hubspot: summary names the synced contact');

const pd = await R.pipedrive.test(GOOD.pipedrive);
ok(pd.success && pd.detail.includes('Bench User'), 'pipedrive: test() reports the account name', pd.detail);
const pdSummary = await R.pipedrive.handleEvent('u1', GOOD.pipedrive, 'email.replied', REPLY);
ok(String(pdSummary).startsWith('Created'), 'pipedrive: creates person when search finds none', String(pdSummary));
overrides.set('persons/search', () => ({ status: 200, body: { success: true, data: { items: [{ item: { id: 314 } }] } } }));
const pdSummary2 = await R.pipedrive.handleEvent('u1', GOOD.pipedrive, 'email.replied', REPLY);
const noteCall = captured.filter((c) => c.url.includes('/notes')).pop()!;
ok(String(pdSummary2).startsWith('Updated') && noteCall.body.person_id === 314, 'pipedrive: reuses existing person and attaches note');
overrides.delete('persons/search');

const nt = await R.notion.test(GOOD.notion);
ok(nt.success && nt.detail.includes('Leads DB'), 'notion: test() reads the database title', nt.detail);
const ntSummary = await R.notion.handleEvent('u1', GOOD.notion, 'sara.intent_classified', { contact_id: 'c1', intent: 'interested', confidence: 0.93 });
const ntCall = captured.filter((c) => c.url.endsWith('/v1/pages')).pop()!;
ok(!!ntCall.body?.properties?.Name?.title && ntCall.body.parent.database_id === '2f26ee68df304251aad48ddc420cba3d', 'notion: discovers title property + normalizes dashed DB id');
ok(String(ntSummary).includes('lead@acme.io'), 'notion: summary names the contact');

const at = await R.airtable.test(GOOD.airtable);
ok(at.success && at.detail.includes('Email'), 'airtable: test() lists usable fields', at.detail);
const atSummary = await R.airtable.handleEvent('u1', GOOD.airtable, 'email.replied', REPLY);
const atCall = captured.filter((c) => c.url.includes('/v0/appABCDEF12345678/')).pop()!;
const atFields = atCall.body?.records?.[0]?.fields || {};
ok('Email' in atFields && 'Name' in atFields && !('Company' in atFields) && !('Event' in atFields), 'airtable: only fills fields the table actually has');
ok(atCall.body?.typecast === true && String(atSummary).includes('Leads'), 'airtable: typecast on, summary names the table');

// ═════ 4. CRM skip semantics ═════
section('4. CRM relevance filtering');
for (const id of ['hubspot', 'pipedrive', 'notion', 'airtable'] as const) {
  const before = captured.length;
  const skip1 = await R[id].handleEvent('u1', GOOD[id], 'sara.intent_classified', { contact_id: 'c1', intent: 'objection' });
  ok(skip1 === null && captured.length === before, `${id}: skips negative SARA intent without any HTTP call`);
  const skip2 = await R[id].handleEvent('u1', GOOD[id], 'email.replied', { from: 'x@y.z' });
  ok(skip2 === null, `${id}: skips event with no contact_id`);
}
db.contacts = [{ id: 'c1', email: null }];
const skip3 = await R.hubspot.handleEvent('u1', GOOD.hubspot, 'email.replied', REPLY);
ok(skip3 === null, 'crm: skips contact with no email');
db.contacts = [{ id: 'c1', email: 'lead@acme.io', first_name: 'Ada', last_name: 'Lovelace', company: 'Acme' }];

// ═════ 5. Failure paths ═════
section('5. Failure paths (auth errors, 5xx, garbage, network)');
overrides.set('api.telegram.org', () => ({ status: 401, body: { ok: false, description: 'Unauthorized' } }));
const tgFail = await R.telegram.test(GOOD.telegram);
ok(!tgFail.success && tgFail.detail.includes('Unauthorized'), 'telegram: 401 maps to helpful message', tgFail.detail);
await rejects(() => R.telegram.handleEvent('u1', GOOD.telegram, 'email.replied', REPLY), 'telegram: handleEvent throws on 401', 'Unauthorized');
overrides.delete('api.telegram.org');

overrides.set('api.hubapi.com', () => ({ status: 403, body: { message: 'scopes missing' } }));
const hsFail = await R.hubspot.test(GOOD.hubspot);
ok(!hsFail.success && hsFail.detail.toLowerCase().includes('scope'), 'hubspot: 403 points at missing scopes', hsFail.detail);
overrides.delete('api.hubapi.com');

overrides.set('hooks.slack.com', () => ({ status: 500, body: 'server_error' }));
await rejects(() => R.slack.handleEvent('u1', GOOD.slack, 'email.replied', REPLY), 'slack: handleEvent throws on 500', '500');
overrides.delete('hooks.slack.com');

overrides.set('api.notion.com', () => ({ status: 200, body: 'this is not json {{{' }));
const ntGarbage = await R.notion.test(GOOD.notion);
ok(ntGarbage.success === true || ntGarbage.success === false, 'notion: garbage JSON body never crashes test()');
overrides.delete('api.notion.com');

overrides.set('api.airtable.com', () => ({ status: 200, body: { tables: [{ name: 'Leads', fields: [{ name: 'Notes' }] }] } }));
const atNoEmail = await R.airtable.test(GOOD.airtable);
ok(!atNoEmail.success && atNoEmail.detail.includes('Email'), 'airtable: missing Email field fails with actionable message', atNoEmail.detail);
overrides.set('api.airtable.com', () => ({ status: 200, body: { tables: [{ name: 'Deals', fields: [] }] } }));
const atNoTable = await R.airtable.test(GOOD.airtable);
ok(!atNoTable.success && atNoTable.detail.includes('Deals'), 'airtable: wrong table name lists what exists', atNoTable.detail);
overrides.delete('api.airtable.com');

overrides.set('hooks.zapier.com', () => ({ status: 0, body: '', __throw: Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'TypeError' }) } as any));
const zapNet = await R.zapier.test(GOOD.zapier);
ok(!zapNet.success && zapNet.detail.length > 0, 'zapier: network failure returns clean failure, no crash', zapNet.detail);
overrides.delete('hooks.zapier.com');

overrides.set('discord.com', () => ({ status: 0, body: '', __throw: Object.assign(new Error('aborted'), { name: 'AbortError' }) } as any));
const dcTimeout = await R.discord.test(GOOD.discord);
ok(!dcTimeout.success && dcTimeout.detail.includes('timed out'), 'discord: timeout maps to "timed out"', dcTimeout.detail);
overrides.delete('discord.com');

// ═════ 6. Redaction ═════
section('6. Secret redaction');
db.integrations = [{
  id: 'i1', user_id: 'u1', provider: 'slack',
  config: { webhook_url: 'https://hooks.slack.com/services/T0001/B0001/SUPERSECRETPART' },
  events: ['email.replied'], is_active: true, last_success_at: null, last_error: null,
  created_at: 'now', updated_at: 'now',
}, {
  id: 'i2', user_id: 'u1', provider: 'telegram',
  config: { bot_token: '123456789:AAFxx_yyzz-1234567890abcdefghijklmn', chat_id: '123456789' },
  events: ['email.replied'], is_active: true, last_success_at: null, last_error: null,
  created_at: 'now', updated_at: 'now',
}];
const listed = await listIntegrations('u1');
ok(!JSON.stringify(listed).includes('SUPERSECRETPART'), 'redaction: webhook URL secret path never leaves the server');
ok(!JSON.stringify(listed).includes('AAFxx_yyzz'), 'redaction: bot token body never leaves the server');
ok(listed[1].config.chat_id === '123456789', 'redaction: non-secret fields pass through readable');
ok(listed[0].config.webhook_url.startsWith('https://hooks.slack.com'), 'redaction: masked URL still shows provider origin');

// ═════ 7. Concurrent dispatch storm ═════
section('7. Concurrent dispatch storm (10 providers × 30 events)');
const stormProviders = ['slack', 'discord', 'telegram', 'teams', 'zapier', 'make', 'hubspot', 'pipedrive', 'notion', 'airtable'];
db.integrations = stormProviders.map((p, i) => ({
  id: `int_${p}`, user_id: 'u1', provider: p, config: GOOD[p],
  events: ['email.replied'], is_active: true,
  last_success_at: null, last_error: null, created_at: 'now', updated_at: 'now',
}));
db.activityInserts = [];
db.integrationPatches = [];
captured.length = 0;
// Add jitter so the storm actually interleaves.
const jitter: Responder = async (req) => {
  await new Promise((r) => setTimeout(r, Math.random() * 20));
  return defaultRoute(req);
};
for (const host of ['hooks.slack.com', 'discord.com', 'api.telegram.org', 'hooks.zapier.com', 'hook.eu1.make.com', 'api.hubapi.com', 'api.pipedrive.com', 'api.notion.com', 'api.airtable.com']) overrides.set(host, jitter);

const t0 = Date.now();
await Promise.all(
  Array.from({ length: 30 }, (_, i) =>
    dispatchEvent('u1', 'email.replied', { ...REPLY, subject: `Re: storm ${i}` })
  )
);
const stormMs = Date.now() - t0;
overrides.clear();
const successLogs = db.activityInserts.filter((a: any) => a.success).length;
const failLogs = db.activityInserts.filter((a: any) => !a.success).length;
ok(successLogs === 300, `storm: all 300 deliveries logged as success (got ${successLogs} ok / ${failLogs} failed)`);
ok(stormMs < 30000, `storm: completed in ${stormMs}ms`);
console.log(`  · ${captured.filter((c) => !c.url.includes('supabase')).length} provider HTTP calls, ${db.activityInserts.length} activity rows, ${stormMs}ms total`);

// ═════ 8. Dispatch resilience (one provider down, others deliver) ═════
section('8. Dispatch resilience');
db.activityInserts = [];
db.integrationPatches = [];
overrides.set('hooks.slack.com', () => ({ status: 500, body: 'slack is down' }));
await dispatchEvent('u1', 'email.replied', REPLY);
overrides.clear();
const slackFail = db.activityInserts.find((a: any) => !a.success);
const others = db.activityInserts.filter((a: any) => a.success);
ok(!!slackFail && String(slackFail.detail || '').includes('500'), 'resilience: failed provider logged with detail');
ok(others.length === 9, `resilience: remaining 9 providers still delivered (got ${others.length})`);
ok(db.integrationPatches.some((p: any) => typeof p.last_error === 'string'), 'resilience: last_error persisted for the failing integration');

// ═════ Summary ═════
console.log(`\n${'═'.repeat(50)}\n  ${pass} passed, ${fail} failed\n${'═'.repeat(50)}`);
if (failures.length) { console.log('Failures:'); for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
process.exit(0);
