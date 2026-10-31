/* ═══════════════════════════════════════════════════════════════════════
   A calmer app: one list for the day, an inbox with four tabs, and a
   builder that starts with the writing.

   Run: npx tsx scripts/calm-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { momentRank, replyRank, taskRank } from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const cli = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

console.log('\none list for the day');
{
  const now = Date.parse('2026-10-13T12:00:00Z');
  const fresh = momentRank(3, '2026-10-13T11:00:00Z', now);
  is('a strong fresh moment sits below anyone waiting on a reply', fresh < replyRank('ok' as any, null, null), `${fresh}`);
  is('and above a routine task due today', fresh > taskRank(false, 'normal'), `${fresh}`);
  is('a moment fades with age', momentRank(3, '2026-09-29T12:00:00Z', now) < fresh);
  const flow = src('services/flow.service.ts');
  is('moments join the list', /kind: 'moment'/.test(flow) && /from\('signals'\)/.test(flow));
  is('someone already waiting on a reply is not listed twice', /if \(m\.contact_id && replyContacts\.has\(m\.contact_id\)\) continue;/.test(flow));
  is('a handful at a time', /sortFlow\(momentItems\)\.slice\(0, 8\)/.test(flow));
  const home = cli('pages/dashboard/DashboardPage.tsx');
  is('Home shows the list itself', /<TodayQueue mode="home" \/>/.test(home));
  is('no separate attention card, teaser or replies feed', !/title="Needs attention"/.test(home) && !/FlowTeaser/.test(home) && !/Latest replies/.test(home));
  is('one status line, not stacked banners', /<StatusLine \/>/.test(home) && !/<SystemNote|<AutopilotNote/.test(home) && !existsSync(join(here, '../../client/src/components/dashboard/SystemNote.tsx')));
  const q = cli('components/flow/TodayQueue.tsx');
  is('Home shows six, then "Show all"', /const HOME_ROWS = 6;/.test(q) && /Show all \$\{items\.length\}/.test(q));
  is('a cleared list says so', /You're done for today\./.test(q));
  is('a moment can be written to from the list', /setWriting\(item\)/.test(q) && /<MomentWriteDialog/.test(q));
  is('a reply shows what they said, not the shared subject', /What they said, not the subject line/.test(q));
  is('focus mode is the same list', /<TodayQueue mode="focus" \/>/.test(cli('pages/flow/FlowPage.tsx')));
  is('Flow is no longer its own tab', !/label: 'Flow'/.test(cli('lib/sections.ts')));
}

console.log('\nan inbox with four tabs');
{
  const inbox = cli('pages/inbox/InboxPage.tsx');
  is('All, Needs you, Relay is unsure, Other mail', /label: 'All'/.test(inbox) && /label: 'Needs you'/.test(inbox) && /label: 'Relay is unsure'/.test(inbox) && /label: 'Other mail'/.test(inbox));
  is('"Relay is unsure" only while there is something to decide', /\(viewCounts\.needs_triage \|\| 0\) > 0 \|\| activeView === 'needs_triage'/.test(inbox));
  is('Hot leads and Unread moved to More', /\{ id: 'hot', label: 'Hot leads' \}/.test(inbox) && /\{ id: 'unread', label: 'Unread' \}/.test(inbox));
  is('rows lead with what they said', /const showSubject = !said \|\| \(!threadOnly && !isOutbound\) \|\| isMail\(msg\);/.test(inbox));
  is('Reply and Done on the row', /data-row-actions/.test(inbox) && /title="Reply \(r\)"/.test(inbox));
  const sections = cli('lib/sections.ts');
  is('Reply queue and Qualify queue (once Leads inbox) are out of the bar but still searchable', /label: 'Reply queue'.*hidden: true/.test(sections) && /label: 'Qualify queue'.*hidden: true/.test(sections) && /filter\(\(tab\) => !tab\.hidden/.test(cli('components/layout/SectionBar.tsx')));
}

console.log('\nwrite first, set up later');
{
  const b = cli('pages/campaigns/CampaignCreatePage.tsx');
  is('the order is Sequence, Audience, Sending, Review', /const WIZARD_ORDER = \[1, 2, 0, 3\] as const;/.test(b));
  is('a new campaign opens on the writing', /const \[wizardStep, setWizardStep\] = useState\(1\);/.test(b));
  is('Sending is set up for you', /label: 'Sending', icon: Settings, description: 'Set up for you'/.test(b));
  is('Review says how it will send, with a way to change it', /data-review-sending/.test(b));
  is('a mailbox is not named twice', !/\{a\.label\} — \{a\.email_address\}/.test(b));
}

console.log('\npolish');
{
  const detail = cli('pages/campaigns/CampaignDetailPage.tsx');
  is('campaign tabs sit right under the name, before the charts', detail.indexOf('Tabs, right under the name') > -1 && detail.indexOf('Tabs, right under the name') < detail.indexOf('<ForecastPanel'));
  is('a campaign is renamed by clicking its name', /<InlineEdit[\s\S]{0,120}ariaLabel="Campaign name"/.test(detail));
  const svc = src('services/campaigns.service.ts');
  is('renaming works at any stage; every other edit waits for a draft', /const renameOnly = /.test(svc) && /else if \(existing\.status !== 'draft'\)/.test(svc));
  const forecast = cli('components/campaigns/ForecastPanel.tsx');
  is('the forecast labels each day and says what a gap means', /weekday: 'narrow'/.test(forecast) && /Gaps: days it does not send/.test(forecast));
  const builder = cli('pages/campaigns/CampaignCreatePage.tsx');
  is('preview in Gmail, Outlook or on a phone', /\(\['gmail', 'outlook', 'phone'\] as const\)/.test(builder));
  is('the inbox row comes first: sender, subject, first words', /data-preview-row/.test(builder) && /const preheader = /.test(builder));
  const deck = cli('components/flow/ReplyDeck.tsx');
  is('replies one at a time on a phone, swipe to send or for tomorrow', /const SWIPE = 90;/.test(deck) && /if \(dx > SWIPE && text\.trim\(\)\) send\(\);/.test(deck) && /else if \(dx < -SWIPE\) later\(\);/.test(deck));
  is('nothing is sent without words in it', /disabled=\{!text\.trim\(\)\}/.test(deck));
  is('the deck opens from the Today list on a phone', /data-open-deck/.test(cli('components/flow/TodayQueue.tsx')) && /md:hidden/.test(cli('components/flow/TodayQueue.tsx')));
  for (const page of ['pages/campaigns/CampaignsListPage.tsx', 'pages/sara/SaraQueuePage.tsx', 'pages/assets/AssetBuilderPage.tsx']) {
    is(`${page.split('/').pop()} loads with skeleton rows, not a spinner`, /<SkeletonList rows=/.test(cli(page)));
  }
  is('the metric strip is two by two on a phone', /grid grid-cols-2 sm:flex sm:divide-x/.test(cli('pages/dashboard/DashboardPage.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
