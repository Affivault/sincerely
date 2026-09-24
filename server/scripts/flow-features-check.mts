/* ═══════════════════════════════════════════════════════════════════════
   The judgements behind Flow, deal health, the command bar, the launch
   forecast and the buying committee - asserted, because each one decides
   what somebody does next and a quiet regression would steer them wrong.

   Run: npx tsx scripts/flow-features-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scoreDeal, parseCommand, matchesDealQuery, parseAmount, forecastCampaign,
  buyingCommittee, committeeSeniorityOf, engagementWindow, replyRank, meetingRank, dealRank, taskRank, sortFlow,
  nextRuleRun, type DealSignals, type FlowItem,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const srv = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const cli = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

const NOW = Date.parse('2026-09-23T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const base: DealSignals = {
  stage: 'qualified', created_at: daysAgo(20), stage_changed_at: daysAgo(3), expected_close_date: null,
  last_inbound_at: null, last_outbound_at: null, response_hours: [], engaged_people: 2, people: 2,
  has_decision_maker: true, roles_recorded: true, next_meeting_at: null, overdue_tasks: 0,
};

console.log('deal health');
{
  const waiting = scoreDeal({ ...base, last_inbound_at: daysAgo(4), last_outbound_at: daysAgo(6) }, NOW);
  is('they wrote last and wait: the next action is to reply', waiting.next_action === 'reply', waiting.next_action);
  is('and it costs the most', waiting.reasons[0].action === 'reply');

  const quiet = scoreDeal({ ...base, last_inbound_at: daysAgo(25), last_outbound_at: daysAgo(10) }, NOW);
  is('we wrote last and they went quiet: follow up', quiet.next_action === 'follow_up', quiet.next_action);

  const good = scoreDeal({ ...base, last_inbound_at: daysAgo(0), last_outbound_at: daysAgo(1), next_meeting_at: new Date(NOW + 2 * 86_400_000).toISOString() }, NOW);
  is('talking today with a meeting booked is healthy', good.grade === 'healthy', `${good.score}`);

  const slowing = scoreDeal({ ...base, response_hours: [2, 3, 4, 120], last_inbound_at: daysAgo(1), last_outbound_at: daysAgo(1) }, NOW);
  is('replies slowing are noticed', slowing.reasons.some((r) => /slowing/i.test(r.text)));

  const single = scoreDeal({ ...base, engaged_people: 1, people: 1 }, NOW);
  is('single-threaded deals say so', single.reasons.some((r) => r.action === 'add_stakeholder'));

  const late = scoreDeal({ ...base, expected_close_date: '2026-09-01' }, NOW);
  is('a passed close date asks for a new one', late.reasons.some((r) => r.action === 'update_close_date'));
  is('score stays within 0-100', [waiting, quiet, good, slowing, single, late].every((h) => h.score >= 0 && h.score <= 100));
}

console.log('\nflow ranking');
{
  is('a meeting in ten minutes outranks an overdue reply', meetingRank(new Date(NOW + 10 * 60_000).toISOString(), NOW, false) > replyRank('overdue', 'meeting', 50_000));
  is('an overdue reply outranks an at-risk deal', replyRank('overdue', null, null) > dealRank({ score: 10, grade: 'at_risk', reasons: [], next_action: 'follow_up', summary: '' }));
  is('an interested reply outranks a plain one at the same lateness', replyRank('waiting', 'interested', null) > replyRank('waiting', 'other', null));
  is('an overdue task outranks one due today', taskRank(true, 'normal') > taskRank(false, 'normal'));
  const items = [{ key: 'task:1', rank: 50 }, { key: 'reply:1', rank: 90 }, { key: 'deal:1', rank: 60 }] as FlowItem[];
  is('sorted most urgent first', sortFlow(items).map((i) => i.key).join(',') === 'reply:1,deal:1,task:1');
}

console.log('\ncommand bar');
{
  const p = parseCommand('pause acme.com');
  is('"pause acme.com" pauses a company', p?.kind === 'pause_recipient' && p.target === 'acme.com');
  const e = parseCommand('stop emailing Bob@Acme.com');
  is('"stop emailing bob@acme.com" pauses a person', e?.kind === 'pause_recipient' && e.target === 'bob@acme.com');
  is('"resume acme.com" resumes', parseCommand('resume acme.com')?.kind === 'resume_recipient');
  const en = parseCommand('add jane@acme.com to Q4 outbound');
  is('"add x to campaign" enrols by name', en?.kind === 'enroll' && en.email === 'jane@acme.com' && en.campaign === 'Q4 outbound', JSON.stringify(en));
  is('"pause the meeting" is not a command', parseCommand('pause the meeting') === null);
  is('"call ada tomorrow" is left to quick add', parseCommand('call ada tomorrow') === null);
  const dq = parseCommand('deals over 10k closing this month');
  is('a deal question is read', dq?.kind === 'deal_query' && dq.query.min_value === 10_000 && dq.query.closing === 'this_month', JSON.stringify(dq));
  is('amounts read as people write them', parseAmount('1.5m') === 1_500_000 && parseAmount('$2,500') === 2500);
  const now = new Date('2026-09-23T12:00:00');
  const deal = { title: 'Acme', company: 'Acme', value: 20_000, stage: 'proposal' as const, expected_close_date: '2026-09-30' };
  is('a matching deal matches', matchesDealQuery(deal, { min_value: 10_000, closing: 'this_month' }, {}, now));
  is('a closed deal never does', !matchesDealQuery({ ...deal, stage: 'won' }, { min_value: 10_000 }, {}, now));
  is('closing next month excludes this month', !matchesDealQuery(deal, { closing: 'next_month' }, {}, now));
}

console.log('\nlaunch forecast');
{
  const f = forecastCampaign({
    steps: [{ is_email: true, delay_days: 0 }, { is_email: true, delay_days: 3 }],
    positions: [{ step: 0, due_in_days: 0, count: 100 }],
    send_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    daily_limit: 0, per_mailbox_window_cap: 0,
    mailboxes: [{ label: 'a', capacity: () => 25 }],
    start: new Date('2026-09-21T09:00:00'), history: null,
  });
  is('every email is sent', f.total_sends === 200, String(f.total_sends));
  is('no more than capacity on any day', f.days.every((d) => d.sends <= Math.max(d.capacity, 0)));
  is('nothing on a weekend', f.days.every((d) => d.sending_day || d.sends === 0));
  is('the mailbox is named as the bottleneck', f.bottleneck === 'mailboxes');
  is('without history, typical rates are admitted to', f.projection.assumed);
  const none = forecastCampaign({
    steps: [{ is_email: true, delay_days: 0 }], positions: [{ step: 0, due_in_days: 0, count: 10 }],
    send_days: ['monday'], daily_limit: 0, per_mailbox_window_cap: 0, mailboxes: [],
    start: new Date('2026-09-21T09:00:00'), history: null,
  });
  is('no mailbox sends nothing, and says so', none.total_sends === 0 && none.warnings.some((w) => /mailbox/i.test(w)));
}

console.log('\nbuying committee');
{
  is('titles read as seniority', committeeSeniorityOf('VP Sales') === 'decision_maker' && committeeSeniorityOf('Sales Manager') === 'manager' && committeeSeniorityOf('SDR') === 'individual');
  const c = buyingCommittee(
    [
      { id: '1', email: 'amy@x.com', first_name: 'Amy', last_name: null, job_title: 'SDR' },
      { id: '2', email: 'ceo@x.com', first_name: 'Cat', last_name: null, job_title: 'CEO' },
    ],
    [{ from_email: 'amy@x.com', to_email: 'me@us.com', direction: 'inbound', received_at: daysAgo(1) }],
  );
  is('the engaged come first', c.members[0].id === '1' && c.engaged === 1);
  is('and the missing decision maker is named', !c.decision_maker_engaged && /Cat/.test(c.gap || ''), c.gap || '');
  const w = engagementWindow([
    { activity_type: 'opened', occurred_at: '2026-09-21T09:10:00' },
    { activity_type: 'opened', occurred_at: '2026-09-22T09:40:00' },
    { activity_type: 'replied', occurred_at: '2026-09-22T10:05:00' },
  ]);
  is('a reading window is found from opens and replies', !!w && w.from === 9, JSON.stringify(w));
  is('one open is not a pattern', engagementWindow([{ activity_type: 'opened', occurred_at: '2026-09-21T09:10:00' }]) === null);
}

console.log('\nstanding searches');
{
  const fri = new Date('2026-09-25T10:00:00Z');
  is('weekdays skip the weekend', nextRuleRun('weekdays', fri).getUTCDay() === 1);
  is('weekly is seven days', nextRuleRun('weekly', fri).getTime() - fri.getTime() === 7 * 86_400_000);
  const svc = srv('services/prospect-rules.service.ts');
  is('enrolment goes through the ordinary door', /campaignContactsService\.add\(/.test(svc));
  is('running out of credits stops the run rather than erroring', /no_credits/.test(svc));
}

console.log('\nwiring');
{
  is('a positive reply pauses the company', /maybePauseCompany\(message, result\)/.test(srv('services/sara.service.ts')));
  is('a paused enrolment keeps its campaign from completing', /\['pending', 'active', 'paused'\]/.test(srv('services/sequence.service.ts')));
  is('free mail is never treated as a company', /isFreeMailDomain\(domain\)/.test(srv('services/account-pause.service.ts')));
  is('Flow is routed and in the sidebar', /path="\/flow"/.test(cli('App.tsx')) && /href: '\/flow'/.test(cli('components/layout/Sidebar.tsx')));
  is('nothing user-facing still says SARA', !/SARA/.test(cli('pages/inbox/InboxPage.tsx')) && !/SARA/.test(cli('pages/settings/SettingsPage.tsx')));
}

console.log('\nreview fixes');
{
  const seq = srv('services/sequence.service.ts');
  const marked = seq.slice(seq.indexOf('export async function markReplied'), seq.indexOf('export async function stopOtherCampaignsForContact'));
  is('a paused contact who replies is marked replied', /'pending', 'active', 'paused'/.test(marked));
  const stopOthers = seq.slice(seq.indexOf('export async function stopOtherCampaignsForContact'), seq.indexOf('async function markCompleted'));
  is('and stopped everywhere else too', /'pending', 'active', 'paused'/.test(stopOthers));
  const pause = srv('services/account-pause.service.ts');
  is('"resume all" leaves hand-paused people paused', /like\('error_message', `\$\{COMPANY_PAUSE_PREFIX\}%`\)/.test(pause));
  is('a failed resume is not reported as nothing paused', !/resumePausedContacts\(userId, campaignId, ccIds\)\.catch\(\(\) => 0\)/.test(pause));
  const health = srv('services/deal-health.service.ts');
  const enc = /const ENCODABLE = (\/.*\/);/.exec(health)?.[1] || '';
  const re = eval(enc) as RegExp;
  is('an address with an underscore is still read', re.test('john_doe@acme.com'), enc);
  is('out-of-office replies are not the buyer writing', /if \(m\.auto_reply_kind\) continue;/.test(health));
  is('the brief finds a contact by exact address', !/ilike\('email', String\(event\.contact_email\)\.replace/.test(srv('services/meeting-brief.service.ts')));
  is('a cancelled meeting was not booked', /status\.neq\.cancelled/.test(srv('services/away.service.ts')));
  is('"the remaining N" is counted, not capped at a page', /count: 'exact', head: true/.test(srv('services/step-outcomes.service.ts')));
  is('a standing search with nowhere to put people spends nothing', /no_destination/.test(srv('services/prospect-rules.service.ts')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
