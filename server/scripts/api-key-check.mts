/* ═══════════════════════════════════════════════════════════════════════
   Does an API key actually work?

   The Chrome extension is entirely built on one: it mints a key through the
   app, stores it, and every single thing it does afterwards is a request
   carrying `Authorization: Bearer sk_live_...`. When that path is wrong the
   symptom the user reports is "the extension won't connect", which is three
   layers away from whatever actually broke — and the failure is invisible
   from inside the app, because the app authenticates with a JWT and never
   exercises this chain at all.

   So this drives the real Express app over real HTTP with a real key shape,
   through the real middleware stack, and asserts the answers.

   Run: npx tsx scripts/api-key-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto';
import type { AddressInfo } from 'net';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'check';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'check';
process.env.TRACKING_SECRET ||= 'check-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.STRIPE_SECRET_KEY ||= '';
process.env.NODE_ENV ||= 'test';

const { supabaseAdmin } = await import('../src/config/supabase.js');

const USER = '00000000-0000-0000-0000-000000000001';
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const newKey = () => `sk_live_${crypto.randomBytes(32).toString('hex')}`;

interface World {
  api_keys: any[];
  contact_lists: any[];
  /** Writes the app attempted, so a create can be seen to have happened. */
  writes: { table: string; op: string; payload: any }[];
}

let world: World;

let keySeq = 0;

function keyRow(raw: string, over: Partial<any> = {}): any {
  return {
    id: `key-${++keySeq}`,
    user_id: USER,
    name: 'Chrome extension',
    key_hash: sha256(raw),
    key_prefix: raw.slice(0, 16),
    scopes: ['read', 'write'],
    rate_limit: 100,
    is_active: true,
    expires_at: null,
    last_used_at: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

function freshWorld(raw: string): World {
  return {
    api_keys: [keyRow(raw)],
    contact_lists: [
      { id: 'list-1', user_id: USER, name: 'Leads', is_default: true, contact_count: 3 },
      { id: 'list-2', user_id: USER, name: 'Events', is_default: false, contact_count: 0 },
    ],
    writes: [],
  };
}

/** Minimal PostgREST stand-in: eq filters, single/maybeSingle, counts, writes. */
function stub(table: string): any {
  let single = false;
  let counting = false;
  const eqs: [string, any][] = [];

  const rows = () => {
    let out: any[] = (world as any)[table] ?? [];
    for (const [col, value] of eqs) out = out.filter((r) => !(col in r) || r[col] === value);
    return out;
  };

  const resolve = () => {
    const found = rows();
    if (counting) return { data: null, error: null, count: found.length };
    if (single) {
      return found[0]
        ? { data: found[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'no rows returned' } };
    }
    return { data: found, error: null };
  };

  const chain: any = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return chain; };
      if (prop === 'select') return (_c?: string, o?: any) => { if (o?.count) counting = true; return chain; };
      if (prop === 'eq') return (col: string, value: any) => { eqs.push([col, value]); return chain; };
      if (prop === 'insert' || prop === 'update' || prop === 'upsert' || prop === 'delete') {
        return (payload?: any) => {
          for (const row of Array.isArray(payload) ? payload : [payload ?? {}]) {
            world.writes.push({ table, op: prop, payload: row });
          }
          if (prop === 'insert') {
            const created = { id: `new-${world.writes.length}`, ...payload };
            (world as any)[table] = [...((world as any)[table] ?? []), created];
          }
          return chain;
        };
      }
      if (prop === 'then') return (res: any) => res(resolve());
      return () => chain;
    },
    apply() { return chain; },
  });
  return chain;
}

(supabaseAdmin as any).from = stub;
(supabaseAdmin as any).rpc = () => Promise.resolve({ data: null, error: null });
(supabaseAdmin as any).auth = {
  admin: {
    getUserById: async () => ({ data: { user: { id: USER, email: 'jordan@sincerely.io' } }, error: null }),
  },
  getUser: async () => ({ data: { user: null }, error: { message: 'not a jwt' } }),
};

const { app } = await import('../src/app.js');

const server = app.listen(0);
await new Promise<void>((r) => server.once('listening', () => r()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function call(path: string, opts: { key?: string; method?: string; body?: any } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* HTML or empty */ }
  return { status: res.status, json, text, headers: res.headers };
}

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

/**
 * Every scenario starts from a working key and breaks exactly one thing.
 *
 * Each gets its own key id because the rate limiter counts per key id in a
 * module-level map: a shared id would carry one scenario's request count into
 * the next and quietly 429 a request that should have succeeded.
 */
function scenario(mutate?: (w: World, raw: string) => void): string {
  const raw = newKey();
  world = freshWorld(raw);
  mutate?.(world, raw);
  return raw;
}

console.log('\nthe happy path the extension depends on');
{
  const key = scenario();
  const lists = await call('/api/v1/lists', { key });
  is('GET /lists is authorised by an API key', lists.status === 200, `${lists.status} ${lists.text.slice(0, 160)}`);
  is('and returns the account\'s lists', Array.isArray(lists.json) && lists.json.length === 2,
     JSON.stringify(lists.json)?.slice(0, 160));
  is('the key records that it was used',
     world.writes.some((w) => w.table === 'api_keys' && w.op === 'update' && 'last_used_at' in w.payload),
     JSON.stringify(world.writes));
}

console.log('\nrejections must be honest about which one it is');
{
  const key = scenario();
  const bad = await call('/api/v1/lists', { key: `sk_live_${'0'.repeat(64)}` });
  is('an unknown key is 401, not 500', bad.status === 401, `${bad.status} ${bad.text.slice(0, 160)}`);
  is('and says so in a body the extension can read', typeof bad.json?.error === 'string', bad.text.slice(0, 160));
  void key;
}
{
  const key = scenario((w) => { w.api_keys[0].is_active = false; });
  const res = await call('/api/v1/lists', { key });
  is('a revoked key is rejected', res.status === 401, `${res.status} ${res.text.slice(0, 160)}`);
}
{
  const key = scenario((w) => { w.api_keys[0].expires_at = new Date(Date.now() - 60_000).toISOString(); });
  const res = await call('/api/v1/lists', { key });
  is('an expired key is rejected', res.status === 401, `${res.status} ${res.text.slice(0, 160)}`);
}
{
  const res = await call('/api/v1/lists');
  is('no header at all is 401', res.status === 401, `${res.status} ${res.text.slice(0, 160)}`);
}

console.log('\nscopes decide what a key may do');
{
  const key = scenario((w) => { w.api_keys[0].scopes = ['read']; });
  const read = await call('/api/v1/lists', { key });
  is('a read-only key can still read', read.status === 200, `${read.status} ${read.text.slice(0, 160)}`);

  const write = await call('/api/v1/lists', { key, method: 'POST', body: { name: 'From extension' } });
  is('a read-only key cannot write', write.status === 403, `${write.status} ${write.text.slice(0, 160)}`);
  is('and the body names the missing scope so the UI can explain it',
     write.json?.required_scope === 'write', write.text.slice(0, 160));
}
{
  const key = scenario();
  const write = await call('/api/v1/lists', { key, method: 'POST', body: { name: 'From extension' } });
  is('a read+write key can create a list', write.status === 201, `${write.status} ${write.text.slice(0, 160)}`);
  is('and the list is written against the key owner',
     world.writes.some((w) => w.table === 'contact_lists' && w.payload?.user_id === USER),
     JSON.stringify(world.writes.filter((w) => w.table === 'contact_lists')));
}

console.log("\nan API key must not be able to mint or revoke keys");
{
  const key = scenario();
  const mint = await call('/api/v1/api-keys', { key, method: 'POST', body: { name: 'escalation' } });
  is('POST /api-keys refuses an API key', mint.status === 403, `${mint.status} ${mint.text.slice(0, 160)}`);
  is('no key was created', !world.writes.some((w) => w.table === 'api_keys' && w.op === 'insert'),
     JSON.stringify(world.writes));

  const revoke = await call('/api/v1/api-keys/key-1/revoke', { key, method: 'POST' });
  is('POST /api-keys/:id/revoke refuses an API key', revoke.status === 403, `${revoke.status}`);

  const del = await call('/api/v1/api-keys/key-1', { key, method: 'DELETE' });
  is('DELETE /api-keys/:id refuses an API key', del.status === 403, `${del.status}`);
}

console.log('\nthe rate limiter answers in the shape the extension backs off on');
{
  const key = scenario((w) => { w.api_keys[0].rate_limit = 2; });
  const first = await call('/api/v1/lists', { key });
  const second = await call('/api/v1/lists', { key });
  const third = await call('/api/v1/lists', { key });
  is('the calls within a limit of 2 both succeed',
     first.status === 200 && second.status === 200, `${first.status}, ${second.status}`);
  is('a third call over a limit of 2 is 429', third.status === 429, `${third.status} ${third.text.slice(0, 160)}`);
  // Without these a client can only discover the limit by hitting it, which
  // is what turned an ordinary burst into a user-facing "rate limit reached".
  is('every reply publishes the remaining budget',
     first.headers.get('x-ratelimit-remaining') === '1' && second.headers.get('x-ratelimit-remaining') === '0',
     `${first.headers.get('x-ratelimit-remaining')}, ${second.headers.get('x-ratelimit-remaining')}`);
  is('and the limit and window alongside it',
     first.headers.get('x-ratelimit-limit') === '2' && Number(first.headers.get('x-ratelimit-reset')) > 0,
     `${first.headers.get('x-ratelimit-limit')} / ${first.headers.get('x-ratelimit-reset')}`);
  is('Retry-After is set', Number(third.headers.get('retry-after')) > 0, String(third.headers.get('retry-after')));
  is('and the body carries the same number', Number(third.json?.retry_after_seconds) > 0, third.text.slice(0, 160));
}

console.log('\nkeys are not interchangeable between accounts');
{
  const key = scenario((w) => {
    w.api_keys.push(keyRow('sk_live_' + '1'.repeat(64), { id: 'key-2', user_id: 'someone-else' }));
    w.contact_lists.push({ id: 'list-9', user_id: 'someone-else', name: 'Not yours', is_default: false, contact_count: 99 });
  });
  const lists = await call('/api/v1/lists', { key });
  is("a key only sees its owner's lists",
     Array.isArray(lists.json) && lists.json.every((l: any) => l.user_id === USER),
     JSON.stringify(lists.json)?.slice(0, 200));
}

server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
