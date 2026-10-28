/*
 * Credit billing.
 *
 * Drives the real credit, search and reveal code against a stubbed Icypeas
 * and a fake database, and pins down what billing promises:
 *
 *   - every plan has a ceiling: trials get 100, Lifetime and Scale are no
 *     longer unlimited, and a hand-set allowance wins
 *   - a search page costs 0.5 credit only when Icypeas is paid for it: a
 *     page already held is free, a jump pays for each page it walks, an
 *     empty page or a failed call is refunded
 *   - out of credits, nothing paid runs
 *   - every paid Icypeas call is logged against the account and action,
 *     with the Icypeas credits it burned
 */
import assert from 'node:assert';

process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.ICYPEAS_API_KEY = 'icy-test-key';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

/* ── A stubbed Icypeas ──────────────────────────────────────────────── */

let icyCalls: string[] = [];
let handler: (path: string, body: any) => any = () => ({ success: true });
(globalThis as any).fetch = async (url: string, init: any) => {
  const path = String(url).replace('https://app.icypeas.com/api', '');
  icyCalls.push(path);
  const out = handler(path, init?.body ? JSON.parse(init.body) : null);
  const status = out?.__status ?? 200;
  return { ok: status < 400, status, statusText: 'x', json: async () => out } as any;
};

const lead = (i: number) => ({ _id: `p${i}`, firstname: `F${i}`, lastname: 'L', lastCompanyWebsite: 'acme.com' });
const peopleHandler = (total: number) => (path: string, body: any) => {
  if (path !== '/find-people') return { success: true };
  const size = Number(body.pagination?.size) || 100;
  const chunk = Number(String(body.pagination?.token || 't1').slice(1));
  const from = (chunk - 1) * size;
  const count = Math.max(0, Math.min(size, total - from));
  return { success: true, total, leads: Array.from({ length: count }, (_, i) => lead(from + i)), pagination: { size, token: `t${chunk + 1}` } };
};

/* ── A fake database ────────────────────────────────────────────────── */

const USER = '00000000-0000-0000-0000-0000000000c1';
let subscription: any = null;
let ledger: any[] = [];
let usage: any[] = [];
let outOfCredits = false;

function from(name: string): any {
  const filters: Array<[string, any]> = [];
  let single = false;
  // PostgREST answers at most 1,000 rows however many are asked for.
  let window: [number, number] = [0, 999];
  const run = () => {
    if (name === 'subscriptions') return { data: subscription, error: null };
    if (name === 'prospect_credit_ledger') {
      const rows = ledger.filter((r) => filters.every(([c, v]) => c === 'created_at' || r[c] === v));
      return { data: rows.slice(window[0], Math.min(window[1], window[0] + 999) + 1), error: null };
    }
    return { data: single ? null : [], error: null };
  };
  const chain: any = {
    select: () => chain,
    eq: (c: string, v: any) => { filters.push([c, v]); return chain; },
    gte: (c: string, v: any) => { filters.push([c, v]); return chain; },
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    range: (a: number, b: number) => { window = [a, b]; return chain; },
    maybeSingle: () => { single = true; return chain; },
    single: () => { single = true; return chain; },
    insert: (row: any) => {
      const rows = Array.isArray(row) ? row : [row];
      if (name === 'prospect_credit_ledger') ledger.push(...rows);
      if (name === 'provider_usage') usage.push(...rows);
      return { then: (res: any) => Promise.resolve({ data: null, error: null }).then(res) };
    },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = from;
let spendArgs: any[] = [];
(supabaseAdmin as any).rpc = async (fn: string, args: any) => {
  assert.equal(fn, 'try_spend_prospect_credits');
  spendArgs.push(args);
  if (outOfCredits) return { data: [{ spent_bucket: null }], error: null };
  ledger.push({ user_id: USER, delta: -args.p_amount, kind: 'spend', bucket: 'plan', action: args.p_action });
  return { data: [{ spent_bucket: 'plan' }], error: null };
};

const { billingService } = await import('../src/services/billing.service.js');
const { prospectingService } = await import('../src/services/prospecting.service.js');
const { icypeasCallCredits } = await import('../src/services/provider-usage.service.js');
const { PLANS, CREDIT_PRICES, TRIAL_CREDIT_CAP, formatCredits, creditsLabel } = await import('@lemlist/shared');

const net = () => Math.round(ledger.reduce((s, r) => s + Number(r.delta), 0) * 10) / 10;
const reset = () => { ledger = []; usage = []; spendArgs = []; icyCalls = []; outOfCredits = false; };
const settle = () => new Promise((r) => setTimeout(r, 0));

console.log('\nEvery plan has a ceiling');
{
  is('no plan is unlimited', Object.values(PLANS).every((p) => p.prospectCredits >= 0));
  is('Starter is 250 and Growth 1,000', PLANS.starter.prospectCredits === 250 && PLANS.growth.prospectCredits === 1000);
  subscription = null;
  is('no subscription is Free: 25', (await billingService.getCreditAllowance(USER)) === 25);
  subscription = { plan: 'growth', status: 'trialing' };
  is(`a Growth trial gets ${TRIAL_CREDIT_CAP}`, (await billingService.getCreditAllowance(USER)) === TRIAL_CREDIT_CAP);
  is('and says it is capped', await billingService.isTrialCapped(USER));
  subscription = { plan: 'growth', status: 'active' };
  is('a paying Growth gets 1,000', (await billingService.getCreditAllowance(USER)) === 1000);
  subscription = { plan: 'lifetime', status: 'free' };
  is('Lifetime gets 1,000, not unlimited', (await billingService.getCreditAllowance(USER)) === 1000);
  subscription = { plan: 'scale', status: 'active', credit_allowance: 7500 };
  is('a hand-set allowance wins', (await billingService.getCreditAllowance(USER)) === 7500);
  subscription = { plan: 'growth', status: 'past_due' };
  is('an unpaid Growth drops to Free', (await billingService.getCreditAllowance(USER)) === 25);
  subscription = { plan: 'starter', status: 'active' };
}

console.log('\nWhat an Icypeas call burned');
{
  is('25 people is 0.5', Math.abs(icypeasCallCredits('/find-people', { leads: Array(25).fill({}) }) - 0.5) < 1e-9);
  is('a count is free', icypeasCallCredits('/find-people/count', { total: 9 }) === 0);
  is('a LinkedIn URL found is 1', icypeasCallCredits('/url-search/profile', { status: 'FOUND', item: { url: 'https://linkedin.com/in/x' } }) === 1);
  is('none found is free', icypeasCallCredits('/url-search/profile', { status: 'NOT_FOUND' }) === 0);
  is('a profile read is 1.5', icypeasCallCredits('/scrape/profile?url=x', { success: true, data: { firstname: 'A' } }) === 1.5);
  is('a company read is 0.5', icypeasCallCredits('/scrape/company?url=x', { success: true, data: { name: 'A' } }) === 0.5);
}

console.log('\nA search page costs credits only when Icypeas is paid');
{
  reset();
  handler = peopleHandler(230);
  const f = { titles: ['CTO'] };
  const p1 = await prospectingService.search(USER, f, 1);
  await settle();
  is('page 1 shows 25 people', p1.results.length === 25);
  is('and costs 0.5 credit', spendArgs.length === 1 && spendArgs[0].p_amount === CREDIT_PRICES.search && spendArgs[0].p_action === 'search', JSON.stringify(spendArgs));
  is('logged against the account as a search', usage.length === 1 && usage[0].user_id === USER && usage[0].action === 'search' && usage[0].provider_credits === 0.5, JSON.stringify(usage));

  spendArgs = []; icyCalls = [];
  await prospectingService.search(USER, f, 1);
  is('the same page again is free', spendArgs.length === 0 && icyCalls.length === 0);

  spendArgs = [];
  await prospectingService.search(USER, f, 3);
  is('jumping to page 3 pays for pages 2 and 3', spendArgs.length === 1 && spendArgs[0].p_amount === 1, JSON.stringify(spendArgs));

  reset();
  handler = peopleHandler(0);
  const empty = await prospectingService.search(USER, { titles: ['Nobody'] }, 1);
  is('an empty search is refunded', empty.results.length === 0 && net() === 0, `net ${net()}`);

  reset();
  handler = () => ({ __status: 500, message: 'down' });
  try {
    await prospectingService.search(USER, { titles: ['Down'] }, 1);
    is('a failed search throws', false);
  } catch {
    is('a failed search is refunded', net() === 0 && ledger.some((r) => r.kind === 'refund' && r.reason === 'provider_error'));
  }
}

console.log('\nOut of credits, nothing paid runs');
{
  reset();
  outOfCredits = true;
  handler = peopleHandler(230);
  try {
    await prospectingService.search(USER, { titles: ['CFO'] }, 1);
    is('the search is refused', false);
  } catch (e: any) {
    is('the search is refused with a 403', e?.statusCode === 403, String(e?.message));
    is('and Icypeas is never called', icyCalls.length === 0);
  }
  try {
    await prospectingService.reveal(USER, { provider: 'icypeas', provider_person_id: 'p1', person: { first_name: 'F', last_name: 'L', company_domain: 'acme.com' } });
    is('the reveal is refused', false);
  } catch (e: any) {
    is('the reveal is refused with a 403', e?.statusCode === 403);
    is('and no email search runs', !icyCalls.includes('/email-search'));
  }
}

console.log('\nA found email is logged as a reveal');
{
  reset();
  handler = (path) => path === '/email-search'
    ? { success: true, item: { _id: 's', status: 'NONE' } }
    : { success: true, item: { _id: 's', status: 'NOT_FOUND' } };
  const { icypeasPolling } = await import('../src/services/prospect-providers.js');
  icypeasPolling.delaysMs = [0, 0];
  const r = await prospectingService.reveal(USER, { provider: 'icypeas', provider_person_id: 'p9', person: { first_name: 'F', last_name: 'L', company_domain: 'acme.com' } });
  await settle();
  is('not found is refunded', r.found === false && net() === 0);
  is('and nothing is logged, since Icypeas does not charge for it', usage.length === 0, JSON.stringify(usage));
}

console.log('\nA busy month is counted in full');
{
  reset();
  subscription = { plan: 'growth', status: 'active' };
  // 1,500 search pages: past the 1,000 rows one read returns.
  for (let i = 0; i < 1500; i++) ledger.push({ id: `s${i}`, user_id: USER, delta: -0.5, kind: 'spend', bucket: 'plan', action: 'search', reason: 'search' });
  const { creditsService } = await import('../src/services/credits.service.js');
  const sum = await creditsService.summary(USER);
  is('every spend counts: 750 used, 250 left', sum.used === 750 && sum.remaining === 250, JSON.stringify(sum));
  const rep = await creditsService.report(USER);
  is('and the month by action adds up the same', rep.by_action[0]?.credits === 750 && rep.by_action[0]?.count === 1500, JSON.stringify(rep.by_action));

  ledger.push({ id: 'adj', user_id: USER, delta: 50, kind: 'adjustment', bucket: 'purchased', action: 'adjustment', reason: 'Owner-only note about this account' });
  const after = await creditsService.report(USER);
  is('given credits are spendable', after.credits.purchased === 50 && after.credits.remaining === 300);
  is('but the owner\'s note on them never reaches the account', !JSON.stringify(after).includes('Owner-only note'));
}

console.log('\nCredits read as people write them');
{
  is('0.5 stays 0.5', formatCredits(0.5) === '0.5');
  is('float noise is rounded', formatCredits(0.1 + 0.2) === '0.3');
  is('one is singular', creditsLabel(1) === '1 credit' && creditsLabel(2) === '2 credits' && creditsLabel(0.5) === '0.5 credits');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
