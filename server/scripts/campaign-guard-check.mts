/* ═══════════════════════════════════════════════════════════════════════
   Closed days, the two new guards, and the copy the preview renders.

   Each is a promise somebody will rely on without watching: that nothing
   goes out on Christmas Day, that a campaign being reported as spam stops,
   that a sequence growing quieter step by step is NOT mistaken for one
   landing in spam, and that the preview's unsubscribe/sender/spintax pass
   is the very one a send runs.

   Run: npx tsx scripts/campaign-guard-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'audit';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'audit';
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);

const shared = await import('@lemlist/shared');
const {
  normalizeBlackoutDate, normalizeBlackoutDates, isBlackoutDay, mergeBlackoutDates,
  judgeComplaints, judgeOpenCollapse, nowInTimezone, partsInTimezone, notificationFor,
} = shared;
const { isWithinSendWindow, getNextSendWindowStart } = await import('../src/services/sequence.service.js');
const { finishRecipientCopy } = await import('../src/services/email-sender.service.js');

let pass = 0, fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` - got ${detail}` : ''}`); }
}

console.log('a closed day means what it says');
is('a one-off date survives', normalizeBlackoutDate('2026-12-25') === '2026-12-25');
is('an annual date survives', normalizeBlackoutDate('12-25') === '12-25');
is('29 Feb is a real annual entry', normalizeBlackoutDate('02-29') === '02-29');
is('a date that never comes is refused', normalizeBlackoutDate('2026-02-30') === null);
is('29 Feb in a non-leap year is refused', normalizeBlackoutDate('2027-02-29') === null);
is('junk is refused', normalizeBlackoutDate('christmas') === null && normalizeBlackoutDate(1225) === null);
is('a list is cleaned, de-duplicated and sorted',
   JSON.stringify(normalizeBlackoutDates(['2026-11-03', '12-25', 'x', '12-25', '01-01'])) === JSON.stringify(['01-01', '12-25', '2026-11-03']),
   JSON.stringify(normalizeBlackoutDates(['2026-11-03', '12-25', 'x', '12-25', '01-01'])));
is('account and campaign lists merge', mergeBlackoutDates(['12-25'], ['12-26'], null).length === 2);
is('annual matches any year', isBlackoutDay(['12-25'], 2031, 12, 25));
is('one-off matches only its year', isBlackoutDay(['2026-12-25'], 2026, 12, 25) && !isBlackoutDay(['2026-12-25'], 2027, 12, 25));
is('no list, no closed days', !isBlackoutDay([], 2026, 12, 25) && !isBlackoutDay(undefined, 2026, 12, 25));

console.log('\nthe engine treats one as a closed day and rolls on');
{
  const tz = 'Pacific/Auckland'; // UTC+12/13: where noon-UTC probing used to skip a day
  const every = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const campaign = { timezone: tz, send_days: every, send_window_start: '00:00', send_window_end: '23:59' };
  const now = nowInTimezone(tz);
  const day = (offset: number) => {
    const d = new Date(Date.UTC(now.year, now.month - 1, now.day + offset));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };
  is('an all-day, every-day window is open without closed days', isWithinSendWindow(campaign, undefined, []));
  is('and shut on a closed day', !isWithinSendWindow(campaign, undefined, [day(0)]));
  const next = getNextSendWindowStart(campaign, undefined, [day(0), day(1), day(2)]);
  const p = partsInTimezone(next, tz);
  const got = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  is('three closed days in a row roll to the fourth', got === day(3), `${got} vs ${day(3)}`);
  const weekdays = { ...campaign, send_days: ['monday'] };
  const far = getNextSendWindowStart(weekdays, undefined, Array.from({ length: 30 }, (_, i) => day(i)));
  is('a closure longer than a week is looked past', far.getTime() - Date.now() > 29 * 86_400_000, far.toISOString());
  const recipient = { ...campaign, send_in_recipient_timezone: true, timezone: 'UTC' };
  const theirs = nowInTimezone('America/Los_Angeles');
  const theirDay = `${theirs.year}-${String(theirs.month).padStart(2, '0')}-${String(theirs.day).padStart(2, '0')}`;
  is('read on the recipient\'s clock when the campaign sends on theirs',
     !isWithinSendWindow(recipient, { contact_timezone: 'America/Los_Angeles' }, [theirDay]));
}

console.log('\nspam complaints');
is('one complaint never pauses', !judgeComplaints(150, 1, 0.3).trip);
is('too few sends never pauses', !judgeComplaints(50, 5, 0.3).trip);
is('2 in 100 is confidently past 0.3%', judgeComplaints(100, 2, 0.3).trip);
is('2 in 300 is not - it could be bad luck', !judgeComplaints(300, 2, 0.3).trip);
is('3 in 300 is', judgeComplaints(300, 3, 0.3).trip);
is('a higher limit is respected', !judgeComplaints(300, 3, 1).trip);

console.log('\nan open-rate collapse');
{
  const sample = (n: number, rate: number, step: string) =>
    Array.from({ length: n }, (_, i) => ({ step_id: step, opened: i < Math.round(n * rate) }));
  const baseline = [...sample(300, 0.4, 's1'), ...sample(300, 0.25, 's2')];
  is('a cliff trips it', judgeOpenCollapse(sample(150, 0.04, 's1'), baseline, 60).trip);
  is('a follow-up opened less than the first email is NOT a collapse',
     !judgeOpenCollapse(sample(150, 0.22, 's2'), baseline, 60).trip,
     JSON.stringify(judgeOpenCollapse(sample(150, 0.22, 's2'), baseline, 60)));
  is('a modest dip does not', !judgeOpenCollapse(sample(150, 0.3, 's1'), baseline, 60).trip);
  is('too few recent sends never judge', !judgeOpenCollapse(sample(50, 0, 's1'), baseline, 60).trip);
  is('a campaign almost nobody opens is never judged',
     !judgeOpenCollapse(sample(150, 0, 's1'), sample(600, 0.05, 's1'), 60).trip);
}

console.log('\nthe owner is told why');
{
  const c = notificationFor('campaign.paused', { campaign_id: '1', reason: 'complaint_rate', complaints: 3, sent: 300 });
  const o = notificationFor('campaign.paused', { campaign_id: '1', reason: 'open_collapse', baseline_rate: 40, recent_rate: 4 });
  is('a complaint pause is an alert', c?.setting === 'campaign_alerts' && /spam/.test(c.text));
  is('an open-collapse pause is an alert', o?.setting === 'campaign_alerts' && /40%/.test(o.text));
  is('a hand pause still is not', notificationFor('campaign.paused', { campaign: { id: '1' } }) === null);
}

console.log('\nthe preview runs the send\'s own last pass');
{
  const out = finishRecipientCopy({
    subject: '{Hi|Hey} there',
    html: '<p>{Hi|Hey} {{first_name}}, {{sender_name}} here.</p>',
    sender: { name: 'Jordan Lee', email: 'j@example.com' },
    spinSeed: (part) => `step:cc:${part}`,
    unsubscribeUrl: 'https://t.example.com/api/track/unsubscribe/x',
    includeUnsubscribe: true,
  });
  const again = finishRecipientCopy({
    subject: '{Hi|Hey} there', html: '<p>{Hi|Hey} {{first_name}}, {{sender_name}} here.</p>',
    sender: { name: 'Jordan Lee', email: 'j@example.com' }, spinSeed: (part) => `step:cc:${part}`,
    unsubscribeUrl: 'https://t.example.com/api/track/unsubscribe/x', includeUnsubscribe: true,
  });
  is('sender tags filled', out.html.includes('Jordan Lee'), out.html);
  is('nothing left in braces', !/[{}]/.test(out.html.replace(/style="[^"]*"/g, '')) && !/[{}]/.test(out.subject), out.html);
  is('the unsubscribe footer is added', out.html.includes('/api/track/unsubscribe/x'));
  is('the same seed picks the same wording', out.html === again.html && out.subject === again.subject);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
