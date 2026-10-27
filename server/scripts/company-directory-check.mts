/*
 * Free company directory (PDL Free Company Dataset, migration 098).
 *
 * Pins down what it promises:
 *
 *   - a dataset record becomes a row: domain from the website, filterable
 *     columns lower case, junk ids and names dropped
 *   - the Prospector's company filters become PostgREST filters that quote
 *     user text, so a comma or bracket in a name cannot break the query
 *   - the service sends those filters, refuses an unfiltered search, and
 *     reports the directory unavailable (not an error) before it is loaded
 *   - the importer reads both the CSV and the JSON file and skips companies
 *     nobody could email
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const { normalizeCompanyRecord, domainFromWebsite, companyDirectoryQuery } = await import('../src/services/company-directory.js');

console.log('\nA dataset record becomes a row');
const row = normalizeCompanyRecord({
  id: 'abc123', name: 'Acme Analytics', website: 'https://www.Acme.io/about', linkedin_url: 'linkedin.com/company/acme',
  founded: '2014', size: '11-50', industry: 'Computer Software', country: 'United Kingdom', region: 'England', locality: 'London',
});
is('domain is the bare host', row?.domain === 'acme.io', JSON.stringify(row));
is('linkedin gets a scheme', row?.linkedin_url === 'https://linkedin.com/company/acme');
is('founded is a number', row?.founded === 2014);
is('filterable columns are lower case', row?.industry === 'computer software' && row?.country === 'united kingdom' && row?.locality === 'london');
is('the name keeps its case', row?.name === 'Acme Analytics');
is('no id is unusable', normalizeCompanyRecord({ name: 'x' }) === null);
is('no name is unusable', normalizeCompanyRecord({ id: '1', name: '  ' }) === null);
is('"null" text is empty', normalizeCompanyRecord({ id: '1', name: 'X', website: 'null', founded: 'null' })?.domain === null);
is('a website that is not a host is no domain', domainFromWebsite('not a site') === null);

console.log('\nFilters become PostgREST filters');
const q = companyDirectoryQuery({
  companies: ['acme.io', 'Smith, Jones (UK)'],
  locations: ['UK', 'London'],
  industries: ['Computer Software'],
  companySizes: ['11-50'],
});
is('a domain matches exactly', q.companyOr?.includes('domain.in.("acme.io")') === true, q.companyOr || '');
is('a name is a quoted prefix match', q.companyOr?.includes('name_key.like."smith, jones (uk)*"') === true, q.companyOr || '');
is('UK also searches united kingdom', q.locationOr?.includes('"united kingdom"') === true && q.locationOr?.includes('"uk"') === true, q.locationOr || '');
is('a location matches country, region or city', /^country\.in\.\(.*\),region\.in\.\(.*\),locality\.in\.\(.*\)$/.test(q.locationOr || ''));
is('industries are lower case', q.industries[0] === 'computer software');
is('quotes and wildcards are dropped', companyDirectoryQuery({ companies: ['a"b*%c'] }).companyOr === 'name_key.like."abc*"');
is('no filters is no query', companyDirectoryQuery({}).companyOr === null && companyDirectoryQuery({}).locationOr === null);

console.log('\nThe service');
const requests: string[] = [];
let respond: (url: string) => Response = () => new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } });
globalThis.fetch = (async (input: any) => {
  const url = typeof input === 'string' ? input : input.url;
  requests.push(decodeURIComponent(url));
  return respond(url);
}) as any;
const { companyDirectoryService } = await import('../src/services/company-directory.service.js');

respond = () => new Response(JSON.stringify({ message: 'relation "company_directory" does not exist' }), { status: 404 });
const status = await companyDirectoryService.status();
is('before migration 098 the directory is unavailable, not an error', status.available === false && status.companies === 0);

let refused = false;
try { await companyDirectoryService.search({}, 1); } catch (e: any) { refused = /filter/.test(e.message); }
is('an unfiltered search is refused', refused);

respond = () => new Response(JSON.stringify([{ id: '1', name: 'Acme', domain: 'acme.io' }]), {
  status: 200, headers: { 'content-type': 'application/json', 'content-range': '25-25/1234' },
});
requests.length = 0;
const res = await companyDirectoryService.search({ industries: ['Computer Software'], companySizes: ['11-50'], locations: ['London'] }, 2);
const sent = requests[0] || '';
is('it queries company_directory', sent.includes('/rest/v1/company_directory'), sent);
const plain = sent.replace(/\+/g, ' ').replace(/"/g, '');
is('industry and size are sent', plain.includes('industry=in.(computer software)') && plain.includes('size=in.(11-50)'), sent);
is('location is sent as an or', sent.includes('or=(country.in.("london")'), sent);
is('results come back with the total', res.results.length === 1 && res.total === 1234 && res.page === 2, JSON.stringify(res));

console.log('\nThe importer (dry run)');
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'companydir-'));
const csv = join(dir, 'companies.csv');
writeFileSync(csv, [
  'id,name,website,linkedin_url,founded,size,industry,country,region,locality',
  '1,Acme,acme.io,,2014,11-50,computer software,united kingdom,england,london',
  '2,"Smith, Jones",smithjones.co.uk,,,1-10,law practice,united kingdom,england,leeds',
  '3,No Site Ltd,,,,1-10,retail,united states,,',
  ',Missing Id,x.com,,,,,,,',
].join('\n'));
const json = join(dir, 'companies.json');
writeFileSync(json, [
  JSON.stringify({ id: '1', name: 'Acme', website: 'acme.io', country: 'united kingdom' }),
  JSON.stringify({ id: '2', name: 'Beta', website: 'beta.com', country: 'united states' }),
].join('\n'));
const run = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', join(here, 'import-company-directory.mts'), ...args], { encoding: 'utf8', cwd: join(here, '..') });
const loaded = (out: string) => Number(/would load\s+([\d,]+)/.exec(out.split('Done')[1] || '')?.[1]?.replace(/,/g, '') ?? -1);
const csvOut = run(csv, '--dry-run');
is('CSV: rows with a website load, one with no website and one with no id do not', loaded(csvOut) === 2, csvOut);
is('--keep-no-domain loads the one with no website too', loaded(run(csv, '--dry-run', '--keep-no-domain')) === 3);
is('JSON lines load', loaded(run(json, '--dry-run')) === 2);
is('--countries narrows it', loaded(run(json, '--dry-run', '--countries=united states')) === 1);

console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0);
