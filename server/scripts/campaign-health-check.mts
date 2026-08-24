/* ═══════════════════════════════════════════════════════════════════════
   Whether a running campaign is actually running.

   A campaign keeps its green badge from launch until somebody changes it,
   and every way of not sending is silent underneath it: a mailbox that
   stops authenticating, a bounce guard that trips, a daily allowance spent,
   a queue where everyone is stuck on an error. Sends drop to zero and the
   first signal is a fortnight without replies.

   The value of this panel is that somebody trusts it instead of checking
   five pages, which makes a wrong answer worse than no panel at all. Saying
   "sending" over a dead mailbox wastes a week; crying "stalled" over a
   healthy campaign teaches people to ignore it, after which it is right at
   the exact moment nobody is reading.

   So this drives the real service against a stubbed database and asserts
   the level and the issue ids — never the wording.

   Run: npx tsx scripts/campaign-health-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'check';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'check';
process.env.TRACKING_SECRET ||= 'check-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.STRIPE_SECRET_KEY ||= '';

const { supabaseAdmin } = await import('../src/config/supabase.js');

const USER = '00000000-0000-0000-0000-000000000001';
const CAMPAIGN = 'camp-1';

interface World {
  campaigns: any[];
  smtp_accounts: any[];
  campaign_smtp_accounts: any[];
  sending_domains: any[];
  user_settings: any[];
  /** campaign_contacts, counted by status. */
  contactsByStatus: Record<string, number>;
  /** campaign_activities counts, by activity_type. */
  activities: Record<string, number>;
}

let world: World;

function mailbox(over: Partial<any> = {}): any {
  return {
    id: 'mb-1',
    user_id: USER,
    label: 'Primary',
    email_address: 'jordan@sincerely.io',
    is_active: true,
    is_verified: true,
    daily_send_limit: 200,
    sends_today: 20,
    warmup_mode: false,
    warmup_started_at: null,
    warmup_start_volume: 4,
    warmup_daily_target: 0,
    warmup_ramp_days: 30,
    warmup_sent_today: 0,
    total_sent: 4000,
    total_bounced: 20,
    ...over,
  };
}

/**
 * A stand-in for the PostgREST client.
 *
 * campaign_contacts is answered from a count table rather than from rows,
 * because every read of it here is a `head: true` count and building the
 * rows would only be a more elaborate way of returning the same number.
 */
function stub(table: string): any {
  let single = false;
  let counting = false;
  const eqs: [string, any][] = [];
  const ins: [string, any[]][] = [];

  const resolve = () => {
    if (counting) {
      if (table === 'campaign_contacts') {
        const status = eqs.find(([col]) => col === 'status')?.[1];
        const statuses = ins.find(([col]) => col === 'status')?.[1];
        if (status) return { data: null, error: null, count: world.contactsByStatus[status] ?? 0 };
        if (statuses) {
          const total = statuses.reduce(
            (n: number, s: string) => n + (world.contactsByStatus[s] ?? 0), 0,
          );
          return { data: null, error: null, count: total };
        }
        const all = Object.values(world.contactsByStatus).reduce((n, v) => n + v, 0);
        return { data: null, error: null, count: all };
      }
      if (table === 'campaign_activities') {
        const type = eqs.find(([col]) => col === 'activity_type')?.[1];
        return { data: null, error: null, count: world.activities[type] ?? 0 };
      }
      return { data: null, error: null, count: (world as any)[table]?.length ?? 0 };
    }

    let rows: any[] = (world as any)[table] ?? [];
    for (const [col, value] of eqs) rows = rows.filter((r) => !(col in r) || r[col] === value);
    for (const [col, values] of ins) rows = rows.filter((r) => values.includes(r[col]));
    if (single) {
      return {
        data: rows[0] ?? null,
        error: rows[0] ? null : { code: 'PGRST116', message: 'no rows' },
        count: rows.length,
      };
    }
    return { data: rows, error: null, count: rows.length };
  };

  const chain: any = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return chain; };
      if (prop === 'select') {
        return (_cols?: string, opts?: any) => { if (opts?.count) counting = true; return chain; };
      }
      if (prop === 'eq') return (col: string, value: any) => { eqs.push([col, value]); return chain; };
      if (prop === 'in') return (col: string, values: any[]) => { ins.push([col, values]); return chain; };
      if (prop === 'then') return (res: any) => res(resolve());
      return () => chain;
    },
    apply() { return chain; },
  });
  return chain;
}

(supabaseAdmin as any).from = stub;
(supabaseAdmin as any).rpc = () => Promise.resolve({ data: null, error: null });

const { campaignHealthService } = await import('../src/services/campaign-health.service.js');
const { invalidateGuardSettings } = await import('../src/services/bounce-guard.service.js');

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

/**
 * A campaign that is running, sending, and has people left.
 *
 * Deliberately mid-week and mid-morning UTC with a wide window, so the
 * schedule check is not what every scenario trips over.
 */
function freshWorld(): World {
  return {
    campaigns: [{
      id: CAMPAIGN, user_id: USER, name: 'Q3 outbound', status: 'running',
      timezone: 'UTC', send_window_start: '00:00', send_window_end: '23:59',
      send_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      paused_reason: null,
    }],
    smtp_accounts: [mailbox()],
    campaign_smtp_accounts: [{ campaign_id: CAMPAIGN, smtp_account_id: 'mb-1' }],
    sending_domains: [{ user_id: USER, domain: 'sincerely.io', spf_ok: true, dkim_ok: true }],
    user_settings: [{ user_id: USER, bounce_guard_enabled: true, bounce_guard_threshold: 8 }],
    contactsByStatus: { pending: 400, active: 20, error: 0 },
    activities: { sent: 120, bounced: 1 },
  };
}

async function health(mutate?: (w: World) => void) {
  world = freshWorld();
  mutate?.(world);
  invalidateGuardSettings(USER);
  return campaignHealthService.get(USER, CAMPAIGN);
}

const has = (r: any, id: string) => r.issues.some((i: any) => i.id === id);
const ids = (r: any) => r.issues.map((i: any) => i.id).sort().join(',');

/* ─────────────────────────────────────────────────────────────────── */

console.log('\na healthy campaign is left alone');
{
  const r = await health();
  is('level is ok', r.level === 'ok', `${r.level}: ${r.summary} [${ids(r)}]`);
  is('and nothing is raised', r.issues.length === 0, ids(r));
  is('it reports what actually went out', r.sent_24h === 120, String(r.sent_24h));
  is('and how long the queue takes at this rate',
     r.days_to_clear === 3, `${r.days_to_clear} (420 left, 200/day)`);
}

console.log('\na mailbox that stopped authenticating is a stall, not a warning');
{
  // The commonest real cause, and the one the badge hid best: a changed
  // password or a revoked app password. Nothing sends, and nothing said so.
  const r = await health((w) => { w.smtp_accounts[0].is_verified = false; });
  is('level is stalled', r.level === 'stalled', `${r.level}: ${ids(r)}`);
  is('and it is named as a sender problem', has(r, 'sender_failing'), ids(r));
  is('with somewhere to go about it',
     r.issues.find((i: any) => i.id === 'sender_failing')?.fix?.href?.includes('email-accounts'),
     JSON.stringify(r.issues[0]?.fix));
}

console.log('\nan empty sender pool with nothing to fall back on is also a stall');
{
  const r = await health((w) => { w.smtp_accounts = []; w.campaign_smtp_accounts = []; });
  is('level is stalled', r.level === 'stalled', `${r.level}: ${ids(r)}`);
  is('and it says there is no mailbox', has(r, 'no_sender'), ids(r));
}

console.log('\ntoday’s allowance running out is worth saying, but it is not broken');
{
  const r = await health((w) => { w.smtp_accounts[0].sends_today = 200; });
  is('level is attention, not stalled', r.level === 'attention', `${r.level}: ${ids(r)}`);
  is('and it is the allowance', has(r, 'capacity_exhausted'), ids(r));
  is('capacity reads zero, honestly', r.capacity_today === 0, String(r.capacity_today));
}

console.log('\na limit of zero, though, means nothing will ever send');
{
  // The trap: 0 means "unlimited" for a warm-up target elsewhere in this
  // codebase, and reading it that way here would report an uncapped mailbox
  // as healthy when it sends nothing at all.
  const r = await health((w) => { w.smtp_accounts[0].daily_send_limit = 0; });
  is('an uncapped mailbox is not reported as broken',
     !has(r, 'no_capacity'), ids(r));
  is('and its capacity is null rather than a made-up number',
     r.capacity_today === null, String(r.capacity_today));
  is('so there is no days-to-clear guess either',
     r.days_to_clear === null, String(r.days_to_clear));
}

console.log('\nan unauthenticated sending domain still sends, badly');
{
  const r = await health((w) => { w.sending_domains = []; });
  is('level is attention', r.level === 'attention', `${r.level}: ${ids(r)}`);
  is('and the domain is named', has(r, 'domain_unauthenticated'), ids(r));
}

console.log('\na queue where everyone is stuck is a stall');
{
  const r = await health((w) => {
    w.contactsByStatus = { pending: 0, active: 0, error: 40 };
  });
  is('level is stalled', r.level === 'stalled', `${r.level}: ${ids(r)}`);
  is('and it says why', has(r, 'all_errored'), ids(r));
  is('the errored count is reported', r.errored === 40, String(r.errored));
}

console.log('\na campaign that has finished its audience is not a fault');
{
  const r = await health((w) => {
    w.contactsByStatus = { pending: 0, active: 0, error: 0 };
  });
  is('level is attention, not stalled', r.level === 'attention', `${r.level}: ${ids(r)}`);
  is('and it says there is nobody left', has(r, 'nothing_left'), ids(r));
}

console.log('\nbeing outside the sending window is a fact, not a problem');
{
  /*
   * The sending day is derived from today rather than hard-coded.
   *
   * A fixed 'monday' meant this scenario tested nothing at all on Mondays —
   * the window was open, the branch never ran, and the suite still reported
   * a pass. A check that quietly stops checking one day in seven is worse
   * than one that fails, because nothing ever tells you.
   */
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const notToday = DAYS[(new Date().getUTCDay() + 3) % 7];

  const r = await health((w) => {
    w.campaigns[0].send_days = [notToday];
    w.campaigns[0].send_window_start = '09:00';
    w.campaigns[0].send_window_end = '17:00';
  });
  is('level is attention', r.level === 'attention', `${r.level}: ${ids(r)} (sends ${notToday})`);
  is('and it is the schedule', has(r, 'outside_schedule'), ids(r));
  is('with no fix link, because there is nothing to fix',
     r.issues.find((i: any) => i.id === 'outside_schedule')?.fix === null,
     JSON.stringify(r.issues.find((i: any) => i.id === 'outside_schedule')));
}

console.log('\nand being inside it is not raised at all');
{
  // The other half, which nothing covered: a campaign sending right now
  // must not be told it is outside its own window.
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const today = DAYS[new Date().getUTCDay()];
  const r = await health((w) => {
    w.campaigns[0].send_days = [today];
    w.campaigns[0].send_window_start = '00:00';
    w.campaigns[0].send_window_end = '23:59';
  });
  is('an open window is silent', !has(r, 'outside_schedule'), ids(r));
}

console.log('\nno sending window at all is worth flagging');
{
  const r = await health((w) => {
    w.campaigns[0].send_window_start = null;
    w.campaigns[0].send_window_end = null;
  });
  is('it is raised', has(r, 'no_schedule'), ids(r));
  is('but it does not claim the campaign is asleep',
     !has(r, 'outside_schedule'), ids(r));
}

console.log('\na draft is not asked about at all');
{
  // reach(), not get(): a draft has no health to report, and answering
  // "not sending" about one would be true and useless.
  world = freshWorld();
  world.campaigns[0].status = 'draft';
  const reach = await campaignHealthService.reach(USER, CAMPAIGN);
  is('reach still answers for a draft', reach.pending === 420, String(reach.pending));
  is('but says it is not sending', reach.sending === false, JSON.stringify(reach));
}

console.log('\nreach is the cheap answer the extension asks for');
{
  world = freshWorld();
  const reach = await campaignHealthService.reach(USER, CAMPAIGN);
  is('it counts who is left', reach.pending === 420, String(reach.pending));
  is('the daily allowance', reach.daily_capacity === 200, String(reach.daily_capacity));
  is("what is left of today's", reach.capacity_today === 180, String(reach.capacity_today));
  is('and how long that takes', reach.days_to_clear === 3, String(reach.days_to_clear));
  is('and it knows the campaign is live', reach.sending === true, JSON.stringify(reach));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
