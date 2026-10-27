/*
 * Prospector -> lead list -> campaign.
 *
 * Pins down what the upgraded Prospector promises:
 *
 *   - every Icypeas filter in the advanced panel reaches the query under
 *     its own name: include/exclude lists, ranges, growth; unknown keys and
 *     empty filters never go out (Icypeas rejects both)
 *   - excludes merge with the main panel's includes for the same field
 *   - a saved lead records the search that found it, for the Leads page
 *   - saving into a list enrols the lead into the campaigns on that list,
 *     and a standing search (which verifies first) can opt out of that
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

const { icypeasQuery } = await import('../src/services/prospect-providers.js');
const { describeProspectSearch, countAdvancedFilters, PROSPECT_FILTER_FIELDS } = await import('@lemlist/shared');

console.log('\nAdvanced filters reach Icypeas');
{
  const q = icypeasQuery({
    titles: ['CMO'],
    advanced: {
      currentJobTitle: { exclude: ['Assistant'] },
      skills: { include: ['Shopify', ' '], exclude: [] },
      pastCompanyName: { include: ['HubSpot'] },
      school: { include: [] },
      totalYearsOfExperience: { min: 5, max: null },
      'currentCompany.revenue': { min: null, max: null },
      'currentCompany.headcountGrowth': { timespan: '6months', min: 20, max: 99999 },
      notARealField: { include: ['x'] },
    } as any,
  });
  is('an exclude merges with the main panel include', JSON.stringify(q.currentJobTitle) === JSON.stringify({ include: ['CMO'], exclude: ['Assistant'] }), JSON.stringify(q.currentJobTitle));
  is('a text filter keeps only real values', JSON.stringify(q.skills) === JSON.stringify({ include: ['Shopify'] }), JSON.stringify(q.skills));
  is('past roles are sent', JSON.stringify(q.pastCompanyName) === JSON.stringify({ include: ['HubSpot'] }));
  is('an empty text filter is left off', !('school' in q));
  is('a range becomes >= / <=', JSON.stringify(q.totalYearsOfExperience) === JSON.stringify({ '>=': 5 }), JSON.stringify(q.totalYearsOfExperience));
  is('a range with no bounds is left off', !('currentCompany.revenue' in q));
  is('growth keeps its period and is clamped', JSON.stringify(q['currentCompany.headcountGrowth']) === JSON.stringify({ timespan: '6months', min: 20, max: 10000 }), JSON.stringify(q['currentCompany.headcountGrowth']));
  is('an unknown key never goes out', !('notARealField' in q));
  is('a bad growth period falls back to 12 months',
    icypeasQuery({ advanced: { 'pastCompany.headcountGrowth': { timespan: 'forever', min: 1 } as any } })['pastCompany.headcountGrowth']?.timespan === '12months');
  is('ids and URNs are not offered', !PROSPECT_FILTER_FIELDS.some((f) => /Id$|Urn$/.test(f.key)));
  is('31 filters are offered', PROSPECT_FILTER_FIELDS.length === 31, String(PROSPECT_FILTER_FIELDS.length));
  is('active filters are counted', countAdvancedFilters({ a: { include: ['x'] }, b: { include: [] }, c: { min: 3 } }) === 2);
}

console.log('\nWhere a lead came from');
{
  is('a search is summarised', describeProspectSearch({ titles: ['CMO'], locations: ['London'] }) === 'Prospector: CMO · London');
  is('long searches say how much more', describeProspectSearch({ titles: ['A', 'B', 'C'], locations: ['D', 'E'], advanced: { skills: { include: ['x'] } } }) === 'Prospector: A · B · C · D +2 more');
  is('no search is still labelled', describeProspectSearch({}) === 'Prospector');
}

/* ── A successful reveal against a fake database ────────────────────── */

const USER = '00000000-0000-0000-0000-0000000000b2';
const writes: { table: string; row: any }[] = [];
const ledger: any[] = [];

function from(name: string): any {
  let single = false;
  const run = () => {
    if (name === 'prospect_credit_ledger') return { data: ledger, error: null };
    if (name === 'campaigns') return { data: [{ id: 'camp-1', name: 'Q4 founders' }, { id: 'camp-2', name: 'Draft follow-up' }], error: null };
    if (name === 'contacts' && single) return { data: writes.some((w) => w.table === 'contacts') ? { id: 'contact-1' } : null, error: null };
    return { data: single ? null : [], error: null };
  };
  const chain: any = {
    select: () => chain, eq: () => chain, gte: () => chain, in: () => chain, not: () => chain,
    maybeSingle: () => { single = true; return chain; },
    single: () => { single = true; return chain; },
    upsert: (row: any) => { writes.push({ table: name, row }); return chain; },
    update: (row: any) => { writes.push({ table: name, row }); return chain; },
    insert: (row: any) => { writes.push({ table: name, row }); return { then: (res: any) => Promise.resolve({ data: null, error: null }).then(res) }; },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = from;
(supabaseAdmin as any).rpc = async () => ({ data: [{ spent_bucket: 'plan' }], error: null });
const { billingService } = await import('../src/services/billing.service.js');
(billingService as any).getPlanId = async () => 'starter';
const { listsService } = await import('../src/services/lists.service.js');
const listed: string[] = [];
(listsService as any).addContacts = async (_u: string, listId: string) => { listed.push(listId); return { success: 1, failed: 0 }; };
const { campaignContactsService } = await import('../src/services/campaign-contacts.service.js');
const enrolled: string[] = [];
(campaignContactsService as any).add = async (campaignId: string) => {
  enrolled.push(campaignId);
  // The second campaign already has them: nothing new to report.
  return { added: campaignId === 'camp-1' ? 1 : 0, skipped: 0, total: 1, reasons: {}, skips: [] };
};
const { prospectingService } = await import('../src/services/prospecting.service.js');

// The search found an email with the lead, so no provider call is needed.
const { icypeasProvider } = await import('../src/services/prospect-providers.js');
(icypeasProvider as any).enrichEmail = async () => ({ email: 'Ana@Acme.io' });

console.log('\nSaving into a list that feeds campaigns');
{
  const res = await prospectingService.reveal(USER, {
    provider: 'icypeas', provider_person_id: 'p1',
    person: { first_name: 'Ana', last_name: 'Ruiz', company: 'Acme', company_domain: 'acme.io' },
    list_id: 'list-1',
    search: { titles: ['CMO'], locations: ['Madrid'] },
  });
  const contact = writes.find((w) => w.table === 'contacts')?.row;
  is('the lead is saved', res.found === true && res.contact_id === 'contact-1', JSON.stringify(res));
  is('it records the search that found it', contact?.import_source === 'Prospector: CMO · Madrid' && contact?.source === 'prospector', JSON.stringify(contact));
  is('and when', typeof contact?.imported_at === 'string');
  is('it goes into the chosen list', listed.includes('list-1'));
  is('and into every campaign on that list', enrolled.join() === 'camp-1,camp-2', enrolled.join());
  is('the response names only campaigns it actually joined', JSON.stringify(res.enrolled_in) === JSON.stringify([{ id: 'camp-1', name: 'Q4 founders' }]), JSON.stringify(res.enrolled_in));

  enrolled.length = 0; listed.length = 0; writes.length = 0;
  const quiet = await prospectingService.reveal(USER, {
    provider: 'icypeas', provider_person_id: 'p2', person: { first_name: 'Bo', company_domain: 'beta.io' }, list_id: 'list-1',
  }, { enrolListCampaigns: false });
  is('a standing search saves to the list without enrolling', listed.includes('list-1') && enrolled.length === 0 && (quiet.enrolled_in || []).length === 0);

  enrolled.length = 0; listed.length = 0;
  await prospectingService.reveal(USER, { provider: 'icypeas', provider_person_id: 'p3', person: { first_name: 'Cy', company_domain: 'gamma.io' } });
  is('no list means no list and no campaign', listed.length === 0 && enrolled.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0);
