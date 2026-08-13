/* ═══════════════════════════════════════════════════════════════════════
   The readiness report has to be right about the thing it is asked.

   Its whole value is that someone trusts a one-word verdict instead of
   visiting five pages, which means a wrong verdict is worse than no page
   at all: "Safe to send" over an unauthenticated domain would do real
   damage, and "Not ready" over a healthy account teaches people to ignore
   it — after which it is right at the exact moment nobody is reading.

   So this drives the real service against a stubbed database and asserts
   the verdicts, not the wording.

   Run: npx tsx scripts/readiness-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'check';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'check';
process.env.TRACKING_SECRET ||= 'check-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.STRIPE_SECRET_KEY ||= '';

const { supabaseAdmin } = await import('../src/config/supabase.js');

const USER = '00000000-0000-0000-0000-000000000001';
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

interface World {
  smtp_accounts: any[];
  sending_domains: any[];
  tracking_domains: any[];
  user_settings: any[];
  campaigns: any[];
  /** campaign_activities counts, by activity_type. */
  activities: Record<string, number>;
}

let world: World;

function mailbox(over: Partial<any> = {}): any {
  return {
    id: `mb-${Math.random().toString(36).slice(2, 8)}`,
    user_id: USER,
    label: 'Primary',
    email_address: 'jordan@sincerely.io',
    is_active: true,
    is_verified: true,
    health_score: 95,
    total_sent: 4000,
    total_bounced: 20,
    total_opened: 900,
    bounce_rate_7d: 0.5,
    daily_send_limit: 500,
    sends_today: 0,
    warmup_mode: false,
    warmup_started_at: null,
    warmup_start_volume: 4,
    warmup_daily_target: 0,
    warmup_ramp_days: 30,
    warmup_sent_today: 0,
    created_at: ago(400),
    ...over,
  };
}

function authenticatedDomain(over: Partial<any> = {}): any {
  return {
    id: 'dom-1', user_id: USER, domain: 'sincerely.io',
    is_verified: true, txt_verified: true, spf_ok: true, dkim_ok: true, dmarc_ok: true,
    ...over,
  };
}

function settingsRow(over: Partial<any> = {}): any {
  return {
    id: 'set-1', user_id: USER,
    bounce_guard_enabled: true, bounce_guard_threshold: 8, domain_hourly_limit: 5,
    ...over,
  };
}

function freshWorld(): World {
  return {
    smtp_accounts: [mailbox(), mailbox({ id: 'mb-2', email_address: 'sam@sincerely.io' })],
    sending_domains: [authenticatedDomain()],
    tracking_domains: [{ id: 'td-1', user_id: USER, domain: 'track.sincerely.io', verified: true, verified_at: ago(2), last_error: null, last_checked_at: ago(2) }],
    user_settings: [settingsRow()],
    campaigns: [{ id: 'c1', user_id: USER, name: 'Q3 outbound', status: 'running', paused_reason: null }],
    activities: { sent: 4000, bounced: 40 },
  };
}

/**
 * A stand-in for the PostgREST client.
 *
 * The two things it has to get right are the ones that silently invert a
 * result: `.single()`/`.maybeSingle()` return a bare object where everything
 * else returns an array, and a `head: true` count query returns a count with
 * no rows at all. Getting either wrong would make this harness agree with
 * whatever the service does.
 */
function stub(table: string): any {
  let single = false;
  let counting = false;
  const eqs: [string, any][] = [];

  const resolve = () => {
    if (counting) {
      if (table === 'campaign_activities') {
        const type = eqs.find(([col]) => col === 'activity_type')?.[1];
        return { data: null, error: null, count: world.activities[type] ?? 0 };
      }
      return { data: null, error: null, count: (world as any)[table]?.length ?? 0 };
    }
    let rows: any[] = (world as any)[table] ?? [];
    for (const [col, value] of eqs) {
      rows = rows.filter((r) => !(col in r) || r[col] === value);
    }
    if (single) return { data: rows[0] ?? null, error: rows[0] ? null : { code: 'PGRST116', message: 'no rows' }, count: rows.length };
    return { data: rows, error: null, count: rows.length };
  };

  const chain: any = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return chain; };
      if (prop === 'select') {
        return (_cols?: string, opts?: any) => { if (opts?.count) counting = true; return chain; };
      }
      if (prop === 'eq') return (col: string, value: any) => { eqs.push([col, value]); return chain; };
      if (prop === 'then') return (res: any) => res(resolve());
      return () => chain;
    },
    apply() { return chain; },
  });
  return chain;
}

(supabaseAdmin as any).from = stub;
(supabaseAdmin as any).rpc = () => Promise.resolve({ data: null, error: null });

const { readinessService } = await import('../src/services/readiness.service.js');
const { invalidateGuardSettings } = await import('../src/services/bounce-guard.service.js');
const { invalidateSenderIdentity } = await import('../src/services/settings.service.js');
const { invalidateTrackingBaseUrl } = await import('../src/services/tracking-domain.service.js');

/** Each scenario starts from a healthy account and breaks exactly one thing. */
async function report(mutate?: (w: World) => void) {
  world = freshWorld();
  mutate?.(world);
  // These memoise per user, correctly, in production. Between scenarios here
  // they would carry the previous world's answer into the next one.
  invalidateGuardSettings(USER);
  invalidateSenderIdentity(USER);
  invalidateTrackingBaseUrl(USER);
  return readinessService.report(USER);
}

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

const statusOf = (r: any, id: string) => r.checks.find((c: any) => c.id === id)?.status;

console.log('\na healthy account is told it is safe, plainly');
{
  const r = await report();
  is('verdict is ready', r.verdict === 'ready', `verdict ${r.verdict}: ${r.summary}`);
  is('every check passes', r.checks.every((c: any) => c.status === 'pass'),
     JSON.stringify(r.checks.filter((c: any) => c.status !== 'pass').map((c: any) => `${c.id}=${c.status}`)));
  is("today's capacity is real", r.capacity_today === 1000 && r.capacity_ceiling === 1000,
     `${r.capacity_today}/${r.capacity_ceiling}`);
}

console.log('\nthe things that must block a send');
{
  const r = await report((w) => { w.smtp_accounts = []; });
  is('no mailbox blocks', r.verdict === 'blocked' && statusOf(r, 'mailboxes') === 'fail', r.summary);
}
{
  const r = await report((w) => { w.smtp_accounts = [mailbox({ is_verified: false })]; });
  is('an unverified mailbox blocks', statusOf(r, 'mailboxes') === 'fail', r.summary);
}
{
  const r = await report((w) => { w.sending_domains = []; });
  is('an unauthenticated sending domain blocks', statusOf(r, 'domain_auth') === 'fail', r.summary);
}
{
  const r = await report((w) => { w.sending_domains = [authenticatedDomain({ dkim_ok: false })]; });
  is('missing DKIM blocks', statusOf(r, 'domain_auth') === 'fail', r.summary);
}
{
  const r = await report((w) => { w.activities = { sent: 4000, bounced: 400 }; });
  is('a 10% bounce rate blocks', statusOf(r, 'bounce_rate') === 'fail', r.summary);
}
{
  const r = await report((w) => { w.smtp_accounts = [mailbox({ health_score: 20 })]; });
  is('a burnt mailbox blocks', statusOf(r, 'mailbox_health') === 'fail', r.summary);
}
{
  const r = await report((w) => { w.smtp_accounts = [mailbox({ sends_today: 500 }), mailbox({ id: 'mb-2', sends_today: 500 })]; });
  is('no capacity left today blocks', statusOf(r, 'capacity') === 'fail', r.summary);
}

console.log('\nthe things that are a warning, not a wall');
{
  const r = await report((w) => { w.sending_domains = [authenticatedDomain({ dmarc_ok: false })]; });
  is('missing DMARC warns', r.verdict === 'risky' && statusOf(r, 'domain_auth') === 'warn', r.summary);
}
{
  const r = await report((w) => { w.tracking_domains = []; });
  is('the shared tracking host warns', statusOf(r, 'tracking_domain') === 'warn', r.summary);
}
{
  const r = await report((w) => { w.user_settings = [settingsRow({ bounce_guard_enabled: false })]; });
  is('the guard switched off warns', statusOf(r, 'safeguards') === 'warn', r.summary);
}
{
  const r = await report((w) => {
    w.campaigns = [{ id: 'c1', user_id: USER, name: 'Bought list', status: 'paused', paused_reason: 'Paused automatically: 90 of 900 sends bounced.' }];
  });
  is('a campaign the guard already stopped warns', statusOf(r, 'safeguards') === 'warn', r.summary);
}
{
  const r = await report((w) => { w.smtp_accounts = [mailbox()]; });
  is('a single mailbox warns — one throttle stops everything', statusOf(r, 'mailboxes') === 'warn', r.summary);
}
{
  const r = await report((w) => { w.smtp_accounts = [mailbox({ health_score: 60 }), mailbox({ id: 'mb-2' })]; });
  is('a struggling mailbox warns', statusOf(r, 'mailbox_health') === 'warn', r.summary);
}
{
  const r = await report((w) => {
    w.smtp_accounts = [mailbox(), mailbox({ id: 'mb-2', created_at: ago(3), total_sent: 12 })];
  });
  is('a brand-new mailbox at full volume warns', statusOf(r, 'warmup') === 'warn', r.summary);
}

console.log('\nwhat must NOT be called a problem');
{
  const r = await report((w) => {
    w.smtp_accounts = [mailbox({ created_at: ago(2), total_sent: 0, warmup_mode: true, warmup_started_at: ago(2), warmup_daily_target: 200 }), mailbox({ id: 'mb-2' })];
  });
  is('a mailbox already on a ramp is not scolded for being new', statusOf(r, 'warmup') === 'pass', r.summary);
}
{
  const r = await report((w) => { w.activities = { sent: 6, bounced: 2 }; });
  is('2 bounces out of 6 is too small a sample to judge', statusOf(r, 'bounce_rate') === 'pass', r.summary);
}
{
  const r = await report((w) => {
    w.smtp_accounts = [mailbox({ email_address: 'jordan@gmail.com' }), mailbox({ id: 'mb-2', email_address: 'sam@gmail.com' })];
    w.sending_domains = [];
  });
  is('a consumer mailbox is a warning, not a DNS failure',
     statusOf(r, 'domain_auth') === 'warn', `${statusOf(r, 'domain_auth')}: ${r.summary}`);
}
{
  const r = await report((w) => { w.smtp_accounts = [mailbox({ daily_send_limit: 0 }), mailbox({ id: 'mb-2', daily_send_limit: 0 })]; });
  is('an uncapped mailbox reports no number rather than a wrong one',
     r.capacity_today === null && r.capacity_ceiling === null && statusOf(r, 'capacity') === 'pass',
     `${r.capacity_today}/${r.capacity_ceiling} ${statusOf(r, 'capacity')}`);
}
{
  // Every optional source empty, as on a database that has not run the
  // later migrations. Missing data must never be reported as a failure.
  const r = await report((w) => { w.tracking_domains = []; w.user_settings = []; w.campaigns = []; w.activities = {}; });
  is('a pre-migration database produces no false failures',
     r.checks.every((c: any) => c.status !== 'fail'),
     JSON.stringify(r.checks.filter((c: any) => c.status === 'fail').map((c: any) => c.id)));
}

console.log('\nthe report is usable by the page that renders it');
{
  const r = await report((w) => { w.sending_domains = []; });
  is('every failing check carries a link that fixes it',
     r.checks.filter((c: any) => c.status !== 'pass').every((c: any) => c.fix && c.fix.href),
     JSON.stringify(r.checks.filter((c: any) => c.status !== 'pass' && !c.fix).map((c: any) => c.id)));
  is('the summary names what is wrong', /domain/i.test(r.summary), r.summary);
  is('checks are unique by id', new Set(r.checks.map((c: any) => c.id)).size === r.checks.length);
  is('every check belongs to a rendered group',
     r.checks.every((c: any) => ['identity', 'reputation', 'capacity', 'safeguards'].includes(c.group)),
     JSON.stringify(r.checks.map((c: any) => c.group)));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
