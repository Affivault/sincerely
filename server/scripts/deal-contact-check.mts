/* ═══════════════════════════════════════════════════════════════════════
   When did we last speak to anyone on the deal - kept honest.

   - the last touch either way, who with, and who made it
   - who holds the ball, and when anybody on their side last wrote back
   - fresh / cooling / gone quiet / never, by days since the last touch
   - the same per person, so a silent decision maker shows
   - out-of-office replies, cancelled meetings and no-shows do not count
   - shown on the card, the table (sortable), a "Gone quiet" slice and the deal page

   Run: npx tsx scripts/deal-contact-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dealContactActivity, dealContactFromDetail, dealContactShort, paceOf, agoLabel,
  DEAL_CONTACT_COOLING_DAYS, DEAL_CONTACT_QUIET_DAYS,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

const now = new Date(Date.UTC(2026, 10, 20, 12));
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const people = [
  { email: 'Sarah@Acme.io', name: 'Sarah Lee', primary: true },
  { email: 'dan@acme.io', name: 'Dan Ortiz', role: 'Decision maker' },
  { email: 'pat@acme.io', name: 'Pat Kim', role: 'Champion' },
];

console.log('\nthe last touch, who with, who made it');
{
  const a = dealContactActivity({ now, people, touches: [
    { at: ago(10), kind: 'email_out', email: 'sarah@acme.io' },
    { at: ago(3), kind: 'email_in', email: 'sarah@acme.io' },
    { at: ago(20), kind: 'email_out', email: 'dan@acme.io' },
  ] });
  is('the last touch is their reply', a.last?.by === 'them' && a.last.name === 'Sarah Lee', JSON.stringify(a.last));
  is('the ball is with you', a.ball === 'you');
  is('three days ago is fresh', a.days_since === 3 && a.pace === 'fresh');
  is('the headline names her', a.sentence === 'Sarah replied 3 days ago', a.sentence);
  is('the card line is short', dealContactShort(a) === 'Sarah replied 3d ago', dealContactShort(a));
  is('one of three is talking', a.engaged === 1 && a.total === 3);
  const dan = a.people.find((p) => p.email === 'dan@acme.io')!;
  is('the decision maker shows as quiet with no reply', dan.pace === 'quiet' && /no reply yet/.test(dan.line), dan.line);
  const pat = a.people.find((p) => p.email === 'pat@acme.io')!;
  is('somebody never contacted says so, and sorts last', pat.pace === 'never' && a.people[a.people.length - 1].email === 'pat@acme.io');
  is('addresses are matched whatever their case', a.people[0].email === 'sarah@acme.io' && a.people[0].last_in === ago(3));
}

console.log('\nyou wrote last');
{
  const a = dealContactActivity({ now, people, touches: [
    { at: ago(30), kind: 'email_in', email: 'dan@acme.io' },
    { at: ago(15), kind: 'email_out', email: 'sarah@acme.io' },
  ] });
  is('the ball is theirs', a.ball === 'them');
  is('fifteen days is gone quiet', a.pace === 'quiet');
  is('it says when anyone last wrote back', a.sentence === 'You emailed Sarah 2 weeks ago, last heard from Dan 4 weeks ago', a.sentence);
  const none = dealContactActivity({ now, people, touches: [{ at: ago(8), kind: 'email_out', email: 'sarah@acme.io' }] });
  is('and when nobody ever has', /no reply from anyone yet$/.test(none.sentence) && none.pace === 'cooling', none.sentence);
}

console.log('\nmeetings and calls count as speaking');
{
  const a = dealContactActivity({ now, people, touches: [
    { at: ago(9), kind: 'email_out', email: 'dan@acme.io' },
    { at: ago(2), kind: 'meeting', email: 'dan@acme.io' },
  ] });
  is('a meeting is the last touch', a.last?.kind === 'meeting' && a.sentence === 'Met with Dan 2 days ago', a.sentence);
  is('and counts as hearing from them', a.days_since_heard === 2 && a.engaged === 1);
}

console.log('\nthe thresholds');
{
  is('fresh under a week', paceOf(DEAL_CONTACT_COOLING_DAYS - 1) === 'fresh');
  is('cooling from a week', paceOf(DEAL_CONTACT_COOLING_DAYS) === 'cooling');
  is('gone quiet from a fortnight', paceOf(DEAL_CONTACT_QUIET_DAYS) === 'quiet');
  is('never when there is nothing', paceOf(null) === 'never');
  is('words for days', agoLabel(0) === 'today' && agoLabel(1) === 'yesterday' && agoLabel(21) === '3 weeks ago');
  const empty = dealContactActivity({ now, people, touches: [], windowDays: 120 });
  is('a windowed read does not claim nobody was ever contacted', /in the last 120 days/.test(empty.sentence), empty.sentence);
  const future = dealContactActivity({ now, people, touches: [{ at: ago(-3), kind: 'meeting', email: 'dan@acme.io' }] });
  is('a meeting still to come is not contact', future.last === null);
}

console.log('\nfrom the deal page');
{
  const a = dealContactFromDetail({
    deal: { contact: { id: 'c1', email: 'sarah@acme.io', first_name: 'Sarah', last_name: 'Lee' } },
    participants: [{ contact_id: 'c2', role: 'Decision maker', contact: { email: 'dan@acme.io', first_name: 'Dan', last_name: 'Ortiz' } }],
    emails: [
      { from_email: 'sarah@acme.io', to_email: 'me@x.io', direction: 'inbound', received_at: ago(1), auto_reply_kind: 'out_of_office' },
      { from_email: 'sarah@acme.io', to_email: 'me@x.io', direction: null, received_at: ago(5) },
      { from_email: 'me@x.io', to_email: 'dan@acme.io', direction: 'outbound', received_at: ago(4) },
    ],
    events: [
      { starts_at: ago(2), type: 'meeting', status: 'cancelled', contact_email: 'dan@acme.io' },
      { starts_at: ago(3), type: 'call', status: 'no_show', contact_email: 'dan@acme.io' },
    ],
  }, now);
  is('an out-of-office is not them writing back', a.last_heard?.at === ago(5));
  is('cancelled meetings and no-shows are not contact', a.last?.kind === 'email' && a.last.email === 'dan@acme.io');
  is('the primary and participants are both on it', a.total === 2 && a.people.some((p) => p.role === 'Decision maker'));
}

console.log('\nwired in');
{
  const svc = src('services/deal-health.service.ts');
  is('the board read carries it', /activity: dealContactActivity\(/.test(svc));
  is('and reads meetings held, skipping cancelled and no-shows', /status === 'cancelled' \|\| e\.status === 'no_show'/.test(svc));
  is('and still skips out-of-office replies', /if \(m\.auto_reply_kind\) continue/.test(svc));
  is('the deal page email read includes auto_reply_kind', /is_read, contact_id, auto_reply_kind/.test(src('services/crm.service.ts')));
  is('the card shows it', /<DealContactLine activity=\{health\.activity\}/.test(client('components/crm/DealCard.tsx')));
  const table = client('components/crm/DealTable.tsx');
  is('the table has a sortable Last contact column', /label="Last contact" sortKey="contact"/.test(table) && /<DealContactCell/.test(table));
  const filters = client('components/crm/DealFilters.tsx');
  is('there is a Gone quiet slice', /quiet: 'Gone quiet'/.test(filters) && /pace !== 'quiet' && pace !== 'never'/.test(filters));
  is('the pipeline page feeds it', /contactOf=\{contactOf\}/.test(client('pages/crm/DealsPage.tsx')));
  const page = client('pages/crm/DealDetailPage.tsx');
  is('the deal page has the panel', /<DealContactPanel activity=\{contact\}/.test(page) && /dealContactFromDetail\(/.test(page));
  is('and each person says when we last spoke', /<PersonContactLine person=\{touch\}/.test(client('components/crm/DealPeople.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
