/* ═══════════════════════════════════════════════════════════════════════
   One person, one story - kept that way.

   - sequence events read as sentences: which step, which campaign; opens
     and clicks folded; a bounce says why
   - deal moves are part of the person's history
   - the top of the profile says where things stand, including the one
     warning that matters: they answered and nothing happened since

   Run: npx tsx scripts/relationship-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { campaignStory, stageMoveTitle, whereWeAre } from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

const cmp = { campaign_id: 'cp1', campaign_name: 'UK brokers - Q4' };
const at = (d: number) => new Date(Date.UTC(2026, 8, d, 12)).toISOString();

console.log('\nsequence events read as sentences');
{
  const rows = campaignStory([
    { ...cmp, id: '1', activity_type: 'sent', step_order: 0, step_subject: 'Quick question', occurred_at: at(1) },
    { ...cmp, id: '2', activity_type: 'opened', step_order: 0, step_subject: 'Quick question', occurred_at: at(2) },
    { ...cmp, id: '3', activity_type: 'opened', step_order: 0, step_subject: 'Quick question', occurred_at: at(3) },
    { ...cmp, id: '4', activity_type: 'opened', step_order: 0, step_subject: 'Quick question', occurred_at: at(4) },
    { ...cmp, id: '5', activity_type: 'clicked', step_order: 0, step_subject: 'Quick question', metadata: { url: 'https://x.io/p' }, occurred_at: at(4) },
    { ...cmp, id: '6', activity_type: 'opened', step_order: 1, step_subject: 'Re: Quick question', occurred_at: at(6) },
    { ...cmp, id: '7', activity_type: 'replied', step_order: 1, occurred_at: at(7) },
    { ...cmp, id: '8', activity_type: 'bounced', step_order: 2, metadata: { source: 'notice', bounce_kind: 'address', reason: 'user unknown' }, occurred_at: at(8) },
    { ...cmp, id: '9', activity_type: 'bounced', step_order: 2, metadata: { source: 'smtp', bounce_kind: 'blocked', reason: '5.7.1 spam' }, occurred_at: at(9) },
  ]);
  const titles = rows.map((r) => r.title);
  is('a send names its step', titles.includes('Step 1 sent'), JSON.stringify(titles));
  is('three opens of one step are one row', titles.filter((t) => t.startsWith('Step 1 opened')).length === 1 && titles.includes('Step 1 opened 3 times'));
  is('with when it started', rows.find((r) => r.title === 'Step 1 opened 3 times')?.first_at === at(2));
  is('and its latest time', rows.find((r) => r.title === 'Step 1 opened 3 times')?.at === at(4));
  is('opens of another step stay apart', titles.includes('Step 2 opened'));
  is('a click says where it went', rows.find((r) => r.type === 'clicked')?.detail?.includes('https://x.io/p') === true);
  is('replies are left to the reply itself', !rows.some((r) => r.type === 'replied'));
  const dead = rows.find((r) => r.id === 'act-8');
  is('a bounce says why, and how we know', !!dead?.detail?.startsWith('User unknown (from a returned-mail notice)'), dead?.detail || '');
  const blocked = rows.find((r) => r.id === 'act-9');
  is('a block says the address is fine', !!blocked?.detail?.includes('The address itself is fine'), blocked?.detail || '');
  is('the campaign is named', rows[0].detail?.includes('UK brokers - Q4') === true);
}

console.log('\ndeal moves are part of the story');
{
  is('opening', stageMoveTitle({ from_stage: null, to_stage: 'lead' }, 'Acme') === 'Deal opened: Acme');
  is('moving', stageMoveTitle({ from_stage: 'lead', to_stage: 'qualified' }, 'Acme') === 'Acme moved to Qualified');
  is('winning', stageMoveTitle({ from_stage: 'proposal', to_stage: 'won' }, 'Acme') === 'Won: Acme');
  is('losing', stageMoveTitle({ from_stage: 'lead', to_stage: 'lost' }, 'Acme') === 'Lost: Acme');
  is('reopening', stageMoveTitle({ from_stage: 'lost', to_stage: 'lead' }, 'Acme') === 'Reopened: Acme');
  const svc = src('services/crm.service.ts');
  is('the contact summary carries every stage move', /from\('deal_stage_events'\)[\s\S]{0,200}\.in\('deal_id', dealIds\)/.test(svc) && /stage_events: stageEvents/.test(svc));
  is('scoped to the user', /from\('deal_stage_events'\)[\s\S]{0,120}\.eq\('user_id', userId\)/.test(svc));
  const history = client('components/crm/ContactHistory.tsx');
  is('the history shows them, linked to the deal', /kind: 'deal'/.test(history) && /to=\{`\/deals\/\$\{e\.dealId\}`\}/.test(history));
  is('and uses the sentence-maker', /campaignStory\(campaignActivity\)/.test(history));
  is('the timeline knows each step\'s position', /step_order: typeof a\.campaign_steps\?\.step_order === 'number'/.test(src('services/analytics.service.ts')));
}

console.log('\nwhere we are, at a glance');
{
  const now = new Date(Date.UTC(2026, 8, 20, 12));
  const base = { now, activity: [{ ...cmp, activity_type: 'sent', step_order: 0, occurred_at: at(1) }], tasks: [], events: [] };
  const replied = whereWeAre({ ...base, emails: [{ direction: 'inbound', received_at: at(15), subject: 'Re: hi' }], deals: [] });
  is('the last touch is theirs when they replied last', replied.last_touch?.by === 'them');
  is('where it started', replied.started_from?.campaign === 'UK brokers - Q4');
  is('a reply five days unanswered, with nothing planned, is flagged', replied.quiet_days === 5);
  const planned = whereWeAre({ ...base, emails: [{ direction: 'inbound', received_at: at(15) }], deals: [],
    events: [{ title: 'Intro call', starts_at: at(22) }] });
  is('not when a meeting is booked', planned.quiet_days === null && planned.next_step?.kind === 'meeting');
  const answered = whereWeAre({ ...base, emails: [{ direction: 'inbound', received_at: at(15) }, { direction: 'outbound', received_at: at(16) }], deals: [] });
  is('not when you answered', answered.quiet_days === null && answered.last_touch?.by === 'you');
  const deals = whereWeAre({ ...base, emails: [], deals: [
    { id: 'a', title: 'Old', stage: 'lost', created_at: at(1), stage_changed_at: at(2) },
    { id: 'b', title: 'Pilot', stage: 'qualified', value: 12000, currency: 'GBP', created_at: at(5), stage_changed_at: at(16) },
    { id: 'c', title: 'Upsell', stage: 'lead', created_at: at(18) },
  ] });
  is('the open deal furthest along is the one shown', deals.deal?.id === 'b' && deals.deal.open);
  is('with its own currency and days in stage', deals.deal?.currency === 'GBP' && deals.deal.days_in_stage === 4);
  const soonest = whereWeAre({ ...base, emails: [], deals: [],
    tasks: [{ title: 'Send deck', due_date: at(21) }], events: [{ title: 'Call', starts_at: at(25) }] });
  is('the next step is whichever comes first', soonest.next_step?.what === 'Send deck');
  const cancelled = whereWeAre({ ...base, emails: [], deals: [], events: [{ title: 'Call', starts_at: at(25), status: 'cancelled' }] });
  is('a cancelled meeting is not a next step', cancelled.next_step === null);
  const page = client('pages/contacts/ContactDetailPage.tsx');
  is('the profile opens with it', /<WhereWeAre/.test(page));
  is('and no longer prints dollars for every currency', !/`\$\$\{Math\.round/.test(page));
  is('overdue says so', /Overdue - was due/.test(client('components/crm/WhereWeAre.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
