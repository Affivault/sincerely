/*
 * Icypeas prospect provider.
 *
 * Drives the real adapter against a stubbed fetch, and the real reveal flow
 * against a fake database, and pins down what it promises:
 *
 *   - our neutral filters become Icypeas's include/range query
 *   - a lead becomes a ProspectPerson, whichever spelling the fields use
 *   - page numbers are cut from token-chained chunks, without re-fetching
 *   - the email finder polls until it settles; not found is null, a dead
 *     account or a stuck search throws
 *   - Icypeas wins, then PDL; Apollo never runs without its opt-in flag
 *   - a reveal that finds nothing, or fails, refunds the credit it spent
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

type Call = { path: string; body: any; auth: string | null };
let calls: Call[] = [];
let handler: (path: string, body: any) => any = () => ({ success: true });

(globalThis as any).fetch = async (url: string, init: any) => {
  const path = String(url).replace('https://app.icypeas.com/api', '');
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ path, body, auth: init?.headers?.Authorization ?? null });
  const out = handler(path, body);
  const status = out?.__status ?? 200;
  return {
    ok: status < 400, status, statusText: 'x',
    json: async () => out,
  } as any;
};

const { env } = await import('../src/config/env.js');
const providers = await import('../src/services/prospect-providers.js');
const { icypeasQuery, icypeasLeadToProspect, icypeasEmailFromItem, icypeasProvider, icypeasPolling, getActiveProvider } = providers;
icypeasPolling.delaysMs = [0, 0, 0, 0];

console.log('\nFilters to an Icypeas query');
{
  const q = icypeasQuery({
    titles: ['Head of Growth', ' CMO '],
    seniorities: ['vp'],
    locations: ['US', 'Paris, France'],
    industries: ['Software Development'],
    companies: ['Acme Inc', 'https://www.stripe.com/about', 'notion.so'],
    companySizes: ['11-50', '201-500'],
    keywords: '  outbound  ',
  });
  is('titles become currentJobTitle', JSON.stringify(q.currentJobTitle) === JSON.stringify({ include: ['Head of Growth', 'CMO'] }));
  is('a seniority does not widen explicit titles', !q.currentJobTitle.include.includes('VP'));
  is('locations pass through', JSON.stringify(q.location?.include) === JSON.stringify(['US', 'Paris, France']));
  is('industry is the current company\'s', q['currentCompany.industry']?.include[0] === 'Software Development');
  is('names go to currentCompanyName', JSON.stringify(q.currentCompanyName?.include) === JSON.stringify(['Acme Inc']));
  is('domains go to currentCompanyWebsite, bare', JSON.stringify(q.currentCompanyWebsite?.include) === JSON.stringify(['stripe.com', 'notion.so']));
  is('size buckets become one spanning range', JSON.stringify(q['currentCompany.headcount']) === JSON.stringify({ '>=': 11, '<=': 500 }));
  is('keywords are trimmed', q.keyword?.include[0] === 'outbound');

  const s = icypeasQuery({ seniorities: ['c_suite', 'director'] });
  is('seniority alone becomes titles', s.currentJobTitle.include.includes('CEO') && s.currentJobTitle.include.includes('Director'));
  is('empty filters are left out', Object.keys(icypeasQuery({ titles: [' '], locations: [] })).length === 0);
  is('an open-ended size has no ceiling', JSON.stringify(icypeasQuery({ companySizes: ['10001+'] })['currentCompany.headcount']) === JSON.stringify({ '>=': 10001 }));
}

console.log('\nA lead to a prospect');
{
  const p = icypeasLeadToProspect({
    _id: 'lead-1', firstname: 'Ada', lastname: 'Lovelace', lastJobTitle: 'CTO',
    lastCompanyName: 'Analytical', lastCompanyWebsite: 'https://www.analytical.io/', address: 'London, UK',
    profileUrl: 'linkedin.com/in/ada',
  });
  is('id is the lead id', p.id === 'lead-1');
  is('provider is icypeas', p.provider === 'icypeas');
  is('names and title', p.full_name === 'Ada Lovelace' && p.job_title === 'CTO');
  is('company and bare domain', p.company === 'Analytical' && p.company_domain === 'analytical.io');
  is('linkedin gets a scheme', p.linkedin_url === 'https://linkedin.com/in/ada');
  is('location', p.location === 'London, UK');

  const nested = icypeasLeadToProspect({
    firstName: 'Grace', lastName: 'Hopper', url: 'https://linkedin.com/in/grace',
    experiences: [{ title: 'Admiral', companyName: 'Navy', companyWebsite: 'navy.mil' }],
  });
  is('camelCase and nested experience are read', nested.first_name === 'Grace' && nested.job_title === 'Admiral' && nested.company === 'Navy' && nested.company_domain === 'navy.mil');
  is('no id falls back to the profile URL', nested.id === 'https://linkedin.com/in/grace');
  is('an empty lead still has a name', icypeasLeadToProspect({}).full_name === 'Unknown');
}

console.log('\nSearch pages from chunks');
{
  const lead = (i: number) => ({ _id: `p${i}`, firstname: `F${i}`, lastname: 'L', lastCompanyWebsite: 'acme.com' });
  handler = (path, body) => {
    if (path !== '/find-people') return { success: true };
    const chunk = body.pagination?.token === 't2' ? 2 : body.pagination?.token === 't3' ? 3 : 1;
    const count = chunk === 3 ? 30 : 100;
    return {
      success: true, total: 230,
      leads: Array.from({ length: count }, (_, i) => lead((chunk - 1) * 100 + i)),
      pagination: { size: 100, token: chunk === 1 ? 't2' : chunk === 2 ? 't3' : 'tx' },
    };
  };
  calls = [];
  const f = { titles: ['CTO'] };
  const p1 = await icypeasProvider.search(f, 1, 25);
  is('page 1 is the first 25', p1.results.length === 25 && p1.results[0].id === 'p0' && p1.results[24].id === 'p24');
  is('the first page is asked for without pagination', calls.length === 1 && calls[0].body.pagination === undefined);
  is('the key is sent bare', calls[0].auth === 'icy-test-key');
  is('total is Icypeas\'s', p1.total === 230);
  is('search never yields emails', p1.emailsById.size === 0);

  calls = [];
  const p2 = await icypeasProvider.search(f, 2, 25);
  is('page 2 comes from the cached chunk', calls.length === 0 && p2.results[0].id === 'p25');

  calls = [];
  const p5 = await icypeasProvider.search(f, 5, 25);
  is('page 5 follows the token', calls.length === 1 && calls[0].body.pagination?.token === 't2' && p5.results[0].id === 'p100');
  is('the query is unchanged between pages', JSON.stringify(calls[0].body.query) === JSON.stringify({ currentJobTitle: { include: ['CTO'] } }));

  calls = [];
  const p10 = await icypeasProvider.search(f, 10, 25);
  is('a short last chunk ends the results', p10.results.length === 5 && p10.results[0].id === 'p225');
  const p11 = await icypeasProvider.search(f, 11, 25);
  is('past the end is empty, not a loop', p11.results.length === 0 && calls.length === 1);

  calls = [];
  await icypeasProvider.search({ titles: ['CFO'] }, 9, 25);
  is('a jump walks forward through the chunks', calls.map((c) => c.body.pagination?.token ?? '-').join() === '-,t2,t3');
}

console.log('\nThe email finder');
{
  const statuses = ['NONE', 'IN_PROGRESS', 'DEBITED'];
  handler = (path, body) => {
    if (path === '/email-search') return { success: true, item: { _id: 'search-1', status: 'NONE' } };
    if (path === '/bulk-single-searchs/read') {
      const status = statuses.shift() || 'DEBITED';
      return { success: true, items: [{ _id: body.id, status, results: status === 'DEBITED' ? { emails: [{ email: 'ada@analytical.io', certainty: 'ultra_sure' }] } : {} }] };
    }
    return { success: true };
  };
  calls = [];
  const found = await icypeasProvider.enrichEmail('p0');
  is('a person seen in search is looked up from the server copy', calls[0]?.body?.firstname === 'F0' && calls[0]?.body?.domainOrCompany === 'acme.com');
  is('it polls until the search settles', calls.filter((c) => c.path === '/bulk-single-searchs/read').length === 3);
  is('and returns the email', found.email === 'ada@analytical.io');

  calls = [];
  await icypeasProvider.enrichEmail('never-seen', { first_name: 'Jo', last_name: 'Bloggs', company: 'Bloggs Ltd' });
  is('an unseen person falls back to the search-row snapshot', calls[0]?.body?.lastname === 'Bloggs' && calls[0]?.body?.domainOrCompany === 'Bloggs Ltd');

  calls = [];
  const blank = await icypeasProvider.enrichEmail('nobody', { full_name: 'Unknown' });
  is('nothing to search with is not found, with no call', blank.email === null && calls.length === 0);

  for (const status of ['NOT_FOUND', 'DEBITED_NOT_FOUND', 'NOT_DEBITED']) {
    handler = (path) => path === '/email-search'
      ? { success: true, item: { _id: 's', status: 'NONE' } }
      : { success: true, item: { _id: 's', status } };
    const r = await icypeasProvider.enrichEmail('p1');
    is(`${status} is not found`, r.email === null);
  }

  const throwsWith = async (label: string, re: RegExp) => {
    try { await icypeasProvider.enrichEmail('p1'); is(label, false, 'it resolved'); }
    catch (e: any) { is(label, re.test(e?.message || ''), e?.message); }
  };
  handler = (path) => path === '/email-search' ? { success: true, item: { _id: 's' } } : { success: true, item: { status: 'INSUFFICIENT_FUNDS' } };
  await throwsWith('an empty Icypeas account throws', /out of credits/);
  handler = (path) => path === '/email-search' ? { success: true, item: { _id: 's' } } : { success: true, item: { status: 'IN_PROGRESS' } };
  await throwsWith('a search that never settles throws', /too long/);
  handler = () => ({ success: false, validationErrors: [{ message: 'domainOrCompany is required' }] });
  await throwsWith('a 200 with success:false is an error', /domainOrCompany is required/);
  handler = () => ({ __status: 401, message: 'The user does not exist' });
  await throwsWith('a bad key is an error', /user does not exist/);

  is('emails under results[] are read too', icypeasEmailFromItem({ results: [{ emails: [{ email: 'x@y.io' }] }] }) === 'x@y.io');
  is('no email is null', icypeasEmailFromItem({ results: { emails: [] } }) === null);
}

console.log('\nWhich provider runs');
{
  const saved = { ...env };
  const set = (patch: Partial<typeof env>) => Object.assign(env, saved, patch);
  set({ ICYPEAS_API_KEY: 'k', PDL_API_KEY: 'k', APOLLO_API_KEY: 'k', ALLOW_APOLLO_PROVIDER: true });
  is('Icypeas is preferred', getActiveProvider()?.id === 'icypeas');
  set({ ICYPEAS_API_KEY: '', PDL_API_KEY: 'k', APOLLO_API_KEY: 'k', ALLOW_APOLLO_PROVIDER: true });
  is('then PDL', getActiveProvider()?.id === 'pdl');
  set({ ICYPEAS_API_KEY: '', PDL_API_KEY: '', APOLLO_API_KEY: 'k', ALLOW_APOLLO_PROVIDER: false });
  is('an Apollo key alone does nothing', getActiveProvider() === null);
  set({ ICYPEAS_API_KEY: '', PDL_API_KEY: '', APOLLO_API_KEY: 'k', ALLOW_APOLLO_PROVIDER: true });
  is('Apollo only with the opt-in flag', getActiveProvider()?.id === 'apollo');
  set({ ICYPEAS_API_KEY: 'icy-test-key' });
}

/* ── The reveal flow against a fake database ────────────────────────── */

const USER = '00000000-0000-0000-0000-0000000000a1';
let ledger: any[] = [];
let spends: any[] = [];

function from(name: string): any {
  const filters: Array<[string, any]> = [];
  let single = false;
  const run = () => {
    if (name === 'prospect_credit_ledger') {
      const rows = ledger.filter((r) => filters.every(([c, v]) => c === 'created_at' || r[c] === v));
      return { data: rows, error: null };
    }
    return { data: single ? null : [], error: null };
  };
  const chain: any = {
    select: () => chain,
    eq: (c: string, v: any) => { filters.push([c, v]); return chain; },
    gte: (c: string, v: any) => { filters.push([c, v]); return chain; },
    in: () => chain,
    maybeSingle: () => { single = true; return chain; },
    single: () => { single = true; return chain; },
    insert: (row: any) => {
      if (name === 'prospect_credit_ledger') ledger.push(...(Array.isArray(row) ? row : [row]));
      return { then: (res: any) => Promise.resolve({ data: null, error: null }).then(res) };
    },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = from;
(supabaseAdmin as any).rpc = async (fn: string, args: any) => {
  assert.equal(fn, 'try_spend_prospect_credits');
  spends.push(args);
  ledger.push({ user_id: USER, delta: -1, kind: 'spend', bucket: 'plan', provider: args.p_provider, provider_person_id: args.p_provider_person_id });
  return { data: [{ spent_bucket: 'plan' }], error: null };
};
const { billingService } = await import('../src/services/billing.service.js');
(billingService as any).getPlanId = async () => 'starter';
const { prospectingService } = await import('../src/services/prospecting.service.js');

console.log('\nReveal refunds');
{
  ledger = []; spends = [];
  handler = (path) => path === '/email-search'
    ? { success: true, item: { _id: 's', status: 'NONE' } }
    : { success: true, item: { _id: 's', status: 'NOT_FOUND' } };
  const r = await prospectingService.reveal(USER, {
    provider: 'icypeas', provider_person_id: 'p2', person: { first_name: 'F2', last_name: 'L', company_domain: 'acme.com' },
  });
  const refund = ledger.find((l) => l.kind === 'refund');
  is('not found says so', r.found === false && r.email === null);
  is('one credit was spent with Icypeas as provider', spends.length === 1 && spends[0].p_provider === 'icypeas');
  is('and refunded as no_email_found', refund?.reason === 'no_email_found' && refund?.delta === 1 && refund?.bucket === 'plan');
  is('so the user is net zero', ledger.reduce((s, l) => s + l.delta, 0) === 0);

  ledger = []; spends = [];
  handler = () => ({ __status: 500, message: 'upstream down' });
  try {
    await prospectingService.reveal(USER, { provider: 'icypeas', provider_person_id: 'p3' });
    is('a provider failure is an error', false, 'it resolved');
  } catch (e: any) {
    is('a provider failure is a 502', e?.statusCode === 502, `${e?.statusCode} ${e?.message}`);
  }
  const back = ledger.find((l) => l.kind === 'refund');
  is('and refunded as provider_error', back?.reason === 'provider_error' && ledger.reduce((s, l) => s + l.delta, 0) === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
