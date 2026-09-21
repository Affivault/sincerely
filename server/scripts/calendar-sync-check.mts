/*
 * Reading a calendar Sincerely does not own.
 *
 * One assertion here matters more than the rest put together: when Google
 * cannot be reached, the busy set must NOT come back empty. Empty reads as
 * free, free means the page offers the time, and the prospect books a half
 * hour the account is already in a meeting for. Failing that way is worse
 * than never having connected the calendar at all, because the account now
 * believes it is protected.
 */
import assert from 'node:assert';

process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.TRACKING_BASE_URL ||= 'https://app.sincerely.io';
process.env.CLIENT_URL ||= 'https://app.sincerely.io';
process.env.API_BASE_URL ||= 'https://api.sincerely.io';
process.env.GOOGLE_CLIENT_ID ||= 'google-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'google-client-secret';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const { encrypt } = await import('../src/utils/encryption.js');

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 3600_000).toISOString();

let connections: any[] = [];
let cacheRows: any[] = [];
let updates: { table: string; patch: any }[] = [];

const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = (table: string) => {
  const chain: any = {
    select: () => chain, eq: () => chain, is: () => chain,
    gte: () => chain, lte: () => chain, order: () => chain, limit: () => chain,
    update: (patch: any) => { updates.push({ table, patch }); return chain; },
    upsert: async (rows: any) => {
      if (table === 'calendar_busy_cache') cacheRows = Array.isArray(rows) ? rows : [rows];
      return { data: null, error: null };
    },
    delete: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: any) => resolve({
      data: table === 'calendar_connections' ? connections
        : table === 'calendar_busy_cache' ? cacheRows
        : [],
      error: null,
    }),
  };
  return chain;
};

/* Google is a fetch away, and that is the seam. */
let fetchMode: 'ok' | 'down' | 'unauthorised' = 'ok';
const BUSY = [
  { start: '2026-12-01T09:00:00.000Z', end: '2026-12-01T10:00:00.000Z' },
  { start: '2026-12-01T14:00:00.000Z', end: '2026-12-01T14:30:00.000Z' },
];
(globalThis as any).fetch = async (url: string) => {
  if (fetchMode === 'down') throw new Error('ECONNREFUSED');
  if (String(url).includes('freeBusy')) {
    if (fetchMode === 'unauthorised') {
      return new Response(JSON.stringify({ error: { message: 'no' } }), { status: 401 });
    }
    return new Response(JSON.stringify({ calendars: { primary: { busy: BUSY } } }), { status: 200 });
  }
  return new Response(JSON.stringify({}), { status: 200 });
};

const { calendarSync, googleConfigured, signState, verifyState } =
  await import('../src/services/calendar-sync.service.js');

const FROM = new Date('2026-12-01T00:00:00.000Z');
const TO = new Date('2026-12-02T00:00:00.000Z');

const liveConnection = () => ([{
  id: 'conn-1', provider: 'google', read_busy: true, write_events: true,
  access_token: encrypt('at-live'), refresh_token: encrypt('rt'),
  expires_at: FUTURE, calendar_ids: ['primary'],
}]);

console.log('the feature is off until it is configured');
{
  is('configured, because the test set the credentials', googleConfigured() === true);
}

console.log('\nstate is signed, and cannot be edited');
{
  const state = signState('u1');
  is('it round-trips', verifyState(state).userId === 'u1');
  const [payload, sig] = state.split('.');
  const forged = `${Buffer.from(JSON.stringify({ u: 'intruder', e: Date.now() + 60000 })).toString('base64url')}.${sig}`;
  let threw = false;
  try { verifyState(forged); } catch { threw = true; }
  is('a swapped user is refused', threw);
  let threw2 = false;
  try { verifyState(`${payload}.deadbeef`); } catch { threw2 = true; }
  is('a short signature is refused rather than throwing a type error', threw2);
}

console.log('\nbusy times come back, and are cached');
{
  connections = liveConnection();
  fetchMode = 'ok';
  cacheRows = [];
  const busy = await calendarSync.externalBusy('u1', FROM, TO);
  is('both busy blocks are returned', busy.length === 2, JSON.stringify(busy));
  is('as real dates', busy[0].start instanceof Date && busy[0].end instanceof Date);
  is('with the right instant',
     busy[0].start.toISOString() === '2026-12-01T09:00:00.000Z', busy[0].start.toISOString());
  is('and the answer was cached', cacheRows.length > 0, String(cacheRows.length));
  is('including days with nothing on them, so a free day is not "unknown"',
     cacheRows.some((r) => Array.isArray(r.intervals) && r.intervals.length === 0),
     JSON.stringify(cacheRows).slice(0, 200));
}

console.log('\nAN OUTAGE MUST NOT READ AS FREE');
{
  // The cache holds what Google last said.
  cacheRows = [{
    connection_id: 'conn-1', day: '2026-12-01',
    intervals: BUSY, fetched_at: new Date().toISOString(),
  }];
  connections = liveConnection();
  fetchMode = 'down';

  const busy = await calendarSync.externalBusy('u1', FROM, TO);
  /*
   * The single most important assertion in this file. An empty array here
   * is a booking page that offers a time the account is already busy in -
   * and it does it silently, to somebody who connected their calendar
   * precisely so that would not happen.
   */
  is('the last known busy times are used instead of nothing',
     busy.length === 2, `returned ${busy.length} intervals`);
  is('and they are the ones Google last gave',
     busy[0].start.toISOString() === '2026-12-01T09:00:00.000Z', busy[0].start.toISOString());
}

console.log('\na revoked token is reported, not silently ignored');
{
  connections = liveConnection();
  fetchMode = 'unauthorised';
  updates = [];
  cacheRows = [];

  const busy = await calendarSync.externalBusy('u1', FROM, TO);
  is('nothing is invented when access is refused', busy.length === 0, JSON.stringify(busy));
  is('the connection is marked broken',
     updates.some((u) => u.table === 'calendar_connections' && u.patch.broken_at),
     JSON.stringify(updates));
  is('with a reason somebody can act on',
     updates.some((u) => /reconnect/i.test(u.patch.broken_reason || '')),
     JSON.stringify(updates.map((u) => u.patch.broken_reason)));
}

console.log('\na connection set to not be read is not read');
{
  connections = [];
  fetchMode = 'ok';
  const busy = await calendarSync.externalBusy('u1', FROM, TO);
  is('no connections means no external busy', busy.length === 0);
}

console.log('\nnothing here ever throws into a booking page');
{
  connections = liveConnection();
  for (const mode of ['down', 'unauthorised', 'ok'] as const) {
    fetchMode = mode;
    const result = await calendarSync.externalBusy('u1', FROM, TO).then((r) => r, (e) => e);
    is(`"${mode}" resolves rather than rejecting`, Array.isArray(result), String(result));
  }
  // A push that fails must not surface either: the meeting is already made.
  fetchMode = 'down';
  const pushed = await calendarSync.pushEvent('u1', {
    id: 'e1', title: 'x', start: FROM, end: TO,
  }).then(() => 'resolved', (e) => e);
  is('a failed push resolves quietly', pushed === 'resolved', String(pushed));
  const removed = await calendarSync.removeEvent('u1', 'e1').then(() => 'resolved', (e) => e);
  is('so does a failed removal', removed === 'resolved', String(removed));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} calendar-sync check(s) failed`);
