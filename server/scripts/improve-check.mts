/* ═══════════════════════════════════════════════════════════════════════
   Campaigns that improve themselves - and only ever for the better.

   Run: npx tsx scripts/improve-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IMPROVE, probabilityBBetter, judge, experimentSummary, nextElement, challengerProblems, buildDigest,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

console.log('\ndeciding: 90% sure, on replies, never on noise');
{
  is('equal numbers are a coin toss', Math.abs(probabilityBBetter({ sent: 300, replies: 9 }, { sent: 300, replies: 9 }) - 0.5) < 1e-9);
  is('more replies on B leans to B', probabilityBBetter({ sent: 300, replies: 9 }, { sent: 300, replies: 18 }) > 0.9);
  is('symmetric', Math.abs(probabilityBBetter({ sent: 300, replies: 9 }, { sent: 300, replies: 18 }) + probabilityBBetter({ sent: 300, replies: 18 }, { sent: 300, replies: 9 }) - 1) < 1e-9);
  const early = judge({ sent: 50, replies: 1 }, { sent: 50, replies: 6 }, ago(3));
  is(`nothing is decided before ${IMPROVE.MIN_ARM} sends each, however good it looks`, !early.decided);
  const win = judge({ sent: 150, replies: 4 }, { sent: 150, replies: 12 }, ago(5));
  is('a clear win is called', win.decided && win.outcome === 'won');
  const lose = judge({ sent: 150, replies: 12 }, { sent: 150, replies: 4 }, ago(5));
  is('a clear loss keeps the original', lose.decided && lose.outcome === 'kept');
  const close = judge({ sent: 200, replies: 7 }, { sent: 200, replies: 9 }, ago(5));
  is('70% sure is not sure enough', !close.decided && close.probability > 0.6 && close.probability < 0.9);
  const flat = judge({ sent: 600, replies: 20 }, { sent: 600, replies: 22 }, ago(10));
  is(`no clear difference by ${IMPROVE.MAX_ARM} sends each keeps the original`, flat.decided && flat.outcome === 'kept');
  const stale = judge({ sent: 160, replies: 5 }, { sent: 160, replies: 6 }, ago(IMPROVE.MAX_DAYS + 1));
  is(`after ${IMPROVE.MAX_DAYS} days with enough sends, it ends`, stale.decided && stale.outcome === 'kept');
  const starved = judge({ sent: 20, replies: 0 }, { sent: 20, replies: 1 }, ago(IMPROVE.MAX_DAYS * 2 + 1));
  is('a test that never gets enough people ends, keeping the original', starved.decided && starved.outcome === 'kept');
  const s = experimentSummary({ element: 'subject', email_number: 1 }, { sent: 300, replies: 9 }, { sent: 300, replies: 18 }, 'won', '');
  is('the win reads as a sentence', s === 'A new subject line on email 1 got 100% more replies (6.0% replied to the new version, 3.0% to the original, 300 sends each). It is now the email everyone gets.', s);
  is('so does a keep', /no clear difference .* so the original stays\.$/.test(experimentSummary({ element: 'ask', email_number: 2 }, { sent: 600, replies: 20 }, { sent: 600, replies: 22 }, 'kept', 'no clear difference after enough sends')));
}

console.log('\nwhat to test');
{
  is('the first email starts with its subject', nextElement(1, []) === 'subject');
  is('then the opening, then the ask', nextElement(1, ['subject']) === 'opening' && nextElement(1, ['subject', 'opening']) === 'ask');
  is('follow-ups never test a subject (they ride the thread)', nextElement(2, []) === 'opening' && nextElement(3, ['opening']) === 'ask');
  is('when all are tried, the oldest comes round again', nextElement(1, ['subject', 'opening', 'ask']) === 'subject');
}

console.log('\nwhat Relay may not change');
{
  const original = { subject: 'quick question', body_html: '<p>Hi {{first_name|there}},</p><p>We help brokers grow.</p><p>See https://affivault.com - worth a call?</p>' };
  is('a good subject change passes', challengerProblems(original, { subject: 'brokers and partners', body_html: null }, 'subject').length === 0);
  is('an empty subject is refused', challengerProblems(original, { subject: ' ', body_html: null }, 'subject').length > 0);
  is('a shouty subject is refused (reads more like spam)', challengerProblems(original, { subject: 'FREE OFFER TODAY!', body_html: null }, 'subject').some((p) => /spam/.test(p)));
  const opening = { subject: null, body_html: '<p>Hi {{first_name|there}},</p><p>Saw you are expanding in the UK.</p><p>See https://affivault.com - worth a call?</p>' };
  is('a good opening change passes', challengerProblems(original, opening, 'opening').length === 0, challengerProblems(original, opening, 'opening').join(' '));
  is('a dropped merge tag is refused', challengerProblems(original, { subject: null, body_html: '<p>Hi there,</p><p>Saw you are expanding.</p><p>See https://affivault.com - worth a call?</p>' }, 'opening').some((p) => /merge tags/.test(p)));
  is('a changed link is refused', challengerProblems(original, { subject: null, body_html: '<p>Hi {{first_name|there}},</p><p>Saw you are expanding.</p><p>See https://bit.ly/x - worth a call?</p>' }, 'opening').some((p) => /links/.test(p)));
  is('a rewrite of the whole email is refused', challengerProblems(original, { subject: null, body_html: '<p>Hi {{first_name|there}}, see https://affivault.com</p>' }, 'opening').some((p) => /too much/.test(p)));
}

console.log('\nthe engine');
{
  const svc = src('services/experiments.service.ts');
  is('judged on replies credited to the version each person got', /readVariant\(\(r as any\)\.metadata\)/.test(svc) && /activity_type', 'replied'\)/.test(svc));
  is('opens are never read', !/'opened'/.test(svc));
  is('only sends since the test began count', (svc.match(/\.gte\('occurred_at', since\)/g) || []).length === 2);
  is('a test set up by hand is never written over', /A test the person set up by hand is theirs/.test(svc));
  is('a person editing the email mid-test ends the test', /the email was edited while the test was running/.test(svc));
  is('it asks first unless the campaign runs tests without asking', /if \(campaign\.relay_improve_auto\) await start\(/.test(svc) && /'relay\.test_proposed'/.test(svc));
  is('a challenger that fails the checks is never proposed', /const problems = challengerProblems\(original, challenger, element\);\s*if \(problems\.length === 0\) written = draft;/.test(svc));
  is('a win becomes the email; a keep clears the test', /ab_promoted_variant: 'b'/.test(svc) && /await clearStep\(e\);/.test(svc));
  is('undo only while the email is still the winner', /The email has been changed since, so there is nothing to undo/.test(svc));
  is('switching it off ends a live test with the original in place', /Switching it off ends a live test/.test(svc));
  is('it waits after a skip rather than nagging', /COOLDOWN_AFTER_SKIP_MS/.test(svc));
  is('not enough people left is said, not pretended', /Not enough people left to learn from/.test(svc));
  is('the old open-based promoter leaves Relay\'s tests alone', /relayOwned\.has\(step\.step_id\)/.test(src('jobs/schedulers/ab-promote.scheduler.ts')));
  is('the hourly job runs with a heartbeat', /beat\('improve', tick\)/.test(src('jobs/schedulers/improve.scheduler.ts')) && /startImproveScheduler\(\)/.test(src('index.ts')));
  const d = buildDigest({ from_day: 'a', to_day: 'b', sent: 10, replies: 1, positive: 0, meetings: 0, bounced: 0, complaints: 0, waiting: 0, campaigns: [], attention: [], learned: ['Q4: A new subject line on email 1 got 40% more replies.'] });
  is('the weekly digest says what Relay learned', /What Relay learned\n- Q4: A new subject line/.test(d.text));
  is('the campaign page shows it', /<ImproveCard campaignId=\{id\} \/>/.test(client('pages/campaigns/CampaignDetailPage.tsx')));
  const card = client('components/campaigns/ImproveCard.tsx');
  is('Approve, Edit, Skip - and run without asking', /Approve and start test/.test(card) && /> Edit/.test(card) && /'Skip'/.test(card) && /Run new tests without asking me first/.test(card));
  const migration = readFileSync(join(here, '../../supabase/migrations/082_self_improving_campaigns.sql'), 'utf8');
  is('migration 082: the switches and the tests', /relay_improve boolean/.test(migration) && /relay_improve_auto boolean/.test(migration) && /create table if not exists campaign_experiments/.test(migration));
  is('one live test per campaign, enforced by the database', /create unique index if not exists idx_campaign_experiments_one_live/.test(migration));
  is('the migration is ASCII with no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(begin|commit)\s*;/im.test(migration));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
