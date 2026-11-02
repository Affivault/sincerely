/* ═══════════════════════════════════════════════════════════════════════
   Import and export: what other tools send, and what comes back out.

   Written from a real export (a "residential property owners" list from
   a lead tool) that imported badly: Job position became a custom field,
   Country took the Location slot from Location, the company's city was
   filed as the person's, LinkedIn arrived twice, and Company size,
   industry, LinkedIn and HQ phone had nowhere to go. The fixtures below
   use that file's exact header row with made-up people.

   The other layouts are the common exports (Apollo, HubSpot, Sales
   Navigator tools), and Sincerely's own export, which must import back
   in with nothing to map.

   Run: npx tsx scripts/import-export-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  planImport, prepareImport, headerSignature, sourceSaysInvalid, splitTags, mappingProblems,
  buildContactExport, EXPORT_PRESETS, resolveExportColumns, verificationLabel, toCsv,
} from '@lemlist/shared';

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function is(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`); }
}

console.log('\nthe lead-tool export that started this');
{
  const headers = ['Email', 'Email status', 'First name', 'Last name', 'Full name', 'User social', 'LinkedIn', 'Job position', 'Country', 'Location', 'Industry', 'Add date', 'Company name', 'Company URL', 'Company social', 'Company size', "Company's country", 'Company location', 'State', 'City', 'Company industry', 'HQ phone', 'Phone'];
  const row = (o: Record<string, string>) => Object.fromEntries(headers.map((h) => [h, o[h] ?? '']));
  const rows = [
    row({ Email: '', 'First name': 'Ivo', 'Last name': 'Marr', 'Full name': 'Ivo Marr', 'User social': 'https://www.linkedin.com/in/ivo-marr-1', LinkedIn: 'https://www.linkedin.com/in/ivo-marr-1', 'Job position': 'Co-Owner | Buy-to-Let Portfolio', Country: 'United Kingdom', Location: 'London Area, United Kingdom', 'Add date': '2026-10-28 23:30:19', 'Company name': 'Marr Properties', 'Company social': 'https://www.linkedin.com/company/1001', 'Company size': '11-50', "Company's country": 'United Kingdom', 'Company location': 'London, United Kingdom', City: 'London', 'Company industry': 'Real Estate' }),
    row({ Email: 'tess.olu@example-lets.com', 'Email status': 'unknown', 'First name': 'Tess', 'Last name': 'Olu', 'Full name': 'Tess Olu', 'User social': 'https://www.linkedin.com/in/tess-olu-2', LinkedIn: 'https://www.linkedin.com/in/tess-olu-2', 'Job position': 'Buy to Let Owner', Country: 'United Kingdom', Location: 'Ilford, England, United Kingdom', Industry: 'Hospitality', 'Add date': '2026-10-28 23:30:19', 'Company name': 'Olu Lets', 'Company URL': 'http://www.example-lets.com', 'Company social': 'https://www.linkedin.com/company/1002', "Company's country": 'United Kingdom', 'Company location': 'Cardiff, United Kingdom', City: 'Cardiff' }),
  ];
  const plan = planImport(headers, rows);
  const m = plan.mapping;
  const expect: Record<string, string> = {
    Email: 'email', 'Email status': 'email_status', 'First name': 'first_name', 'Last name': 'last_name',
    LinkedIn: 'linkedin_url', 'Job position': 'job_title', Country: 'country', Location: 'location', Industry: 'industry',
    'Company name': 'company', 'Company URL': 'company_website', 'Company social': 'company_linkedin', 'Company size': 'company_size',
    'Company location': 'company_location', 'Company industry': 'company_industry', 'HQ phone': 'company_phone', Phone: 'phone', State: 'state',
  };
  for (const [h, t] of Object.entries(expect)) is(`"${h}" -> ${t}`, m[h] === t, `got ${m[h]}`);
  for (const h of ['Full name', 'User social', 'Add date', "Company's country", 'City']) {
    is(`"${h}" skipped, with a reason`, m[h] === '' && !!plan.notes[h], `got ${m[h]} / ${plan.notes[h]}`);
  }
  is('nothing left as a custom field', !Object.values(m).includes('__custom__'), JSON.stringify(m));
  is('confident', plan.confident);

  const out = prepareImport(rows, m);
  const tess = out.contacts[0];
  is('one importable person', out.contacts.length === 1);
  is('the person with no email is set aside whole, with why', out.setAside.length === 1 && out.setAside[0].reason === 'no_email' && out.setAside[0].row['First name'] === 'Ivo' && /LinkedIn/.test(out.setAside[0].detail));
  is('and counted as worth finding an email for', out.blankWithLinkedin === 1);
  is('company details travel with the row', tess.company_linkedin === 'https://www.linkedin.com/company/1002' && tess.company_location === 'Cardiff, United Kingdom' && tess.company_website === 'http://www.example-lets.com');
  is('the old verdict is kept, as a custom field', tess.custom_fields?.['Email status'] === 'unknown');
  is('"unknown" is not a reason to leave someone out', out.flagged === 0);
}

console.log('\nother tools');
{
  const apollo = ['First Name', 'Last Name', 'Title', 'Company', 'Company Name for Emails', 'Email', 'Email Status', 'Email Sent', '# Employees', 'Industry', 'Person Linkedin Url', 'Website', 'Company Linkedin Url', 'City', 'State', 'Country', 'Corporate Phone', 'Mobile Phone', 'Apollo Contact Id'];
  const rows = [Object.fromEntries(apollo.map((h) => [h, '']))];
  Object.assign(rows[0], { Email: 'a@acme.io', 'Email Sent': 'TRUE', 'Person Linkedin Url': 'http://www.linkedin.com/in/a', 'Company Linkedin Url': 'http://www.linkedin.com/company/acme', Company: 'Acme', 'Company Name for Emails': 'Acme' });
  const m = planImport(apollo, rows).mapping;
  is('Apollo: Title is the job title', m.Title === 'job_title');
  is('Apollo: "Email Sent: TRUE" is not the email', m['Email Sent'] !== 'email' && m.Email === 'email', JSON.stringify(m));
  is('Apollo: # Employees is company size', m['# Employees'] === 'company_size');
  is('Apollo: person and company LinkedIn told apart', m['Person Linkedin Url'] === 'linkedin_url' && m['Company Linkedin Url'] === 'company_linkedin');
  is('Apollo: Corporate Phone is the company phone, Mobile the person', m['Corporate Phone'] === 'company_phone' && m['Mobile Phone'] === 'phone');
  is('Apollo: ids are skipped', m['Apollo Contact Id'] === '');
  is('Apollo: the second company name repeats the first and is skipped', m['Company Name for Emails'] === '');

  const hub = ['Record ID', 'First Name', 'Last Name', 'Email', 'Phone Number', 'Company Name', 'Job Title', 'Website URL', 'City', 'State/Region', 'Country/Region', 'Create Date'];
  const hm = planImport(hub, [Object.fromEntries(hub.map((h) => [h, h === 'Email' ? 'x@y.co' : '']))]).mapping;
  is('HubSpot: State/Region and Country/Region', hm['State/Region'] === 'state' && hm['Country/Region'] === 'country');
  is('HubSpot: Record ID and Create Date skipped', hm['Record ID'] === '' && hm['Create Date'] === '');
  is('HubSpot: Website URL is the website', hm['Website URL'] === 'website');

  const nav = ['Full Name', 'Profile URL', 'Headline', 'Current Company', 'Email'];
  const nm = planImport(nav, [{ 'Full Name': 'Ada L', 'Profile URL': 'https://www.linkedin.com/in/ada', Headline: 'CTO', 'Current Company': 'Analytical', Email: 'ada@a.io' }]).mapping;
  is('Sales Navigator: a Profile URL of linkedin.com/in links is the LinkedIn', nm['Profile URL'] === 'linkedin_url', JSON.stringify(nm));
  is('Sales Navigator: Current Company is the company', nm['Current Company'] === 'company');
}

console.log('\nflags from the old tool');
{
  const headers = ['Email', 'Verification', 'Unsubscribed', 'Tags'];
  const rows = [
    { Email: 'a@a.io', Verification: 'Valid', Unsubscribed: 'No', Tags: 'VIP, london; vip' },
    { Email: 'b@b.io', Verification: 'Invalid', Unsubscribed: 'No', Tags: '' },
    { Email: 'c@c.io', Verification: 'catch-all', Unsubscribed: 'Yes', Tags: '' },
  ];
  const plan = planImport(headers, rows);
  is('status, unsubscribed and tags columns are recognised', plan.mapping.Verification === 'email_status' && plan.mapping.Unsubscribed === 'do_not_contact' && plan.mapping.Tags === 'tags', JSON.stringify(plan.mapping));
  const out = prepareImport(rows, plan.mapping);
  is('invalid and unsubscribed are left out by default', out.contacts.length === 1 && out.flagged === 2);
  is('and can be kept on purpose', prepareImport(rows, plan.mapping, { skipFlagged: false }).contacts.length === 3);
  is('tags are split and de-duplicated, case-blind', JSON.stringify(out.contacts[0].tags) === JSON.stringify(['VIP', 'london']));
  is('only a clear verdict counts as invalid', sourceSaysInvalid('undeliverable') && !sourceSaysInvalid('risky') && !sourceSaysInvalid('unknown'));
  is('tag lists stop at twenty', splitTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(',')).length === 20);
}

console.log('\nsaved mappings key on the layout, not the order');
{
  is('same columns in another order and casing match', headerSignature(['Email', 'First name']) === headerSignature(['first name', 'EMAIL']));
  is('different columns do not', headerSignature(['Email']) !== headerSignature(['Email', 'Phone']));
}

console.log('\nexport');
{
  const rows = [{
    email: 'ada@a.io', first_name: 'Ada', last_name: 'Lovelace', company: '=HYPERLINK("x")', lifecycle: 'prospect',
    is_unsubscribed: false, is_bounced: false, dcs_verified_at: '2026-01-01', dcs_score: 90, dcs_syntax_ok: true, dcs_domain_ok: true,
    created_at: '2026-01-02T10:00:00Z', custom_fields: { Email: 'clash', Notes: 'met at expo' }, tag_names: ['VIP'], list_names: ['Q3'],
    company_rec: { website: 'a.io', size: '11-50' },
  }];
  const sheet = buildContactExport(rows, resolveExportColumns());
  is('plain labels, not column names', sheet.header[0] === 'Email' && sheet.header.includes('First name') && !sheet.header.includes('first_name'));
  is('a custom field named like a real column is prefixed, not lost', sheet.header.includes('Custom: Email') && sheet.header.includes('Notes'));
  is('tags, lists and company details are in it', sheet.rows[0].includes('VIP') && sheet.rows[0].includes('Q3') && sheet.rows[0].includes('11-50'));
  is('verification in words', sheet.rows[0].includes('Valid') && verificationLabel({ is_bounced: true }) === 'Invalid' && verificationLabel({}) === 'Unverified');
  is('the CSV neutralises formulas', toCsv(sheet.header, sheet.rows).includes(`"'=HYPERLINK(""x"")"`));
  is('unknown column keys are ignored', resolveExportColumns(['email', 'user_id']).join() === 'email');

  // Round trip: what Sincerely exports, Sincerely imports with nothing to map.
  const everything = buildContactExport(rows, EXPORT_PRESETS.find((p) => p.id === 'everything')!.columns);
  const back = planImport(everything.header, everything.rows.map((r) => Object.fromEntries(everything.header.map((h, i) => [h, String(r[i] ?? '')]))));
  is('an export imports back in confidently', back.confident && mappingProblems(back.mapping).length === 0);
  for (const h of ['Lists', 'Lifecycle', 'Source', 'Imported from', 'Added']) {
    is(`"${h}" is skipped on the way back in`, back.mapping[h] === '', `got ${back.mapping[h]}`);
  }
  for (const [h, t] of [['Company website', 'company_website'], ['Company LinkedIn', 'company_linkedin'], ['Company phone', 'company_phone'], ['Email status', 'email_status'], ['Bounced', 'do_not_contact'], ['Tags', 'tags']] as const) {
    is(`"${h}" maps back to ${t}`, back.mapping[h] === t, `got ${back.mapping[h]}`);
  }
}

console.log('\nthe database side');
{
  const sql = readFileSync(join(here, '../../supabase/migrations/109_import_export_fields.sql'), 'utf8');
  is('migration 109 is pure ASCII', !/[^\x00-\x7F]/.test(sql));
  is('and has no BEGIN/COMMIT of its own', !/^\s*(BEGIN|COMMIT)\s*;/im.test(sql));
  is('the merge takes a mode', /import_contacts_merge\(p_user_id uuid, p_rows jsonb, p_mode text DEFAULT 'fill'\)/.test(sql));
  is('the old signature is dropped, not overloaded', /DROP FUNCTION IF EXISTS import_contacts_merge\(uuid, jsonb\)/.test(sql));
  is('blank cells never blank a stored value, even when overwriting', /WHEN 'overwrite' THEN COALESCE\(EXCLUDED\.first_name, c\.first_name\)/.test(sql));
  const svc = readFileSync(join(here, '../src/services/contacts.service.ts'), 'utf8');
  is('the service sends the mode, and falls back before 109 is run', /p_mode: mode/.test(svc) && /run migration 109/.test(svc));
  is('export and list share one filter', (svc.match(/applyContactFilters\(/g) || []).length >= 3);
}

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, `${failed} import/export check(s) failed`);
