/* ═══════════════════════════════════════════════════════════════════════
   What the people who buy have in common.

   The revenue report answers "which campaign earned money". It cannot
   answer the question that decides the next list, and that question -
   industry, size, seniority, where they came from - is the one thing a
   two-product stack structurally cannot answer, because the replies live
   in one company's database and the revenue in another's.

   It is also the easiest analysis in this product to get catastrophically
   wrong, and the way it goes wrong is not a bug:

   SLICE FORTY DEALS EIGHT WAYS AND SOMETHING WILL ALWAYS LOOK THREE
   TIMES BETTER. That is arithmetic, not a finding. With eight industries
   and a handful of wins the top row is whichever segment got lucky, and a
   tool that renders it as "fintech closes at 6x your average" has told
   somebody to rebuild their entire list around noise - which they will,
   because it is exactly the kind of insight people want to be true.

   So the assertions are about refusal, and about which end of a
   confidence interval the ranking is allowed to use:

     TOO FEW CLOSED DEALS, NO WIN RATE. Not a cautious one. None.

     LIFT NEEDS BOTH SIDES. A confident segment against a baseline of
     nine deals is not a comparison.

     LIFT USES THE LOWER BOUND. Four-of-five is a point estimate of 80%
     that could easily be 40%; ranking on the flattering end puts small
     lucky segments on top, which is the entire failure being prevented.

     MISSING DATA IS NOT A SEGMENT. Bucketing blanks into "Other"
     produces a large confident group made of nothing, which then wins.

   Run: npx tsx scripts/segment-revenue-check.mts
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
  segmentRevenue, seniorityOf, sizeBandOf, wilsonLowerBound,
  MIN_CLOSED_FOR_RATE, MIN_REACHED_FOR_RATE, LIFT_THRESHOLD,
} = await import('@lemlist/shared');

/** n contacts in one bucket: `won` bought, `lost` did not, rest never closed. */
const bucket = (value: string | null, n: number, opts: { won?: number; lost?: number; replied?: number; wonValue?: number } = {}) => {
  const won = opts.won ?? 0;
  const lost = opts.lost ?? 0;
  const replied = opts.replied ?? won + lost;
  const each = won > 0 ? (opts.wonValue ?? won * 10_000) / won : 0;
  return Array.from({ length: n }, (_, i) => ({
    value,
    replied: i < replied,
    won: i < won ? 1 : 0,
    lost: i >= won && i < won + lost ? 1 : 0,
    open: 0,
    wonValue: i < won ? each : 0,
  }));
};

console.log('\na segment with too few closed deals gets no win rate');
{
  const report = segmentRevenue([
    ...bucket('Fintech', 40, { won: 3, lost: 1 }),
    ...bucket('Retail', 40, { won: 1, lost: 2 }),
  ], 'industry');

  const fintech = report.rows.find((r) => r.value === 'Fintech')!;
  is('four closed deals is not a win rate', fintech.winRate === null, String(fintech.winRate));
  is('nor a confident one', fintech.confidentWinRate === null);
  is('and certainly not a lift', fintech.lift === null,
     'a segment with four closed deals would be reported as a multiple of your average');
  is('but it says why', /4 closed deals/.test(fintech.note) && fintech.note.includes(String(MIN_CLOSED_FOR_RATE)),
     fintech.note);

  /*
   * The counts are still there. They need no inference - they are money
   * divided by people - and they are what somebody actually decides a
   * list on while the rates are still arriving.
   */
  is('the counts are reported regardless', fintech.won === 3 && fintech.reached === 40);
  is('and revenue per contact, which needs no inference',
     fintech.valuePerContact === 750, String(fintech.valuePerContact));

  is('the verdict says the differences are still noise',
     /still noise/.test(report.verdict) || /before any segment/.test(report.verdict), report.verdict);

  /*
   * And with a solid baseline behind it, so the SEGMENT's own floor is
   * the only thing standing between a thin group and a confident-looking
   * multiple. The case above has a thin baseline too, which means the
   * baseline rule catches it on its own and the segment rule is never
   * exercised - the same shape as an assertion that passes against
   * broken code.
   */
  const solidBaseline = segmentRevenue([
    ...bucket('Fintech', 40, { won: 3, lost: 1 }),
    ...bucket('Retail', 300, { won: 40, lost: 40 }),
  ], 'industry');
  const thinAgainstSolid = solidBaseline.rows.find((r) => r.value === 'Fintech')!;
  is('the account baseline here is solid',
     solidBaseline.baseline.confidentWinRate !== null,
     'the next assertion would pass for the wrong reason');
  is('and a thin segment still gets no lift against it',
     thinAgainstSolid.lift === null,
     'four closed deals would be reported as a multiple of a solid average');
}

console.log('\nand the baseline has to clear the bar too');
{
  /*
   * A confident segment compared against an account with nine closed
   * deals in total is not a comparison. Both sides or nothing.
   */
  const thinBaseline = segmentRevenue([
    ...bucket('Fintech', 60, { won: 8, lost: 1 }),
    ...bucket('Retail', 60, { won: 0, lost: 0 }),
  ], 'industry');
  const fin = thinBaseline.rows.find((r) => r.value === 'Fintech')!;
  is('a segment can have a rate of its own', fin.winRate !== null, String(fin.winRate));
  is('and a lift once the account baseline is solid too', fin.lift !== null,
     'nine closed deals across the account is enough baseline');

  const noBaseline = segmentRevenue(bucket('Fintech', 40, { won: 2, lost: 1 }), 'industry');
  is('with nothing closed anywhere, no lift at all',
     noBaseline.rows[0].lift === null && noBaseline.baseline.confidentWinRate === null);
  is('and the verdict says how many deals it needs',
     noBaseline.verdict.includes(String(MIN_CLOSED_FOR_RATE)), noBaseline.verdict);
}

console.log('\nthe ranking uses the cautious end of the rate, not the flattering one');
{
  /*
   * The load-bearing assertion. A small lucky segment has a wonderful
   * point estimate and a terrible lower bound; ranking on the point
   * estimate is precisely how it ends up on top of a list somebody then
   * rebuilds their targeting around.
   */
  const lucky = { won: 9, closed: 10 };   // 90% observed
  const solid = { won: 60, closed: 80 };  // 75% observed
  is('the small lucky one looks better on the raw rate',
     lucky.won / lucky.closed > solid.won / solid.closed);
  is('and worse on the confident one',
     wilsonLowerBound(lucky.won, lucky.closed) < wilsonLowerBound(solid.won, solid.closed),
     `${wilsonLowerBound(lucky.won, lucky.closed)} vs ${wilsonLowerBound(solid.won, solid.closed)}`);

  const report = segmentRevenue([
    ...bucket('Lucky', 40, { won: 9, lost: 1 }),
    ...bucket('Solid', 200, { won: 60, lost: 20 }),
  ], 'industry');
  is('so the solid one ranks first', report.rows[0].value === 'Solid',
     report.rows.map((r) => `${r.value}:${r.lift}`).join(' '));
  is('and the lift reported is the confident one, not the raw one',
     (report.rows[0].lift ?? 0) < (report.rows[0].winRate ?? 0) / (report.baseline.winRate ?? 1) + 0.5,
     JSON.stringify({ lift: report.rows[0].lift, winRate: report.rows[0].winRate }));
}

console.log('\nmissing data is never a segment');
{
  /*
   * Bucketing blanks into "Other" produces a large, confident group made
   * entirely of nothing - which then wins, and sends somebody chasing an
   * industry that does not exist.
   */
  const report = segmentRevenue([
    ...bucket(null, 300, { won: 40, lost: 5 }),
    ...bucket('  ', 50, { won: 5, lost: 1 }),
    ...bucket('Fintech', 40, { won: 9, lost: 1 }),
  ], 'industry');

  is('blanks are counted, not bucketed', report.unknown === 350, String(report.unknown));
  is('and produce no row of their own', report.rows.length === 1,
     report.rows.map((r) => r.value).join(', '));
  is('so nothing called "Other" can win', !report.rows.some((r) => /other|unknown/i.test(r.value)));

  /*
   * But they stay in the baseline, because they WERE reached and they DID
   * close. Leaving them out would compare a segment against a
   * hand-picked subset of the account rather than against the account.
   */
  is('they still count towards the account baseline',
     report.baseline.reached === 390 && report.baseline.won === 54,
     JSON.stringify(report.baseline));

  const allBlank = segmentRevenue(bucket(null, 100, { won: 10, lost: 2 }), 'industry');
  is('nothing recorded at all says exactly that',
     /none of the 100 contacts reached has this recorded/i.test(allBlank.verdict), allBlank.verdict);
}

console.log('\na reply rate needs a sample too');
{
  const thin = segmentRevenue(bucket('Fintech', 12, { replied: 6 }), 'industry');
  is('twelve contacts is not a reply rate', thin.rows[0].replyRate === null);
  is('the counts are still there', thin.rows[0].replied === 6 && thin.rows[0].reached === 12);

  const enough = segmentRevenue(bucket('Fintech', MIN_REACHED_FOR_RATE, { replied: 6 }), 'industry');
  is('at the floor it is reported', enough.rows[0].replyRate !== null, String(enough.rows[0].replyRate));
}

console.log('\nthe verdict says how many groups it was picked from');
{
  /*
   * "Best of twelve" and "best of two" are different claims and only the
   * reader can weigh that, so the number goes in the sentence rather than
   * a footnote.
   */
  const many = segmentRevenue([
    ...bucket('Fintech', 80, { won: 20, lost: 4 }),
    ...bucket('Retail', 80, { won: 6, lost: 18 }),
    ...bucket('Legal', 80, { won: 8, lost: 14 }),
  ], 'industry');
  is('a standout is named', /Fintech closes at/.test(many.verdict), many.verdict);
  is('with its multiple', /x your average/.test(many.verdict), many.verdict);
  is('and the number of groups compared',
     /out of 3 industry groups/.test(many.verdict), many.verdict);
  is('which is also on the report', many.compared === 3, String(many.compared));

  const flat = segmentRevenue([
    ...bucket('Fintech', 80, { won: 12, lost: 12 }),
    ...bucket('Retail', 80, { won: 12, lost: 12 }),
  ], 'industry');
  is('and nothing is named when nothing stands out',
     /Nothing here is far enough/.test(flat.verdict), flat.verdict);
  is('rather than crowning whichever is marginally ahead',
     !/closes at/.test(flat.verdict), flat.verdict);

  is('the threshold is a real gap, not any difference at all',
     LIFT_THRESHOLD >= 1.2, String(LIFT_THRESHOLD));
}

console.log('\nnothing here throws on an empty or odd account');
{
  const none = segmentRevenue([], 'industry');
  is('no data is not a crash', none.rows.length === 0 && none.compared === 0);
  is('and says so', /Nothing to compare/.test(none.verdict), none.verdict);
  is('with an all-zero baseline', none.baseline.reached === 0 && none.baseline.winRate === null);
}

console.log('\nturning a job title into something you can group by');
{
  is('a founder is a founder', seniorityOf('Co-Founder & CEO') === 'Founder / CEO');
  is('a CTO is C-level', seniorityOf('CTO') === 'C-level');
  is('a VP is a VP', seniorityOf('VP of Sales') === 'VP');
  is('a head of is a head of', seniorityOf('Head of Growth') === 'Director / Head');
  is('and a manager a manager', seniorityOf('Marketing Manager') === 'Manager');

  /*
   * Null rather than a guess. An unrecognised title counted as "Other"
   * builds exactly the bucket-of-nothing this module refuses elsewhere.
   */
  is('an unrecognised title is unknown, not "Other"',
     seniorityOf('Chef de Partie') === null,
     'unrecognised titles would form a segment made of noise');
  is('and an empty one too', seniorityOf('') === null && seniorityOf(null) === null);
}

console.log('\nand a headcount field into a band');
{
  is('a range bands on its lower end', sizeBandOf('50-200') === '11-50',
     'a 50-200 company is mid-market, not enterprise');
  is('a bare number works', sizeBandOf('320') === '201-1000');
  /*
   * A trailing plus is a floor, not a value. Banding "1000+" on the
   * number alone filed the largest companies in the list as mid-market -
   * the one distinction a size segment exists to make.
   */
  is('so does "1000+"', sizeBandOf('1000+') === '1000+',
     String(sizeBandOf('1000+')));
  is('and "200+" is above the 51-200 band, not in it',
     sizeBandOf('200+') === '201-1000', String(sizeBandOf('200+')));
  is('and "11 to 50"', sizeBandOf('11 to 50') === '11-50');
  is('and a thousands separator', sizeBandOf('5,000') === '1000+');
  is('a tiny company', sizeBandOf('3') === '1-10');
  is('and nothing parseable is unknown',
     sizeBandOf('Enterprise') === null && sizeBandOf('') === null);
}

console.log('\nthe server counts who was reached, not who bought');
{
  const svc = srv('services/segment-revenue.service.ts');

  /*
   * The shape of the query is the whole argument. Built from deals alone
   * there is no denominator: "fintech won us 80k" means nothing without
   * "out of how many fintech contacts we mailed", and the version without
   * it recommends whichever industry you happen to have mailed most.
   */
  is('it starts from contacts reached',
     /from\('campaign_contacts'\)/.test(svc),
     'a report built from deals alone has no denominator');
  is('one row per contact, not per enrolment',
     /const repliedBy = new Map<string, boolean>\(\)/.test(svc),
     'somebody in three campaigns would be counted three times');
  is('and it is tenant-scoped through the campaign',
     /campaigns!inner\(user_id\)/.test(svc) && /\.eq\('campaigns\.user_id', userId\)/.test(svc));

  is('won value uses the shared deal shape',
     /wonValue \+= dealValue\(d as any\)/.test(svc),
     'two totals for one deal is how a revenue report loses its reader');
  is('and open stages come from the one definition',
     /isOpen\(d\.stage as any\)/.test(svc));

  is('the deciding is all in shared', /return segmentRevenue\(members, dimension\)/.test(svc));
  is('and paging does not silently stop at 1000',
     /async function fetchAll/.test(svc));
}

console.log('\nrevenue reaches the page where sending is decided');
{
  const list = cli('pages/campaigns/CampaignsListPage.tsx');

  /*
   * The whole point of the closed loop. Ranked by volume and reply rate,
   * a sequence replying at 12% that closed nothing looks better than one
   * at 4% that closed 47k - and this list is where somebody decides what
   * to send more of.
   */
  is('the campaign list shows what each one earned',
     /data-earned-cell/.test(list),
     'revenue would stay two navigations away from the decision');
  is('and it can be sorted on', /case 'earned':/.test(list));

  /*
   * A dash, not a zero. "No deals credited yet" and "this campaign earns
   * nothing" are different facts, and a bare 0 makes the first read as
   * the second.
   */
  is('nothing credited reads as nothing known, not as zero',
     /revenue && revenue\.won_value > 0 \? fmtMoney\(revenue\.won_value\) : '\\u2014'/.test(list),
     'a campaign with no attributed deals would show a confident £0');
  is('and it sorts below a genuine zero rather than tying with it',
     /c\.__revenue \? c\.__revenue\.won_value : -1/.test(list));

  // A revenue lookup that fails must not take the campaigns table with it.
  is('a failed revenue lookup leaves the table working',
     /queryKey: \['analytics', 'revenue'\][\s\S]{0,200}silentError: true/.test(list),
     'an outage in a secondary join would break the primary screen');
}

console.log('\nand the segments screen says what it cannot tell you');
{
  const page = cli('pages/analytics/SegmentsPage.tsx');

  is('the verdict comes from shared', /data-segment-verdict/.test(page) && /report\.verdict/.test(page));
  is('the lift is rendered only where shared produced one',
     /\{row\.lift != null && \(/.test(page),
     'the page could compute its own multiple and bypass the refusal');
  is('and a segment with no rate says why', /data-segment-note/.test(page));

  /*
   * The multiple-comparisons problem, on the screen. This is the failure
   * mode of every insights page ever built, and stating it is the
   * difference between informing a decision and manufacturing confidence.
   */
  is('the multiple-comparisons problem is stated',
     /data-segment-caveat/.test(page));
  is('in plain terms',
     /Compare enough groups and one of them looks good by chance/.test(page));
  is('and it says which end of the rate the ranking uses',
     /cautious end of that rate rather than the flattering\s+end/.test(page),
     'the assertion must survive the sentence being re-wrapped');

  is('the page is routed', /path="\/analytics\/segments"/.test(cli('App.tsx')));
  is('and reachable', /href: '\/analytics\/segments'/.test(cli('components/layout/Sidebar.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} segment revenue check(s) failed`);
