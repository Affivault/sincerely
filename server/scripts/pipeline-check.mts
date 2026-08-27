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
  daysByStage,
  nextStep,
  stageTimeline,
  summarisePipeline,
  weightedValue,
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
