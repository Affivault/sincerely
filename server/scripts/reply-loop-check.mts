/* ═══════════════════════════════════════════════════════════════════════
   Replies stop sequences - provably - and you hear about what matters.

   - the reply check drives the same matching and stopping a real reply
     does, cleans up after itself, and is never seen as mail or a reply
   - each Notifications switch sends what it says, and only that
   - the weekly digest is due once a week, Monday 08:00 local
   - spam complaint reports are read, acted on, and slow the mailbox

   Run: npx tsx scripts/reply-loop-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseComplaintReport, looksLikeComplaintReport, notificationFor, buildDigest, digestDue, digestSlot,
  judgeMailbox, readSystemMailHeader, replyCheckTokenIn, replyCheckSubject, replyCheckDue,
  explainReplyCheckFailure, REPLY_CHECK_STAGES, AUTOPILOT, INTEGRATION_CATALOG,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

console.log('\nthe reply check rides the real path');
{
  const sync = src('services/inbox-sync.service.ts');
  is('replies are matched by one function', /const matchedActivity: any = [^;]*await matchSend\(userId, inReplyTo, contactId\)/.test(sync));
  is('...and stopped by one function', /await recordReplyAndStop\(userId, matchedActivity, \{/.test(sync));
  is('the check uses both, unchanged', /await matchSend\(msg\.userId, msg\.inReplyTo, null\)/.test(sync) && /await recordReplyAndStop\(msg\.userId, matched,/.test(sync));
  is('system mail is handled before anything stores or reads it',
     sync.indexOf('if (await handleSystemMail(') > 0 && sync.indexOf('if (await handleSystemMail(') < sync.indexOf("from('inbox_messages')\n    .insert(row)"));
  is('a bounce or out-of-office about the check is not an answer', /looksLikeBounceNotice\(\{ fromEmail: msg\.fromEmail/.test(sync) && /autoReply\.kind \|\| !msg\.inReplyTo/.test(sync));
  const rc = src('services/reply-check.service.ts');
  is('the answer is threaded like a person\'s', /'In-Reply-To': messageId, References: messageId/.test(rc));
  is('it waits on the database, which any server\'s sync can satisfy', /status === 'replied'\) \{ stopped = true/.test(rc));
  is('what it creates is removed, whatever happened', /finally \{\s*await cleanUp\(userId\)/.test(rc));
  is('one at a time per account', /if \(running\.has\(userId\)\)/.test(rc));
  is('the placeholders never show in lists',
     /\.neq\('name', REPLY_CHECK_CAMPAIGN_NAME\)/.test(src('services/campaigns.service.ts'))
     && /REPLY_CHECK_CONTACT_DOMAIN\}`\)/.test(src('services/contacts.service.ts')));
  is('the system header is read', readSystemMailHeader('reply-check 0123456789abcdef')?.token === '0123456789abcdef' && readSystemMailHeader('notice')?.kind === 'notice' && readSystemMailHeader('nonsense') === null);
  is('the subject carries the token for header-stripping providers', replyCheckTokenIn(`Re: ${replyCheckSubject('0123456789abcdef')}`) === '0123456789abcdef');
  is('every stage has words for its failure', REPLY_CHECK_STAGES.every((s) => explainReplyCheckFailure(s, { from: 'a@x.com', to: 'b@x.com' }).length > 20));
  is('daily: due after a day, not before', replyCheckDue(null) && replyCheckDue(new Date(Date.now() - 25 * 3_600_000).toISOString()) && !replyCheckDue(new Date(Date.now() - 3_600_000).toISOString()));
  const sched = src('jobs/schedulers/reply-check.scheduler.ts');
  is('a failed automatic check is retried an hour later before it counts', /consecutive_failures === 1/.test(sched));
  is('automatic checks wait for the migration', /if \(!\(await replyCheckService\.ready\(\)\)\) return;/.test(sched));
  is('only two failures in a row are raised', /consecutive_failures >= 2/.test(src('services/system-status.service.ts')));
  is('the status page shows it', /<ReplyCheckCard status=\{data\.reply_check\}/.test(client('pages/system/SystemStatusPage.tsx')));
}

console.log('\neach switch sends what it says');
{
  const map: Array<[string, Record<string, unknown>, string]> = [
    ['system.attention', { key: 'k', title: 'X cannot send', detail: 'd' }, 'email_notifications'],
    ['email.complained', { email: 'a@b.com' }, 'email_notifications'],
    ['campaign.paused', { campaign_id: '1', reason: 'bounce_rate', sent: 50, bounced: 6 }, 'campaign_alerts'],
    ['campaign.completed', { campaign_id: '1' }, 'campaign_alerts'],
    ['email.replied', { from: 'a@b.com', subject: 'Re: hi' }, 'reply_notifications'],
  ];
  for (const [ev, data, setting] of map) is(`${ev} -> ${setting}`, notificationFor(ev, data)?.setting === setting);
  is('your own launch, pause and resume are not emailed', notificationFor('campaign.launched', { campaign: { id: '1' } }) === null
     && notificationFor('campaign.paused', { campaign: { id: '1' } }) === null && notificationFor('campaign.resumed', {}) === null);
  is('opens and clicks are not emailed', notificationFor('email.opened', {}) === null && notificationFor('email.clicked', {}) === null);
  is('a bounce-guard pause says why', /bounce guard/.test(notificationFor('campaign.paused', { reason: 'bounce_rate', sent: 50, bounced: 6 })!.text));
  const notify = src('services/notify.service.ts');
  is('every event reaches the notifier', /import\('\.\/notify\.service\.js'\)\s*\.then\(\(m\) => m\.notifyForEvent\(userId, eventType, data\)\)/.test(src('services/webhook.service.ts')));
  is('the switch is asked first', /if \(!\(await wants\(userId, mail\.setting\)\)\) return;/.test(notify));
  is('reply emails are capped per hour', /REPLY_EMAILS_PER_HOUR/.test(notify));
  is('notifications are marked as system mail', /\[SYSTEM_MAIL_HEADER\]: 'notice'/.test(notify));
  const settings = client('pages/settings/SettingsPage.tsx');
  is('Settings describes what each switch actually sends', /At most 20 an hour/.test(settings) && /Monday at 8am in your time zone/.test(settings));
}

console.log('\nthe weekly digest');
{
  // Wednesday 1 October 2026, 12:00 UTC.
  const wed = Date.UTC(2026, 9, 1, 12);
  const slot = digestSlot(wed, 'Europe/London');
  is('the slot is Monday 08:00 London (07:00 UTC in BST)', slot.toISOString() === '2026-09-28T07:00:00.000Z', slot.toISOString());
  is('due when nothing was sent this week', digestDue(null, wed, 'Europe/London'));
  is('not due once sent after the slot', !digestDue('2026-09-28T07:30:00.000Z', wed, 'Europe/London'));
  is('due again after next Monday 08:00', digestDue('2026-09-28T07:30:00.000Z', Date.UTC(2026, 9, 5, 8), 'Europe/London'));
  is('not before 08:00 on Monday', !digestDue('2026-09-28T07:30:00.000Z', Date.UTC(2026, 9, 5, 6, 30), 'Europe/London'));
  is('a nonsense time zone falls back to UTC', digestSlot(wed, 'Not/AZone').toISOString() === '2026-09-28T08:00:00.000Z');
  const d = buildDigest({ from_day: 'Mon 21 Sept', to_day: 'Sun 27 Sept', sent: 420, replies: 21, positive: 6, meetings: 3, bounced: 4, complaints: 1, waiting: 5, campaigns: [{ name: 'Q4', sent: 400, replies: 20 }], attention: [{ title: 'x cannot send', detail: '' }] });
  is('subject leads with the week', d.subject === 'Your week: 420 sent, 21 replies, 3 meetings', d.subject);
  is('says what is waiting on you', /5 replies are waiting for an answer from you/.test(d.text));
  is('a quiet week says so plainly', buildDigest({ from_day: 'a', to_day: 'b', sent: 0, replies: 0, positive: 0, meetings: 0, bounced: 0, complaints: 0, waiting: 0, campaigns: [], attention: [] }).subject === 'Your week: nothing went out');
  const svc = src('services/digest.service.ts');
  is('the week is claimed before it is sent', /Claim it first/.test(svc) && /\.eq\('last_digest_sent_at', \(r as any\)\.last_digest_sent_at\)/.test(svc));
  is('it waits for the migration rather than repeat itself', /last_digest_sent_at\/\.test\(error\.message\)\) \{ columnMissing = true; return \{ sent: 0 \}; \}/.test(svc));
}

console.log('\nspam complaints');
{
  const arf = [
    'This is an email abuse report for an email message received from IP 203.0.113.9.',
    '',
    'Feedback-Type: abuse',
    'User-Agent: Yahoo!-Mail-Feedback/2.0',
    'Version: 1',
    'Original-Rcpt-To: Jane@Example.com',
    'Reported-Domain: acme.io',
    '',
    'Received: from mail.acme.io',
    'From: Alex <alex@acme.io>',
    'To: jane@example.com',
    'Subject: quick question',
    'Message-ID: <0a1b2c3d-1111-4222-8333-444455556666@acme.io>',
    'X-Sincerely-Campaign: 11111111-2222-4333-8444-555555555555',
    'X-Sincerely-Contact: 66666666-7777-4888-9999-000000000000',
    'X-Sincerely-Step: 99999999-8888-4777-8666-555555555555',
  ].join('\n');
  const r = parseComplaintReport({ fromEmail: 'feedback@arf.mail.yahoo.com', contentType: 'multipart/report; report-type=feedback-report', text: arf });
  is('an ARF report is read', !!r && r.feedbackType === 'abuse');
  is('the provider is named', r?.provider === 'Yahoo');
  is('our headers name the contact and campaign', r?.contactId === '66666666-7777-4888-9999-000000000000' && r?.campaignId === '11111111-2222-4333-8444-555555555555');
  is('the original Message-ID is found', r?.originalMessageId === '<0a1b2c3d-1111-4222-8333-444455556666@acme.io>');
  is('the recipient is read and lowercased', r?.recipient === 'jane@example.com');
  is('a not-spam report is not a complaint', parseComplaintReport({ fromEmail: 'x@y.com', contentType: 'multipart/report; report-type=feedback-report', text: 'Feedback-Type: not-spam\n' }) === null);
  is('an ordinary reply is not a report', !looksLikeComplaintReport({ fromEmail: 'jane@example.com', subject: 'Re: quick question', text: 'Sounds good, Thursday?' }));
  is('a redacted report still finds the send', parseComplaintReport({ fromEmail: 'staff@hotmail.com', subject: 'complaint about message from 203.0.113.9', text: 'Message-ID: <abc@acme.io>\nTo: [redacted]\n' })?.originalMessageId === '<abc@acme.io>');
  is('a forged contact id is ignored', parseComplaintReport({ fromEmail: 'x@y.com', text: 'Feedback-Type: abuse\nX-Sincerely-Contact: not-a-uuid\n' })?.contactId === null);

  is('one complaint slows a mailbox', judgeMailbox({ sent: 500, bounced: 0, blocked: 0, complained: 1 }).verdict === 'slow');
  is(`${AUTOPILOT.REST_COMPLAINTS} complaints rest it`, judgeMailbox({ sent: 500, bounced: 0, blocked: 0, complained: 2 }).verdict === 'rest');
  is('none changes nothing', judgeMailbox({ sent: 500, bounced: 0, blocked: 0 }).verdict === 'ok');

  const sync = src('services/inbox-sync.service.ts');
  is('reports are read from attached parts too', /message\\\/\(feedback-report\|rfc822\)/.test(sync));
  is('a report is never matched as a reply', /!outbound && !bounceNotice && !complaint \? await matchSend/.test(sync));
  is('...nor read by Relay', /!bounceNotice && !complaint && ctx\.aiTaggingOn/.test(sync));
  const intake = src('services/complaint-intake.service.ts');
  is('the person is suppressed as complained', /suppressionService\.add\(userId, t\.email, 'complained'/.test(intake));
  is('every sequence to them stops', /status: 'unsubscribed', next_send_at: null/.test(intake) && /\.in\('status', \['pending', 'active', 'paused'\]\)/.test(intake));
  is('recorded once per enrolment', /const first = \(count \|\| 0\) === 0;/.test(intake));
  is('the autopilot counts them per mailbox', /\['sent', 'bounced', 'complained'\]/.test(src('services/autopilot.service.ts')));
  is('the Autopilot page shows them', /<ComplaintsCard \/>/.test(client('components/delivery/AutopilotPanel.tsx')));
}

console.log('\nchat integrations hear about problems');
{
  const slack = INTEGRATION_CATALOG.find((p) => p.id === 'slack')!;
  for (const e of ['system.attention', 'system.resolved', 'email.complained']) {
    is(`Slack can subscribe to ${e}`, slack.supportedEvents.includes(e));
    is(`...and does by default`, slack.defaultEvents.includes(e));
  }
  is('the integration settings can offer them', /'system\.attention': 'Something needs attention'/.test(client('pages/integrations/IntegrationsPage.tsx')));
  const migration = readFileSync(join(here, '../../supabase/migrations/079_reply_check_and_notifications.sql'), 'utf8');
  is('existing chat integrations are subscribed by the migration', /update user_integrations/.test(migration) && /'system\.attention', 'system\.resolved', 'email\.complained'/.test(migration));
  is('migration 079 creates what the code reads', /create table if not exists reply_checks/.test(migration) && /reply_check_daily/.test(migration) && /last_digest_sent_at/.test(migration));
  is('the migration is ASCII with no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(begin|commit)\s*;/im.test(migration));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
