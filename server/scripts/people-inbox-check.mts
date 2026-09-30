/* ═══════════════════════════════════════════════════════════════════════
   A people-first inbox, and a Relay that reads only what was written.

   Run: npx tsx scripts/people-inbox-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'check';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'check';
process.env.TRACKING_SECRET ||= 'check-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.NODE_ENV ||= 'test';

const { classifyMailKind, stripQuoted } = await import('../src/utils/mail-kind.js');
const { classifyReply } = await import('../src/services/sara.service.js');
const sh = await import('@lemlist/shared');

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

console.log('\nRelay reads what they wrote, not your own email back');
{
  const reply = "Yes, let's talk next week - Tuesday works.\n\nOn Mon, 28 Sep 2026 at 09:00, Alex <alex@affivault.com> wrote:\n> Hi Sam,\n> quick idea...\n> Unsubscribe here: https://x/u";
  is('quoted history is cut', stripQuoted(reply).text === "Yes, let's talk next week - Tuesday works.");
  const intent = classifyReply('Re: Quick idea', reply).intent;
  is('a yes that quotes your unsubscribe footer is a meeting, not an unsubscribe', intent === 'meeting', intent);
  is('"please unsubscribe me" is still an unsubscribe', classifyReply('Re: x', 'Please unsubscribe me').intent === 'unsubscribe');
  is('a bare "unsubscribe" reply is an unsubscribe', classifyReply('Re: x', 'Unsubscribe').intent === 'unsubscribe');
  const newsletter = 'Big news this week.\n\nYou are receiving this email because you subscribed. Unsubscribe | Manage preferences';
  is('a newsletter footer is not a request to unsubscribe', classifyReply('September rewards', newsletter).intent !== 'unsubscribe');
  is('"away from" in passing is not an out-of-office', classifyReply('Re: x', 'We moved away from spreadsheets last year, tell me more').intent !== 'out_of_office');
  is('Outlook-style history is cut', stripQuoted('Sounds good\n\nFrom: Alex <a@b.com>\nSent: Monday\nTo: Sam').text === 'Sounds good');
}

console.log('\nperson or mail');
{
  const k = (x: any) => classifyMailKind(x).kind;
  is('a broker newsletter of tracking links is bulk', k({ fromEmail: 'info@mc.gomarkets.com', subject: 'Finish your application', bodyText: 'https://click.mc.gomarkets.com/?qs=a https://click.mc.gomarkets.com/?qs=b https://click.mc.gomarkets.com/?qs=c' }) === 'bulk');
  is('a subscription renewal is a receipt', k({ fromEmail: 'hello@spaceship.com', subject: 'Spacemail Business subscription auto-renewed' }) === 'transactional');
  is('GitHub is a notification', k({ fromEmail: 'notifications@github.com', subject: 'Re: [Affivault/sincerely] PR #513' }) === 'notification');
  is('a no-reply sender is a notification', k({ fromEmail: 'no-reply@render.com', subject: 'Server failure detected' }) === 'notification');
  is('a sales drip with a footer is bulk', k({ fromEmail: 'tamina@close.com', subject: 'Quick AI Overview?', bodyText: 'Hi Alex, trial users miss this.\n\nYou received this email because you signed up. Unsubscribe | Manage preferences' }) === 'bulk');
  is('mailing-list headers decide, when present', k({ fromEmail: 'team@brevo.com', subject: 'Let Brevo do the heavy lifting', headers: new Map([['list-unsubscribe', '<mailto:u@x>']]) }) === 'bulk');
  is('a stranger writing plainly is a person', k({ fromEmail: 'sam@acme.com', subject: 'Question', bodyText: 'Hi Alex, saw your note. Could you send pricing?\nThanks\nSam' }) === 'person');
  is('someone you know is a person even with a footer', k({ fromEmail: 'sam@acme.com', subject: 'Re: idea', bodyText: 'Yes please.\n\nUnsubscribe | Manage preferences', known: true }) === 'person');
  is('your own mailbox is internal', k({ fromEmail: 'affivault@gmail.com', subject: 'Idea I wanted to share', own: true }) === 'internal');
}

console.log('\nnames, companies and shared inboxes');
{
  is('mc.gomarkets.com is GO Markets\' domain, not a company called "Mc"', sh.companyFromEmail('info@mc.gomarkets.com') === 'Gomarkets');
  is('hello@dodl.co.uk is Dodl', sh.companyFromEmail('hello@dodl.co.uk') === 'Dodl');
  is('gmail says nothing about an employer', sh.companyFromEmail('x@gmail.com') === null);
  is('hyphens become words', sh.companyFromEmail('a@free-trade.io') === 'Free Trade');
  is('the website is the registrable domain', sh.websiteFromEmail('a@mc.gomarkets.com') === 'https://gomarkets.com');
  is('affiliates@ is a shared inbox', sh.isRoleAddress('affiliates@hl.co.uk'));
  is('a named person is not', !sh.isRoleAddress('tom.winterton@investengine.com'));
  is('a sender shows the name their mail client sent', sh.senderLabel('info@mc.gomarkets.com', 'GO Markets') === 'GO Markets');
  is('and the company for "info@" when there is no name', sh.senderLabel('info@mc.gomarkets.com') === 'Gomarkets');
  is('a preview is words, not tracking links', !/https?:/.test(sh.previewText('https://click.mc.gomarkets.com/?qs=A https://click.mc.gomarkets.com/?qs=B', '<p>From Nvidia earnings to Bitcoin</p><a href="https://click.x.com">Read</a>')));
  const split = sh.splitQuotedHtml('<div>Sounds good</div><div class="gmail_quote">On Mon wrote: old</div>');
  is('Gmail quoted history folds away', split.main === '<div>Sounds good</div>' && split.quoted.startsWith('<div class="gmail_quote"'));
}

console.log('\nwired through');
{
  const sync = src('services/inbox-sync.service.ts');
  is('sync sorts each message as it arrives', /mailKind = classifyMailKind\(/.test(sync));
  is('Relay only reads people', /mailKind === 'person'\)\) \{\n\s+processReply/.test(sync));
  const sara = src('services/sara.service.ts');
  is('Relay skips mail entirely, before any auto-action', /NON_PERSON_KINDS\.includes\(message\.mail_kind\)/.test(sara));
  is('auto-unsubscribe needs a short, unambiguous reply', /freshLength <= 400/.test(sara));
  is('Claude reads first, rules are the fallback', /if \(aiAvailable\(\) && fresh[ )&]/.test(sara) && /const ruled = classifyReply/.test(sara));
  const inbox = src('services/inbox.service.ts');
  is('inbox counts are about people', /people\(unreadQ\), people\(needsTriageQ\)/.test(inbox));
  is('Other mail has its own folder', /folder === 'other'/.test(inbox));
  is('the reply queue behind Flow is people only', /peopleOnly \? PEOPLE_FILTER/.test(src('services/reply-queue.service.ts')));
  is('wrongly unsubscribed people are offered back, not resubscribed silently', /async relayReview\(/.test(src('services/mail-sort.service.ts')));
  is('the Unibox has an Other mail tab', /label: 'Other mail'/.test(client('pages/inbox/InboxPage.tsx')));
  is('a thread of mail offers "This is a person"', /This is a person/.test(client('components/inbox/PeopleFirstNotices.tsx')));
  is('quoted history folds in the reader', /Show quoted text/.test(client('components/shared/EmailBody.tsx')));
  is('tracking pixels are dropped before rendering', /function withoutTrackers/.test(client('components/shared/EmailBody.tsx')));
}

console.log('\nleads, sequences, dashboard');
{
  is('leads are filled from their domain in the background', /enrichmentService\.ensure\(userId\)/.test(src('services/contacts.service.ts')));
  is('"No title" is gone from the leads table', !/'No title'/.test(client('pages/contacts/ContactsListPage.tsx')));
  is('empty columns fold away', /emptyColumnIds/.test(client('pages/contacts/ContactsListPage.tsx')));
  is('Relay can write a sequence', /campaignRoutes\.post\('\/write-sequence'/.test(src('routes/campaign.routes.ts')));
  is('and it works without Claude too', /templateSequence\(offer/.test(src('services/sequence-writer.service.ts')));
  is('the builder offers it', /Write with Relay/.test(client('pages/campaigns/CampaignCreatePage.tsx')));
  is('a dashboard with nothing sent shows the next step, not empty charts', /!everSent && \(/.test(client('pages/dashboard/DashboardPage.tsx')));
  is('setup says "ready" and "not tested", not "connected" beside "not tested"', /ready to send/.test(src('services/setup.service.ts')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} people-inbox check(s) failed`);
