/* ═══════════════════════════════════════════════════════════════════════
   When a customer comes up again, and what is riding on it.

   This is arithmetic, which is exactly why it is worth testing: every one
   of these functions feeds a number somebody plans around. A renewal that
   reads as one day nearer than it is, or an "at risk" total that quietly
   includes deals already renewed, is the kind of wrong that nobody
   notices until the quarter is over.

   The date handling is the part with teeth. A renewal date is a calendar
   date, not an instant, and the obvious `new Date('2027-01-15')` gives
   midnight UTC - which is the 14th for anybody west of Greenwich. Half the
   world would see every renewal a day early, including "due today".

   Run: npx tsx scripts/renewal-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import {
  RENEWAL_BANDS,
  actionableDate,
  daysUntil,
  noticeDeadline,
  parseCalendarDate,
  renewalBand,
  renewalPhrase,
  renewalSummary,
  renewalValue,
  toIsoDate,
  triggerSpec,
  describeTriggerProblem,
  isAutomatic,
  CAMPAIGN_TRIGGERS,
  type RenewalDeal,
} from '@lemlist/shared';

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

/** A fixed "today" so nothing here depends on when it is run. */
const TODAY = new Date(2026, 8, 2); // 2 September 2026, local

const deal = (over: Partial<RenewalDeal> = {}): RenewalDeal => ({
  id: 'd1',
  title: 'Northbeam',
  stage: 'won',
  renewal_status: 'upcoming',
  recurring_amount: 5000,
  recurring_period: 'month',
  term_months: 12,
  ...over,
});

console.log('a calendar date is a calendar date, not an instant');
{
  const d = parseCalendarDate('2027-01-15');
  is('parsed into the local day somebody wrote down',
     d !== null && d.getFullYear() === 2027 && d.getMonth() === 0 && d.getDate() === 15,
     d ? d.toString() : 'null');

  /*
   * The bug this exists to stop. `new Date('2027-01-15')` is midnight UTC,
   * so in any negative-offset timezone .getDate() is 14 - every renewal
   * reads one day nearer than it is.
   */
  is('and not through UTC, which would shift the day for half the world',
     parseCalendarDate('2027-01-15')!.getDate() === 15,
     `got ${parseCalendarDate('2027-01-15')!.getDate()}`);

  is('a date with a time on it still lands on the right day',
     parseCalendarDate('2027-01-15T23:30:00Z')!.getDate() === 15);
  is('nothing is nothing', parseCalendarDate(null) === null && parseCalendarDate('') === null);
  is('and garbage is nothing rather than Invalid Date',
     parseCalendarDate('not a date') === null);

  is('round-tripping keeps the day',
     toIsoDate(parseCalendarDate('2027-01-15')!) === '2027-01-15');
}

console.log('\ncounting the days');
{
  is('today is zero', daysUntil('2026-09-02', TODAY) === 0, String(daysUntil('2026-09-02', TODAY)));
  is('tomorrow is one', daysUntil('2026-09-03', TODAY) === 1);
  is('yesterday is minus one', daysUntil('2026-09-01', TODAY) === -1);
  is('a date months out is counted in whole days',
     daysUntil('2026-12-01', TODAY) === 90, String(daysUntil('2026-12-01', TODAY)));
  is('no date is null rather than zero, which would read as "today"',
     daysUntil(null, TODAY) === null);

  /*
   * Across a daylight-saving boundary the elapsed milliseconds between two
   * calendar dates is 23 or 25 hours, so dividing and flooring loses or
   * gains a day. Rounding is what keeps the count whole.
   */
  const springForward = new Date(2027, 2, 27);  // day before UK clocks change
  is('a daylight-saving change does not eat a day',
     daysUntil('2027-03-29', springForward) === 2, String(daysUntil('2027-03-29', springForward)));
}

console.log('\nthe deadline that actually matters');
{
  is('no notice period means the renewal date is the deadline',
     noticeDeadline(deal({ renewal_date: '2027-01-15' })) === null);
  is('a notice period moves the deadline earlier',
     noticeDeadline(deal({ renewal_date: '2027-01-15', renewal_notice_days: 60 })) === '2026-11-16',
     String(noticeDeadline(deal({ renewal_date: '2027-01-15', renewal_notice_days: 60 }))));
  is('and that earlier date is what the app steers by',
     actionableDate(deal({ renewal_date: '2027-01-15', renewal_notice_days: 60 })) === '2026-11-16');
  is('without one, it steers by the renewal itself',
     actionableDate(deal({ renewal_date: '2027-01-15' })) === '2027-01-15');
  is('a zero notice period is not a deadline',
     noticeDeadline(deal({ renewal_date: '2027-01-15', renewal_notice_days: 0 })) === null);
}

console.log('\nbanding, so a list becomes a plan');
{
  const band = (date: string, notice?: number) =>
    renewalBand(deal({ renewal_date: date, renewal_notice_days: notice }), TODAY);

  is('a date that has passed is overdue', band('2026-08-01') === 'overdue');
  is('yesterday is overdue', band('2026-09-01') === 'overdue');
  is('today is this week, not overdue', band('2026-09-02') === 'this_week', String(band('2026-09-02')));
  is('seven days out is still this week', band('2026-09-09') === 'this_week');
  is('eight days out is not', band('2026-09-10') === 'this_month');
  is('thirty days out is within the month', band('2026-10-02') === 'this_month');
  is('ninety days out is within the quarter', band('2026-12-01') === 'quarter');
  is('ninety-one days out is later', band('2026-12-02') === 'later');
  is('no date bands into nothing rather than into "overdue"',
     renewalBand(deal({ renewal_date: null }), TODAY) === null);

  /*
   * The point of the notice deadline. A renewal a hundred days out with a
   * sixty day notice period has forty days left, not a hundred, and putting
   * it in "later" is how the window closes without anybody seeing it.
   */
  is('a notice period pulls a far-off renewal into an urgent band',
     band('2026-12-11', 60) === 'quarter', String(band('2026-12-11', 60)));
  is('while the same renewal with no notice period is not urgent yet',
     band('2026-12-11') === 'later');
  is('and a long enough notice period makes it this month',
     band('2026-12-11', 80) === 'this_month', String(band('2026-12-11', 80)));

  is('every band in the list is reachable',
     new Set(RENEWAL_BANDS.map((b) => b.id)).size === RENEWAL_BANDS.length);
  is('and each one explains itself',
     RENEWAL_BANDS.every((b) => b.hint.length > 20));
}

console.log('\nwhat is actually at stake');
{
  is('a recurring deal is worth its annual recurring revenue',
     renewalValue(deal({ recurring_amount: 5000, recurring_period: 'month' })) === 60000,
     String(renewalValue(deal({ recurring_amount: 5000, recurring_period: 'month' }))));
  is('however the customer was quoted it',
     renewalValue(deal({ recurring_amount: 60000, recurring_period: 'year' })) === 60000);
  is('a quarterly retainer normalises too',
     renewalValue(deal({ recurring_amount: 15000, recurring_period: 'quarter' })) === 60000);

  /*
   * A three year term is not three years of risk at renewal time: what is
   * up for renewal is the next year of it. Using total contract value here
   * would treble the number on the page.
   */
  is('a three-year deal risks a year, not the whole term',
     renewalValue(deal({ recurring_amount: 5000, recurring_period: 'month', term_months: 36 })) === 60000,
     String(renewalValue(deal({ recurring_amount: 5000, recurring_period: 'month', term_months: 36 }))));

  is('a deal with no recurring part falls back to its own value',
     renewalValue({ value: 24000, recurring_amount: null, one_off_amount: null, term_months: null }) === 24000);
  is('and an empty deal is worth nothing rather than NaN',
     renewalValue({}) === 0);
}

console.log('\nthe summary a page is built on');
{
  const deals: RenewalDeal[] = [
    deal({ id: 'a', renewal_date: '2026-08-01' }),                       // overdue
    deal({ id: 'b', renewal_date: '2026-09-05' }),                       // this week
    deal({ id: 'c', renewal_date: '2026-10-01' }),                       // this month
    deal({ id: 'd', renewal_date: '2026-11-15' }),                       // quarter
    deal({ id: 'e', renewal_date: '2027-06-01' }),                       // later
    deal({ id: 'f', renewal_date: '2026-09-20', renewal_status: 'renewed' }),
    deal({ id: 'g', renewal_date: '2026-09-21', renewal_status: 'churned' }),
    deal({ id: 'h', renewal_date: null }),
  ];
  const s = renewalSummary(deals, TODAY);

  is('only renewals still to be decided are counted',
     s.totalCount === 5, `${s.totalCount} counted`);
  is('a renewed deal is history, not risk',
     !JSON.stringify(s).includes('"f"'));
  is('each band holds the right one',
     s.bands.map((b) => `${b.id}:${b.count}`).join(' ') === 'overdue:1 this_week:1 this_month:1 quarter:1 later:1',
     s.bands.map((b) => `${b.id}:${b.count}`).join(' '));

  is('at risk is the next ninety days plus whatever already slipped',
     s.atRiskCount === 4, `${s.atRiskCount}`);
  is('and excludes the far-off one, which nobody can act on yet',
     s.atRiskValue === 4 * 60000, String(s.atRiskValue));
  is('overdue is reported separately, because it is a different problem',
     s.overdueCount === 1 && s.overdueValue === 60000, JSON.stringify({ c: s.overdueCount, v: s.overdueValue }));
  is('the total covers everything undecided, including later',
     s.totalValue === 5 * 60000, String(s.totalValue));

  const empty = renewalSummary([], TODAY);
  is('no deals is zeroes, not an empty page of NaN',
     empty.totalCount === 0 && empty.atRiskValue === 0 && empty.bands.length === RENEWAL_BANDS.length);
}

console.log('\nhow a renewal reads in a sentence');
{
  is('today', renewalPhrase(deal({ renewal_date: '2026-09-02' }), TODAY) === 'today');
  is('tomorrow', renewalPhrase(deal({ renewal_date: '2026-09-03' }), TODAY) === 'tomorrow');
  is('yesterday', renewalPhrase(deal({ renewal_date: '2026-09-01' }), TODAY) === 'yesterday');
  is('in n days', renewalPhrase(deal({ renewal_date: '2026-10-02' }), TODAY) === 'in 30 days');
  is('n days ago', renewalPhrase(deal({ renewal_date: '2026-08-03' }), TODAY) === '30 days ago');
  is('and nothing at all when there is no date',
     renewalPhrase(deal({ renewal_date: null }), TODAY) === null);
}

console.log('\nwhat starts a sequence');
{
  is('an unknown trigger falls back to manual rather than throwing',
     triggerSpec('nonsense' as any).id === 'manual');
  is('manual is not automatic', !isAutomatic('manual') && !isAutomatic(null));
  is('the three CRM triggers are', ['deal_won', 'renewal_due', 'deal_lost'].every((t) => isAutomatic(t as any)));
  is('every trigger says what it actually does',
     CAMPAIGN_TRIGGERS.every((t) => t.effect.length > 20));
  is('and every automatic one says which way its offset counts',
     CAMPAIGN_TRIGGERS.filter((t) => t.postSaleOnly).every((t) => t.offsetLabel.length > 0));

  /*
   * The one configuration that must never be accepted: a cold sequence that
   * fires off your own deals, which would pitch your customers. The database
   * refuses it too - this is so the form can say so before somebody saves.
   */
  is('a cold campaign with a CRM trigger is refused, and told why',
     /pitch your customers/.test(
       describeTriggerProblem({ audience: 'cold', trigger_event: 'renewal_due' }) || ''),
     String(describeTriggerProblem({ audience: 'cold', trigger_event: 'renewal_due' })));
  is('the same trigger on a customer campaign is fine',
     describeTriggerProblem({ audience: 'post_sale', trigger_event: 'renewal_due', trigger_offset_days: 90 }) === null);
  is('a cold campaign a person starts is fine',
     describeTriggerProblem({ audience: 'cold', trigger_event: 'manual' }) === null);
  is('a negative offset is refused',
     describeTriggerProblem({ audience: 'post_sale', trigger_event: 'renewal_due', trigger_offset_days: -1 }) !== null);
  is('and one longer than a year',
     describeTriggerProblem({ audience: 'post_sale', trigger_event: 'renewal_due', trigger_offset_days: 400 }) !== null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
