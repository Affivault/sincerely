/* ═══════════════════════════════════════════════════════════════════════
   The deliverability autopilot, and the bounces it learns from.

   - returned-mail notices are read: dead addresses, policy blocks and
     delays told apart, and nothing a person wrote mistaken for one
   - a mailbox is slowed, rested and brought back on evidence, never on a
     handful of sends, and judged afresh after a rest
   - nothing in the send path can reach a resting mailbox
   - a campaign that runs out of mailboxes waits instead of dropping people

   Run: npx tsx scripts/autopilot-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseBounceNotice, looksLikeBounceNotice, classifyRejection,
  judgeMailbox, nextMailboxState, restMailbox, autopilotAllowance, evidenceFrom,
  receivingProvider, judgeProvider, holdHours, AUTOPILOT,
  type MailboxAutopilot,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');
const own = 'alex@affivault.com';

console.log('\nreturned-mail notices are read');
{
  const gmail = parseBounceNotice({ ownAddress: own, fromEmail: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', bodyText:
    "** Address not found **\n\nYour message wasn't delivered to maud@northbeam.io because the address couldn't be found, or is unable to receive mail.\n\nThe response was:\n\nThe email account that you tried to reach does not exist. 550 5.1.1 https://support.google.com/mail/?p=NoSuchUser" });
  is('Gmail: a dead address, and whose', gmail?.kind === 'address' && gmail.recipients[0] === 'maud@northbeam.io' && gmail.status === '5.1.1', JSON.stringify(gmail));

  const outlook = parseBounceNotice({ ownAddress: own, fromEmail: 'postmaster@outlook.com', subject: 'Undeliverable: Quick question', bodyText:
    "Delivery has failed to these recipients or groups:\n\njlee@contoso.com\nThe email address you entered couldn't be found.\n\nRemote Server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup'\nOriginal message headers:\nFrom: Alex <alex@affivault.com>\nTo: <jlee@contoso.com>" });
  is('Outlook: dead, and never the sender\'s own address', outlook?.kind === 'address' && JSON.stringify(outlook.recipients) === '["jlee@contoso.com"]', JSON.stringify(outlook));

  const postfix = parseBounceNotice({ ownAddress: own, fromEmail: 'MAILER-DAEMON@mx.host.com', subject: 'Undelivered Mail Returned to Sender', bodyText:
    '<old@closedco.com>: host mx.closedco.com[1.2.3.4] said: 550 5.1.1 User unknown\n\nFinal-Recipient: rfc822; old@closedco.com\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 User unknown' });
  is('Postfix (RFC 3464 report): read from Final-Recipient', postfix?.kind === 'address' && postfix.recipients[0] === 'old@closedco.com' && postfix.reason === 'user unknown', JSON.stringify(postfix));

  const exim = parseBounceNotice({ ownAddress: own, fromEmail: 'Mailer-Daemon@server.example.net', subject: 'Mail delivery failed: returning message to sender', bodyText:
    'A message that you sent could not be delivered to one or more of its\nrecipients. This is a permanent error. The following address(es) failed:\n\n  gone@deadco.net\n    SMTP error from remote mail server after RCPT TO:<gone@deadco.net>:\n    550 No such user here' });
  is('Exim: the address on its own line', exim?.kind === 'address' && exim.recipients[0] === 'gone@deadco.net', JSON.stringify(exim));

  const blocked = parseBounceNotice({ ownAddress: own, fromEmail: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', bodyText:
    "Your message wasn't delivered to ceo@bigco.com because the remote server rejected it.\n550 5.7.1 [203.0.113.5] Our system has detected that this message is likely unsolicited mail. This message has been blocked." });
  is('a 5.7.x refusal is the sender being blocked, not a dead address', blocked?.kind === 'blocked' && blocked.recipients[0] === 'ceo@bigco.com', JSON.stringify(blocked));

  const delayed = parseBounceNotice({ ownAddress: own, fromEmail: 'postmaster@mail.example.com', subject: 'Delivery Status Notification (Delay)', bodyText:
    'Delivery to the following recipient has been delayed:\n\n     slow@example.org\n\nAction: delayed\nStatus: 4.4.1' });
  is('a delay is soft, and acted on by nobody', delayed?.kind === 'soft');
  const full = parseBounceNotice({ ownAddress: own, fromEmail: 'mailer-daemon@yahoo.com', subject: 'Failure Notice', bodyText: 'Sorry, we were unable to deliver your message to the following address.\n\n<full@yahoo.com>:\n552 4.2.2 mailbox full' });
  is('a full mailbox is soft', full?.kind === 'soft');

  is('a person writing about an undelivered invoice is not a notice',
     !looksLikeBounceNotice({ fromEmail: 'maud@northbeam.io', subject: 'Re: undelivered invoice', bodyText: 'Our invoice was undelivered last week, can you resend?' }));
  is('a newsletter is not a notice', parseBounceNotice({ fromEmail: 'news@brand.com', subject: 'Your weekly digest', bodyText: 'Top stories. Unsubscribe.' }) === null);
  is('a notice naming only our own address is not acted on',
     parseBounceNotice({ ownAddress: own, fromEmail: 'mailer-daemon@x.com', subject: 'Undeliverable', bodyText: 'Your message to alex@affivault.com could not be processed.' }) === null);
  is('an IP address is not read as a status code',
     parseBounceNotice({ ownAddress: own, fromEmail: 'mailer-daemon@x.com', subject: 'Undeliverable', bodyText: 'Delivery to the following recipient failed permanently:\n\n  a@b.io\n\nhost 4.2.2.1 said: 550 no such user' })?.kind === 'address');
}

console.log('\nrefusals at send time are told apart the same way');
{
  is('550 5.1.1 user unknown: address', classifyRejection('550 5.1.1 <x@y.com>: Recipient address rejected: User unknown') === 'address');
  is('554 5.7.1 spam: blocked', classifyRejection('554 5.7.1 Service unavailable; Client host blocked using Spamhaus') === 'blocked');
  is('550 policy rejection without a code: blocked', classifyRejection('550 Message rejected due to poor reputation') === 'blocked');
  const seq = src('services/sequence.service.ts');
  is('a block does not mark the contact bounced', /if \(rejection === 'address'\) \{\s*await supabaseAdmin\s*\.from\('contacts'\)\s*\.update\(\{ is_bounced: true \}\)/.test(seq));
  is('the bounce records which mailbox sent it', /smtp_account_id: err\.smtpAccountId/.test(seq) && /bounce_kind: rejection/.test(seq));
}

console.log('\nnotices reach the contact, the campaign and the mailbox');
{
  const sync = src('services/inbox-sync.service.ts');
  is('a notice is never matched as a reply', /if \(!outbound && !bounceNotice\) \{\s*if \(inReplyTo\)/.test(sync));
  is('the sync reads it on arrival', /if \(bounceNotice\) \{\s*await intakeBounceNotice\(/.test(sync));
  is('Relay never reads it', /!outbound && !bounceNotice && ctx\.aiTaggingOn/.test(sync));
  const intake = src('services/bounce-intake.service.ts');
  is('one notice about one enrolment is one bounce', /\.eq\('activity_type', 'bounced'\);\s*if \(\(count \|\| 0\) > 0\) return false;/.test(intake));
  is('the enrolment stops', /\.update\(\{ status: 'bounced', next_send_at: null \}\)/.test(intake));
  is('only a dead address is suppressed', /if \(notice\.kind === 'address'\) \{[\s\S]{0,300}suppressionService\.add/.test(intake));
  is('the mailbox is charged and the guard asked', /sse\.recordBounce\(accountId\)/.test(intake) && /await guardAfterBounce\(userId, send\.campaign_id\)/.test(intake));
  is('stored notices are swept too', /export async function sweepBounceNotices/.test(src('services/autopilot.service.ts')));
}

console.log('\na mailbox is judged on evidence, not luck');
{
  is('no sends, no verdict', judgeMailbox({ sent: 0, bounced: 0, blocked: 0 }).verdict === 'ok');
  is('2 bounces in 3 sends is bad luck, not evidence', judgeMailbox({ sent: 3, bounced: 2, blocked: 0 }).verdict === 'ok');
  is('5 in 100 is within a normal cold list', judgeMailbox({ sent: 100, bounced: 5, blocked: 0 }).verdict === 'ok');
  is('12 in 200 is climbing: slow', judgeMailbox({ sent: 200, bounced: 12, blocked: 0 }).verdict === 'slow');
  is('15 in 100 is confidently bad: rest', judgeMailbox({ sent: 100, bounced: 15, blocked: 0 }).verdict === 'rest');
  is('one policy block: slow', judgeMailbox({ sent: 80, bounced: 0, blocked: 1 }).verdict === 'slow');
  is('three policy blocks: rest', judgeMailbox({ sent: 80, bounced: 0, blocked: 3 }).verdict === 'rest');
  is('three blocks lost in 1,000 sends: not a rest', judgeMailbox({ sent: 1000, bounced: 0, blocked: 3 }).verdict !== 'rest');
}

console.log('\nrest, recover, and judged afresh');
{
  const t0 = new Date('2026-09-01T09:00:00Z');
  const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
  let m: MailboxAutopilot = { autopilot_state: 'active' };
  const bad = { sent: 100, bounced: 15, blocked: 0 };
  const clean = { sent: 20, bounced: 0, blocked: 0 };

  let t = nextMailboxState(m, bad, t0, 'a@x.com');
  is('a bad week rests it', t.patch?.autopilot_state === 'resting' && t.event?.kind === 'rest');
  is('for two days', t.patch?.autopilot_rest_until === h(48).toISOString());
  m = { ...m, ...t.patch };
  is('a resting mailbox sends nothing', autopilotAllowance({ ...m, daily_send_limit: 50, warmup_mode: false } as any, h(1)).sendable === false);

  t = nextMailboxState(m, bad, h(47), 'a@x.com');
  is('still resting an hour before the end', t.patch === null);
  t = nextMailboxState(m, bad, h(48.5), 'a@x.com');
  is('then recovering', t.patch?.autopilot_state === 'recovering');
  is('and the old bounces no longer count', t.patch?.autopilot_evidence_from === h(48.5).toISOString());
  m = { ...m, ...t.patch };
  is('evidence is read from the rest\'s end, not a week back', evidenceFrom(m, h(49)).getTime() === h(48.5).getTime());
  is('it comes back at a quarter', autopilotAllowance({ ...m, daily_send_limit: 48, warmup_mode: false } as any, h(49)).limit === 12);

  t = nextMailboxState(m, clean, h(48.5 + 25), 'a@x.com');
  is('a day later, half', t.patch?.autopilot_recovery_day === 1 && t.event?.kind === 'recovery_step');
  m = { ...m, ...t.patch };
  t = nextMailboxState(m, clean, h(48.5 + 73), 'a@x.com');
  is('three clean days later, full volume', t.patch?.autopilot_state === 'active' && t.event?.kind === 'recovered');
  m = { ...m, ...t.patch };

  t = nextMailboxState(m, bad, h(200), 'a@x.com');
  is('a second rest within two weeks is four days', t.patch?.autopilot_rest_until === new Date(h(200).getTime() + 96 * 3_600_000).toISOString());

  const rec = { autopilot_state: 'recovering' as const, autopilot_since: t0.toISOString(), autopilot_recovery_day: 0 };
  is('bouncing again while recovering goes straight back to rest', nextMailboxState(rec, bad, h(5)).patch?.autopilot_state === 'resting');
  const slowed = { autopilot_state: 'slowed' as const, autopilot_reason: 'x' };
  is('slowed mailboxes return to full once the signs clear', nextMailboxState(slowed, clean, t0).patch?.autopilot_state === 'active');
  is('a slowed mailbox sends half', autopilotAllowance({ ...slowed, daily_send_limit: 40, warmup_mode: false } as any).limit === 20);
  is('an uncapped one is held to a share of a base, not unlimited',
     autopilotAllowance({ autopilot_state: 'slowed', daily_send_limit: 0, warmup_mode: false } as any).limit === AUTOPILOT.UNCAPPED_BASE / 2);
  is('a rest that ran out but was not stepped yet still starts at a quarter',
     autopilotAllowance({ autopilot_state: 'resting', autopilot_rest_until: t0.toISOString(), daily_send_limit: 40, warmup_mode: false } as any, h(1)).limit === 10);
  is('restMailbox is the one way to rest', /restMailbox\(/.test(src('services/autopilot.service.ts')) && restMailbox({}, 'r', t0).patch?.autopilot_state === 'resting');
}

console.log('\nnothing in the send path reaches a resting mailbox');
{
  const sse = src('services/sse.service.ts');
  is('rotation leaves resting mailboxes out', /autopilotAllowance\(a, now\)\.sendable/.test(sse));
  is('and says why when all of them rest', /Every mailbox this campaign can use is resting/.test(sse));
  const sender = src('services/email-sender.service.ts');
  is('the campaign-default fallback checks it', /fallback && fallbackAllowance\?\.sendable/.test(sender));
  is('the last-resort fallback checks it', /if \(!allowance\.sendable\) continue;/.test(sender));
  is('no path still reads the raw warm-up allowance', !/warmupAllowance\(/.test(sender) && !/warmupAllowance\(/.test(sse));
  const seq = src('services/sequence.service.ts');
  is('mail to a paused provider waits for the pause', /const heldUntil = ownerId \? await providerHeldUntil\(ownerId, cc\.contacts\.email\) : null;/.test(seq));
  is('capacity and readiness count a resting mailbox as nothing',
     /autopilotAllowance\(a\)/.test(src('services/readiness.service.ts')) && /if \(!sendable\) return 0;/.test(src('services/campaign-health.service.ts')));
}

console.log('\nrunning out of mailboxes is a wait, not a loss');
{
  const seq = src('services/sequence.service.ts');
  const stall = seq.slice(seq.indexOf('if (err.stallReason) {'), seq.indexOf('} else {', seq.indexOf('if (err.stallReason) {')));
  is('the contact is put back and retried', /current_step_order: cc\.current_step_order, next_send_at: retryAt/.test(stall) && /return;/.test(stall));
  is('rather than marked error', !/status: 'error'/.test(stall));
}

console.log('\nproviders that push back are paused');
{
  is('gmail and googlemail are one provider', receivingProvider('a@googlemail.com') === 'gmail.com' && receivingProvider('b@gmail.com') === 'gmail.com');
  is('hotmail, live and outlook are one', receivingProvider('a@hotmail.co.uk') === 'outlook.com' && receivingProvider('b@live.com') === 'outlook.com');
  is('a company is its own domain', receivingProvider('ceo@BigCo.com') === 'bigco.com');
  is('three refusals in fifty sends pause it', judgeProvider(50, 3));
  is('two do not', !judgeProvider(50, 2));
  is('three in a thousand do not', !judgeProvider(1000, 3));
  const now = new Date('2026-09-10T00:00:00Z');
  is('twelve hours the first time, a day if it happens again that week',
     holdHours(null, now) === 12 && holdHours('2026-09-08T00:00:00Z', now) === 24 && holdHours('2026-08-01T00:00:00Z', now) === 12);
}

console.log('\nwired in, and visible');
{
  const migration = readFileSync(join(here, '../../supabase/migrations/077_deliverability_autopilot.sql'), 'utf8');
  for (const col of ['autopilot_state', 'autopilot_rest_until', 'autopilot_evidence_from', 'autopilot_holds', 'autopilot_events', 'autopilot_enabled', 'bounce_checked_at']) {
    is(`migration 077 creates ${col}`, migration.includes(col));
  }
  is('the migration has no BEGIN/COMMIT', !/^\s*(begin|commit)\s*;/im.test(migration));
  is('the migration is ASCII', /^[\x00-\x7F]*$/.test(migration));
  is('the scheduler starts with the server', /startAutopilotScheduler\(\)/.test(src('index.ts')));
  is('the routes are mounted', /routes\.use\('\/autopilot', autopilotRoutes\)/.test(src('routes/index.ts')));
  const svc = src('services/autopilot.service.ts');
  is('every transition is conditioned on the state it was judged from', /\.eq\('autopilot_state', account\.autopilot_state \|\| 'active'\)/.test(svc));
  is('without migration 077 it does nothing', /if \(!\(await autopilotReady\(\)\)\) return \{ users: 0, changed: 0 \};/.test(svc));
  is('switching it off lifts every rest and pause', /autopilot_state: 'active'[\s\S]{0,200}\.neq\('autopilot_state', 'active'\)/.test(svc) && /from\('autopilot_holds'\)\.delete\(\)\.eq\('user_id', userId\)/.test(svc));
  is('bounce_rate_7d is a real seven days now', /bounce_rate_7d: rate/.test(svc) && /if \(!\(await autopilotReady\(\)\)\) await recalculateBounceRates\(\)/.test(src('jobs/schedulers/sse-maintenance.scheduler.ts')));
  is('Slack hears about it', /case 'autopilot\.action':/.test(src('services/integrations.service.ts')));
  is('the Email accounts page has the tab', /\{ id: 'autopilot', label: 'Autopilot'/.test(client('pages/smtp/EmailAccountsPage.tsx')));
  is('each mailbox row says when it is held back', /data-autopilot-pill/.test(client('components/delivery/MailboxList.tsx')));
  is('Home mentions it only when there is something to say', /if \(bits\.length === 0\) return null;/.test(client('components/dashboard/AutopilotNote.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
