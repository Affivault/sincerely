/* ═══════════════════════════════════════════════════════════════════════
   The manual work that was taken out - kept out.

   - an ordinary CSV imports without a mapping screen, and a doubtful one
     still gets it
   - the same person twice is one contact; a bad address is set aside
   - reversible deletes wait behind the undo bar instead of a dialog
   - the launch preflight fixes what it can in place, and agrees with the
     server about when the fix was enough

   Run: npx tsx scripts/streamline-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  planImport, prepareImport, mappingProblems, splitFullName, targetFromValues, launchGate,
  blankTagsFor, previewPersonalization,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');
const server = (p: string) => readFileSync(join(here, '../src', p), 'utf8');

console.log('\nan ordinary file needs no mapping');
{
  const headers = ['Email', 'First Name', 'Last Name', 'Company', 'Title', 'LinkedIn'];
  const rows = [
    { Email: 'ada@analytical.io', 'First Name': 'Ada', 'Last Name': 'Lovelace', Company: 'Analytical', Title: 'CTO', LinkedIn: 'https://linkedin.com/in/ada' },
    { Email: 'grace@cobol.dev', 'First Name': 'Grace', 'Last Name': 'Hopper', Company: 'Cobol', Title: 'CEO', LinkedIn: '' },
  ];
  const plan = planImport(headers, rows);
  is('it is confident', plan.confident);
  is('email found', plan.emailColumn === 'Email');
  is('names, company, title, linkedin mapped',
     plan.mapping['First Name'] === 'first_name' && plan.mapping['Last Name'] === 'last_name'
     && plan.mapping.Company === 'company' && plan.mapping.Title === 'job_title' && plan.mapping.LinkedIn === 'linkedin_url',
     JSON.stringify(plan.mapping));
  is('no problems to fix', mappingProblems(plan.mapping).length === 0);
}

console.log('\ncolumns are read by what is in them, not only their names');
{
  const headers = ['Col A', 'Col B', 'Notes'];
  const rows = Array.from({ length: 10 }, (_, i) => ({
    'Col A': `person${i}@acme.com`, 'Col B': `https://www.linkedin.com/in/p${i}`, Notes: 'met at the fair',
  }));
  const plan = planImport(headers, rows);
  is('an unnamed column full of addresses is the email', plan.mapping['Col A'] === 'email' && plan.confident);
  is('an unnamed column of profile links is LinkedIn', plan.mapping['Col B'] === 'linkedin_url');
  is('anything unrecognised is kept as a custom field, not dropped', plan.mapping.Notes === '__custom__');
  is('phone numbers are spotted', targetFromValues(['+44 20 7946 0958', '(415) 555-0132', '020 7946 0000']) === 'phone');
}

console.log('\na doubtful file still gets the mapping table');
{
  const headers = ['Email', 'Name'];
  const rows = [
    { Email: 'ada@analytical.io', Name: 'Ada' },
    { Email: 'see notes', Name: 'Grace' },
    { Email: 'n/a', Name: 'Linus' },
  ];
  is('mostly-not-addresses is not confident', !planImport(headers, rows).confident);
  const oneBad = planImport(['Email'], [{ Email: 'a@b.co' }, { Email: 'c@d.co' }, { Email: 'e@f.co' }, { Email: 'oops' }]);
  is('a column named Email with one bad row is still trusted', oneBad.confident);
  const unnamedOneBad = planImport(['Col'], [{ Col: 'a@b.co' }, { Col: 'c@d.co' }, { Col: 'e@f.co' }, { Col: 'oops' }]);
  is('an unnamed one is held to a higher bar', !unnamedOneBad.confident);
  const none = planImport(['Name', 'Company'], [{ Name: 'Ada', Company: 'X' }]);
  is('no email column is not confident, and says so',
     !none.confident && mappingProblems(none.mapping).some((p) => /email/i.test(p)));
}

console.log('\ntwo email columns: the fuller one wins, the other is kept');
{
  const headers = ['Work email', 'Personal email'];
  const rows = [
    { 'Work email': '', 'Personal email': 'a@gmail.com' },
    { 'Work email': 'b@acme.com', 'Personal email': 'b@gmail.com' },
    { 'Work email': '', 'Personal email': 'c@gmail.com' },
  ];
  const plan = planImport(headers, rows);
  is('fullest column is the email', plan.mapping['Personal email'] === 'email');
  is('the other is a custom field', plan.mapping['Work email'] === '__custom__');
}

console.log('\nnames');
{
  is('"Ada Lovelace" splits', JSON.stringify(splitFullName('Ada Lovelace')) === JSON.stringify({ first: 'Ada', last: 'Lovelace' }));
  is('"Lovelace, Ada" splits the other way', splitFullName('Lovelace, Ada').first === 'Ada');
  is('"Jean Claude Van Damme" keeps the rest as the surname', splitFullName('Jean Claude Van Damme').last === 'Claude Van Damme');
  const plan = planImport(['Name', 'First name', 'Last name', 'Email'], [{ Name: 'A B', 'First name': 'A', 'Last name': 'B', Email: 'a@b.co' }]);
  is('a Name column next to first and last is not split over them', plan.mapping.Name === '__custom__');
}

console.log('\nrows are cleaned on the way in');
{
  const mapping = { Email: 'email', Name: 'full_name', Company: 'company', Tag: '__custom__' };
  const rows = [
    { Email: ' Ada@Analytical.io ', Name: 'Ada Lovelace', Company: '', Tag: 'vip' },
    { Email: 'ada@analytical.io', Name: 'Someone Else', Company: 'Analytical', Tag: 'later' },
    { Email: 'mailto:grace@cobol.dev', Name: 'Grace Hopper', Company: 'Cobol', Tag: '' },
    { Email: 'not an email', Name: 'X', Company: '', Tag: '' },
    { Email: '', Name: 'Nobody', Company: '', Tag: '' },
  ];
  const out = prepareImport(rows, mapping);
  is('two contacts', out.contacts.length === 2, JSON.stringify(out.contacts));
  is('one duplicate merged', out.duplicates === 1);
  is('one invalid set aside, with a sample', out.invalid === 1 && out.invalidSamples[0] === 'not an email');
  is('one blank skipped', out.blank === 1);
  const ada = out.contacts.find((c) => c.email === 'ada@analytical.io');
  is('addresses trimmed and lower-cased', !!ada);
  is('the first row wins a clash', ada?.first_name === 'Ada' && ada?.last_name === 'Lovelace');
  is('a later row fills only what the first left empty', ada?.company === 'Analytical');
  is('custom fields: first row wins', ada?.custom_fields?.Tag === 'vip');
  is('mailto: is stripped', out.contacts.some((c) => c.email === 'grace@cobol.dev'));
}

console.log('\nthe import page uses the plan');
{
  const page = client('pages/contacts/BulkImportPage.tsx');
  is('plans with the shared planner', /planImport\(/.test(page));
  is('prepares rows with the shared cleaner', /prepareImport\(/.test(page));
  is('the mapping table is behind "Adjust columns" when confident', /Adjust columns/.test(page));
}

console.log('\nreversible deletes wait behind the undo bar');
{
  // [file, the deferred call, the dialog title it replaced]
  const files: Array<[string, RegExp, string]> = [
    ['pages/crm/DealsPage.tsx', /gone\.removeMany\(/, 'title: `Delete ${ids.length} deal'],
    ['pages/crm/DealsPage.tsx', /gone\.remove\(/, 'title: `Delete "${form.title}"?`'],
    ['pages/crm/DealDetailPage.tsx', /gone\.remove\(/, 'title: `Delete "${deal.title}"?`'],
    ['pages/contacts/ContactsListPage.tsx', /gone\.removeMany\(/, "title: `Delete ${selectedContacts.size}"],
    ['pages/contacts/ContactsListPage.tsx', /gone\.remove\(/, "title: 'Delete this contact?'"],
    ['pages/contacts/ContactsListPage.tsx', /restoreList\(/, "title: 'Move this list to trash?'"],
    ['pages/contacts/ContactDetailPage.tsx', /gone\.remove\(/, "title: 'Delete this contact?'"],
    ['pages/companies/CompanyDetailPage.tsx', /gone\.remove\(/, 'title: `Delete ${company.name}?`'],
    ['pages/campaigns/CampaignsListPage.tsx', /gone\.remove\(/, 'title: `Delete "${contextMenuFor.name}"?`'],
    ['pages/campaigns/CampaignDetailPage.tsx', /gone\.remove\(/, "title: 'Delete this campaign?'"],
    ['pages/developer/DeveloperPage.tsx', /gone\.remove\(/, 'title: `Delete the endpoint'],
    ['components/crm/DealPeople.tsx', /gone\.remove\(/, 'title: `Remove ${fullName(p.contact)}'],
  ];
  for (const [file, re, dialog] of files) {
    const src = client(file);
    is(`${file}: ${dialog.slice(7, 40)}... is deferred, not asked`, re.test(src) && !src.includes(dialog));
  }
  const bar = client('components/ui/UndoBar.tsx');
  is('a bulk delete is one undo, not one per row', /const removeMany = useCallback/.test(bar));
  is('the list hides a deleted row while the bar counts down',
     /filter\(\(d\) => !gone\.hidden\(d\.id\)\)/.test(client('pages/crm/DealsPage.tsx')));
}

console.log('\nthe launch preflight fixes what it can in place');
{
  const readiness = server('services/readiness.service.ts');
  for (const kind of ['connect_mailbox', 'test_mailboxes', 'recheck_domains', 'verify_tracking', 'enable_bounce_guard']) {
    is(`the server offers ${kind}`, readiness.includes(`inline: '${kind}'`));
  }
  const fix = client('components/campaigns/InlineFix.tsx');
  for (const kind of ['test_mailboxes', 'recheck_domains', 'verify_tracking', 'enable_bounce_guard']) {
    is(`the client runs ${kind}`, fix.includes(`case '${kind}'`));
  }
  const dialog = client('components/campaigns/LaunchPreflight.tsx');
  is('the dialog re-reads the report after a fix', /readinessApi\.get\((campaignId)?\)/.test(dialog) && /onFixed=\{recheck\}/.test(dialog));
  is('and judges it with the server\'s own rule', /launchGate\(report\)/.test(dialog) && /launchGate\(report\)/.test(server('services/campaigns.service.ts')));
  const warn = { verdict: 'risky' as const, checks: [{ id: 'safeguards', group: 'safeguards' as const, label: '', status: 'warn' as const, headline: '', detail: null, fix: null, facts: [] }] };
  is('a warning alone is risky, not blocked', launchGate(warn).gate === 'risky');
  is('a ready report is clear', launchGate({ verdict: 'ready', checks: [] }).gate === 'clear');
}

console.log('\nthe builder previews as a real person, and starts sensibly');
{
  const ada = { id: 'c1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@analytical.io', company: '' };
  is('the preview renders the real person', previewPersonalization('Hi {{first_name}}', { contact: ada }) === 'Hi Ada');
  is('an empty field with no fallback is a blank', JSON.stringify(blankTagsFor('at {{company}}', ada)) === '["company"]');
  is('a fallback is not a blank', blankTagsFor('at {{company|your team}}', ada).length === 0);
  is('sender and link tags are never the contact\'s blanks',
     blankTagsFor('{{sender_name}} {{unsubscribe_link}} {{booking_link}}', ada).length === 0);
  const page = client('pages/campaigns/CampaignCreatePage.tsx');
  is('the preview is handed the audience', /people=\{selectedContactsPreview\}/.test(page));
  is('healthy mailboxes rotate by default', /healthy\.map\(\(a\) => a\.id\)/.test(page));
  is('the daily limit comes from what they can send, warm-up included', /warmupAllowance\(a\)/.test(page));
  is('a restored draft is never overwritten by defaults', /draft\.decision\.restore\) return;/.test(page));
  is('?list= fills the audience', /get\('list'\)/.test(page) && /addListContacts\(listId\)/.test(page));
  is('no link to the retired /settings/smtp page', !page.includes('/settings/smtp'));
  is('an import into a list offers the campaign', /\/campaigns\/new\?list=/.test(client('pages/contacts/BulkImportPage.tsx')));
}

console.log('\nthe pipeline moves itself');
{
  const crm = server('services/crm.service.ts');
  const create = crm.slice(crm.indexOf('async createEvent('), crm.indexOf('async updateEvent('));
  is('a meeting added by hand advances its deal', /advanceDealForMeeting\(/.test(create));
  const adv = crm.slice(crm.indexOf('async function advanceDealForMeeting'), crm.indexOf('async function autoLinkContact'));
  is('only from Lead, guarded against a concurrent move', /deal\.stage !== 'lead'/.test(adv) && /\.eq\('stage', 'lead'\)/.test(adv));
  is('a guessed link needs exactly one open deal', /data\.length === 1/.test(adv));
  is('the move stamps stage_changed_at', /stage_changed_at: new Date\(\)\.toISOString\(\)/.test(adv));
  const booking = server('services/booking.service.ts');
  is('so does a booking that advances a deal', /\{ stage, stage_changed_at: new Date\(\)\.toISOString\(\) \}/.test(booking));
}

console.log('\nfirst login to first campaign, on one page');
{
  const start = client('pages/start/StartPage.tsx');
  is('a mailbox is connected in place', /<SmtpAccountModal/.test(start));
  is('DNS records are shown to copy, with a check again', /domainApi\.getRecords/.test(start) && /domainApi\.verify/.test(start) && /CopyField/.test(start));
  is('a CSV imports in place when its columns are certain', /planImport\(headers, rows\)/.test(start) && /if \(!plan\.confident\)/.test(start) && /contactsApi\.bulkCreate/.test(start));
  is('a doubtful file goes to the full importer', /navigate\('\/contacts\/import'\)/.test(start));
  is('Relay writes for the chosen list', /\/campaigns\/new\?write=1\$\{q\}/.test(start));
  is('the account\'s own setup check has the last word', /stepDone\('domain'\) \|\|/.test(start));
  is('the builder\'s writer starts on that list', /useState<string \| null>\(\(\) => new URLSearchParams\(window\.location\.search\)\.get\('list'\)\)/.test(client('pages/campaigns/CampaignCreatePage.tsx')));
  is('the checklist on Home leads to it', /to="\/start"/.test(client('components/setup/SetupChecklist.tsx')));
  is('it belongs to Home', /match: \['\/start'\]/.test(client('lib/sections.ts')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
