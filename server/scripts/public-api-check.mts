/* ═══════════════════════════════════════════════════════════════════════
   The public API (/v1), end to end.

   The real Express app is started and called over HTTP. Supabase is a
   small in-memory stand-in for its REST interface, so two things can be
   checked at once: what an API caller gets back, and the exact queries
   the server sends to the database for it (filters, paging, ownership).

   Run: npx tsx scripts/public-api-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

/* ── A stand-in for Supabase ─────────────────────────────────────────── */

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
const seen: { method: string; table: string; params: URLSearchParams; body: any }[] = [];
/** Per-table overrides: return a body to answer, undefined to fall through to the generic table. */
const custom: Record<string, (method: string, params: URLSearchParams, body: any) => { status?: number; body: any; headers?: Record<string, string> } | undefined> = {};

const UNIQUE: Record<string, string[]> = { api_idempotency_keys: ['user_id', 'idem_key'], contacts: ['user_id', 'email'], suppression_list: ['user_id', 'email'] };

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'columns'].includes(k) || k.includes('.')) continue;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const v = raw.slice(dot + 1);
    const cell = row[k];
    if (op === 'eq' && String(cell) !== v) return false;
    if (op === 'neq' && String(cell) === v) return false;
    if (op === 'is' && v === 'null' && cell != null) return false;
    if (op === 'not' && v === 'is.null' && cell == null) return false;
    if (op === 'in') {
      const list = v.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      if (!list.includes(String(cell))) return false;
    }
    if (op === 'lt' && !(String(cell) < v)) return false;
    if (op === 'gt' && !(String(cell) > v)) return false;
    if (op === 'cs') {
      const want = v.replace(/^\{|\}$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      if (!want.every((w) => (cell || []).includes(w))) return false;
    }
  }
  return true;
}

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url || '/', 'http://x');
    const method = req.method || 'GET';
    const body = raw ? JSON.parse(raw) : undefined;
    const send = (status: number, payload: any, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(payload === undefined ? '' : JSON.stringify(payload));
    };

    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      const id = url.pathname.split('/').pop();
      return send(200, { id, email: 'owner-not@example.com' });
    }
    const m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([a-z_]+)$/);
    if (!m) return send(404, { message: 'no route' });
    const table = m[1] ? `rpc/${m[2]}` : m[2];
    seen.push({ method, table, params: url.searchParams, body });

    const over = custom[table]?.(method, url.searchParams, body);
    if (over) return send(over.status ?? 200, over.body, over.headers);
    if (table.startsWith('rpc/')) return send(200, []);

    const rows = (db[table] ||= []);
    const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
    const prefer = String(req.headers.prefer || '');
    const one = (list: Row[]) => {
      if (!wantsObject) return send(200, list);
      if (list.length !== 1) return send(406, { code: 'PGRST116', details: `The result contains ${list.length} rows`, message: 'JSON object requested, multiple (or no) rows returned' });
      return send(200, list[0]);
    };

    if (method === 'GET' || method === 'HEAD') {
      let list = rows.filter((r) => matches(r, url.searchParams));
      const limit = Number(url.searchParams.get('limit') || 0);
      if (limit) list = list.slice(0, limit);
      if (prefer.includes('count=exact')) return send(200, method === 'HEAD' ? undefined : list, { 'Content-Range': `0-${Math.max(0, list.length - 1)}/${list.length}` });
      return one(list);
    }
    if (method === 'POST') {
      const items = (Array.isArray(body) ? body : [body]).map((r: Row) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
      const keys = UNIQUE[table];
      const upsert = prefer.includes('resolution=');
      for (const it of items) {
        const clash = keys && rows.find((r) => keys.every((k) => r[k] === it[k]));
        if (clash && !upsert) return send(409, { code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null });
        if (clash && upsert && !prefer.includes('ignore-duplicates')) Object.assign(clash, it);
        if (!clash) rows.push(it);
      }
      if (!prefer.includes('return=representation')) return send(201, undefined);
      return wantsObject ? send(201, items[0]) : send(201, items);
    }
    if (method === 'PATCH') {
      const hit = rows.filter((r) => matches(r, url.searchParams));
      for (const r of hit) Object.assign(r, body);
      if (!prefer.includes('return=representation')) return send(204, undefined);
      return one(hit);
    }
    if (method === 'DELETE') {
      const keep = rows.filter((r) => !matches(r, url.searchParams));
      const n = rows.length - keep.length;
      db[table] = keep;
      return send(prefer.includes('return=representation') ? 200 : 204, prefer.includes('return=representation') ? [] : undefined, { 'Content-Range': `*/${n}` });
    }
    send(405, { message: 'method' });
  });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
const fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

process.env.SUPABASE_URL = fakeUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.CLIENT_URL ||= 'https://app.sincerely.io';
process.env.API_BASE_URL ||= 'https://api.sincerely.io';

const { app } = await import('../src/app.js');
const shared = await import('@lemlist/shared');
const { signV1, verifyV1, publicEventsFor } = await import('../src/public-api/events.js');
const { buildPublicApiRouter } = await import('../src/public-api/core.js');
const { HANDLERS } = await import('../src/public-api/handlers.js');
const { contactOut } = await import('../src/public-api/serialize.js');

const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let passed = 0;
let failed = 0;
function is(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`); }
}

async function call(method: string, path: string, opts: { key?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.key !== null) headers.Authorization = `Bearer ${opts.key ?? KEY}`;
  if (opts.body !== undefined || opts.raw !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method, headers, body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers };
}
const lastQuery = (table: string, method = 'GET') => [...seen].reverse().find((s) => s.table === table && s.method === method);

/* ── The world ───────────────────────────────────────────────────────── */

const USER = '11111111-1111-4111-8111-111111111111';
const KEY = 'sk_live_checkkey';
const READ_KEY = 'sk_live_readonly';
const SLOW_KEY = 'sk_live_twoperminute';
const hash = (k: string) => crypto.createHash('sha256').update(k).digest('hex');
db.api_keys = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', user_id: USER, key_hash: hash(KEY), name: 'Zapier', scopes: ['read', 'write'], rate_limit: 1000, is_active: true, expires_at: null },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', user_id: USER, key_hash: hash(READ_KEY), name: 'Read only', scopes: ['read'], rate_limit: 1000, is_active: true, expires_at: null },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', user_id: USER, key_hash: hash(SLOW_KEY), name: 'Slow', scopes: ['read'], rate_limit: 2, is_active: true, expires_at: null },
];
db.account_controls = [];

const T0 = '2026-11-03T09:41:00.123456+00:00';
const contactRow = (i: number, extra: Row = {}): Row => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, user_id: USER, email: `person${i}@example.com`,
  first_name: `P${i}`, last_name: null, lifecycle: 'prospect', custom_fields: {}, source: 'api',
  is_unsubscribed: false, is_bounced: false, dcs_verified_at: null, created_at: T0, updated_at: T0,
  contact_tags: [{ tags: { name: 'b' } }, { tags: { name: 'a' } }], list_contacts: [{ list_id: 'L1', contact_lists: { is_trashed: false } }, { list_id: 'L2', contact_lists: { is_trashed: true } }],
  ...extra,
});

console.log('\nAuthentication and the error format');

{
  const r = await call('GET', '/v1/me', { key: null });
  is('no key: 401 missing_api_key', r.status === 401 && r.json?.error?.code === 'missing_api_key', JSON.stringify(r.json));
  is('every answer carries a request id, in the header and the body', /^req_[0-9a-f]{20}$/.test(r.headers.get('x-request-id') || '') && r.json?.request_id === r.headers.get('x-request-id'));
  is('the error has a type, a message and a link to the docs', r.json?.error?.type === 'authentication_error' && !!r.json?.error?.message && /\/developer\?tab=reference#error-missing_api_key$/.test(r.json?.error?.doc_url || ''));
  is('the API version is announced', r.headers.get('sincerely-api-version') === shared.PUBLIC_API_VERSION);
}
{
  const r = await call('GET', '/v1/me', { key: 'eyJhbGciOi.a.jwt' });
  is('a session token is not an API key: 401 invalid_api_key', r.status === 401 && r.json?.error?.code === 'invalid_api_key');
}
{
  const r = await call('GET', '/v1/me', { key: 'sk_live_nosuchkey' });
  is('an unknown key: 401 invalid_api_key', r.status === 401 && r.json?.error?.code === 'invalid_api_key');
}
{
  const r = await call('GET', '/v1/me');
  is('a good key: 200 with who it belongs to', r.status === 200 && r.json?.object === 'account' && r.json?.user_id === USER && r.json?.api_key?.name === 'Zapier', JSON.stringify(r.json));
  is('rate-limit headers on a success', r.headers.get('x-ratelimit-limit') === '1000' && Number(r.headers.get('x-ratelimit-remaining')) >= 0);
}
{
  const r = await call('POST', '/v1/contacts', { key: READ_KEY, body: { email: 'a@b.co' } });
  is('a read-only key cannot write: 403 insufficient_scope', r.status === 403 && r.json?.error?.code === 'insufficient_scope' && r.json?.error?.required_scope === 'write');
}
{
  await call('GET', '/v1/me', { key: SLOW_KEY });
  await call('GET', '/v1/me', { key: SLOW_KEY });
  const r = await call('GET', '/v1/me', { key: SLOW_KEY });
  is('over the key\'s rate: 429 rate_limited with Retry-After', r.status === 429 && r.json?.error?.code === 'rate_limited' && Number(r.headers.get('retry-after')) > 0);
}
console.log('\nRoutes and bodies');
{
  const r = await call('GET', '/v1/nope');
  is('an unknown path: 404 route_not_found', r.status === 404 && r.json?.error?.code === 'route_not_found');
  const w = await call('GET', '/v1/campaigns/6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f/pause');
  is('the wrong method says which one to use', w.status === 404 && /takes POST/.test(w.json?.error?.message || ''), w.json?.error?.message);
  const j = await call('POST', '/v1/contacts', { raw: '{"email": ' });
  is('a body that is not JSON: 400 body_invalid, in the same format', j.status === 400 && j.json?.error?.code === 'body_invalid' && !!j.json?.request_id, JSON.stringify(j.json));
  const a = await call('POST', '/v1/contacts', { body: [{ email: 'x@y.co' }] });
  is('a JSON array where an object belongs: body_invalid', a.status === 400 && a.json?.error?.code === 'body_invalid');
  const u = await call('POST', '/v1/contacts', { body: { email: 'x@y.co', firstname: 'Ada' } });
  is('a misspelt field is refused and named', u.status === 400 && u.json?.error?.code === 'parameter_invalid' && u.json?.error?.param === 'firstname');
  const e = await call('POST', '/v1/contacts', { body: { email: 'not-an-email' } });
  is('a bad address: parameter_invalid on email', e.status === 400 && e.json?.error?.param === 'email');
  const m = await call('POST', '/v1/contacts', { body: { first_name: 'Ada' } });
  is('no address: parameter_missing on email', m.status === 400 && m.json?.error?.code === 'parameter_missing' && m.json?.error?.param === 'email');
  const id = await call('GET', '/v1/contacts/not-a-uuid');
  is('a path id that is not an id is a 404, not a database error', id.status === 404 && id.json?.error?.code === 'resource_not_found');
}

console.log('\nContacts: the queries behind the answers');
{
  const rows = Array.from({ length: 26 }, (_, i) => contactRow(i + 1));
  custom.contacts = (method) => (method === 'GET' ? { body: rows } : undefined);
  const LIST = '22222222-2222-4222-8222-222222222222';
  const r = await call('GET', `/v1/contacts?lifecycle=lead&list_id=${LIST}&limit=25`);
  const q = lastQuery('contacts')!;
  is('a page: 25 of them, has_more and a cursor', r.status === 200 && r.json?.object === 'list' && r.json?.data?.length === 25 && r.json?.has_more === true && typeof r.json?.next_cursor === 'string', JSON.stringify(r.json)?.slice(0, 200));
  is('it asks for one more than the page, to know if there is more', q.params.get('limit') === '26');
  is('newest first, with the id as the tie-break', q.params.get('order') === 'created_at.desc,id.desc', q.params.get('order') || '');
  is('only this account', q.params.get('user_id') === `eq.${USER}`);
  is('"lead" is stored as prospect', q.params.get('lifecycle') === 'eq.prospect');
  is('the list filter joins on membership', /in_list:list_contacts!inner\(list_id\)/.test(q.params.get('select') || '') && q.params.get('in_list.list_id') === `eq.${LIST}`);

  const r2 = await call('GET', `/v1/contacts?lifecycle=lead&list_id=${LIST}&cursor=${encodeURIComponent(r.json.next_cursor)}`);
  const q2 = lastQuery('contacts')!;
  const or = q2.params.getAll('or');
  const last = rows[24];
  is('the next page starts strictly after the last row, ties broken by id',
    r2.status === 200 && or.length === 1 && or[0] === `(created_at.lt."${last.created_at}",and(created_at.eq."${last.created_at}",id.lt.${last.id}))`, or.join(' | '));
  is('the timestamp keeps its microseconds (no rows skipped or repeated)', or[0]?.includes('.123456+00:00'));

  const r3 = await call('GET', `/v1/contacts?updated_after=2026-01-01T00:00:00Z&cursor=${encodeURIComponent(r.json.next_cursor)}`);
  is('a cursor from a different sort is refused: cursor_invalid', r3.status === 400 && r3.json?.error?.code === 'cursor_invalid');
  const r4 = await call('GET', '/v1/contacts?cursor=garbage');
  is('a made-up cursor: cursor_invalid', r4.status === 400 && r4.json?.error?.code === 'cursor_invalid');
  const r5 = await call('GET', '/v1/contacts?limit=0');
  const r6 = await call('GET', '/v1/contacts?limit=101');
  is('limit must be 1 to 100', r5.json?.error?.param === 'limit' && r6.json?.error?.param === 'limit');
  const r7 = await call('GET', '/v1/contacts?updated_after=last%20tuesday');
  is('a time that is not ISO 8601 is refused', r7.status === 400 && r7.json?.error?.param === 'updated_after');

  await call('GET', '/v1/contacts?q=ada%20analytical&updated_after=2026-01-01T00:00:00Z');
  const q8 = lastQuery('contacts')!;
  is('search: every word must match somewhere', q8.params.getAll('or').length === 2 && q8.params.getAll('or')[0].includes('email.ilike.%ada%'));
  is('updated_after sorts by updated_at', q8.params.get('order') === 'updated_at.desc,id.desc' && q8.params.get('updated_at') === 'gt.2026-01-01T00:00:00.000Z');
  delete custom.contacts;

  const c = contactOut(contactRow(9, { lifecycle: 'customer', first_name: 'Ada', last_name: 'Lovelace' }));
  is('a contact: lifecycle, full name, sorted tags, live lists only', c.lifecycle === 'customer' && c.full_name === 'Ada Lovelace' && c.tags.join() === 'a,b' && c.list_ids.join() === 'L1' && c.email_status === 'unverified');
  is('a contact has exactly the documented fields', JSON.stringify(Object.keys(c).sort()) === JSON.stringify(Object.keys(shared.CONTACT_EXAMPLE).sort()),
    `${Object.keys(c).sort().join()} vs ${Object.keys(shared.CONTACT_EXAMPLE).sort().join()}`);
}

console.log('\nCreating, conflicts and safe retries');
{
  db.contacts = [contactRow(50, { email: 'taken@example.com' })];
  const r = await call('POST', '/v1/contacts', { body: { email: 'Taken@Example.com' } });
  is('an address already here: 409 contact_exists with its id', r.status === 409 && r.json?.error?.code === 'contact_exists' && r.json?.error?.existing_id === db.contacts[0].id, JSON.stringify(r.json));

  db.suppression_list = [];
  const key = `idem-${crypto.randomUUID()}`;
  const first = await call('POST', '/v1/suppressions', { body: { emails: ['no@example.com', 'bad-address'] }, headers: { 'Idempotency-Key': key } });
  is('suppress: added, and the bad address named', first.status === 201 && first.json?.added === 1 && first.json?.invalid?.[0] === 'bad-address', JSON.stringify(first.json));
  const writesBefore = seen.filter((s) => s.table === 'suppression_list' && s.method === 'POST').length;
  const again = await call('POST', '/v1/suppressions', { body: { emails: ['no@example.com', 'bad-address'] }, headers: { 'Idempotency-Key': key } });
  const writesAfter = seen.filter((s) => s.table === 'suppression_list' && s.method === 'POST').length;
  is('the same key again: the first answer, marked as a replay, and nothing written twice',
    again.status === 201 && again.headers.get('idempotent-replayed') === 'true' && JSON.stringify(again.json) === JSON.stringify(first.json) && writesAfter === writesBefore);
  const reused = await call('POST', '/v1/suppressions', { body: { emails: ['other@example.com'] }, headers: { 'Idempotency-Key': key } });
  is('the same key for a different request: 422 idempotency_key_reused', reused.status === 422 && reused.json?.error?.code === 'idempotency_key_reused');

  db.api_idempotency_keys.push({ user_id: USER, idem_key: 'busy', method: 'POST', path: '/v1/suppressions', request_hash: crypto.createHash('sha256').update(`POST /v1/suppressions\n${JSON.stringify({ emails: ['z@example.com'] })}`).digest('hex'), status: null, response: null, created_at: new Date().toISOString() });
  const busy = await call('POST', '/v1/suppressions', { body: { emails: ['z@example.com'] }, headers: { 'Idempotency-Key': 'busy' } });
  is('the same key while the first is still running: 409 idempotency_key_in_flight', busy.status === 409 && busy.json?.error?.code === 'idempotency_key_in_flight', JSON.stringify(busy.json));

  const keep = await call('POST', '/v1/suppressions', { body: { emails: ['no@example.com'] } });
  is('an address already suppressed keeps its reason', keep.json?.added === 0 && keep.json?.already_suppressed === 1);
}

console.log('\nUpdating: merges, blanks and upserts');
{
  const id = '00000000-0000-4000-8000-000000000077';
  db.contacts = [contactRow(77, { id, email: 'ada@example.com', job_title: 'CTO', custom_fields: { keep: '1', drop: '2' } })];
  const before = seen.length;
  const r = await call('PATCH', `/v1/contacts/${id}`, { body: { custom_fields: { drop: null, add: 3 }, job_title: '' } });
  const write = seen.slice(before).find((x) => x.table === 'contacts' && x.method === 'PATCH');
  is('custom fields merge: null removes one, others are kept, values become text',
    r.status === 200 && JSON.stringify(write?.body?.custom_fields) === JSON.stringify({ keep: '1', add: '3' }), JSON.stringify(write?.body));
  is('an empty string leaves a field alone (an unmapped Zapier field never blanks data)', write && !('job_title' in write.body) && db.contacts[0].job_title === 'CTO');
  const r2 = await call('PATCH', `/v1/contacts/${id}`, { body: { job_title: null } });
  is('null clears it', r2.status === 200 && db.contacts[0].job_title === null);

  const up = await call('POST', '/v1/contacts', { body: { email: 'ADA@example.com', company: 'Analytical Engines', upsert: true } });
  is('upsert on an existing address updates it and answers 200', up.status === 200 && up.json?.id === id && db.contacts[0].company === 'Analytical Engines', JSON.stringify(up.json)?.slice(0, 160));

  db.campaign_contacts = [
    { id: 'dddddddd-0000-4000-8000-000000000001', contact_id: id, campaign_id: 'c1', status: 'active', campaigns: { user_id: USER } },
  ];
  custom.campaign_contacts = (method, params) => (method === 'GET' && params.get('select')?.includes('campaigns!inner') ? { body: db.campaign_contacts } : undefined);
  db.suppression_list = [];
  const un = await call('POST', `/v1/contacts/${id}/unsubscribe`);
  is('unsubscribe: flagged, their sequences stopped, the address suppressed',
    un.status === 200 && un.json?.unsubscribed === true && db.campaign_contacts[0].status === 'unsubscribed'
      && db.suppression_list.some((x) => x.email === 'ada@example.com' && x.reason === 'unsubscribed'), JSON.stringify(un.json)?.slice(0, 120));
  const q = lastQuery('campaign_contacts')!;
  is('only this account\'s campaigns, only live enrolments', q.params.get('campaigns.user_id') === `eq.${USER}` && /pending.*active.*paused/.test(q.params.get('status') || ''));
  delete custom.campaign_contacts;

  // One call for no-code tools: unsubscribe an address whether or not it is a contact.
  db.suppression_list = [];
  db.contacts[0].is_unsubscribed = false;
  const one = await call('POST', '/v1/unsubscribes', { body: { email: 'ADA@example.com' } });
  is('unsubscribes: a contact\'s address unsubscribes the contact', one.status === 200 && one.json?.was_contact === true && one.json?.contact_id === id && db.contacts[0].is_unsubscribed === true, JSON.stringify(one.json));
  const two = await call('POST', '/v1/unsubscribes', { body: { email: 'nobody-yet@example.com' } });
  is('unsubscribes: any other address is suppressed', two.status === 200 && two.json?.was_contact === false && db.suppression_list.some((x) => x.email === 'nobody-yet@example.com' && x.reason === 'unsubscribed'));
  const bad = await call('POST', '/v1/unsubscribes', { body: { email: 'not an address' } });
  is('unsubscribes: a non-address is refused', bad.status === 400 && bad.json?.error?.param === 'email');

  // Removing by email, which is what a Make or n8n step has to hand.
  const CAMP = '33333333-3333-4333-8333-333333333333';
  db.campaigns = [{ id: CAMP, user_id: USER, name: 'Q4', status: 'running', list_id: null, created_at: T0, updated_at: T0 }];
  db.campaign_contacts = [{ id: 'eeeeeeee-0000-4000-8000-000000000001', campaign_id: CAMP, contact_id: id, status: 'active' }];
  const rm = await call('DELETE', `/v1/campaigns/${CAMP}/contacts/${encodeURIComponent('Ada@Example.com')}`);
  is('a campaign removal can name the contact by email', rm.status === 200 && rm.json?.contact_id === id && db.campaign_contacts.length === 0, JSON.stringify(rm.json));
  const rm404 = await call('DELETE', `/v1/campaigns/${CAMP}/contacts/${encodeURIComponent('ghost@example.com')}`);
  is('an email that is not a contact is a plain 404', rm404.status === 404 && /no contact with the address ghost@example.com/.test(rm404.json?.error?.message || ''));

  const enr = await call('POST', `/v1/campaigns/${CAMP}/contacts`, { body: { emails: ['ghost@example.com', 'not-an-address', 'ghost@example.com'] } });
  const res = enr.json?.results || [];
  is('enrolling: one answer per person asked for, in order, without repeats',
    enr.status === 200 && res.length === 2 && res[0].outcome === 'not_found' && res[0].email === 'ghost@example.com' && res[1].outcome === 'invalid' && res[1].reason === 'not a valid email address', JSON.stringify(enr.json));

  const del = await call('DELETE', '/v1/contacts/00000000-0000-4000-8000-000000000999');
  is('deleting a contact that is not there: 404, nothing deleted', del.status === 404 && db.contacts.length === 1);
}

console.log('\nWebhooks');
{
  const plain = await call('POST', '/v1/webhooks', { body: { url: 'http://hooks.example.com/x', events: ['reply.interested'] } });
  is('a webhook must be https', plain.status === 400 && plain.json?.error?.param === 'url');
  const bad = await call('POST', '/v1/webhooks', { body: { url: 'https://hooks.example.com/x', events: ['email.replied'] } });
  is('an internal event name is not a public one', bad.status === 400 && bad.json?.error?.param === 'events' && /not an event type/.test(bad.json?.error?.message));
  const none = await call('POST', '/v1/webhooks', { body: { url: 'https://hooks.example.com/x' } });
  is('events are required', none.status === 400 && none.json?.error?.code === 'parameter_missing');
  const local = await call('POST', '/v1/webhooks', { body: { url: 'https://127.0.0.1/x', events: ['reply.interested'] } });
  is('a webhook cannot point inside our network', local.status === 400 && local.json?.error?.param === 'url');

  const types = await call('GET', '/v1/events/types');
  is('the event types are listed', types.status === 200 && types.json?.data?.length === shared.PUBLIC_EVENTS.length);
  const sample = await call('GET', '/v1/events/types/reply.interested/sample');
  is('a sample event with nothing to draw on is the documented example', sample.status === 200 && sample.json?.type === 'reply.interested' && sample.json?.object === 'event' && !!sample.json?.data?.contact?.email, JSON.stringify(sample.json)?.slice(0, 200));
  const unknown = await call('GET', '/v1/events/types/email.replied/sample');
  is('a sample of an unknown type: 404', unknown.status === 404);

  const body = JSON.stringify({ id: 'evt_1', type: 'reply.received' });
  const sig = signV1('whsec_test', body);
  is('a signature verifies', verifyV1('whsec_test', body, sig));
  is('a changed body does not', !verifyV1('whsec_test', body.replace('received', 'interested'), sig));
  is('a wrong secret does not', !verifyV1('whsec_other', body, sig));
  is('an old one does not (replay)', !verifyV1('whsec_test', body, signV1('whsec_test', body, Math.floor(Date.now() / 1000) - 600)));
  is('a mangled header does not', !verifyV1('whsec_test', body, 'v1=abc') && !verifyV1('whsec_test', body, ''));

  // Building public events from internal ones.
  db.inbox_messages = [{ id: 'cccccccc-0000-4000-8000-000000000001', user_id: USER, contact_id: db.contacts[0].id, campaign_id: null, from_email: 'taken@example.com', sender_name: 'Taken', subject: 'Re: hi', body_text: 'Yes, Thursday works', received_at: T0, sara_intent: 'meeting', sara_confidence: 0.912, direction: 'inbound', message_id: '<m1@x>' }];
  const interested = await publicEventsFor(USER, 'sara.intent_classified', { message_id: db.inbox_messages[0].id, intent: 'meeting', confidence: 0.912 });
  is('a meeting reply is both reply.classified and reply.interested', interested.map((e) => e.type).sort().join() === 'reply.classified,reply.interested');
  is('the event carries the whole contact and the reply', interested[0]?.data?.contact && (interested[0].data as any).contact.email === db.contacts[0].email && (interested[0].data as any).reply.text === 'Yes, Thursday works' && (interested[0].data as any).reply.intent_confidence === 0.91);
  const objection = await publicEventsFor(USER, 'sara.intent_classified', { message_id: db.inbox_messages[0].id, intent: 'objection' });
  is('an objection is classified, not interested', objection.map((e) => e.type).join() === 'reply.classified');
  const dup = await publicEventsFor(USER, 'sara.intent_classified', { message_id: db.inbox_messages[0].id, intent: 'interested', auto_deal_created: true });
  is('the auto-deal echo is not announced twice', dup.length === 0);
  const replied = await publicEventsFor(USER, 'email.replied', { contact_id: db.contacts[0].id, message_id: '<m1@x>', from: 'taken@example.com' });
  is('email.replied becomes reply.received with the stored reply', replied.length === 1 && replied[0].type === 'reply.received' && (replied[0].data as any).reply.id === db.inbox_messages[0].id);
  const internalOnly = await publicEventsFor(USER, 'deal.won', {});
  is('an internal-only event becomes nothing', internalOnly.length === 0);
  is('every public event has an envelope with an evt_ id and the version', /^evt_[0-9a-f]{24}$/.test(interested[0].id) && interested[0].api_version === shared.PUBLIC_API_VERSION);
}

console.log('\nThe definition, the routes and the docs agree');
{
  let threw = '';
  try { buildPublicApiRouter({ ...HANDLERS, 'made.up': async () => ({ body: {} }) }); } catch (e: any) { threw = e.message; }
  is('a handler with no definition stops the server starting', /Not defined: made\.up/.test(threw));
  const { 'me.get': _drop, ...rest } = HANDLERS;
  threw = '';
  try { buildPublicApiRouter(rest); } catch (e: any) { threw = e.message; }
  is('a definition with no handler stops it too', /No handler: me\.get/.test(threw));

  const keys = shared.API_ENDPOINTS.map((e) => `${e.method} ${e.path}`);
  is('no two endpoints share a method and path', new Set(keys).size === keys.length);
  is('endpoint ids are unique', new Set(shared.API_ENDPOINTS.map((e) => e.id)).size === shared.API_ENDPOINTS.length);
  const codes = new Set(shared.API_ERROR_CODES.map((e) => e.code));
  is('every error an endpoint lists is a defined code', shared.API_ENDPOINTS.every((e) => (e.errors || []).every((c) => codes.has(c))));
  is('every webhook event is reachable from an internal one', shared.PUBLIC_EVENT_TYPES.every((t) => Object.values(shared.INTERNAL_TO_PUBLIC).flat().includes(t)));

  const doc = await call('GET', '/v1/openapi.json', { key: null });
  const paths = doc.json?.paths || {};
  const ops = Object.values(paths).flatMap((p: any) => Object.values(p)) as any[];
  is('openapi.json is public and OpenAPI 3.1', doc.status === 200 && doc.json?.openapi === '3.1.0');
  is('it describes every endpoint once', ops.length === shared.API_ENDPOINTS.length && new Set(ops.map((o) => o.operationId)).size === ops.length);
  is('it points at this server', doc.json?.servers?.[0]?.url === 'https://api.sincerely.io');
  is('every path parameter is declared', Object.entries(paths).every(([p, byMethod]: any) => Object.values(byMethod).every((op: any) =>
    [...p.matchAll(/\{(\w+)\}/g)].every((m) => op.parameters.some((x: any) => x.in === 'path' && x.name === m[1])))));

  for (const ep of shared.API_ENDPOINTS.filter((e) => e.bodyExample)) {
    const s = shared.codeSamples(ep, 'https://api.sincerely.io');
    const curlBody = s.curl.match(/-d '(.*)'$/m)?.[1];
    if (!curlBody || JSON.stringify(JSON.parse(curlBody)) !== JSON.stringify(ep.bodyExample)) { is(`curl sample for ${ep.id} carries the body`, false); break; }
    if (/\btrue\b|\bfalse\b|\bnull\b/.test(s.python.split('json=')[1] || '')) { is(`python sample for ${ep.id} uses Python literals`, false, s.python); break; }
  }
  is('every code sample carries its body, in each language\'s own syntax', true);

  // Every documented example body is accepted by the validator that guards the real endpoint.
  const ownKeys = new Set(Object.keys(HANDLERS));
  is('every handler is defined', shared.API_ENDPOINTS.every((e) => ownKeys.has(e.id)));
}

console.log('\nThe example request bodies are valid requests');
{
  // Each documented body against the live validator: anything but a parameter error passes this check
  // (the stand-in database has none of the example's rows, so a 404 is expected and fine).
  for (const ep of shared.API_ENDPOINTS.filter((e) => e.bodyExample)) {
    const path = shared.fillPath(ep.path);
    // No DNS here: a documentation address is swapped for a public literal one.
    const exampleBody = ep.id === 'webhooks.create' ? { ...ep.bodyExample, url: 'https://203.0.113.10/sincerely' } : ep.bodyExample;
    const r = await call(ep.method, path, { body: exampleBody });
    const code = r.json?.error?.code;
    is(`${ep.id}: the documented example is a valid request`, !['parameter_invalid', 'parameter_missing', 'body_invalid'].includes(code), JSON.stringify(r.json?.error));
  }
}

console.log('\nThe Zapier app, driving this server');
{
  // The real app from integrations/zapier, pointed at this server, so the two cannot drift apart.
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const zapierDir = fileURLToPath(new URL('../../integrations/zapier/', import.meta.url));
  const zreq = createRequire(`${zapierDir}index.js`);
  let ZapApp: any;
  let zapierCore: any;
  try {
    process.env.SINCERELY_API_URL = base;
    ZapApp = zreq('./index.js');
    zapierCore = zreq('zapier-platform-core');
  } catch (e: any) {
    is('the Zapier app is installed (npm ci --prefix integrations/zapier)', false, e?.message);
  }
  if (ZapApp) {
    const zap = zapierCore.createAppTester(ZapApp);
    const authData = { api_key: KEY };

    const me = await zap(ZapApp.authentication.test, { authData });
    is('Zapier: connecting checks the key against /v1/me', me?.user_id === USER && me?.api_key?.name === 'Zapier');

    db.contacts = [];
    const created = await zap(ZapApp.creates.create_contact.operation.perform, {
      authData, inputData: { email: 'Grace@Example.com', first_name: 'Grace', company: '', tags: 'navy' },
    });
    const row = db.contacts.find((c) => c.email === 'grace@example.com');
    is('Zapier: Create or Update Contact creates a lead, from the API, with nothing blank written',
      created?.email === 'grace@example.com' && row?.source === 'api' && row?.lifecycle === 'prospect' && !('company' in row), JSON.stringify(row));

    const again = await zap(ZapApp.creates.create_contact.operation.perform, { authData, inputData: { email: 'grace@example.com', job_title: 'Admiral' } });
    is('Zapier: the same address again updates the same contact', again?.id === row?.id && db.contacts.filter((c) => c.email === 'grace@example.com').length === 1 && row?.job_title === 'Admiral');

    db.webhook_endpoints = [];
    const sub = await zap(ZapApp.triggers.reply_interested.operation.performSubscribe, { authData, targetUrl: 'https://203.0.113.10/hooks/catch/1/abc', inputData: {} });
    const hook = db.webhook_endpoints[0];
    is('Zapier: turning a Zap on creates a v1 webhook for that one event, marked as Zapier\'s',
      sub?.id === hook?.id && hook?.format === 'v1' && hook?.source === 'zapier' && JSON.stringify(hook?.events) === '["reply.interested"]', JSON.stringify(hook));
    is('Zapier: the signing secret comes back once, as whsec_', /^whsec_[0-9a-f]{48}$/.test(sub?.secret || ''));

    const list = await zap(ZapApp.triggers.reply_interested.operation.performList, { authData, inputData: {} });
    is('Zapier: the test record is a full interested-reply event', list?.length === 1 && list[0].event_type === 'reply.interested' && !!list[0].contact?.email && !!list[0].reply);

    await zap(ZapApp.triggers.reply_interested.operation.performUnsubscribe, { authData, subscribeData: sub });
    is('Zapier: turning the Zap off deletes the webhook', db.webhook_endpoints.length === 0);
    await zap(ZapApp.triggers.reply_interested.operation.performUnsubscribe, { authData, subscribeData: sub });
    is('Zapier: turning it off again (already gone) does not fail', true);

    let msg = '';
    try {
      await zap(ZapApp.creates.add_to_campaign.operation.perform, { authData, inputData: { campaign_id: '99999999-9999-4999-8999-999999999999', email: 'grace@example.com' } });
    } catch (e: any) { msg = e.message; }
    is('Zapier: a campaign that does not exist is a plain sentence, with the reference', /No such campaign/.test(msg) && /req_[0-9a-f]{20}/.test(msg), msg);

    db.suppression_list = [];
    const un = await zap(ZapApp.creates.unsubscribe.operation.perform, { authData, inputData: { email: 'stranger@example.com' } });
    is('Zapier: unsubscribing an address that is not a contact suppresses it', un?.was_contact === false && db.suppression_list.some((x) => x.email === 'stranger@example.com'));

    let badKey = '';
    try { await zap(ZapApp.authentication.test, { authData: { api_key: 'sk_live_revoked' } }); } catch (e: any) { badKey = e.name; }
    is('Zapier: a revoked key asks the person to reconnect', badKey === 'ExpiredAuthError');

    const logged = (db.api_request_log || []).filter((r) => /Zapier/.test(r.user_agent || ''));
    is('Zapier: its calls are in the request log, named as Zapier', logged.length >= 5);
  }
}

server.close();
fake.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
