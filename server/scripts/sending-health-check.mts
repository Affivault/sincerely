/* ═══════════════════════════════════════════════════════════════════════
   Sending health, bulk pace, comparisons and CSV: the rules, asserted.

   The verdict a mailbox gets decides what somebody does next, so the
   order of the rules matters as much as the rules: a mailbox that cannot
   sign in must say so before it says anything about DMARC. And a CSV
   that runs a formula when it is opened is a security bug, not a
   formatting one.

   Run: npx tsx scripts/sending-health-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  judgeSendingHealth, csvCell, toCsv, dailyLimitProblem, MAX_BULK_DAILY_LIMIT, percentOf, senderRow,
} = await import('@lemlist/shared');

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

const now = new Date('2026-10-01T12:00:00Z');
const good = {
  is_active: true, is_verified: true, last_send_error: null, created_at: '2026-01-01T00:00:00Z',
  daily_send_limit: 40, gap_min: 120, gap_max: 300, warmup_on: false,
  autopilot_state: 'active' as const, autopilot_reason: null,
  sent_14d: 400, bounced_14d: 2, blocked_14d: 0, complained_14d: 0,
  domain: { domain: 'acme.test', domain_id: 'd1', checked: true, spf: true, dkim: true, dmarc: true, last_checked_at: '2026-09-30T00:00:00Z' },
  placement: { test_id: 't', at: '2026-09-29T00:00:00Z', verdict: 'good' as const, inbox_rate: 1, headline: 'All in.' },
};

console.log('\na mailbox gets one verdict, worst first');
{
  const v = judgeSendingHealth(good, now);
  is('a clean mailbox is healthy', v.status === 'healthy', v.reason);
  is('and has nothing it must do', v.next_step.kind === 'none');

  const broken = judgeSendingHealth({ ...good, last_send_error: 'Authentication failed', domain: { ...good.domain, dmarc: false } }, now);
  is('a refused sign-in is at risk', broken.status === 'at_risk');
  is('and is the reason shown before the DNS', /Authentication failed/.test(broken.reason), broken.reason);
  is('with reconnecting as the step', broken.next_step.kind === 'reconnect');
  is('and DMARC still listed', broken.findings.some((f) => /DMARC/.test(f.text)));

  const noDkim = judgeSendingHealth({ ...good, domain: { ...good.domain, dkim: false } }, now);
  is('missing DKIM is at risk', noDkim.status === 'at_risk' && noDkim.next_step.kind === 'authenticate_domain');

  const unknown = judgeSendingHealth({ ...good, domain: { ...good.domain, checked: false, domain_id: null } }, now);
  is('an unchecked domain is watched, not passed', unknown.status === 'watch' && unknown.next_step.label === 'Check the domain');

  const resting = judgeSendingHealth({ ...good, autopilot_state: 'resting', autopilot_reason: '3 receiving servers refused it' }, now);
  is('a resting mailbox is at risk, and says why', resting.status === 'at_risk' && /refused it/.test(resting.reason));

  const bouncing = judgeSendingHealth({ ...good, sent_14d: 200, bounced_14d: 30 }, now);
  is('a high bounce rate is at risk, on the autopilot rules', bouncing.status === 'at_risk' && bouncing.next_step.kind === 'slow_pace', bouncing.reason);

  const few = judgeSendingHealth({ ...good, sent_14d: 3, bounced_14d: 2 }, now);
  is('two bounces in three sends is not evidence', few.status === 'healthy', few.reason);

  const spam = judgeSendingHealth({ ...good, placement: { ...good.placement, verdict: 'poor', inbox_rate: 0.3, headline: '2 of 6 reached the inbox.' } }, now);
  is('poor placement is at risk', spam.status === 'at_risk' && spam.next_step.kind === 'run_placement');

  const fast = judgeSendingHealth({ ...good, daily_send_limit: 0, gap_min: 0, gap_max: 0 }, now);
  is('no limit and no gap is watched', fast.status === 'watch' && fast.next_step.kind === 'slow_pace');

  const fresh = judgeSendingHealth({ ...good, created_at: '2026-09-28T00:00:00Z' }, now);
  is('a new mailbox without warm-up is told to warm up', fresh.status === 'watch' && fresh.next_step.kind === 'start_warmup');

  const untested = judgeSendingHealth({ ...good, placement: null }, now);
  is('healthy but never tested suggests a placement test', untested.status === 'healthy' && untested.next_step.kind === 'run_placement');
}

console.log('\na pace on many mailboxes is held to sane numbers');
{
  is('the recommended limit passes', dailyLimitProblem(40) === null);
  is('zero (uncapped) is refused in bulk', dailyLimitProblem(0) !== null);
  is('a fraction is refused', dailyLimitProblem(12.5) !== null);
  is('above the bulk ceiling is refused', dailyLimitProblem(MAX_BULK_DAILY_LIMIT + 1) !== null);
  const svc = src('services/smtp.service.ts');
  is('the endpoint checks the gap and the limit', /dailyLimitProblem\(limit\)/.test(svc) && /gapProblem\(min, max\)/.test(svc));
  is('and writes only the caller\'s rows', /\.update\(patch\)\s*\.eq\('user_id', userId\)\s*\.in\('id', ids\)/.test(svc));
  is('and says how many actually changed', /changed: changed\.length/.test(svc));
}

console.log('\na CSV cell never runs as a formula');
{
  is('= is neutralised', csvCell('=HYPERLINK("x")') === `"'=HYPERLINK(""x"")"`, csvCell('=HYPERLINK("x")'));
  is('+ - @ are too', ['+1', '-cmd', '@SUM(A1)'].every((v) => csvCell(v).startsWith("'")));
  is('a real negative number is left a number', csvCell(-3) === '-3');
  is('commas and quotes are quoted', csvCell('a, "b"') === '"a, ""b"""');
  is('a sheet is a header and rows', toCsv(['A', 'B'], [[1, 'x']]) === 'A,B\n1,x');
  const pages = ['pages/companies/CompaniesPage.tsx', 'pages/suppression/SuppressionPage.tsx', 'pages/crm/DealsPage.tsx', 'pages/leads/LeadsPage.tsx', 'pages/analytics/RevenuePage.tsx'];
  is('no page keeps its own unguarded csvCell', pages.every((p) => !/function csvCell/.test(client(p))));
}

console.log('\ncomparisons count people, as the rest of analytics does');
{
  is('a rate is over its denominator, to one decimal', percentOf(1, 3) === 33.3 && percentOf(5, 0) === 0);
  const row = senderRow({ key: 'k', label: 'k', email: null, domain: null },
    { sent: 10, reached: 8, attempted: 10, opened: 4, clicked: 1, replied: 2, bounced: 2, complained: 0 });
  is('reply rate is of the people reached', row.reply_rate === 25);
  is('bounce rate is of everyone attempted', row.bounce_rate === 20);
  const cmp = src('services/comparison.service.ts');
  is('compare uses the campaign stats function', /rpc\('get_campaigns_stats'/.test(cmp));
  is('and checks the campaigns are the caller\'s first', cmp.indexOf(".eq('user_id', userId)") < cmp.indexOf("rpc('get_campaigns_stats'"));
  is('by sender reads which mailbox from the send', /metadata->>smtp_account_id/.test(cmp));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} sending health check(s) failed`);
