/* ═══════════════════════════════════════════════════════════════════════
   Forty replies land, three matter, and the three get lost.

   That is where cold outreach actually leaks money, and it was the part
   of the loop this app had nothing for. A reply could be classified
   (sara_intent) and triaged into a disposition (interested / later / not
   interested), but nothing said WHOSE JOB IT WAS or HOW LONG SOMEBODY HAD
   BEEN WAITING.

   A queue is easy to build and easy to build uselessly, and every way of
   getting it wrong ends the same way - somebody stops looking at it,
   which is worse than having no queue, because now the real ones are
   hidden behind a number nobody trusts. So the assertions here are
   mostly about what must NOT be in it:

     AN AUTOREPLY IS NOT A PERSON WAITING. Get this wrong and the overdue
     count is meaningless within a week.

     AN UNSUBSCRIBE IS NOT A CONVERSATION. It needs an action, not a
     reply, so it cannot be "overdue for a response".

     A PARKED REPLY IS NOT A LATE ONE. Without somewhere to put "ask me
     in March", the only way to clear it is to pretend it is answered.

     TRIAGE IS NOT AN ANSWER. Letting a disposition stop the clock turns
     the SLA into a measure of how fast somebody clicks a label.

     URGENCY IS NOT AGE. Rank on age alone and the top of the queue is
     permanently held by the oldest thing nobody was ever going to
     convert.

   Run: npx tsx scripts/reply-queue-check.mts
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
  needsHuman, replyState, replyPriority, queueCounts, waitLabel,
  replyStateLabel, REPLY_SLA_MS, DEFAULT_SLA_MS,
} = await import('@lemlist/shared');

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const hoursAhead = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

/** A person, interested, who wrote in an hour ago. */
const reply = (over: Record<string, unknown> = {}) => ({
  received_at: hoursAgo(1),
  sara_intent: 'interested',
  auto_reply_kind: null,
  triage_decision: null,
  assigned_to: null,
  first_response_at: null,
  snoozed_until: null,
  ...over,
}) as any;

console.log('\nwhat is not a person waiting');
{
  is('an ordinary reply is', needsHuman(reply()) === true);

  /*
   * The load-bearing one. An out-of-office does not need an answer, and a
   * clock started by a robot makes the overdue count meaningless within a
   * week - at which point people stop looking, and the real ones are
   * hidden behind a number nobody trusts.
   */
  is('an out-of-office is not',
     needsHuman(reply({ auto_reply_kind: 'out_of_office' })) === false,
     'the queue would fill with robots');
  is('nor is any other autoreply',
     needsHuman(reply({ auto_reply_kind: 'auto_reply' })) === false);

  /*
   * An unsubscribe needs an action, not a reply. Showing it as overdue
   * for a response teaches people that overdue means nothing.
   */
  is('an unsubscribe is not a conversation',
     needsHuman(reply({ sara_intent: 'unsubscribe' })) === false);
  is('nor is a bounce', needsHuman(reply({ sara_intent: 'bounce' })) === false);
  is('nor is an out-of-office that was classified rather than flagged',
     needsHuman(reply({ sara_intent: 'out_of_office' })) === false);

  is('an answered reply is finished',
     needsHuman(reply({ first_response_at: hoursAgo(0.5) })) === false);
  is('and so is one decided to be a dead end',
     needsHuman(reply({ triage_decision: 'not_interested' })) === false);

  /*
   * "Later" is the one people think is handled and is not. It is a reply
   * somebody intends to come back to, which is exactly the thing that
   * gets forgotten, so it stays in until it is parked with a date.
   */
  is('but "later" is still waiting until it is parked',
     needsHuman(reply({ triage_decision: 'later' })) === true,
     'the replies most likely to be forgotten would vanish from the queue');

  // An unclassified reply is a person until something says otherwise.
  is('an unclassified reply is assumed to be a person',
     needsHuman(reply({ sara_intent: null })) === true);
}

console.log('\ntriage is not an answer');
{
  /*
   * The distinction the whole SLA rests on. Deciding a reply is
   * "interested" is a note to yourself; it is not answering the person
   * who wrote in. Conflating them turns the clock into a measure of how
   * fast somebody clicks a label.
   */
  const triaged = replyState(reply({ triage_decision: 'interested', received_at: hoursAgo(9) }), NOW);
  is('a triaged reply is still waiting', triaged.urgency === 'overdue', triaged.urgency);
  is('and its clock never stopped', triaged.waitedMs === 9 * 3_600_000, String(triaged.waitedMs));

  const answered = replyState(reply({ first_response_at: hoursAgo(1) }), NOW);
  is('an answered one is done', answered.urgency === 'done');
  is('with no clock at all', answered.waitedMs === 0 && answered.remainingMs === null);
}

console.log('\nhow long each kind of reply gets');
{
  /*
   * Differentiated on purpose. Somebody asking to book is ready now and
   * every hour costs; somebody raising an objection is thinking, and an
   * answer tomorrow is a good answer. One flat number would be either
   * hysterical or useless.
   */
  is('a request to book gets two hours', REPLY_SLA_MS.meeting === 2 * 3_600_000);
  is('an objection gets a day', REPLY_SLA_MS.objection === 24 * 3_600_000);
  is('and "not now" gets three', REPLY_SLA_MS.not_now === 72 * 3_600_000);
  is('a request to book is late sooner than an objection',
     REPLY_SLA_MS.meeting < REPLY_SLA_MS.objection,
     'one flat SLA would be either hysterical or useless');

  const bookingLate = replyState(reply({ sara_intent: 'meeting', received_at: hoursAgo(3) }), NOW);
  const objectionFine = replyState(reply({ sara_intent: 'objection', received_at: hoursAgo(3) }), NOW);
  is('three hours is late for a booking request', bookingLate.urgency === 'overdue');
  is('and perfectly fine for an objection', objectionFine.urgency === 'waiting',
     objectionFine.urgency);

  is('an unknown intent falls back rather than throwing',
     replyState(reply({ sara_intent: 'something-new' }), NOW).slaMs === DEFAULT_SLA_MS);

  // The warning band, so "late" is not the first anybody hears of it.
  const soon = replyState(reply({ sara_intent: 'interested', received_at: hoursAgo(3.5) }), NOW);
  is('there is a warning before it is late', soon.urgency === 'due-soon', soon.urgency);
  is('with the time left', soon.remainingMs === 0.5 * 3_600_000, String(soon.remainingMs));
}

console.log('\nparked is not late, and parking does not reset the clock');
{
  const parked = replyState(reply({ received_at: hoursAgo(48), snoozed_until: hoursAhead(72) }), NOW);
  is('a parked reply is parked, not overdue', parked.urgency === 'parked', parked.urgency);
  is('and it reports how long it is parked for',
     parked.remainingMs === 72 * 3_600_000, String(parked.remainingMs));

  /*
   * And it comes back on its own. There is no sweep to wake it: the state
   * is computed from the timestamp at read time, so a snooze that has
   * expired is simply no longer a snooze. Nothing to drift.
   */
  const woken = replyState(reply({ received_at: hoursAgo(48), snoozed_until: hoursAgo(1) }), NOW);
  is('an expired park is back in the queue', woken.urgency === 'overdue', woken.urgency);

  /*
   * Parking is a promise to come back, not a fresh start. The wait runs
   * from when the reply arrived, because that is when the person started
   * waiting - resetting it would let somebody park a reply forever and
   * always look on time.
   */
  is('and the wait is still measured from when they wrote in',
     woken.waitedMs === 48 * 3_600_000, String(woken.waitedMs));
}

console.log('\nurgency is not age');
{
  /*
   * Rank on age alone and the top of the queue is permanently held by the
   * oldest thing nobody was ever going to convert - which is the fastest
   * way to teach somebody to ignore the top of the queue.
   */
  const freshBooking = reply({ sara_intent: 'meeting', received_at: hoursAgo(1) });
  const ancientNotNow = reply({ sara_intent: 'not_now', received_at: hoursAgo(600) });
  is('a fresh request to book outranks a three-week-old "not now"',
     replyPriority(freshBooking, NOW) > replyPriority(ancientNotNow, NOW),
     `${replyPriority(freshBooking, NOW)} vs ${replyPriority(ancientNotNow, NOW)}`);

  /*
   * Lateness is capped for the same reason. A reply overdue by three
   * weeks has already failed; a fresh one has not.
   */
  const veryLateOther = reply({ sara_intent: 'other', received_at: hoursAgo(500) });
  is('and outranks something merely very late',
     replyPriority(freshBooking, NOW) > replyPriority(veryLateOther, NOW),
     `${replyPriority(freshBooking, NOW)} vs ${replyPriority(veryLateOther, NOW)}`);

  // Within a band, lateness does decide.
  const lateA = reply({ sara_intent: 'interested', received_at: hoursAgo(12) });
  const lateB = reply({ sara_intent: 'interested', received_at: hoursAgo(5) });
  is('but within one intent, the later one comes first',
     replyPriority(lateA, NOW) > replyPriority(lateB, NOW));

  // Money matters, but does not take over.
  const withDeal = reply({ sara_intent: 'objection', deal_value: 40_000 });
  const noDeal = reply({ sara_intent: 'objection' });
  is('an open deal lifts a reply', replyPriority(withDeal, NOW) > replyPriority(noDeal, NOW));
  is('but not past a better intent',
     replyPriority(reply({ sara_intent: 'meeting' }), NOW) > replyPriority(withDeal, NOW),
     'one large deal would own the top of the queue for weeks');

  is('unowned work gets a nudge',
     replyPriority(reply(), NOW) > replyPriority(reply({ assigned_to: 'u1' }), NOW));

  /*
   * Parked and finished work must never outrank anything live, however
   * valuable, or parking would be pointless.
   */
  const parkedRich = reply({ sara_intent: 'meeting', deal_value: 500_000, snoozed_until: hoursAhead(48) });
  is('parked work sorts below everything live',
     replyPriority(parkedRich, NOW) < replyPriority(reply({ sara_intent: 'not_now' }), NOW),
     'parking a reply would not actually get it out of the way');
  is('and a finished one below that', replyPriority(reply({ first_response_at: hoursAgo(1) }), NOW) === -1);
}

console.log('\nthe counts add up and exclude what they should');
{
  const rows = [
    reply({ sara_intent: 'meeting', received_at: hoursAgo(5) }),              // overdue, unassigned
    reply({ sara_intent: 'interested', received_at: hoursAgo(3.5) }),          // due soon
    reply({ sara_intent: 'objection', assigned_to: 'me' }),                    // waiting, mine
    reply({ snoozed_until: hoursAhead(24) }),                                  // parked
    reply({ auto_reply_kind: 'out_of_office', received_at: hoursAgo(90) }),     // never counted
    reply({ first_response_at: hoursAgo(1) }),                                  // done
  ];
  const c = queueCounts(rows, { now: NOW, userId: 'me' });

  is('open counts only what a person is waiting on', c.open === 3, JSON.stringify(c));
  is('the autoreply is nowhere in it', c.open + c.parked === 4, JSON.stringify(c));
  is('overdue is counted', c.overdue === 1);
  is('and due-soon separately', c.dueSoon === 1);
  is('parked has its own count and is not open', c.parked === 1 && c.open === 3);
  is('unclaimed is counted', c.unassigned === 2, String(c.unassigned));
  is('and what is yours', c.mine === 1);

  is('an empty list is all zeroes, not a crash',
     queueCounts([], { now: NOW }).open === 0);
}

console.log('\nnothing here throws on a malformed row');
{
  const junk = replyState({ received_at: 'not a date' } as any, NOW);
  is('an unparseable timestamp does not become a permanent overdue',
     junk.urgency === 'waiting', junk.urgency);
  is('and does not produce a negative age', junk.waitedMs === 0);

  const future = replyState(reply({ received_at: hoursAhead(2) }), NOW);
  is('a reply from the future is not negatively old', future.waitedMs === 0);

  is('a junk snooze is ignored rather than crashing',
     replyState(reply({ snoozed_until: 'soon' }), NOW).urgency !== 'parked');
}

console.log('\nthe clock reads like something a person wrote');
{
  is('under a minute', waitLabel(30_000) === 'just now');
  is('minutes', waitLabel(4 * 60_000) === '4m');
  is('hours', waitLabel(3 * 3_600_000) === '3h');
  is('days', waitLabel(50 * 3_600_000) === '2d');
  is('never negative', waitLabel(-5000) === 'just now');

  const late = replyState(reply({ sara_intent: 'meeting', received_at: hoursAgo(6) }), NOW);
  const label = replyStateLabel(late);
  is('and an overdue reply says what it is past',
     /Waiting 6h/.test(label) && /past the 2h/.test(label), label);
  is('rather than only shouting "overdue"', !/^Overdue$/.test(label), label);
}

console.log('\nthe clock stops where a human actually replies');
{
  const inbox = srv('services/inbox.service.ts');
  const queue = srv('services/reply-queue.service.ts');

  is('sending a reply stops it',
     /await replyQueueService\.markResponded\(userId, messageId\);/.test(inbox),
     'the queue would keep an answered conversation as overdue forever');

  /*
   * Triage must not. It is a note to yourself, and letting it stop the
   * clock turns the SLA into a measure of how fast somebody clicks a
   * label.
   */
  is('triage does not',
     !/markResponded/.test(srv('services/triage.service.ts')),
     'triaging a reply would silently count as answering it');

  /*
   * The whole conversation, not one message. Answering any message in a
   * thread answers the person; marking only the open one leaves its
   * siblings in the queue as overdue replies to a handled conversation.
   */
  is('it stops for the whole thread', /\.eq\('thread_id', thread\)/.test(queue));
  is('and for the message itself, for mail with no thread at all',
     /And the message itself, whatever its thread turned out to be/.test(queue),
     'a one-off reply with no References header would never clear');
  is('our own outbound mail is never treated as waiting',
     /direction\.is\.null,direction\.eq\.inbound/.test(queue));
}

console.log('\nthe queue is ordered by the shared judgement, not by SQL');
{
  const queue = srv('services/reply-queue.service.ts');

  is('ranking comes from shared', /replyPriority\(facts, now\)/.test(queue));
  is('and the sort uses it', /filtered\.sort\(\(a, b\) => b\.priority - a\.priority\)/.test(queue),
     'a judgement in an ORDER BY is a judgement nobody can test');
  is('parked work is out of the default view',
     /default: return r\.state\.urgency !== 'parked'/.test(queue),
     'parking something would not get it out of the way');

  /*
   * Deal value is fetched once for the page. Forty replies would
   * otherwise be forty round trips to move a few of them up a list.
   */
  is('what is at stake is fetched in one query',
     /async function dealValueByContact/.test(queue) && /\.in\('contact_id'/.test(queue));
  /*
   * Through the shared isOpen rather than a comparison of its own. The
   * first version of this compared against a "status" column that does
   * not exist - the schema guard caught it - and the real question is
   * which STAGES are finished, which shared already answers.
   */
  is('and only open deals count',
     /if \(!isOpen\(deal\.stage as any\)\) continue;/.test(queue),
     'a closed-lost deal would still push a reply up the queue');
  is('using the one definition of an open stage',
     /needsHuman, isOpen,/.test(queue));
}

console.log('\nassignment promises only what the app can keep');
{
  /*
   * Every service here scopes by user_id and nothing reads team_members
   * for data access, so a teammate cannot open another user's inbox at
   * all. "Assign to Sarah" would hand over a reply she has no way to
   * read - a promise the system cannot keep - so the route only ever
   * assigns the caller to themselves.
   */
  const routes = srv('routes/reply-queue.routes.ts');
  is('the route assigns the caller, and only the caller',
     /assigned \? req\.userId! : null/.test(routes),
     'a reply could be handed to somebody with no way to open it');
  is('and says why, so this is not mistaken for an oversight',
     /scopes by user_id/.test(routes) && /org-scoped access/.test(routes));

  // The column takes any user id, so nothing changes when that lands.
  is('the service itself is already general',
     /assign\(userId: string, messageId: string, assignee: string \| null\)/.test(
       srv('services/reply-queue.service.ts')));
}

console.log('\nand the screen leads somewhere');
{
  const page = cli('pages/replies/RepliesPage.tsx');
  const inbox = cli('pages/inbox/InboxPage.tsx');

  /*
   * A queue whose rows open nothing is a list of things to feel bad
   * about. Every row lands on the real conversation.
   */
  is('a row opens the conversation', /navigate\(`\/inbox\?message=\$\{reply\.id\}`\)/.test(page));
  is('and the unibox knows what to do with that',
     /searchParams\.get\('message'\)/.test(inbox),
     'the link would land on the inbox and lose the message');
  is('the param is consumed once rather than sticking',
     /next\.delete\('message'\)/.test(inbox),
     'returning to the inbox later would reopen an old message');

  is('the state is rendered in words', /data-reply-state/.test(page) && /replyStateLabel/.test(page));
  is('claiming is one click', /data-reply-claim/.test(page));
  is('and parking is too', /data-reply-park/.test(page));

  /*
   * What is deliberately not in the queue, on the screen. A headline
   * number that silently includes robots is one people stop believing.
   */
  is('the exclusions are stated', /data-queue-caveat/.test(page));
  is('including that autoreplies never enter it',
     /never enter this queue/.test(page));
  is('and that triage is not an answer',
     /clock stops when you actually reply, not when you triage/.test(page));

  is('the page is routed', /path="\/replies"/.test(cli('App.tsx')));
  is('and reachable', /href: '\/replies'/.test(cli('components/layout/Sidebar.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} reply queue check(s) failed`);
