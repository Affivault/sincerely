/* ═══════════════════════════════════════════════════════════════════════
   The numbers people make decisions on.

   A pipeline total is the number a rep quotes and a manager plans around,
   which makes it the worst possible place for an arithmetic mistake: it is
   confidently wrong, it is wrong in the same direction every time, and
   nobody checks it because it looks like a number.

   Two traps in particular are worth pinning down.

   Rot is measured from `stage_changed_at`, never `updated_at`. The second
   moves when somebody fixes a typo in a title, so using it would report a
   deal nobody has touched in two months as freshly worked — the exact lie
   rot detection exists to catch.

   And the summary is one pass over every deal, so an open deal that is both
   overdue and stalled must be counted once in each bucket and never twice
   in one. Getting that wrong inflates the total quietly.

   Run: npx tsx scripts/pipeline-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import {
  STAGE_PROBABILITY,
  funnel,
  isOpen,
  probabilityOf,
  rotOf,
  annualRecurring,
  dealValue,
  daysByStage,
  hasEconomics,
  medianDaysPerStage,
  monthlyRecurring,
  nextStep,
  outcomesByStage,
  performanceBySource,
  pipelineArr,
  reasonBreakdown,
  revenueSplit,
  totalContractValue,
  countLifecycles,
  isEngaged,
  leadIsStale,
  shouldPromote,
  stageBeforeClose,
  stageTimeline,
  summariseLeads,
  summarisePipeline,
  weightedValue,
  revenueByCampaign,
  outreachFunnel,
  valuePerReply,
  isStrongAttribution,
} from '@lemlist/shared';
import type { Deal, DealStage } from '@lemlist/shared';

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

const NOW = new Date('2026-06-15T12:00:00.000Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    user_id: 'u1',
    title: 'A deal',
    company: null,
    company_id: null,
    contact_name: null,
    contact_email: null,
    contact_id: null,
    value: 1000,
    currency: 'USD',
    stage: 'qualified',
    expected_close_date: null,
    notes: null,
    position: 0,
    probability: null,
    outcome_reason: null,
    closed_at: null,
    stage_changed_at: daysAgo(1),
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
    ...over,
  } as Deal;
}

/* ─────────────────────────────────────────────────────────────────── */

console.log('\nodds come from the stage unless the deal overrides them');
{
  is('a qualified deal uses its stage default',
     probabilityOf(deal({ stage: 'qualified' })) === STAGE_PROBABILITY.qualified);
  is('its own number wins when it has one',
     probabilityOf(deal({ stage: 'qualified', probability: 85 })) === 85);

  // Closed is not a probability. A won deal stored at 60% would report 60%
  // of revenue that has already landed.
  is('a won deal is certain, whatever is stored on it',
     probabilityOf(deal({ stage: 'won', probability: 60 })) === 100);
  is('and a lost one is zero, whatever is stored on it',
     probabilityOf(deal({ stage: 'lost', probability: 60 })) === 0);

  is('a nonsense stored value falls back rather than being trusted',
     probabilityOf(deal({ stage: 'lead', probability: 140 as any }) ) === STAGE_PROBABILITY.lead);
  is('and zero is honoured, because zero is a real answer',
     probabilityOf(deal({ stage: 'lead', probability: 0 })) === 0);
}

console.log('\nweighted value is value times odds');
{
  is('60% of 10,000 is 6,000',
     weightedValue(deal({ stage: 'proposal', value: 10_000 })) === 6000,
     String(weightedValue(deal({ stage: 'proposal', value: 10_000 }))));
  is('a lost deal is worth nothing to a forecast',
     weightedValue(deal({ stage: 'lost', value: 10_000 })) === 0);
}

console.log('\nrot is measured from the last stage change, not the last edit');
{
  /*
   * The trap. This deal was edited an hour ago and has not moved in fifty
   * days. Reading updated_at would call it healthy.
   */
  const stale = deal({
    stage: 'proposal',
    stage_changed_at: daysAgo(50),
    updated_at: daysAgo(0),
    created_at: daysAgo(90),
  });
  const verdict = rotOf(stale, NOW);
  is('a deal edited today but unmoved for fifty days is rotting',
     verdict.rotting === true, JSON.stringify(verdict));
  is('and it reports the days in stage, not since the edit',
     verdict.days === 50, String(verdict.days));

  is('a proposal that moved three days ago is fine',
     rotOf(deal({ stage: 'proposal', stage_changed_at: daysAgo(3) }), NOW).rotting === false);

  // Thresholds differ per stage: a quiet lead is ordinary, a quiet proposal
  // is a lost deal nobody has admitted to.
  is('twelve days is fine for a lead',
     rotOf(deal({ stage: 'lead', stage_changed_at: daysAgo(12) }), NOW).rotting === false);
  is('but not for a proposal',
     rotOf(deal({ stage: 'proposal', stage_changed_at: daysAgo(12) }), NOW).rotting === true);

  is('a closed deal never rots — it is finished, not stalled',
     rotOf(deal({ stage: 'won', stage_changed_at: daysAgo(400) }), NOW).rotting === false);

  // Pre-migration rows have no stage_changed_at at all.
  is('a row with no stage clock falls back to when it was created',
     rotOf(deal({ stage: 'proposal', stage_changed_at: null, created_at: daysAgo(40) }), NOW).days === 40);
  is('and one with neither is not accused of anything',
     rotOf(deal({ stage: 'proposal', stage_changed_at: null, created_at: null as any }), NOW).rotting === false);
}

console.log('\nthe header sums each deal into every bucket it belongs in, once');
{
  const deals = [
    // Open, ordinary.
    deal({ stage: 'lead', value: 1000, stage_changed_at: daysAgo(2) }),
    // Open, closing inside the window.
    deal({ stage: 'qualified', value: 2000, expected_close_date: inDays(10), stage_changed_at: daysAgo(2) }),
    // Open, close date already gone, and stalled as well.
    deal({ stage: 'proposal', value: 4000, expected_close_date: inDays(-5), stage_changed_at: daysAgo(40) }),
    // Closed inside the lookback.
    deal({ stage: 'won', value: 8000, closed_at: daysAgo(5), created_at: daysAgo(35) }),
    // Closed, but too long ago to count as recent.
    deal({ stage: 'won', value: 16_000, closed_at: daysAgo(200), created_at: daysAgo(260) }),
    deal({ stage: 'lost', value: 500, closed_at: daysAgo(9), created_at: daysAgo(19) }),
  ];
  const s = summarisePipeline(deals, { soonDays: 30, now: NOW });

  is('open is the three live deals', s.open === 7000 && s.openCount === 3, JSON.stringify(s));
  is('commit is the proposal alone, unweighted',
     s.commit === 4000 && s.commitCount === 1, `${s.commit}/${s.commitCount}`);

  // 1000*10% + 2000*30% + 4000*60% = 100 + 600 + 2400
  is('weighted applies each stage’s odds', s.weighted === 3100, String(s.weighted));

  is('the overdue one is counted as overdue',
     s.overdue === 4000 && s.overdueCount === 1, `${s.overdue}/${s.overdueCount}`);
  is('and not also as closing soon — a date in the past is not a forecast',
     s.closingSoon === 2000 && s.closingSoonCount === 1, `${s.closingSoon}/${s.closingSoonCount}`);
  is('the same deal is separately reported as stalled',
     s.rotting === 4000 && s.rottingCount === 1, `${s.rotting}/${s.rottingCount}`);

  is('only the recent win counts as recent',
     s.wonRecent === 8000 && s.wonRecentCount === 1, `${s.wonRecent}/${s.wonRecentCount}`);
  is('win rate is won over won plus lost', s.winRate === 67, String(s.winRate));

  // (30 + 60 + 10) / 3
  is('cycle length averages wins and losses alike',
     s.avgDaysToClose === 33, String(s.avgDaysToClose));
}

console.log('\nan empty pipeline says nothing rather than zero');
{
  const s = summarisePipeline([], { now: NOW });
  is('no win rate without a single closed deal', s.winRate === null);
  is('no cycle length either', s.avgDaysToClose === null);
  is('and the totals are zero, not NaN',
     s.open === 0 && s.weighted === 0 && Number.isFinite(s.weighted));
}

console.log('\nthe funnel describes open work only');
{
  const rows = funnel([
    deal({ stage: 'lead' }), deal({ stage: 'lead' }), deal({ stage: 'lead' }),
    deal({ stage: 'qualified' }),
    deal({ stage: 'won' }), deal({ stage: 'won' }), deal({ stage: 'won' }),
    deal({ stage: 'lost' }),
  ]);
  is('three open stages, no closed ones', rows.length === 3,
     rows.map((r) => r.stage).join(','));
  is('won and lost are excluded — they accumulate forever and would dwarf the rest',
     rows.every((r) => isOpen(r.stage)));
  is('the widest stage is the reference for the bars',
     rows[0].share === 1 && rows[1].share === 1 / 3,
     JSON.stringify(rows.map((r) => r.share)));
  is('an empty funnel does not divide by zero',
     funnel([]).every((r) => r.share === 0 && Number.isFinite(r.share)));
}

console.log('\nvalues that are not numbers do not poison the totals');
{
  const s = summarisePipeline([
    deal({ stage: 'lead', value: null as any }),
    deal({ stage: 'qualified', value: undefined as any }),
    deal({ stage: 'proposal', value: 'abc' as any }),
  ], { now: NOW });
  is('a missing or unparseable value counts as zero, not NaN',
     s.open === 0 && Number.isFinite(s.open) && Number.isFinite(s.weighted),
     `${s.open}/${s.weighted}`);
  is('but the deals are still counted', s.openCount === 3, String(s.openCount));
}


/* ─── The path a deal took ────────────────────────────────────────────── */

console.log('\nstage history turns transitions into durations');
{
  const ev = (from: string | null, to: string, n: number, reason: string | null = null) =>
    ({ from_stage: from, to_stage: to, reason, changed_at: daysAgo(n) });

  const legs = stageTimeline(
    [ev(null, 'lead', 90), ev('lead', 'qualified', 60), ev('qualified', 'proposal', 12)],
    NOW,
  );
  is('one leg per stage entered', legs.length === 3, String(legs.length));
  is('each closed leg lasts until the next move',
     legs[0].days === 30 && legs[1].days === 48,
     JSON.stringify(legs.map((l) => l.days)));
  is('the last leg is measured to now and marked current',
     legs[2].days === 12 && legs[2].current && legs[2].leftAt === null,
     JSON.stringify(legs[2]));
  is('only the last leg is current',
     legs.filter((l) => l.current).length === 1);

  /*
   * Events are read back from the database, and "ordered by changed_at" is
   * a promise about one query, not about every caller that ever passes an
   * array in. Sorting here means a shuffled list cannot silently produce
   * negative durations.
   */
  const shuffled = stageTimeline(
    [ev('qualified', 'proposal', 12), ev(null, 'lead', 90), ev('lead', 'qualified', 60)],
    NOW,
  );
  is('order of the input does not matter',
     JSON.stringify(shuffled.map((l) => [l.stage, l.days]))
       === JSON.stringify(legs.map((l) => [l.stage, l.days])),
     JSON.stringify(shuffled.map((l) => [l.stage, l.days])));

  is('no leg can last a negative number of days',
     stageTimeline([ev(null, 'lead', -3)], NOW).every((l) => l.days >= 0));

  const closed = stageTimeline(
    [ev(null, 'lead', 40), ev('lead', 'lost', 5, 'Price')],
    NOW,
  );
  is('a won/lost reason captions the stage it closed into, not the one it left',
     closed[1].reason === 'Price' && closed[0].reason === null,
     JSON.stringify(closed.map((l) => [l.stage, l.reason])));

  is('a backfilled deal with one recorded event still reports its age',
     stageTimeline([ev(null, 'proposal', 40)], NOW)[0].days === 40);
  is('no history at all is an empty journey, not a crash',
     stageTimeline([], NOW).length === 0);
  is('an event with no timestamp is dropped rather than dated to 1970',
     stageTimeline([ev(null, 'lead', 5), { from_stage: 'lead', to_stage: 'won', reason: null, changed_at: '' }], NOW).length === 1);
}


console.log('\ntime in a stage adds up across every visit');
{
  const ev = (from: string | null, to: string, n: number) =>
    ({ from_stage: from, to_stage: to, reason: null, changed_at: daysAgo(n) });

  /*
   * A deal pushed back from proposal to qualified and worked forward again
   * has been in qualified twice. Reporting only the latest visit would make
   * the deal that has been round the loop three times look like the
   * fastest one on the board.
   */
  const looped = daysByStage(
    [ev(null, 'lead', 60), ev('lead', 'qualified', 50), ev('qualified', 'proposal', 40),
     ev('proposal', 'qualified', 30), ev('qualified', 'proposal', 10)],
    NOW,
  );
  is('a revisited stage sums both visits', looped.qualified === 30, String(looped.qualified));
  is('so does the stage it kept bouncing back to', looped.proposal === 20, String(looped.proposal));
  is('and the stage it never returned to keeps its single figure',
     looped.lead === 10, String(looped.lead));
  is('stages never reached are absent rather than zero, which reads differently',
     !('won' in looped) && !('lost' in looped), JSON.stringify(looped));
}

console.log('\nevery live deal should have a next step, and this says when it does not');
{
  const open = { stage: 'proposal' as DealStage };
  const task = (title: string, n: number, done = false) =>
    ({ title, due_date: daysAgo(n), is_done: done });
  const meet = (title: string, n: number) => ({ title, starts_at: daysAgo(n) });

  const nothing = nextStep(open, [], [], NOW);
  is('an open deal with nothing booked is flagged',
     nothing.missing && nothing.at === null, JSON.stringify(nothing));

  /*
   * A won deal does not need chasing. Nagging for a next step on something
   * already closed is the fastest way to teach people to ignore the flag.
   */
  const won = nextStep({ stage: 'won' }, [], [], NOW);
  is('a closed deal is never flagged for having nothing booked',
     !won.missing, JSON.stringify(won));

  const soonest = nextStep(open, [task('Chase legal', -9), task('Send pricing', -2)], [], NOW);
  is('the soonest thing still ahead is the next step',
     soonest.title === 'Send pricing' && !soonest.overdue, JSON.stringify(soonest));

  is('a meeting can be the next step, not just an activity',
     nextStep(open, [task('Chase legal', -9)], [meet('Commercial review', -3)], NOW).kind === 'meeting');

  /*
   * Everything in the past is not the same as nothing booked, and must not
   * read as if it were — one means "decide what to do next", the other
   * means "you are late".
   */
  const late = nextStep(open, [task('Send pricing', 4)], [], NOW);
  is('an overdue item is overdue, not missing',
     late.overdue && !late.missing && late.title === 'Send pricing', JSON.stringify(late));

  is('a completed activity does not count as something booked',
     nextStep(open, [task('Already done', -5, true)], [], NOW).missing);

  is('an activity with no due date is not a next step either',
     nextStep(open, [{ title: 'Someday', due_date: null, is_done: false }], [], NOW).missing);

  is('an unparseable date cannot become the next step',
     nextStep(open, [{ title: 'Broken', due_date: 'not a date', is_done: false }], [], NOW).missing);
}


/* ─── What a B2B deal is worth ────────────────────────────────────────── */

console.log('\nquoted periods all become the same unit before anything is added up');
{
  is('a monthly retainer is its own monthly figure',
     monthlyRecurring({ recurring_amount: 4000, recurring_period: 'month' }) === 4000);
  is('a quarterly licence divides by three',
     monthlyRecurring({ recurring_amount: 12000, recurring_period: 'quarter' }) === 4000);
  is('an annual contract divides by twelve',
     monthlyRecurring({ recurring_amount: 48000, recurring_period: 'year' }) === 4000);
  is('all three are therefore the same ARR',
     annualRecurring({ recurring_amount: 4000, recurring_period: 'month' }) === 48000
       && annualRecurring({ recurring_amount: 12000, recurring_period: 'quarter' }) === 48000
       && annualRecurring({ recurring_amount: 48000, recurring_period: 'year' }) === 48000);
  is('a missing period is read as monthly rather than dropped',
     monthlyRecurring({ recurring_amount: 4000 }) === 4000);
  is('an unknown period falls back to monthly instead of producing NaN',
     monthlyRecurring({ recurring_amount: 4000, recurring_period: 'fortnight' }) === 4000);
  is('no recurring part is zero, not NaN',
     monthlyRecurring({}) === 0 && Number.isFinite(monthlyRecurring({})));
}

console.log('\ntotal contract value puts a retainer and a project side by side');
{
  const retainer = { recurring_amount: 4000, recurring_period: 'month' as const, term_months: 36, one_off_amount: 12000 };
  is('recurring over the term, plus the one-off',
     totalContractValue(retainer) === 4000 * 36 + 12000, String(totalContractValue(retainer)));

  const project = { one_off_amount: 60000 };
  is('a pure project is just its fee',
     totalContractValue(project) === 60000, String(totalContractValue(project)));

  /*
   * The two deals people wrongly treat as equal. Same headline 60k, and
   * the retainer is worth more than twice as much over its term — which is
   * the entire reason for recording the shape rather than the total.
   */
  const sameHeadline = { recurring_amount: 5000, recurring_period: 'month' as const, term_months: 36 };
  is('60k of retainer on three years beats 60k of one-off work',
     totalContractValue(sameHeadline) === 180000 && totalContractValue({ one_off_amount: 60000 }) === 60000);

  is('an unstated term is assumed to be twelve months, not infinity or one',
     totalContractValue({ recurring_amount: 1000, recurring_period: 'month' }) === 12000);
  is('and the assumption is flagged so the UI need not pretend it knows',
     revenueSplit({ recurring_amount: 1000 }).termAssumed
       && !revenueSplit({ recurring_amount: 1000, term_months: 24 }).termAssumed);
}

console.log('\nevery existing total keeps working through one value function');
{
  is('a deal with no shape keeps the single number it always had',
     dealValue({ value: 25000 }) === 25000);
  is('a deal with a shape reports its computed total instead',
     dealValue({ value: 1, recurring_amount: 2000, recurring_period: 'month', term_months: 12 }) === 24000);
  is('an empty string is not a shape, and is not zero either',
     !hasEconomics({ recurring_amount: '' as any }) && dealValue({ value: 900, recurring_amount: '' as any }) === 900);
  is('a term on its own counts as a shape',
     hasEconomics({ term_months: 24 }));
  is('an unparseable value is zero rather than NaN',
     dealValue({ value: 'abc' as any }) === 0);

  /*
   * New ARR is a different question from pipeline size, and a quarter can
   * be strong on one and weak on the other. A pure project deal must
   * contribute nothing here.
   */
  const arr = pipelineArr([
    deal({ stage: 'qualified', recurring_amount: 1000, recurring_period: 'month' } as any),
    deal({ stage: 'proposal', one_off_amount: 500000 } as any),
    deal({ stage: 'won', recurring_amount: 9000, recurring_period: 'month' } as any),
  ] as any);
  is('open ARR counts only the recurring part of open deals',
     arr.open === 12000, String(arr.open));
  is('and weights it by the same odds the forecast uses',
     arr.weighted === 12000 * 0.3, String(arr.weighted));
}

/* ─── Why deals end the way they do ───────────────────────────────────── */

console.log('\nthe stage a deal died in is recoverable, and is the point of the history');
{
  const ev = (from: string | null, to: string, n: number) =>
    ({ from_stage: from, to_stage: to, reason: null, changed_at: daysAgo(n) });

  const history = {
    a: [ev(null, 'lead', 60), ev('lead', 'qualified', 40), ev('qualified', 'proposal', 20), ev('proposal', 'lost', 5)],
    b: [ev(null, 'lead', 50), ev('lead', 'qualified', 30), ev('qualified', 'proposal', 15), ev('proposal', 'won', 3)],
    c: [ev(null, 'lead', 40), ev('lead', 'qualified', 25), ev('qualified', 'lost', 10)],
    d: [ev(null, 'lead', 30), ev('lead', 'lost', 12)],
    // Closed before any of this was recorded: no prior stage to attribute to.
    e: [ev(null, 'won', 8)],
  };
  const deals = [
    { id: 'a', stage: 'lost' as const, value: 50000 },
    { id: 'b', stage: 'won' as const, value: 90000 },
    { id: 'c', stage: 'lost' as const, value: 20000 },
    { id: 'd', stage: 'lost' as const, value: 10000 },
    { id: 'e', stage: 'won' as const, value: 1000 },
  ];

  is('the closing move names the stage the deal came from',
     stageBeforeClose(history.a) === 'proposal' && stageBeforeClose(history.c) === 'qualified');
  is('a deal born closed has no prior stage rather than a guessed one',
     stageBeforeClose(history.e) === null);

  const rows = outcomesByStage(deals, history);
  const at = (s: string) => rows.find((r) => r.stage === s)!;
  is('proposal shows one won and one lost',
     at('proposal').won === 1 && at('proposal').lost === 1, JSON.stringify(at('proposal')));
  is('so its win rate is 50%', at('proposal').winRate === 50);
  is('qualified lost one and won none', at('qualified').lost === 1 && at('qualified').winRate === 0);
  is('value lost is attributed to the stage it was lost from',
     at('proposal').lostValue === 50000 && at('qualified').lostValue === 20000);
  is('a stage nothing has closed from reports no win rate rather than 0%',
     outcomesByStage([], {}).every((r) => r.winRate === null));
  is('the deal with no recorded prior stage is skipped, not bucketed',
     rows.reduce((n, r) => n + r.won + r.lost, 0) === 4);
}

console.log('\nreasons and sources are ranked by what they actually cost');
{
  const closed = [
    { stage: 'lost' as const, value: 50000, outcome_reason: 'Price', source: 'Cold email' },
    { stage: 'lost' as const, value: 20000, outcome_reason: 'Price', source: 'Cold email' },
    { stage: 'lost' as const, value: 90000, outcome_reason: 'No budget', source: 'LinkedIn' },
    { stage: 'lost' as const, value: 5000, outcome_reason: null, source: 'LinkedIn' },
    { stage: 'won' as const, value: 40000, outcome_reason: 'Product fit', source: 'LinkedIn' },
    { stage: 'qualified' as const, value: 10000, outcome_reason: null, source: 'Cold email' },
  ];

  const lost = reasonBreakdown(closed, 'lost');
  is('the commonest reason leads', lost[0].reason === 'Price' && lost[0].count === 2);
  is('and carries the value that went with it', lost[0].value === 70000, String(lost[0].value));
  is('closes with no reason given are left out rather than counted as blank',
     lost.reduce((n, r) => n + r.count, 0) === 3, JSON.stringify(lost));
  is('won reasons are a separate question', reasonBreakdown(closed, 'won')[0].reason === 'Product fit');

  const sources = performanceBySource(closed);
  const li = sources.find((s) => s.source === 'LinkedIn')!;
  const ce = sources.find((s) => s.source === 'Cold email')!;
  is('a source is judged on what closed, not how much it produced',
     li.won === 1 && li.lost === 2 && li.winRate === 33, JSON.stringify(li));
  is('cold email produced more deals and won none of them',
     ce.won === 0 && ce.lost === 2 && ce.open === 1 && ce.winRate === 0, JSON.stringify(ce));
  is('deals with no source are gathered rather than dropped',
     performanceBySource([{ stage: 'won', value: 10, outcome_reason: null, source: null } as any])[0].source === 'Unattributed');
}

console.log('\nstage duration uses the median, because one stuck deal ruins a mean');
{
  const ev = (from: string | null, to: string, n: number) =>
    ({ from_stage: from, to_stage: to, reason: null, changed_at: daysAgo(n) });

  /*
   * Four deals through qualified: 10, 12, 14 days, and one that sat there
   * for two years. The mean is about 190 days and describes nothing; the
   * median is 13 and is something you can plan against.
   */
  const history = {
    a: [ev(null, 'qualified', 70), ev('qualified', 'proposal', 60)],
    b: [ev(null, 'qualified', 50), ev('qualified', 'proposal', 38)],
    c: [ev(null, 'qualified', 30), ev('qualified', 'proposal', 16)],
    d: [ev(null, 'qualified', 760), ev('qualified', 'proposal', 30)],
  };
  const med = medianDaysPerStage(history, NOW);
  is('the outlier does not move the median', med.qualified === 13, String(med.qualified));

  is('a stage a deal is still sitting in is not counted as finished',
     medianDaysPerStage({ a: [ev(null, 'proposal', 40)] }, NOW).proposal === undefined);
  is('no history at all is an empty answer, not a crash',
     Object.keys(medianDaysPerStage({}, NOW)).length === 0);
}


/* ─── Leads: the holding area before the pipeline ─────────────────────── */

console.log('\nthe lead funnel is measured over decisions, not over arrivals');
{
  const lead = (status: 'open' | 'converted' | 'archived', value: number | null = null) =>
    ({ status, value });

  const f = summariseLeads([
    lead('open', 5000), lead('open', 12000), lead('open', null),
    lead('converted'), lead('converted'), lead('converted'),
    lead('archived'),
  ]);
  is('open, converted and archived are counted separately',
     f.open === 3 && f.converted === 3 && f.archived === 1, JSON.stringify(f));

  /*
   * Three converted out of four decided is 75%. Counting the three open
   * ones in the denominator would give 43% — and would mean the rate fell
   * every time somebody added a lead and rose every time they archived a
   * batch, which is precisely backwards.
   */
  is('the rate is converted over decided, so adding a lead cannot lower it',
     f.conversionRate === 75, String(f.conversionRate));
  is('estimated value counts open leads only',
     f.openValue === 17000, String(f.openValue));
  is('a lead with no estimate contributes nothing rather than NaN',
     Number.isFinite(f.openValue));

  is('nothing decided yet means no rate at all, not 0%',
     summariseLeads([lead('open'), lead('open')]).conversionRate === null);
  is('an empty inbox does not divide by zero',
     summariseLeads([]).conversionRate === null && summariseLeads([]).open === 0);
}

console.log('\na lead nobody has answered is the point of the inbox');
{
  const at = (n: number) => ({ status: 'open' as const, created_at: daysAgo(n) });
  is('an untouched lead older than the threshold is stale',
     leadIsStale(at(9), NOW));
  is('a fresh one is not', !leadIsStale(at(2), NOW));
  is('exactly on the threshold is not yet stale',
     !leadIsStale(at(7), NOW));

  /*
   * Only open leads can go stale. A converted lead has been dealt with and
   * a dropped one has been decided against; nagging about either would
   * teach people to ignore the flag that matters.
   */
  is('a converted lead is never stale, however old',
     !leadIsStale({ status: 'converted', created_at: daysAgo(400) }, NOW));
  is('nor is a dropped one',
     !leadIsStale({ status: 'archived', created_at: daysAgo(400) }, NOW));
  is('an unparseable date is not treated as infinitely old',
     !leadIsStale({ status: 'open', created_at: 'not a date' }, NOW));
}


/* ─── Prospects, contacts and customers ───────────────────────────────── */

console.log('\npromotion only ever moves forward');
{
  is('a stranger who replies becomes a contact', shouldPromote('prospect', 'contact'));
  is('a contact who buys becomes a customer', shouldPromote('contact', 'customer'));
  is('a stranger who buys skips straight to customer', shouldPromote('prospect', 'customer'));

  /*
   * The case that matters. A customer replying to a nurture campaign fires
   * the same promotion path as anybody else, and if it were allowed to
   * apply it would quietly demote them back to a contact — which would put
   * them back in scope for cold outreach.
   */
  is('a customer replying to a campaign is not demoted to a contact',
     !shouldPromote('customer', 'contact'));
  is('nor is a contact demoted to a prospect by any event',
     !shouldPromote('contact', 'prospect'));
  is('re-applying the same level is not a promotion, so nothing is rewritten',
     !shouldPromote('contact', 'contact') && !shouldPromote('customer', 'customer'));
  is('a missing lifecycle is treated as prospect rather than crashing',
     shouldPromote(null, 'contact') && shouldPromote(undefined, 'contact'));
}

console.log('\nthe CRM list means contacts and customers, not strangers');
{
  is('a contact is engaged', isEngaged('contact'));
  is('so is a customer', isEngaged('customer'));
  is('a prospect is not', !isEngaged('prospect'));
  is('and neither is a missing value', !isEngaged(null) && !isEngaged(undefined));
}

console.log('\nthe engagement rate is the top-of-funnel number that was unanswerable');
{
  const c = countLifecycles([
    ...Array.from({ length: 90 }, () => ({ lifecycle: 'prospect' as const })),
    ...Array.from({ length: 8 }, () => ({ lifecycle: 'contact' as const })),
    { lifecycle: 'customer' as const }, { lifecycle: 'customer' as const },
  ]);
  is('each population is counted separately',
     c.prospect === 90 && c.contact === 8 && c.customer === 2, JSON.stringify(c));
  is('customers count as engaged, so the rate is 10%',
     c.engagementRate === 10, String(c.engagementRate));
  is('the total is everybody', c.total === 100);
  is('a contact with no lifecycle recorded counts as a prospect',
     countLifecycles([{}, { lifecycle: null }]).prospect === 2);
  is('an empty book has no rate rather than a zero one',
     countLifecycles([]).engagementRate === null);
}

console.log('\nrevenue is rolled up by the campaign that produced it');
{
  const deal = (over: any) => ({
    id: Math.random().toString(36).slice(2), title: 't', stage: 'won',
    value: 0, currency: 'USD', probability: null,
    recurring_amount: null, recurring_period: null, one_off_amount: null, term_months: null,
    ...over,
  }) as any;

  const rows = revenueByCampaign([
    deal({ source_campaign_id: 'A', attribution: 'reply',     stage: 'won',      value: 50_000 }),
    deal({ source_campaign_id: 'A', attribution: 'thread',    stage: 'won',      value: 30_000 }),
    deal({ source_campaign_id: 'A', attribution: 'enrolment', stage: 'won',      value: 20_000 }),
    deal({ source_campaign_id: 'A', attribution: 'reply',     stage: 'lost',     value: 10_000 }),
    deal({ source_campaign_id: 'B', attribution: 'reply',     stage: 'proposal', value: 40_000 }),
    // Neither of these is a claim about any campaign, so neither may appear.
    deal({ source_campaign_id: null, attribution: null,       stage: 'won',      value: 999_000 }),
    deal({ source_campaign_id: 'C',  attribution: null,       stage: 'won',      value: 999_000 }),
  ]);

  const a = rows.find((r) => r.campaignId === 'A')!;
  const b = rows.find((r) => r.campaignId === 'B')!;

  is('an unattributed deal is left out rather than bucketed as unknown',
     rows.length === 2 && !rows.some((r) => r.campaignId === 'C'),
     rows.map((r) => r.campaignId).join(','));
  is('won value is the money that actually closed',
     a.wonValue === 100_000, String(a.wonValue));
  is('weak evidence still counts as a deal',
     a.deals === 4 && a.won === 3, `${a.deals}/${a.won}`);
  is('but is excluded from the forecastable figure',
     a.strongWonValue === 80_000 && a.strongDeals === 3,
     `${a.strongWonValue} / ${a.strongDeals}`);
  is('win rate is of what closed, not of everything',
     a.winRate === 0.75, String(a.winRate));
  is('average won deal is the mean of the wins',
     a.averageWon !== null && Math.round(a.averageWon) === 33_333, String(a.averageWon));
  is('an open deal is pipeline, not revenue',
     b.wonValue === 0 && b.open === 1 && b.weightedOpen > 0,
     `${b.wonValue}/${b.open}/${b.weightedOpen}`);
  is('a campaign with nothing closed has no win rate rather than a zero one',
     b.winRate === null, String(b.winRate));
  is('the biggest earner leads', rows[0].campaignId === 'A');

  // A retainer and a one-off of the same headline number are not the same deal.
  const shaped = revenueByCampaign([
    deal({ source_campaign_id: 'D', attribution: 'reply', stage: 'won',
           recurring_amount: 5_000, recurring_period: 'month', term_months: 12, one_off_amount: 10_000 }),
  ])[0];
  is('a shaped deal is worth its contract value, not its headline',
     shaped.wonValue === 70_000, String(shaped.wonValue));
}

console.log('\nthe funnel converts against the step before it');
{
  const f = outreachFunnel({ sent: 2000, replied: 14, deals: 6, won: 3 });
  is('the first step has nothing to convert from', f[0].ofPrevious === null);
  is('replies are measured against sends',
     f[1].ofPrevious !== null && Math.abs(f[1].ofPrevious - 0.007) < 1e-9, String(f[1].ofPrevious));
  is('wins are measured against deals, not against sends',
     f[3].ofPrevious === 0.5, String(f[3].ofPrevious));
  is('a zero step does not divide by zero',
     outreachFunnel({ sent: 0, replied: 0, deals: 0, won: 0 }).every((s) => s.ofPrevious === null));

  is('value per reply answers whether to run it again',
     valuePerReply(100_000, 14) !== null && Math.round(valuePerReply(100_000, 14)!) === 7143,
     String(valuePerReply(100_000, 14)));
  is('with no replies it is unknown, not zero',
     valuePerReply(0, 0) === null);
  is('weak evidence is named as weak',
     !isStrongAttribution('enrolment') && isStrongAttribution('reply') && isStrongAttribution('thread'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
