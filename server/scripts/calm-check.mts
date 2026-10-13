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
  is('Reply queue and Leads inbox are out of the bar but still searchable', /label: 'Reply queue'.*hidden: true/.test(sections) && /label: 'Leads inbox'.*hidden: true/.test(sections) && /filter\(\(tab\) => !tab\.hidden/.test(cli('components/layout/SectionBar.tsx')));
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
