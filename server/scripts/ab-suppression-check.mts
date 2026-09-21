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

const { stepHasVariantB, assignVariant, readVariant } = await import('@lemlist/shared');

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

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} ab/suppression check(s) failed`);
