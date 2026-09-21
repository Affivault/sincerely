/* ═══════════════════════════════════════════════════════════════════════
   A percentage nobody has earned yet.

   "16.7% reply rate" is two replies out of twelve. On the dashboard and in
   the campaign table it was set in the same weight, the same colour and
   the same tabular figures as 16.7% off twelve thousand - and sorted
   against it. One more reply takes it to 25% and somebody concludes the
   subject line is working.

   Analytics already refuses to do this: the step table calls a step
   `too_early` below MIN_STEP_SENDS, the A/B panel will not name a winner
   under thirty each, and the bounce guard judges on the lower bound of a
   Wilson interval rather than the raw rate. The dashboard and the campaign
   list were never taught the same manners - they divided and rendered, at
   any sample size including zero.

   The fix is not a disclaimer. Below the threshold the rate is not the
   honest readout and the counts are: "2 of 12" is the same width, carries
   strictly more information, and cannot be misread as a trend.

   The three ways this goes wrong, all of them asserted below:

     A RATE OVER NOTHING. 0/0 rendered as 0.0%, which reads as a campaign
     performing badly rather than one that has not started.

     A RATE OVER ALMOST NOTHING, in the type size of a measurement.

     A BAR, OR AN ARROW, over either. A bar cannot carry a caveat, and a
     short one reads as "doing badly" where the truth is "we do not know
     yet". A "+12%" change computed off nine sends is the same fiction in
     a shape that looks even more like news.

   Run: npx tsx scripts/rate-honesty-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

const {
  rateReadout, averageRateReadout, rateBarWidth, formatRate, MIN_RATE_SAMPLE,
} = await import('@lemlist/shared');

console.log('\nnothing sent is not nought per cent');
{
  /*
   * The original behaviour, and the most misleading of the three: a
   * campaign that has sent nothing showed 0.0% in the same cell a campaign
   * with a genuinely terrible rate would - so a draft read as a failure.
   */
  const none = rateReadout(0, 0, 'replies');
  is('it is a dash, not a zero', none.label === '—', none.label);
  is('and says why', /Nothing sent yet/.test(none.hint), none.hint);
  is('it is not offered as a rate', none.isRate === false && none.kind === 'none');
  is('and there is no rate to read', none.rate === null);

  is('a missing denominator behaves the same',
     rateReadout(3, null, 'replies').kind === 'none');
  is('so does a negative one', rateReadout(3, -5, 'replies').kind === 'none');
  is('and rubbish does not throw',
     rateReadout(NaN as any, 'twelve' as any, 'replies').kind === 'none');
}

console.log('\nand a handful of sends is reported as a handful');
{
  const early = rateReadout(2, 12, 'replies');
  is('twelve sends is below the bar', early.kind === 'early');
  /*
   * The counts, which are true, in place of the percentage, which is not.
   * Same width on screen, strictly more information, and impossible to
   * read as a trend.
   */
  is('it shows the counts rather than a percentage', early.label === '2 of 12', early.label);
  is('never the percentage itself', !early.label.includes('%'), early.label);
  is('and explains what is missing',
     /12 sent so far/.test(early.hint) && early.hint.includes(String(MIN_RATE_SAMPLE)), early.hint);
  is('the rate is still available for anything that needs it',
     early.rate === 2 / 12, String(early.rate));
  is('but it is not flagged as one', early.isRate === false);

  is('one short of the threshold is still early',
     rateReadout(4, MIN_RATE_SAMPLE - 1, 'replies').kind === 'early');
  is('and the threshold itself is enough',
     rateReadout(4, MIN_RATE_SAMPLE, 'replies').kind === 'measured');
}

console.log('\nabove it, the percentage is what you asked for');
{
  const real = rateReadout(48, 1200, 'replies');
  is('it is a rate', real.kind === 'measured' && real.isRate === true);
  is('and reads as one', real.label === '4.0%', real.label);
  is('with the counts behind it', /48 of 1,200 replies/.test(real.hint), real.hint);

  // One decimal below ten, none above: 3.2% to 4.1% is the news, 61.4%
  // versus 61% is noise dressed as detail.
  is('a small rate keeps its decimal', formatRate(0.032) === '3.2%', formatRate(0.032));
  is('a large one does not', formatRate(0.614) === '61%', formatRate(0.614));
  is('a rate already in per cent is not multiplied again',
     formatRate(61.4) === '61%', formatRate(61.4));
  is('and nonsense is a dash', formatRate(NaN) === '—', formatRate(NaN));
}

console.log('\nan average is judged on what it averages over');
{
  /*
   * Some endpoints hand back a rate with no numerator - the dashboard's
   * headline figures are averages across campaigns. The denominator there
   * is the total sent, because an average of rates computed from nothing
   * is still nothing.
   */
  const nothing = averageRateReadout(0, 0, 'emails');
  is('no sends means nothing to average', nothing.kind === 'none' && nothing.label === '—');

  const early = averageRateReadout(0.167, 9, 'emails');
  is('nine emails is too early', early.kind === 'early');
  is('and it says so in words', early.label === 'Too early', early.label);
  is('never as a percentage', !early.label.includes('%'), early.label);
  is('with the count that is missing', /Only 9 emails/.test(early.hint), early.hint);

  const real = averageRateReadout(0.042, 4200, 'emails');
  is('a real sample reads as a rate', real.isRate && real.label === '4.2%', real.label);
  is('and says what it is across', /Across 4,200 emails/.test(real.hint), real.hint);

  is('a nonsense rate over a real sample does not throw',
     averageRateReadout(NaN, 500).label === '0.0%');
}

console.log('\nno bar over a sample that cannot support one');
{
  /*
   * The bar is the worst offender, because it is a claim about magnitude
   * and cannot carry a caveat. A short bar reads as "doing badly" where
   * the truth is "we do not know yet", and that is a conclusion, not a
   * gap.
   */
  is('nothing sent draws no bar', rateBarWidth(rateReadout(0, 0)) === null);
  is('nor does a handful', rateBarWidth(rateReadout(2, 12)) === null,
     String(rateBarWidth(rateReadout(2, 12))));

  const w = rateBarWidth(rateReadout(60, 1200), 0.25);
  is('a measured rate does', w === 20, String(w));
  is('and it is clamped rather than overflowing',
     rateBarWidth(rateReadout(900, 1000), 0.25) === 100);
  is('a zero scale does not divide by zero',
     Number.isFinite(rateBarWidth(rateReadout(60, 1200), 0)!));
}

console.log('\nthe dashboard uses it, including for the arrow');
{
  const dash = src('pages/dashboard/DashboardPage.tsx');

  is('the headline rate is judged on what was sent',
     /const headlineReply = averageRateReadout\(s\.avg_reply_rate, s\.total_sent/.test(dash),
     'the dashboard still divides and renders');
  is('and says "too early" rather than a figure',
     /too early for a reply rate/.test(dash));

  is('the three rate cells carry their sample',
     (dash.match(/readout=\{averageRateReadout\(/g) || []).length === 3,
     `${(dash.match(/readout=\{averageRateReadout\(/g) || []).length} of 3 cells`);

  /*
   * The change arrow is the same fiction in a shape that looks even more
   * like news. "+12%" off nine sends is not a trend.
   */
  is('the change arrow is dropped along with the rate',
     /\{!unproven && <Delta value=\{delta\} \/>\}/.test(dash),
     'a "+12%" swing would still be shown over nine sends');
  is('and the figure is set quieter, because it is not a measurement',
     /unproven \? 'text-\[14px\] text-\[var\(--text-tertiary\)\]' : 'text-\[19px\]'/.test(dash));

  /*
   * The leaderboard rows had a bar four times the reply rate, drawn at any
   * sample. Now the numerator is the real count rather than the rate
   * multiplied back out by its own denominator.
   */
  is('the leaderboard reads real counts, not a reconstructed numerator',
     /rateReadout\(c\.opened, c\.sent, 'opens'\)/.test(dash)
     && /rateReadout\(c\.replied, c\.sent, 'replies'\)/.test(dash));
  is('and its bar disappears below the sample',
     /\{barWidth != null && \(/.test(dash),
     'a two-reply campaign would still get a bar');
}

console.log('\nand so does the campaign table');
{
  const list = src('pages/campaigns/CampaignsListPage.tsx');

  is('every rate column carries its sample',
     /const openR   = rateReadout\(campaign\.opened_count,  total, 'opens'\)/.test(list)
     && /const replyR  = rateReadout\(campaign\.replied_count, total, 'replies'\)/.test(list),
     'the table still computes bare percentages');
  is('the old bare percentages are gone',
     !/const openPct\s+=|const replyPct\s+=/.test(list),
     'a percentage is still being computed without its sample');

  /*
   * The bounce warning is a judgement - a red cell saying this campaign is
   * hurting your domain. One bounce in eight is 12.5% and means nothing;
   * colouring it red sends somebody to pause a campaign over one bad
   * address.
   */
  is('a bounce warning is not made on a sample too small to support it',
     /const warn = r\.isRate && warnAbove != null/.test(list),
     'one bounce in eight would still be shown as a red 12.5%');

  is('the micro-bar goes too', /\{width != null && \(/.test(list));

  // The aggregate strip across the top of the page, and the folder totals.
  is('the account-wide figures follow the same rule',
     /const replyAgg  = rateReadout\(aggregateStats\.replied, sentTotal, 'replies'\)/.test(list));
  is('the metric chips show the count regardless and the rate only when earned',
     /\{readout\?\.isRate && \(/.test(list),
     'the chip would show a percentage over any sample');
}

console.log('\none threshold, and a reason it differs from the step one');
{
  const { MIN_STEP_SENDS } = await import('@lemlist/shared');
  const mod = readFileSync(join(here, '../../shared/src/rate-readout.ts'), 'utf8');

  is('the threshold is a named constant', MIN_RATE_SAMPLE === 30, String(MIN_RATE_SAMPLE));
  /*
   * Two near-identical numbers is how one of them drifts, so the
   * difference is written down rather than left to be rediscovered: a step
   * is judged against its own campaign's other steps, where a modest
   * sample still separates them. A bare percentage on a card has nothing
   * to be relative to and is read as an absolute claim.
   */
  is('and the reason it is not MIN_STEP_SENDS is written down',
     mod.includes('MIN_STEP_SENDS') && /relative comparison/.test(mod),
     'two thresholds with no stated difference will drift');
  is('they are genuinely different numbers', MIN_RATE_SAMPLE !== MIN_STEP_SENDS);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} rate honesty check(s) failed`);
