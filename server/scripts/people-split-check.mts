/* ═══════════════════════════════════════════════════════════════════════
   Leads and Contacts are two pages, and nobody is on both.

   Run: npx tsx scripts/people-split-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sh = await import('@lemlist/shared');

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

console.log('\nwho is on which page');
{
  const { lead, contact } = sh.PEOPLE_PAGE_LIFECYCLES;
  is('the two pages share no lifecycle', lead.every((l: string) => !contact.includes(l)));
  is('between them they cover every lifecycle', [...lead, ...contact].sort().join() === ['contact', 'customer', 'prospect'].join());
  is('a prospect belongs on Leads', sh.peoplePageFor('prospect') === 'lead' && sh.peoplePageHref(null) === '/leads');
  is('a customer belongs on Contacts', sh.peoplePageFor('customer') === 'contact');
  is('a prospect is called a lead', sh.LIFECYCLE_LABEL.prospect === 'Lead');
}

console.log('\noutreach, read from campaigns');
{
  is('no campaigns is "not contacted"', sh.summariseOutreach([]).state === 'none');
  const live = sh.summariseOutreach([
    { status: 'completed', campaign_id: 'a', campaign_name: 'Old', updated_at: '2026-01-02' },
    { status: 'active', campaign_id: 'b', campaign_name: 'Q4', current_step_order: 1, updated_at: '2026-01-01' },
  ]);
  is('a live sequence wins over an ended one', live.state === 'in_sequence' && live.campaign_name === 'Q4' && live.step === 1);
  is('and both campaigns are counted', live.campaigns === 2);
  is('a reply anywhere wins', sh.summariseOutreach([
    { status: 'active', campaign_id: 'b' }, { status: 'replied', campaign_id: 'c' },
  ]).state === 'replied');
  is('only ended ones is "sequence ended"', sh.summariseOutreach([{ status: 'bounced', campaign_id: 'a' }]).state === 'finished');
  is('a draft campaign is "queued", not in sequence', sh.summariseOutreach([{ status: 'pending', campaign_id: 'a', campaign_status: 'draft' }]).state === 'queued');
  is('a cancelled campaign ends the sequence', sh.summariseOutreach([{ status: 'active', campaign_id: 'a', campaign_status: 'cancelled' }]).state === 'finished');
  is('a paused campaign still counts as in sequence', sh.summariseOutreach([{ status: 'active', campaign_id: 'a', campaign_status: 'paused' }]).state === 'in_sequence');
  is('live beats queued', sh.summariseOutreach([
    { status: 'pending', campaign_id: 'a', campaign_status: 'draft', updated_at: '2026-02-01' },
    { status: 'active', campaign_id: 'b', campaign_status: 'running', updated_at: '2026-01-01' },
  ]).state === 'in_sequence');

  // The SQL that the filter runs must say the same as the column.
  const sql = readFileSync(join(here, '../../supabase/migrations/104_outreach_state.sql'), 'utf8');
  is('the filter runs on outreach_state() in the database', /\.eq\('outreach_state', outreach\)/.test(src('services/contacts.service.ts')));
  is('SQL and app agree on every state', sh.LEAD_OUTREACH_STATES.every((st: string) => sql.includes(`'${st}'`)));
  is('SQL and app agree on live statuses', /cc\.status IN \('pending', 'active', 'paused'\)/.test(sql) && /k\.status IN \('scheduled', 'running', 'paused'\)/.test(sql)
    && sh.OUTREACH_LIVE_STATUSES.join() === 'pending,active,paused' && sh.OUTREACH_LIVE_CAMPAIGN_STATUSES.join() === 'scheduled,running,paused');
}

console.log('\nfiling');
{
  const lists = src('services/lists.service.ts');
  is('filing someone in a contact list makes them a contact', /list\?\.kind === 'contact' && filed\.length > 0/.test(lists) && /promoteToContact\(userId, slice, 'manual'\)/.test(lists));
  is('a list made on a page is that page\'s kind', /listsApi\.create\(\{ \.\.\.input, kind: listKind \}\)/.test(client('pages/contacts/ContactsListPage.tsx')));
}

console.log('\ndeals, for contacts');
{
  const d = sh.summariseDeals([
    { stage: 'qualified', value: 1000, currency: 'USD' }, { stage: 'won', value: 50 }, { stage: 'lost', value: 9 },
  ]);
  is('open and won are counted apart, lost not at all', d.open === 1 && d.won === 1 && d.open_value === 1000 && d.currency === 'USD');
  const mixed = sh.summariseDeals([{ stage: 'lead', value: 1, currency: 'USD' }, { stage: 'lead', value: 1, currency: 'EUR' }]);
  is('two currencies are never added together', mixed.currency === null && mixed.open_value === 0 && mixed.open === 2);
}

console.log('\nthe pages');
{
  const page = client('pages/contacts/ContactsListPage.tsx');
  is('no Contacts / Prospects / Everyone toggle', !/label: 'Everyone'/.test(page) && !/setLifecyclePersisted/.test(page));
  is('the lifecycle filter is fixed by the page, inside lists too', /const lifecycle: NonNullable<ContactsListParams\['lifecycle'\]> = listKind === 'lead' \? 'prospect' : stage;/.test(page) && !/activeListId \? 'all' : lifecycle/.test(page));
  is('each page has its own columns', /PAGE_COLUMNS: Record<ListKind, ColumnId\[\]>/.test(page) && /`\$\{listKind\}s\.columns`/.test(page));
  is('Add to campaign is a Leads action only', /listKind === 'lead' && \(\s*<>\s*<button\s*onClick=\{\(\) => setShowCampaignModal\(true\)\}/.test(page));
  is('Convert to contact and Move back to leads exist', /Convert to contact/.test(page) && /Move back to leads/.test(page));
  is('a lead added on Leads stays a lead', /lifecycle: listKind === 'lead' \? 'prospect' : 'contact'/.test(page) && /input\?\.lifecycle === 'prospect'/.test(src('services/contacts.service.ts')));
  is('export and counts follow the page', /applyLifecycle\(q, lifecycle\)/.test(src('services/contacts.service.ts')));
  is('import knows which page sent you', /searchParams\.get\('as'\)/.test(client('pages/contacts/BulkImportPage.tsx')) && /contacts\/import\?as=\$\{listKind\}/.test(page));
  is('a profile goes back to the page the person is on', /navigate\(peoplePageHref\(stage\)\)/.test(client('pages/contacts/ContactDetailPage.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} people-split check(s) failed`);
