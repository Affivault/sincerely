/* ═══════════════════════════════════════════════════════════════════════
   Doing the right thing with replies that arrive - and with what is sent.

   - an out-of-office holds the next email until the day after they are
     back, read from the reply itself, and never stops the sequence
   - a reply that hands you on to somebody is found, and reaching them is
     one step that rides the campaign's own matching and follow-ups
   - the launch review reads the emails for what filters punish

   Run: npx tsx scripts/reply-handling-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readAbsence, awayLabel, AWAY_DEFAULT_HOLD_DAYS, findReferrals, referralIntro,
  checkEmailContent, applyContentFixes, launchGate,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

console.log('\nan out-of-office holds the next email');
{
  const fri = Date.UTC(2026, 9, 2, 10); // Friday 2 October 2026
  const back = (text: string) => readAbsence(text, fri).returns_on;
  is('"until Wednesday 14th October"', back("I'm out of the office until Wednesday 14th October.") === '2026-10-14');
  is('"back on 19/10/2026"', back('I am on annual leave and will be back on 19/10/2026.') === '2026-10-19');
  is('"from 2 Oct to 9 Oct" is back after the 9th', back("I'm away from 2 Oct to 9 Oct.") === '2026-10-09');
  is('"returning Monday", not fooled by "Mon-Fri"', back('Out of office: returning Monday. Office hours Mon-Fri 9-5.') === '2026-10-05');
  is('"October 20, 2026"', back('I will be back in the office on October 20, 2026.') === '2026-10-20');
  is('"back next week" is next Monday', back("I'm on holiday and will reply when I'm back next week.") === '2026-10-05');
  is('"until January" is the 1st', back("I'm on parental leave until January.") === '2027-01-01');
  is('an event date is not a return date', back('Our event is on 15 December. I am out of office until 6th October.') === '2026-10-06');
  is('a time is not a date ("9.30")', back('Back tomorrow. Meeting at 9.30 is still on.') === '2026-10-03');
  is('an ambiguous 10/12 takes the nearer reading', back('I am away until 10/12.') === '2026-10-12');
  is('a date in the past is ignored', back('I was away until 1 September.') === null);
  is('a date far off is ignored', back('Back on 1 March 2028.') === null);
  const none = readAbsence('Automatic reply: travelling with limited access.', fri);
  is(`no date: a ${AWAY_DEFAULT_HOLD_DAYS}-day hold`, none.returns_on === null && none.resume_at.startsWith('2026-10-05'));
  is('resume is the day after they are back', readAbsence('Back on 14 October.', fri).resume_at.startsWith('2026-10-15'));
  is('the note says why the sequence is quiet', /Out of office until 14 Oct - next email waits until 15 Oct/.test(awayLabel('2026-10-15T08:00:00.000Z', '2026-10-14', fri) || ''));
  is('...and goes once they are back', awayLabel('2026-10-15T08:00:00.000Z', '2026-10-14', Date.UTC(2026, 9, 16)) === null);

  const sync = src('services/inbox-sync.service.ts');
  is('inbox sync holds on an out-of-office', /autoReply\.kind === 'out_of_office'\) \{\s*await holdForAbsence\(/.test(sync));
  const svc = src('services/absence.service.ts');
  is('only emails due before they are back move', /\.lt\('next_send_at', reading\.resume_at\)/.test(svc) && /\.in\('status', \['pending', 'active'\]\)/.test(svc));
  is('one that Relay recognised is put back, if it was the only reply', /others\.length > 0 \|\| \(replies \|\| \[\]\)\.length === 0\) return false/.test(svc));
  is('Relay calls it on an out-of-office', /SaraIntent\.OutOfOffice && result\.confidence >= 0\.8/.test(src('services/sara.service.ts')));
  is('the contact page shows it', /away=\{\{ until:/.test(client('pages/contacts/ContactDetailPage.tsx')) && /data-away/.test(client('components/crm/WhereWeAre.tsx')));
}

console.log('\nreferrals');
{
  const own = ['alex@affivault.com'];
  const find = (body: string) => findReferrals({ body, senderEmail: 'jane@acme.com', ownAddresses: own });
  const r1 = find("I'm not the right person. Please reach out to Sam Patel (sam.patel@acme.com), he looks after partnerships.");
  is('the address and name are found', r1.length === 1 && r1[0].email === 'sam.patel@acme.com' && r1[0].first_name === 'Sam' && r1[0].last_name === 'Patel');
  is('"copying in Priya <priya@...>"', find('Copying in my colleague Priya <priya@acme.com> who handles this.')[0]?.first_name === 'Priya');
  is('a name from the address itself', find('You should speak with tom.h@acme.com')[0]?.first_name === 'Tom');
  is('a role address has no name', find('Best person is partnerships@acme.com')[0]?.first_name === null);
  is('a signature is not a referral', find('Not for us.\n\nKind regards,\nJane\njane@acme.com | ops@acme.com').length === 0);
  is('your own address is not a referral', find('Contact alex@affivault.com').length === 0);
  is('the quoted history is not read', find('Talk to Sam.\n\nOn Tue, Alex wrote:\n> reach out to bob@acme.com').length === 0);
  is('an address with no hand-off words is not one', find('Our office is at hello@acme.com, see you there.').length === 0);
  const intro = referralIntro({ toFirstName: 'Sam', referrerFirstName: 'Jane', referrerCompany: 'Acme', offer: 'We run affiliate partnerships for UK platforms. More text.', senderFirstName: 'Alex' });
  is('the intro opens with who suggested it', /^Hi Sam,\n\nJane at Acme suggested I get in touch/.test(intro.body) && intro.subject === 'Jane suggested I reach out');

  const ref = src('services/referral.service.ts');
  is('a suppressed address is refused', /isSuppressed\(userId, email\)/.test(ref));
  is('already in the campaign is refused before sending', ref.indexOf('is already in') < ref.indexOf('inboxService.compose('));
  is('the intro is recorded as the first send, so a reply matches', /activity_type: 'sent',\s*message_id: sent\.message_id/.test(ref));
  is('the follow-ups run from step two', /await advanceToNextStep\(cc\.id, firstEmail\.step_order, steps\)/.test(ref));
  is('the conversation shows the offer', /<ReferralCard/.test(client('pages/inbox/InboxPage.tsx')));
}

console.log('\nthe launch review reads the emails');
{
  const steps = [
    { step_order: 0, subject: 'Re: FREE OFFER TODAY!', body_html: '<p>Hi {{first_name|there}}, act now and click here: https://bit.ly/x https://a.com https://b.com https://c.com https://d.com</p>' },
    { step_order: 1, subject: '', body_html: '<p>Just a thought, no obligation.</p>' },
  ];
  const issues = checkEmailContent(steps, { sendingDomains: ['affivault.com'] });
  const codes = new Set(issues.map((i) => i.code));
  for (const c of ['fake_reply', 'subject_caps', 'subject_bang', 'phrase', 'links', 'shortener', 'link_domain'] as const) is(`finds ${c}`, codes.has(c));
  is('the second email is named as such', issues.some((i) => i.email === 2 && /no obligation/.test(i.message)));
  is('a clean email is clean', checkEmailContent([{ step_order: 0, subject: 'quick question', body_html: '<p>Hi {{first_name|there}}, worth a call? https://affivault.com</p>' }], { sendingDomains: ['affivault.com'] }).length === 0);
  is('merge tags are never judged', checkEmailContent([{ step_order: 0, subject: 'hi', body_text: 'Hi {{FREE_GIFT|there}}' }]).length === 0);
  const fixed = applyContentFixes(steps[0], issues.filter((i) => i.email === 1 && i.replace).map((i) => i.replace!));
  is('rewrites apply, keeping capitals', /Hi \{\{first_name\|there\}\}, when you have a moment and have a look:/.test(fixed.body_html || ''), fixed.body_html || '');
  is('links are never rewritten', /https:\/\/bit\.ly\/x/.test(fixed.body_html || ''));
  is('an image-heavy email is flagged', checkEmailContent([{ step_order: 0, subject: 'hi', body_html: '<img src="x.png"><p>Hi</p>' }])[0]?.code === 'image_heavy');

  const svc = src('services/content-check.service.ts');
  is('a warning, never a block', !/status: 'fail'/.test(svc));
  const report = { verdict: 'risky' as const, checks: [{ id: 'content', group: 'content' as const, label: 'Email content', status: 'warn' as const, headline: '', detail: null, fix: null, facts: [] }] };
  is('so the launch asks once instead of refusing', launchGate(report).gate === 'risky');
  is('launching reads the campaign\'s emails', /readinessService\.report\(userId, \{ campaignId: id \}\)/.test(src('services/campaigns.service.ts')));
  is('the review re-reads with the campaign after a fix', /readinessApi\.get\(campaignId\)/.test(client('components/campaigns/LaunchPreflight.tsx')));
  is('the rewrite runs in place', /case 'apply_content_fixes':/.test(client('components/campaigns/InlineFix.tsx')));
  is('no query passes React Query\'s context as a campaign id', !/queryFn: readinessApi\.get\b/.test(client('components/delivery/ReadinessPanel.tsx')));
  const migration = readFileSync(join(here, '../../supabase/migrations/080_out_of_office_hold.sql'), 'utf8');
  is('migration 080 adds the note columns', /away_until/.test(migration) && /away_returns_on/.test(migration) && /away_note/.test(migration));
  is('the migration is ASCII with no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(begin|commit)\s*;/im.test(migration));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
