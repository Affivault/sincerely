/* ═══════════════════════════════════════════════════════════════════════
   Results say what outreach produced - truthfully - and can be shared.

   Run: npx tsx scripts/results-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resultsPeriod, previousPeriod, resultsHeadline, change, changeText, addMoney, moneyText, emptyNumbers,
  monthlyResultsDue, buildResultsEmail, rateOf, type ResultsNumbers, type ResultsReport,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

console.log('\nperiods, in the account\'s own time zone');
{
  const now = Date.UTC(2026, 9, 5, 12); // 5 Oct 2026
  const tm = resultsPeriod('this_month', now, 'Europe/London');
  is('this month starts at local midnight on the 1st (23:00 UTC in BST)', tm.from === '2026-09-30T23:00:00.000Z', tm.from);
  is('...is partial, and ends now', tm.partial && tm.to === new Date(now).toISOString() && tm.label === 'October 2026');
  const lm = resultsPeriod('last_month', now, 'Europe/London');
  is('last month is September, whole', lm.label === 'September 2026' && !lm.partial && lm.from === '2026-08-31T23:00:00.000Z' && lm.to === '2026-09-30T23:00:00.000Z', `${lm.label} ${lm.from} ${lm.to}`);
  const prevPartial = previousPeriod(tm, 'Europe/London');
  is('a month so far is compared with the same days of the month before', /the same days of September 2026/.test(prevPartial.label)
     && Date.parse(prevPartial.to) - Date.parse(prevPartial.from) === Date.parse(tm.to) - Date.parse(tm.from), prevPartial.label);
  is('last month is compared with the whole month before', previousPeriod(lm, 'Europe/London').label === 'August 2026');
  const q = resultsPeriod('this_quarter', now, 'UTC');
  is('this quarter is Q4', q.label === 'Q4 2026' && q.from === '2026-10-01T00:00:00.000Z');
  is('January\'s last month is December of the year before', resultsPeriod('last_month', Date.UTC(2027, 0, 10), 'UTC').label === 'December 2026');
  is('a nonsense time zone falls back to UTC', resultsPeriod('this_month', now, 'Not/AZone').from === '2026-10-01T00:00:00.000Z');
}

console.log('\nthe sentence says only what happened');
{
  const lm = resultsPeriod('last_month', Date.UTC(2026, 9, 5), 'UTC');
  const c: ResultsNumbers = { ...emptyNumbers(), sent: 4120, replies: 211, positive: 64, meetings: 23, deals: 9, pipeline: [{ currency: 'GBP', amount: 84000 }], won_deals: 2, won: [{ currency: 'GBP', amount: 12000 }] };
  const h = resultsHeadline(lm, c, 'GBP');
  is('meetings, pipeline and won', h === 'From 4,120 emails in September 2026: 23 meetings, £84K of new pipeline and £12K closed.', h);
  is('nothing sent says so', resultsHeadline(lm, emptyNumbers()) === 'Nothing went out in September 2026.');
  is('replies only, when that is all there is', /112 replies, 30 interested\.$/.test(resultsHeadline(lm, { ...emptyNumbers(), sent: 900, replies: 112, positive: 30 })));
  const tm = resultsPeriod('this_month', Date.UTC(2026, 9, 5), 'UTC');
  is('a running month says "so far"', /in October 2026 so far/.test(resultsHeadline(tm, c, 'GBP')));
  const money = addMoney(addMoney(addMoney([], 'GBP', 5000), 'EUR', 3000), 'gbp', 1000);
  is('currencies are never added together', money.length === 2 && money.find((m) => m.currency === 'GBP')?.amount === 6000);
  is('the larger leads', moneyText(money) === '£6K + €3K', moneyText(money));
}

console.log('\ncomparisons are honest');
{
  is('+25%', changeText(change(125, 100)) === '+25%');
  is('-40%', changeText(change(60, 100)) === '-40%');
  is('within 5% is "about the same"', changeText(change(102, 100)) === 'about the same');
  is('from nothing is "new", never +infinity', changeText(change(5, 0)) === 'new');
  is('nothing and nothing says nothing', changeText(change(0, 0)) === null);
  is('a rate needs a base', rateOf(3, 10) === null && rateOf(30, 100) === 0.3);
}

console.log('\nthe monthly email');
{
  const at = (d: number, h: number) => Date.UTC(2026, 9, d, h);
  is('not before 09:00 on the 1st', monthlyResultsDue(null, at(1, 7), 'UTC') === null);
  is('from 09:00 on the 1st, for last month', monthlyResultsDue(null, at(1, 9), 'UTC') === '2026-09');
  is('once', monthlyResultsDue('2026-09', at(3, 12), 'UTC') === null);
  is('local time: 09:00 London is 08:00 UTC in BST', monthlyResultsDue(null, at(1, 8), 'Europe/London') === '2026-09');
  const lm = resultsPeriod('last_month', at(1, 9), 'UTC');
  const report: ResultsReport = {
    period: lm, previous: previousPeriod(lm, 'UTC'),
    current: { ...emptyNumbers(), sent: 4120, replies: 211, positive: 64, meetings: 23, deals: 9, pipeline: [{ currency: 'GBP', amount: 84000 }], won_deals: 2, won: [{ currency: 'GBP', amount: 12000 }] },
    before: { ...emptyNumbers(), sent: 3800, replies: 180, positive: 50, meetings: 15, deals: 6, pipeline: [{ currency: 'GBP', amount: 50000 }] },
    headline: 'h', campaigns: [{ id: '1', name: 'Q4 brokers', sent: 2000, replies: 120, meetings: 15, deals: 5, pipeline: [{ currency: 'GBP', amount: 50000 }], won: [] }],
    generated_at: '',
  };
  const e = buildResultsEmail(report);
  is('subject leads with outcomes', e.subject === 'Your September results: 23 meetings, £84K pipeline, £12K won', e.subject);
  is('each line says how it moved', /Meetings\s+23\s+\(\+53% on August 2026\)/.test(e.text), e.text);
  is('the campaigns that did it', /- Q4 brokers: 120 replies, 15 meetings, £50K pipeline/.test(e.text));
  const svc = src('services/digest.service.ts');
  is('the month is claimed before sending', /Claim the month before sending/.test(svc) && /\.eq\('last_results_month', row\.last_results_month\)/.test(svc));
  is('no email about a month with nothing in it', /no email about nothing/.test(svc));
  is('it runs with the digest', /runMonthlyResults\(\)/.test(src('jobs/schedulers/digest.scheduler.ts')));
}

console.log('\nonly outreach is counted, and sharing is safe');
{
  const svc = src('services/results.service.ts');
  is('meetings need a source campaign and must not be cancelled', /\.not\('source_campaign_id', 'is', null\)\.is\('cancelled_at', null\)/.test(svc));
  is('deals need a source campaign', (svc.match(/from\('deals'\)[\s\S]{0,260}?\.not\('source_campaign_id', 'is', null\)/g) || []).length === 2);
  is('positive replies are replies to campaign mail', /\.not\('campaign_id', 'is', null\)\s*\.in\('sara_intent', \['interested', 'meeting'\]\)/.test(svc));
  const share = src('services/results-share.service.ts');
  is('tokens are 24 random bytes', /crypto\.randomBytes\(24\)\.toString\('base64url'\)/.test(share));
  is('a malformed, unknown or revoked token is the same "not found"', /if \(!TOKEN\.test\(token\)\) return null;/.test(share) && /\.is\('revoked_at', null\)\.maybeSingle\(\)/.test(share));
  is('a link is fixed to its period', /period_to: p\.end/.test(share));
  is('campaign names can be hidden', /campaigns: !!r\.show_campaigns/.test(share));
  const routes = src('routes/results.routes.ts');
  is('the public page is never cached or indexed', /Cache-Control', 'no-store'/.test(routes) && /X-Robots-Tag', 'noindex'/.test(routes));
  is('mounted outside authentication, beside the booking pages', /app\.use\('\/api\/report', publicResultsRoutes\)/.test(src('app.ts')));
  is('the public page never sends a session', /const publicClient = axios\.create/.test(client('api/results.api.ts')));
  is('the shared page links nowhere inside the account', /linkCampaigns=\{false\}/.test(client('pages/public/SharedResultsPage.tsx')));
  is('Results is in Insights', /label: 'Results', href: '\/analytics\/results'/.test(client('lib/sections.ts')));
  const migration = readFileSync(join(here, '../../supabase/migrations/081_results.sql'), 'utf8');
  is('migration 081: shares and the monthly columns', /create table if not exists report_shares/.test(migration) && /monthly_results/.test(migration) && /last_results_month/.test(migration));
  is('shares are server-only', /alter table report_shares enable row level security;/.test(migration) && !/on report_shares for/.test(migration));
  is('the migration is ASCII with no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(begin|commit)\s*;/im.test(migration));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
