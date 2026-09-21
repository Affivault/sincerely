/* ═══════════════════════════════════════════════════════════════════════
   Where the mail actually landed.

   Everything in this product is in service of deliverability - the domain
   records, the warm-up ramp, the domain throttle, the bounce guard - and
   none of it could measure the thing it is all for. The closest the app
   came was a health score that starts at 100 and only moves when
   something bounces, which is a number about rejections rather than about
   folders. A campaign can bounce nothing at all and go entirely to spam.

   A feature that reports deliverability is, more than anything else here,
   a feature that can lie. So the assertions are mostly about refusal:

     A RUNNING TEST HAS NO RATE. Two seeds in out of eight is not "100%
     inbox", and showing it as one is how somebody launches on it.

     MISSING IS NOT SPAM. A message that has not appeared may be
     greylisted, queued or rejected at the gateway. Filing it under spam
     invents a filtering decision nobody observed.

     A PROBE THAT NEVER LEFT IS NOT A DELIVERY FAILURE. It says nothing
     about the receiving provider, so it stays out of the arithmetic
     entirely rather than dragging the number down.

     A SEED NEVER SENDS. It exists to receive probes; one that started
     carrying campaign mail would send from the wrong address and destroy
     the measurement at the same time.

   Run: npx tsx scripts/placement-check.mts
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
const srv = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const cli = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

const {
  classifyFolder, seedProvider, placementSummary, placementByProvider,
  placementAdvice, isSendable, MIN_SEEDS_FOR_RATE, PLACEMENT_WAIT_MS,
} = await import('@lemlist/shared');

const probe = (placement: string, provider = 'gmail') => ({ provider, placement }) as any;
const many = (placement: string, n: number, provider = 'gmail') =>
  Array.from({ length: n }, () => probe(placement, provider));

console.log('\na folder is read for what it means, not what it is called');
{
  is('INBOX is the inbox', classifyFolder('INBOX') === 'inbox');
  is('Gmail’s spam folder is spam', classifyFolder('[Gmail]/Spam') === 'spam');
  is('so is Outlook’s', classifyFolder('Junk Email') === 'spam');
  is('and a dotted hierarchy', classifyFolder('INBOX.Junk') === 'spam');

  /*
   * The server's own answer beats guessing at a name, because it is the
   * only one that works in a language nobody here reads.
   */
  is('the server’s own \\Junk flag is trusted first',
     classifyFolder('Pourriel', '\\Junk') === 'spam');
  is('and \\Inbox likewise', classifyFolder('Posteingang', '\\Inbox') === 'inbox');

  // Localised names, because a seed mailbox is often somebody's real one.
  is('a localised spam folder is still spam', classifyFolder('Correo no deseado') === 'spam');
  is('and a localised inbox still the inbox', classifyFolder('Bandeja de entrada') === 'inbox');

  /*
   * Whole segments, not substrings. A user folder called "Spammers" is
   * not the spam folder, and reading it as one would report a delivered
   * message as filtered.
   */
  is('a folder that merely contains the word is not spam',
     classifyFolder('Spammers to block') === 'other',
     'a user folder would be misread as the spam folder');
  is('nor is "Junk Drawer Ideas"', classifyFolder('Junk Drawer Ideas') === 'other');

  /*
   * A subfolder of the inbox is not the inbox. Something a rule filed away
   * is much closer to unread than to landing in front of somebody.
   */
  is('a filed-away subfolder is neither', classifyFolder('INBOX/Receipts') === 'other');
  is('an empty path does not throw', classifyFolder('') === 'other');
}

console.log('\nthe provider behind a seed');
{
  is('gmail by address', seedProvider('a@gmail.com') === 'gmail');
  is('outlook by address', seedProvider('a@hotmail.co.uk') === 'outlook');
  is('yahoo by address', seedProvider('a@ymail.com') === 'yahoo');

  /*
   * A Workspace mailbox on a custom domain is a Gmail inbox with Gmail's
   * filters. Calling it "other" would put the single most important
   * provider in the bucket that says nothing.
   */
  is('a Workspace mailbox on a custom domain is Gmail',
     seedProvider('steven@acme.com', 'imap.gmail.com') === 'gmail',
     'the provider that matters most would be grouped as "other"');
  is('and Microsoft 365 likewise',
     seedProvider('steven@acme.com', 'outlook.office365.com') === 'outlook');

  is('anything else is other', seedProvider('a@acme.com', 'mail.spacemail.com') === 'other');
  is('nothing at all does not throw', seedProvider(null) === 'other');
}

console.log('\na test still running has no rate');
{
  /*
   * The assertion this whole screen rests on. Two seeds in out of eight is
   * not "100% inbox", and a deliverability tool that says it is has told
   * somebody it is safe to launch.
   */
  /*
   * Enough seeds have answered to clear the sample floor, and some are
   * still outstanding. This is the case where the "still running" rule is
   * the ONLY thing standing between the user and "100% inbox" over a test
   * that has three probes yet to land - an earlier version of this check
   * used 2 answered of 8, which the sample floor caught on its own, so
   * removing the rule under test changed nothing and the assertion passed
   * against broken code.
   */
  const running = placementSummary([...many('inbox', 5), ...many('pending', 3)]);
  is('a test with probes outstanding reports no percentage', running.inboxRate === null,
     `reported ${running.inboxRate} with 3 probes outstanding`);
  is('and says it is still looking', running.verdict === 'too-early', running.verdict);
  is('with how far along it is', /5 of 8 seeds have answered/.test(running.headline), running.headline);

  // And the same with a sample too thin to clear the floor either way.
  const thinAndRunning = placementSummary([...many('inbox', 2), ...many('pending', 6)]);
  is('a barely-started test says nothing either', thinAndRunning.inboxRate === null);

  const nothingYet = placementSummary(many('pending', 4));
  is('nothing back yet says so', /Nothing has arrived yet/.test(nothingYet.headline), nothingYet.headline);

  /*
   * And once it has finished but on too small a sample. Four seeds is the
   * floor, and one Gmail seed saying "inbox" is not a deliverability
   * report.
   */
  const thin = placementSummary(many('inbox', 2));
  is('a finished but tiny test still reports no percentage', thin.inboxRate === null);
  is('and says how many more are needed',
     thin.headline.includes(String(MIN_SEEDS_FOR_RATE)), thin.headline);

  const enough = placementSummary(many('inbox', MIN_SEEDS_FOR_RATE));
  is('at the floor it will report one', enough.inboxRate === 1, String(enough.inboxRate));
  is('and calls it good', enough.verdict === 'good');
}

console.log('\nmissing is never quietly counted as spam');
{
  const s = placementSummary([...many('inbox', 4), ...many('missing', 2)]);
  is('missing has its own count', s.missing === 2 && s.spam === 0, JSON.stringify(s));
  is('and it is not folded into the inbox either', s.inbox === 4);
  is('it counts against the rate', s.inboxRate === 4 / 6, String(s.inboxRate));
  is('the headline names it separately',
     /2 never arrived/.test(s.headline) && !/spam/.test(s.headline), s.headline);

  /*
   * More missing than filtered means a gateway refused them, which is a
   * different problem with a different fix from a spam folder.
   */
  const gateway = placementSummary([...many('inbox', 2), ...many('missing', 4)]);
  is('mostly-missing is diagnosed as a gateway problem',
     /rejected them outright/.test(placementAdvice(gateway)), placementAdvice(gateway));
  is('while mostly-filtered is diagnosed as filtering',
     /being filtered/.test(placementAdvice(placementSummary([...many('inbox', 2), ...many('spam', 4)]))));
}

console.log('\na probe that never left is not a delivery failure');
{
  /*
   * Our own SMTP refusing says nothing whatsoever about the receiving
   * provider. Counting it would blame a spam filter for our outage.
   */
  const s = placementSummary([...many('inbox', 4), ...many('error', 4)]);
  is('errored probes are counted separately', s.errored === 4);
  is('and are out of the denominator', s.answered === 4, `answered ${s.answered}`);
  is('so they do not drag the rate down', s.inboxRate === 1, String(s.inboxRate));
  is('and the verdict is unaffected', s.verdict === 'good', s.verdict);

  const allFailed = placementSummary(many('error', 5));
  is('a test where nothing sent measured nothing', allFailed.verdict === 'unknown');
  is('and says so plainly',
     /None of the test messages could be sent/.test(allFailed.headline), allFailed.headline);
  is('rather than reporting 0% inbox', allFailed.inboxRate === null);

  is('no seeds at all is also unknown, not zero',
     placementSummary([]).verdict === 'unknown' && placementSummary([]).inboxRate === null);
}

console.log('\none message in spam is a finding, not a rounding error');
{
  /*
   * A filter somewhere made that decision about this message, and that
   * decision generalises to recipients far more than a single good result
   * does. So a clean sweep is the only thing called good.
   */
  const nearClean = placementSummary([...many('inbox', 9), ...many('spam', 1)]);
  is('nine out of ten is not "good"', nearClean.verdict !== 'good', nearClean.verdict);
  is('it is mixed', nearClean.verdict === 'mixed');
  is('and the spam is named in the headline', /1 went to spam/.test(nearClean.headline));

  is('a clean sweep is good', placementSummary(many('inbox', 6)).verdict === 'good');
  is('and half in spam is poor',
     placementSummary([...many('inbox', 3), ...many('spam', 3)]).verdict === 'poor');

  is('good advice says to re-run after changes',
     /Re-run this after any change/.test(placementAdvice(placementSummary(many('inbox', 6)))));
  is('and a still-running test is given no advice at all',
     placementAdvice(placementSummary(many('pending', 6))) === '',
     'advice on an unfinished test is advice about nothing');
}

console.log('\nper provider, because filtering is decided per provider');
{
  const groups = placementByProvider([
    ...many('inbox', 2, 'gmail'),
    ...many('spam', 2, 'outlook'),
  ]);
  is('each provider is summarised separately', groups.length === 2, JSON.stringify(groups.map((g) => g.provider)));
  is('gmail first', groups[0].provider === 'gmail');
  is('and its own result stands alone',
     groups[0].summary.inbox === 2 && groups[0].summary.spam === 0);
  is('so does outlook’s', groups[1].summary.spam === 2);
  is('a provider with no seeds is left out entirely',
     !groups.some((g) => g.provider === 'yahoo'),
     'an untested provider would appear as a zero result');
}

console.log('\na seed mailbox never sends');
{
  /*
   * The worst outcome this feature could produce. A seed carrying campaign
   * mail would send from an address the account holder never meant to send
   * from AND destroy the measurement, because a seed with real sending
   * history is no longer a clean read of where new mail lands.
   */
  is('a seed is not sendable, however healthy',
     isSendable({ is_active: true, is_verified: true, is_seed: true }) === false,
     'a seed mailbox would be picked up to carry campaign mail');
  is('an ordinary mailbox still is',
     isSendable({ is_active: true, is_verified: true }) === true);
  is('and the old rules still apply',
     isSendable({ is_active: false, is_verified: true, is_seed: false }) === false);

  /*
   * The in-memory filter is only half of it - the send path picks mailboxes
   * in SQL, and the query that forgets is the query that sends.
   */
  for (const file of [
    'services/email-sender.service.ts',
    'services/warmup.service.ts',
    'services/sse.service.ts',
  ]) {
    const text = srv(file);
    const verified = (text.match(/\.eq\('is_verified', true\)/g) || []).length;
    const notSeed = (text.match(/\.eq\('is_seed', false\)/g) || []).length;
    is(`${file.split('/').pop()} excludes seeds from every sender query`,
       verified > 0 && notSeed >= verified,
       `${verified} sender queries, ${notSeed} of them exclude seeds`);
  }

  const svc = srv('services/placement.service.ts');
  is('and a seed cannot be chosen as the sender under test',
     /if \(sender\.is_seed\) \{[\s\S]{0,200}throw new AppError/.test(svc),
     'a test could be sent from a seed to itself');
}

console.log('\nthe probe is the real message');
{
  const svc = srv('services/placement.service.ts');

  /*
   * Seed testing services put a token in the subject line because it is
   * easy, and it changes the thing being measured - subject text is one of
   * the strongest signals a filter scores. The token rides in headers
   * instead.
   */
  is('the token is not appended to the subject',
     !/subject: `\$\{subject\}/.test(svc) && !/subject \+ ' \['/.test(svc),
     'the test would measure a subject line nobody would ever send');
  is('it rides in the Message-ID', /messageId: `<\$\{token\}/.test(svc));
  is('and in a header', /'X-Sincerely-Placement': token/.test(svc));
  is('and both are searched, so a rewritten one still matches',
     /'message-id': token/.test(svc) && /'x-sincerely-placement': token/.test(svc));

  // Real copy by preference: a hand-typed probe measures a message nobody
  // will ever receive.
  is('a real campaign step can be the probe', /async function resolveContent/.test(svc));
  is('and the step is tenant-checked through its campaign',
     /campaigns!inner\(user_id\)/.test(svc) && /campaigns\?\.user_id === userId/.test(svc),
     'a step id from another account would be readable');
}

console.log('\nevery test resolves, and an unreadable seed is our fault');
{
  const svc = srv('services/placement.service.ts');

  /*
   * A report stuck on "waiting" tells you nothing, and never stops telling
   * you nothing. After the wait window an unfound probe is missing, which
   * is honest: we looked, and it was not there.
   */
  is('there is a wait window', PLACEMENT_WAIT_MS > 0);
  is('and it turns an unfound probe into a result',
     /} else if \(expired\) \{\s*await markResult\(row\.id, 'missing'/.test(svc),
     'a test could sit waiting forever');

  /*
   * But a seed we could not READ is a different thing from a message that
   * did not arrive. Recording it as missing would blame a spam filter for
   * our own connection failure.
   */
  is('a seed that lost its IMAP settings is an error, not a missing message',
     /markResult\(row\.id, 'error', null, 'The seed mailbox is no longer readable\.'\)/.test(svc),
     'a broken seed would be reported as the message being filtered');
  is('and a connection failure leaves it pending for the next sweep',
     /Could not read \$\{row\.seed_email\}/.test(svc) && !/catch[\s\S]{0,300}markResult\(row\.id, 'missing'/.test(svc));

  is('a seed with no IMAP server is refused up front',
     /have no incoming \(IMAP\) server set/.test(svc),
     'it would be sent to, never read, and reported as missing');

  // The sweep must not overlap itself onto the same mailbox.
  const sched = srv('jobs/schedulers/placement.scheduler.ts');
  is('the sweep cannot overlap itself', /if \(running\) return;/.test(sched));
  is('and one bad seed does not stop the rest', /Sweep failed for test/.test(sched));
  is('the scheduler is started', /startPlacementScheduler\(\)/.test(srv('index.ts')));
}

console.log('\nand the screen says what it cannot tell you');
{
  const page = cli('pages/placement/PlacementPage.tsx');

  /*
   * A deliverability tool that overclaims is worse than none. Every product
   * in this category gets read as more precise than it is, so the limits
   * are on the screen rather than in a help article nobody opens.
   */
  is('the limits are stated on the page', /data-placement-caveat/.test(page));
  is('including that seeds are not real recipients',
     /never drag a message out of spam/.test(page));
  is('and that Gmail tabs cannot be seen over IMAP',
     /does not guess at Promotions/.test(page),
     'the one claim a seed tester is most tempted to make');

  is('the rate is rendered only when shared will produce one',
     /summary\.inboxRate !== null && \(/.test(page),
     'the page could compute its own percentage and bypass the refusal');
  is('the verdict comes from shared, not from the component',
     /VERDICT\[summary\.verdict\]/.test(page));
  is('and the advice too', /data-placement-advice/.test(page));

  // Thin coverage is said before a test runs, not discovered after.
  is('thin seed coverage is called out up front',
     /data-seed-coverage/.test(page) && /MIN_SEEDS_FOR_RATE/.test(page));

  is('the page is routed', /path="\/placement"/.test(cli('App.tsx')));
  is('and reachable from the nav', /href: '\/placement'/.test(cli('components/layout/Sidebar.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} placement check(s) failed`);
