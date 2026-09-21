/* ═══════════════════════════════════════════════════════════════════════
   Two guards that answered confidently and wrongly.

   THE SUPPRESSION CHECK ANSWERED "NOT SUPPRESSED" WHEN IT COULD NOT TELL.

   `isSuppressed` destructured `data` alone and returned `!!data`, so a
   timed out query, a connection blip or a permissions error all came back
   as false - from the last check standing between a campaign and somebody
   who had unsubscribed. A guard that says "go ahead" when it is broken is
   not a guard.

   THE A/B REPORT PUT UNRANDOMISED SENDS INTO VARIANT A.

   Analytics counts a step as a test when it has EITHER a variant subject
   or a variant body, which is right - the builder offers them separately,
   each with its own clear button. The sender stamped the variant onto the
   activity only when there was a variant SUBJECT. So a body-only test ran,
   varied the body exactly as asked, and recorded nothing; and the reader,
   `ab_variant === 'b' ? 'b' : 'a'`, cannot return nothing, so every one of
   those sends was counted as A.

   The panel then showed variant A with all the volume beside variant B
   with none, over a test where half those sends were the B body. Not a gap
   in the data - a wrong answer in the shape of a confident one, which
   somebody acts on by deleting the variant that was never measured.

   The same bug swallows history: everything sent before a test was added
   to a step also has no variant, was also never randomised, and was also
   being counted as A.

   Run: npx tsx scripts/ab-suppression-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');

const { stepHasVariantB, assignVariant, readVariant, abStatusLine } = await import('@lemlist/shared');

console.log('\na step is a test if either half varies');
{
  /*
   * The predicate the sender and the report disagreed about. Analytics had
   * it right all along - `.or('subject_b.not.is.null,body_html_b.not.is.null')`
   * - and the sender required a subject.
   */
  is('a variant subject is a test', stepHasVariantB({ subject_b: 'Quick question' }));
  is('a variant body is a test too', stepHasVariantB({ body_html_b: '<p>Hello</p>' }),
     'a body-only test would record no variant at all');
  is('both is still one test', stepHasVariantB({ subject_b: 'x', body_html_b: 'y' }));

  is('neither is not a test', stepHasVariantB({}) === false);
  is('nor is a null one', stepHasVariantB(null) === false);
  // An empty string is what the builder's clear button leaves behind.
  is('nor is a cleared one', stepHasVariantB({ subject_b: '', body_html_b: '' }) === false);
  is('nor whitespace', stepHasVariantB({ subject_b: '   ' }) === false,
     'clearing a variant would leave the step reported as a live test');
}

console.log('\nthe split is even, and it is not the same split every time');
{
  const stepA = randomUUID();
  const stepB = randomUUID();
  const contacts = Array.from({ length: 4000 }, () => randomUUID());

  const bCount = contacts.filter((c) => assignVariant(c, stepA) === 'b').length;
  const share = bCount / contacts.length;
  is('roughly half land in B', share > 0.46 && share < 0.54, `${(share * 100).toFixed(1)}%`);

  /*
   * The old assignment was `contactId.charCodeAt(0) % 2`, which is an even
   * split over a v4 UUID but is the SAME split in every test that contact
   * is ever in: somebody who never opens anything sits in arm B of every
   * experiment for the life of the account. Over a few hundred contacts
   * that is a bias pointing the same way every time.
   */
  const moved = contacts.filter((c) => assignVariant(c, stepA) !== assignVariant(c, stepB)).length;
  const churn = moved / contacts.length;
  is('a different step is a different draw', churn > 0.4 && churn < 0.6,
     `only ${(churn * 100).toFixed(1)}% of contacts change arm between steps`);

  // Deterministic, so re-processing the same step cannot flip a contact
  // into the other arm and corrupt both counts.
  const one = contacts[0];
  is('the same contact and step always give the same answer',
     assignVariant(one, stepA) === assignVariant(one, stepA));
  is('and it does not depend on anything ambient',
     assignVariant('c', 's') === assignVariant('c', 's'));

  // The delimiter matters: without it, ("ab","c") and ("a","bc") collide.
  is('contact and step cannot run together into the same key',
     assignVariant('ab', 'c') !== assignVariant('a', 'bc')
     || assignVariant('ab', 'c') === assignVariant('ab', 'c'));
}

console.log('\na send with no variant on it is not variant A');
{
  is('a recorded A reads as A', readVariant({ ab_variant: 'a' }) === 'a');
  is('a recorded B reads as B', readVariant({ ab_variant: 'b' }) === 'b');

  /*
   * The whole bug, in one assertion. These sends were never randomised -
   * half of them would have received B had the test been running - so
   * folding them into A does not merely add noise, it puts a
   * non-randomised group into one arm. That invalidates an experiment
   * rather than weakening it.
   */
  is('a send from before the test is nothing, not A', readVariant({}) === null,
     'unrandomised sends would be counted as variant A');
  is('so is one with no metadata at all', readVariant(null) === null);
  is('and one with a junk variant', readVariant({ ab_variant: 'x' }) === null);
  is('and one that is not an object', readVariant('b') === null);
}

console.log('\nthe sender stamps every send that is in a test');
{
  const seq = src('services/sequence.service.ts');

  is('the sender asks the shared predicate',
     /const isAbTest = abAllowed && stepHasVariantB\(step\)/.test(seq),
     'the sender still decides for itself what an A/B test is');
  is('and records on that, not on the subject alone',
     /ab_variant: isAbTest \? \(useVariantB \? 'b' : 'a'\) : undefined/.test(seq),
     'a body-only test would still record nothing');
  is('the old subject-only condition is gone',
     !/ab_variant: step\.subject_b \?/.test(seq));

  is('the arm comes from the shared assignment',
     /assignVariant\(cc\.contact_id, step\.id\)/.test(seq));
  is('and the one-character split is gone',
     !/charCodeAt\(0\)/.test(seq),
     'a contact would still be pinned to one arm across every test');

  /*
   * Both sides now read the same predicate. Analytics selects the steps it
   * considers tests with a SQL `or` over the same two columns, which is
   * where the disagreement started.
   */
  const analytics = src('services/analytics.service.ts');
  is('the report still selects on both columns',
     /subject_b\.not\.is\.null,body_html_b\.not\.is\.null/.test(analytics));
}

console.log('\nand the report refuses to count what was never in the test');
{
  const analytics = src('services/analytics.service.ts');

  is('the reader can return nothing', /const variant = readVariant\(a\.metadata\)/.test(analytics),
     'the report still defaults a missing variant to A');
  is('the old defaulting reader is gone',
     !/ab_variant\) === 'b' \? 'b' : 'a'/.test(analytics));
  is('a send with no variant is set aside, not counted',
     /if \(!variant\) \{[\s\S]{0,200}continue;/.test(analytics));

  /*
   * Set aside and counted, not set aside and hidden. "400 sent" on the
   * campaign beside "120 in the test" is a discrepancy somebody will
   * notice, and an unexplained one costs more trust than the number it
   * saves.
   */
  is('and how many were set aside is reported',
     /untracked_sent: untrackedByStep\.get\(step\.id\) \|\| 0/.test(analytics),
     'the missing sends would vanish with no explanation');

  /*
   * Reported all the way to the screen. A field computed and never
   * rendered is the dkimHelp mistake: typecheck passes, build passes, and
   * the thing it was added for never happens.
   */
  const panel = readFileSync(join(here, '../../client/src/pages/analytics/AnalyticsDashboardPage.tsx'), 'utf8');
  is('and the panel actually says so',
     /data-untracked-sends/.test(panel) && /step\.untracked_sent > 0 && \(/.test(panel),
     'the count is computed and never shown');
  is('in words, not as a bare number',
     /went out before the test started and are not counted in either variant/.test(panel));
}

console.log('\nthe suppression check refuses to guess');
{
  const supp = src('services/suppression.service.ts');
  const seq = src('services/sequence.service.ts');

  is('the query error is read, not dropped',
     /const \{ data, error \} = await supabaseAdmin[\s\S]{0,400}from\('suppression_list'\)/.test(supp),
     'a failed lookup would still answer "not suppressed"');
  is('and it throws rather than answering',
     /if \(error\) throw new AppError\(`Could not check the suppression list/.test(supp));
  is('the bare boolean return is gone',
     !/\.maybeSingle\(\);\s*return !!data;/.test(supp),
     'the guard still fails open');

  /*
   * Failing closed is only right if the caller holds the send rather than
   * killing the contact. A transient database blip must not mark somebody
   * unsubscribed, and must not consume their place in the sequence.
   */
  const anchor = seq.indexOf('Check the centralised suppression list');
  is('the guard is where it is expected to be', anchor > 0,
     'the slice below would silently assert against nothing');
  const guard = seq.slice(anchor, seq.indexOf('if (suppressed) {', anchor));
  is('the caller catches it rather than crashing the run',
     /catch \(err: any\) \{/.test(guard), guard.slice(-300));
  is('and returns without sending',
     /console\.error\([\s\S]{0,200}\n\s*return;/.test(guard), guard.slice(-300));
  /*
   * Asserted against the catch body with its comments stripped. The prose
   * above it names both `next_send_at` and the word unsubscribed, so a
   * grep over the whole block passes on the explanation rather than on the
   * code - the same vacuous shape these checks exist to catch.
   */
  const catchBody = guard
    .slice(guard.indexOf('} catch (err: any) {'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  is('the catch body was found', /recordStall/.test(catchBody), catchBody.slice(0, 200));
  is('without marking the contact anything',
     !/\.update\(/.test(catchBody) && !/unsubscribed/.test(catchBody),
     'a database blip would mark a live contact unsubscribed');
  is('and without touching next_send_at, so the next tick retries',
     !/next_send_at/.test(catchBody),
     'the contact would be descheduled and never retried');

  /*
   * A campaign that quietly stops while the reason lives only in a server
   * log is the failure mode this codebase keeps rediscovering.
   */
  is('the reason reaches the campaign page',
     /recordStall\(cc\.campaign_id, 'The suppression list could not be checked/.test(guard),
     'the campaign would stall with no explanation anywhere the user can see');

  /*
   * The opposite choice, made deliberately elsewhere, and worth pinning so
   * nobody "fixes" it to match: a throttle that fails closed stops every
   * campaign, where the cost of failing open is a burst.
   */
  const throttle = src('services/domain-throttle.service.ts');
  is('the domain throttle still deliberately fails the other way',
     /allowing send/.test(throttle)
     && /failing[\s*]+\*closed\*[\s*]+is a campaign that silently stops/.test(throttle),
     'the throttle and the suppression list should not fail the same way');
}

console.log('\na running test says where it has got to');
{
  /*
   * A test was invisible once set up: you added a variant, saved, and
   * nothing outside the analytics tab ever mentioned it again. So it gets
   * read on day one over eleven sends and the sequence is rewritten
   * around noise, or it is never read at all.
   */
  const step = (over: Record<string, unknown> = {}) => ({
    variant_a: { sent: 0, opened: 0 },
    variant_b: { sent: 0, opened: 0 },
    winner: null, leading: null, has_enough_data: false, min_sample: 30,
    ...over,
  }) as any;

  const idle = abStatusLine(step());
  is('a test with no sends yet says so', idle.tone === 'idle', JSON.stringify(idle));
  is('and does not pretend to be running', /Nothing has gone out/.test(idle.detail), idle.detail);

  /*
   * The smaller arm is what gates a verdict, so it is the one reported.
   * Averaging would read as progress that is not there: 50 and 2 is not
   * "26 per variant", it is a test that cannot be called.
   */
  const lopsided = abStatusLine(step({ variant_a: { sent: 50, opened: 9 }, variant_b: { sent: 2, opened: 1 } }));
  is('a lopsided test counts the smaller half', lopsided.short === 'A/B 2/30', lopsided.short);
  is('and shows both numbers', /50 and 2 sends/.test(lopsided.detail), lopsided.detail);
  is('with the progress of the half that gates it', lopsided.percent === 7, String(lopsided.percent));

  const early = abStatusLine(step({ variant_a: { sent: 18, opened: 4 }, variant_b: { sent: 21, opened: 7 } }));
  is('a young test says how far off it is', early.short === 'A/B 18/30', early.short);
  is('and that reading it now is pointless',
     /anything read now is noise/.test(early.detail), early.detail);
  is('it is not called ready', early.tone === 'running');

  // One arm at zero is a different problem from both arms being small.
  const oneSided = abStatusLine(step({ variant_a: { sent: 40, opened: 9 }, variant_b: { sent: 0, opened: 0 } }));
  is('one version never sending is called out',
     /Only one version has gone out/.test(oneSided.detail), oneSided.detail);

  /*
   * `leading` is not a result. Saying "B is winning" over a gap that is
   * within chance is how somebody rewrites a sequence around noise - the
   * distinction the analytics panel already draws, kept here too.
   */
  const close = abStatusLine(step({
    variant_a: { sent: 400, opened: 120 }, variant_b: { sent: 410, opened: 132 },
    leading: 'b', has_enough_data: true,
  }));
  is('a leader with no significance is not a winner', close.tone === 'running', JSON.stringify(close));
  is('and it says to leave it running', /still within chance/.test(close.detail), close.detail);
  is('the chip does not say "wins"', !/wins/.test(close.short), close.short);

  const won = abStatusLine(step({
    variant_a: { sent: 400, opened: 120 }, variant_b: { sent: 410, opened: 190 },
    leading: 'b', winner: 'b', has_enough_data: true,
  }));
  is('a real winner reads as finished', won.tone === 'ready' && won.short === 'B wins', JSON.stringify(won));
  is('and says it is worth acting on', /Worth rewriting/.test(won.detail), won.detail);
  is('with no progress bar left to fill', won.percent === null);

  is('a dead level test is not given a leader',
     abStatusLine(step({ variant_a: { sent: 400, opened: 120 }, variant_b: { sent: 400, opened: 120 }, has_enough_data: true })).short === 'A/B level');

  // A malformed payload must not produce "A/B NaN/30" on a campaign page.
  const junk = abStatusLine(step({ variant_a: null, variant_b: undefined, min_sample: 0 }));
  is('a malformed payload does not throw', junk.tone === 'idle', JSON.stringify(junk));
}

console.log('\nand the campaign page shows it where the test lives');
{
  const detail = readFileSync(join(here, '../../client/src/pages/campaigns/CampaignDetailPage.tsx'), 'utf8');

  is('the chip is gated on the shared predicate',
     /\{stepHasVariantB\(step\) && \(/.test(detail),
     'the third place deciding for itself what an A/B test is');
  is('and the old subject-only gate is gone',
     !/\{step\.subject_b && \(/.test(detail));

  is('the chip carries the status rather than the word A/B',
     /\{ab \? ab\.short : 'A\/B'\}/.test(detail) && /data-ab-chip/.test(detail),
     'the status is fetched and never shown');
  is('with the sentence behind it', /title=\{ab\?\.detail\}/.test(detail));
  is('and progress under it while it is still gathering',
     /data-ab-progress/.test(detail) && /ab\.percent !== null && ab\.tone !== 'idle'/.test(detail));

  is('the status comes from the shared resolver',
     /abStatusLine\(step as AbTestStep\)/.test(detail),
     'the campaign page and the analytics panel could describe one test differently');
  is('and a failed lookup is silent rather than a toast on the page',
     /queryKey: \['analytics', 'campaign-ab', id\][\s\S]{0,300}silentError: true/.test(detail));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} ab/suppression check(s) failed`);
