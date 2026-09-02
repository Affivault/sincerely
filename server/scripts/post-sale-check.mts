/* ═══════════════════════════════════════════════════════════════════════
   Sequences that start themselves, and the guards that must not.

   Post-sale enrolment deliberately opens two doors that cold outreach keeps
   shut: it will email somebody on an open deal, and somebody who lives only
   in a CRM contact list. Both are the point - a renewal is for a customer -
   and both are, in a cold campaign, the exact mistakes the app exists to
   prevent. So the interesting question is not whether enrolment works. It
   is whether the doors opened are the two intended ones and nothing else,
   and in particular whether the suppression list still holds.

   The other half is exactly-once. A worker that ticks every thirty seconds
   and enrols on a date range will re-enrol the same customer 2,880 times a
   day unless the ledger stops it - and will fail to enrol them next year
   unless the ledger knows the difference between one renewal and the next.

   Run: npx tsx scripts/post-sale-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'check';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'check';
process.env.TRACKING_SECRET ||= 'check-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.STRIPE_SECRET_KEY ||= '';

const { supabaseAdmin } = await import('../src/config/supabase.js');

const USER = '00000000-0000-0000-0000-000000000001';
const OTHER_USER = '00000000-0000-0000-0000-0000000000ff';

const iso = (d: Date) => d.toISOString();
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

interface World {
  deals: any[];
  deal_participants: any[];
  contacts: any[];
  campaigns: any[];
  campaign_contacts: any[];
  lifecycle_enrolments: any[];
  /**
   * Simulate two workers ticking at once.
   *
   * When set, reads of the ledger come back empty while its unique index
   * still bites on insert - which is exactly what the loser of a race sees.
   * Without this the read check catches every duplicate first and the race
   * path is never executed, so deleting it changes no test.
   */
  hideLedgerFromReads?: boolean;
  suppression_list: any[];
  inserted: any[];
  updated: any[];
  deleted: any[];
}

let world: World;

function freshWorld(over: Partial<World> = {}): World {
  return {
    deals: [{
      id: 'deal-1', user_id: USER, title: 'Northbeam', stage: 'won',
      closed_at: daysAgo(275), term_months: 12,
      renewal_date: day(90), renewal_status: 'upcoming',
      contact_id: 'contact-1',
    }],
    deal_participants: [{ id: 'p1', user_id: USER, deal_id: 'deal-1', contact_id: 'contact-2' }],
    contacts: [
      { id: 'contact-1', user_id: USER, email: 'signer@northbeam.com', is_unsubscribed: false, is_bounced: false },
      { id: 'contact-2', user_id: USER, email: 'champion@northbeam.com', is_unsubscribed: false, is_bounced: false },
    ],
    campaigns: [{
      id: 'camp-renewal', user_id: USER, name: 'Renewals', status: 'running',
      audience: 'post_sale', trigger_event: 'renewal_due', trigger_offset_days: 90,
    }],
    campaign_contacts: [],
    lifecycle_enrolments: [],
    suppression_list: [],
    inserted: [],
    updated: [],
    deleted: [],
    ...over,
  };
}

/* ── A stand-in for PostgREST ─────────────────────────────────────────
   Grown from the triage harness. Supports the operators these services
   actually use, including the embedded `campaigns.status` filter, because
   a stub that silently ignores a filter agrees with any code at all. */

function stub(table: string): any {
  let single = false;
  let counting = false;
  let deleting = false;
  let pendingUpdate: any = null;
  let justInserted: any[] = [];
  /** Set when an insert violates a unique index, so resolve() can report it. */
  let insertError: any = null;
  let limitN: number | null = null;
  let rangeTo: number | null = null;
  const filters: { op: string; col: string; value: any }[] = [];

  /** Resolve `campaigns.status` against the joined row. */
  const valueOf = (row: any, col: string): any => {
    if (!col.includes('.')) return row[col];
    const [rel, field] = col.split('.');
    const joined = world[rel as keyof World] as any[];
    if (!Array.isArray(joined)) return undefined;
    const fk = `${rel.replace(/s$/, '')}_id`;
    const match = joined.find((r: any) => r.id === row[fk]);
    return match ? match[field] : undefined;
  };

  const rowsFor = (): any[] => {
    if (table === 'lifecycle_enrolments' && world.hideLedgerFromReads) return [];
    let rows: any[] = ((world as any)[table] ?? []).slice();
    for (const f of filters) {
      rows = rows.filter((r) => {
        const v = valueOf(r, f.col);
        switch (f.op) {
          case 'eq': return v === f.value;
          case 'neq': return v !== f.value;
          case 'in': return f.value.includes(v);
          case 'is': return f.value === null ? (v === null || v === undefined) : v === f.value;
          case 'notis': return f.value === null ? (v !== null && v !== undefined) : v !== f.value;
          case 'lte': return v !== null && v !== undefined && String(v) <= String(f.value);
          case 'gte': return v !== null && v !== undefined && String(v) >= String(f.value);
          default: return true;
        }
      });
    }
    if (rangeTo !== null) rows = rows.slice(0, rangeTo + 1);
    if (limitN !== null) rows = rows.slice(0, limitN);
    return rows;
  };

  const resolve = () => {
    // A unique-index violation, reported the way PostgREST reports one —
    // through the same .select().maybeSingle() chain, not as a thrown error.
    if (insertError) {
      const err = insertError;
      insertError = null;
      return { data: null, error: err, count: 0 };
    }

    // An insert followed by .select().single() means "the row I just made".
    if (justInserted.length > 0) {
      const rows = justInserted;
      justInserted = [];
      return { data: single ? rows[0] : rows, error: null, count: rows.length };
    }

    const rows = rowsFor();

    if (pendingUpdate) {
      for (const row of rows) Object.assign(row, pendingUpdate);
      world.updated.push({ table, patch: pendingUpdate, rows: rows.length });
      pendingUpdate = null;
      return { data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
    }

    if (deleting) {
      const ids = new Set(rows.map((r) => r.id));
      (world as any)[table] = ((world as any)[table] ?? []).filter((r: any) => !ids.has(r.id));
      world.deleted.push(...rows.map((r) => ({ table, id: r.id })));
      return { data: null, error: null, count: rows.length };
    }

    if (counting) return { data: null, error: null, count: rows.length };
    if (single) return { data: rows[0] ?? null, error: rows[0] ? null : null, count: rows.length };
    return { data: rows, error: null, count: rows.length };
  };

  const chain: any = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return chain; };
      if (prop === 'select') return (_s?: string, opts?: any) => { if (opts?.count) counting = true; return chain; };
      if (prop === 'eq') return (col: string, value: any) => { filters.push({ op: 'eq', col, value }); return chain; };
      if (prop === 'neq') return (col: string, value: any) => { filters.push({ op: 'neq', col, value }); return chain; };
      if (prop === 'in') return (col: string, value: any[]) => { filters.push({ op: 'in', col, value }); return chain; };
      if (prop === 'is') return (col: string, value: any) => { filters.push({ op: 'is', col, value }); return chain; };
      if (prop === 'not') return (col: string, _op: string, value: any) => { filters.push({ op: 'notis', col, value }); return chain; };
      if (prop === 'lte') return (col: string, value: any) => { filters.push({ op: 'lte', col, value }); return chain; };
      if (prop === 'gte') return (col: string, value: any) => { filters.push({ op: 'gte', col, value }); return chain; };
      if (prop === 'limit') return (n: number) => { limitN = n; return chain; };
      if (prop === 'range') return (_from: number, to: number) => { rangeTo = to; return chain; };
      if (prop === 'insert' || prop === 'upsert') {
        return (rows: any) => {
          for (const row of Array.isArray(rows) ? rows : [rows]) {
            /*
             * The unique index on the ledger, honoured. Without it this
             * harness would happily record the same enrolment twice and
             * agree with a service that had no exactly-once guarantee at all.
             */
            if (table === 'lifecycle_enrolments') {
              const clash = world.lifecycle_enrolments.some((r) =>
                r.campaign_id === row.campaign_id && r.deal_id === row.deal_id
                && r.contact_id === row.contact_id && r.cycle_key === row.cycle_key);
              if (clash) {
                justInserted = [];
                insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
                return chain;
              }
            }
            const withId = { id: `${table}-${world.inserted.length + 1}`, ...row };
            world.inserted.push({ table, ...withId });
            (world as any)[table] = [...((world as any)[table] ?? []), withId];
            justInserted.push(withId);
          }
          return chain;
        };
      }
      if (prop === 'update') return (patch: any) => { pendingUpdate = patch; return chain; };
      if (prop === 'delete') { deleting = true; return () => chain; }
      if (prop === 'order') return () => chain;
      if (prop === 'then') return (res: any) => res(resolve());
      return () => chain;
    },
  });
  return chain;
}

(supabaseAdmin as any).from = stub;

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

const { enrolFromDeal, processLifecycleTriggers, contactsOnDeal, cycleKeyFor, fillsItselfFromCrm } =
  await import('../src/services/post-sale.service.js');

console.log('a sequence that fills itself can be launched empty');
{
  /*
   * Every campaign before this one had to have a contact before it could
   * start - right for a list built by hand, fatal for a sequence whose whole
   * purpose is to sit empty until a deal is won. Without the exemption in
   * `launch`, no post-sale campaign can ever be started, and the feature
   * ships unusable with every other test still green.
   */
  is('a renewal campaign fills itself',
     fillsItselfFromCrm({ audience: 'post_sale', trigger_event: 'renewal_due' }));
  is('so does an onboarding one',
     fillsItselfFromCrm({ audience: 'post_sale', trigger_event: 'deal_won' }));
  is('a customer campaign a person starts by hand does not',
     !fillsItselfFromCrm({ audience: 'post_sale', trigger_event: 'manual' }));
  is('nor one with no trigger at all',
     !fillsItselfFromCrm({ audience: 'post_sale', trigger_event: null }));
  is('and a cold campaign never does, whatever it claims',
     !fillsItselfFromCrm({ audience: 'cold', trigger_event: 'renewal_due' }));
}

const RENEWAL_CAMPAIGN = () => world.campaigns[0];
const DEAL = () => world.deals[0];

console.log('a renewal reaches everybody on the deal, not just whoever signed');
{
  world = freshWorld();
  const who = await contactsOnDeal(USER, 'deal-1');
  is('the named contact and every participant',
     who.length === 2 && who.includes('contact-1') && who.includes('contact-2'), JSON.stringify(who));

  const result = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  is('both are enrolled', result.enrolled === 2, JSON.stringify(result));
  is('a campaign_contacts row exists for each',
     world.campaign_contacts.length === 2, String(world.campaign_contacts.length));
  is('and each is due now, because the wait already happened before enrolling',
     world.campaign_contacts.every((cc: any) => cc.next_send_at && new Date(cc.next_send_at) <= new Date()),
     JSON.stringify(world.campaign_contacts.map((c: any) => c.next_send_at)));
  is('the ledger records the occasion, so this cannot happen twice',
     world.lifecycle_enrolments.length === 2
     && world.lifecycle_enrolments.every((r: any) => r.cycle_key === day(90)),
     JSON.stringify(world.lifecycle_enrolments.map((r: any) => r.cycle_key)));
}

console.log('\nthe two doors post-sale opens on purpose');
{
  /*
   * Being on an open deal, and living only in a CRM contact list, are the
   * two things that get somebody refused by a cold campaign. A renewal is
   * for exactly those people. This is the whole feature.
   */
  world = freshWorld();
  world.deals.push({ id: 'deal-open', user_id: USER, title: 'Expansion', stage: 'proposal', contact_id: 'contact-1' });
  const result = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  is('somebody mid-negotiation on another deal is still enrolled for their renewal',
     result.enrolled === 2 && result.contact_ids.includes('contact-1'), JSON.stringify(result));
  is('and nothing was refused for a cold-outreach reason',
     !('on_open_deal' in result.reasons) && !('crm_contact_only' in result.reasons),
     JSON.stringify(result.reasons));
}

console.log('\nthe door that stays shut');
{
  /*
   * The promise the app makes to people who are not its users. A customer
   * relationship is not a reason to decide somebody's "stop emailing me"
   * has expired.
   */
  world = freshWorld();
  world.suppression_list.push({ id: 's1', user_id: USER, email: 'signer@northbeam.com', reason: 'unsubscribed' });
  const result = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  is('a suppressed customer is NOT emailed, renewal or not',
     result.enrolled === 1 && !result.contact_ids.includes('contact-1'), JSON.stringify(result));
  is('and the cost is reported rather than hidden',
     result.reasons.suppressed === 1, JSON.stringify(result.reasons));

  world = freshWorld();
  world.contacts[0].is_unsubscribed = true;
  const unsub = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  is('somebody who unsubscribed is not enrolled either',
     unsub.enrolled === 1 && unsub.reasons.unsubscribed === 1, JSON.stringify(unsub.reasons));

  world = freshWorld();
  world.contacts[1].is_bounced = true;
  const bounced = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  is('nor somebody whose address hard-bounced',
     bounced.enrolled === 1 && bounced.reasons.bounced === 1, JSON.stringify(bounced.reasons));

  world = freshWorld();
  world.contacts[1].email = '';
  const noEmail = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  is('nor somebody with no address at all',
     noEmail.enrolled === 1 && noEmail.reasons.no_email === 1, JSON.stringify(noEmail.reasons));
}

console.log('\na cold campaign can never be driven from a deal');
{
  world = freshWorld();
  const cold = { id: 'camp-cold', user_id: USER, audience: 'cold', trigger_event: null };
  let err: any = null;
  await enrolFromDeal(USER, cold as any, DEAL(), day(90)).catch((e) => { err = e; });
  is('it is refused outright',
     err !== null && /customer campaign/i.test(err.message), err?.message);
  is('and nothing at all was written',
     world.campaign_contacts.length === 0 && world.lifecycle_enrolments.length === 0);
}

console.log('\nexactly once, however often the worker ticks');
{
  world = freshWorld();
  await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  const second = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));

  is('a second pass for the same renewal enrols nobody',
     second.enrolled === 0, JSON.stringify(second));
  is('and says why, rather than reporting a mysterious zero',
     second.reasons.already_enrolled === 2, JSON.stringify(second.reasons));
  is('no duplicate campaign_contacts rows',
     world.campaign_contacts.length === 2, String(world.campaign_contacts.length));
  is('no duplicate ledger rows',
     world.lifecycle_enrolments.length === 2, String(world.lifecycle_enrolments.length));

  // Ten more ticks, as the worker would do in five minutes.
  for (let i = 0; i < 10; i++) await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  is('and still exactly two after ten more ticks',
     world.campaign_contacts.length === 2 && world.lifecycle_enrolments.length === 2,
     `${world.campaign_contacts.length} / ${world.lifecycle_enrolments.length}`);
}

console.log('\nand exactly once even when two workers tick together');
{
  /*
   * The read check above catches the ordinary repeat. It cannot catch a
   * race: two ticks that both read "not enrolled" before either writes. The
   * unique index is what actually decides, and the loser has to undo the
   * campaign_contacts row it just made - otherwise somebody is sitting in a
   * sequence with no ledger row explaining it, which means they get emailed
   * and then enrolled all over again on the next tick.
   */
  world = freshWorld();
  await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  const contactsBefore = world.campaign_contacts.length;
  /*
   * Their previous run is finished, so the campaign_contacts guard does not
   * short-circuit and the code reaches the ledger. Without this the race
   * path is never executed and deleting it changes no test - which is
   * exactly what happened the first time this was written.
   */
  for (const cc of world.campaign_contacts) { cc.status = 'completed'; cc.current_step_order = 4; }

  world.hideLedgerFromReads = true;
  const raced = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  world.hideLedgerFromReads = false;

  is('the loser of the race enrols nobody',
     raced.enrolled === 0, JSON.stringify(raced));
  is('and reports it as already done rather than as a crash',
     raced.reasons.already_enrolled === 2, JSON.stringify(raced.reasons));
  is('no second ledger row was written',
     world.lifecycle_enrolments.length === 2, String(world.lifecycle_enrolments.length));
  is('no orphan campaign_contacts row is left behind',
     world.campaign_contacts.length === contactsBefore,
     `${world.campaign_contacts.length} vs ${contactsBefore}`);
  /*
   * The reason the claim has to come first. If the loser enrols and only
   * then discovers it lost, it has already rewound somebody's finished run
   * to step one - and the winner's contact gets the whole sequence twice.
   */
  is('and nobody was rewound to step one by the loser',
     world.campaign_contacts.every((cc: any) => cc.status === 'completed' && cc.current_step_order === 4),
     JSON.stringify(world.campaign_contacts.map((c: any) => [c.status, c.current_step_order])));
}

console.log('\nbut next year is a different renewal');
{
  world = freshWorld();
  await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  // Last year's run finished.
  for (const cc of world.campaign_contacts) { cc.status = 'completed'; cc.current_step_order = 3; }

  const nextYear = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(455));
  is('the same customer is enrolled again for the new cycle',
     nextYear.enrolled === 2, JSON.stringify(nextYear));
  is('their finished run is reset to the start rather than left completed',
     world.campaign_contacts.every((cc: any) => cc.status === 'pending' && cc.current_step_order === 0),
     JSON.stringify(world.campaign_contacts.map((c: any) => [c.status, c.current_step_order])));
  is('and campaign_contacts is still one row per person, not two',
     world.campaign_contacts.length === 2, String(world.campaign_contacts.length));
  is('while the ledger keeps both years, so the history survives the reset',
     world.lifecycle_enrolments.length === 4
     && new Set(world.lifecycle_enrolments.map((r: any) => r.cycle_key)).size === 2,
     JSON.stringify(world.lifecycle_enrolments.map((r: any) => r.cycle_key)));
}

console.log('\na reset never un-remembers a no, or interrupts a live run');
{
  world = freshWorld();
  await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  world.campaign_contacts[0].status = 'unsubscribed';
  world.campaign_contacts[1].status = 'active';
  world.campaign_contacts[1].current_step_order = 2;

  const nextYear = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(455));
  is('somebody who unsubscribed mid-sequence is not restarted',
     world.campaign_contacts[0].status === 'unsubscribed', world.campaign_contacts[0].status);
  is('somebody still working through the sequence is left where they are',
     world.campaign_contacts[1].status === 'active' && world.campaign_contacts[1].current_step_order === 2,
     JSON.stringify(world.campaign_contacts[1]));
  is('so the new cycle enrols nobody, and says so',
     nextYear.enrolled === 0 && nextYear.reasons.already_enrolled === 2, JSON.stringify(nextYear.reasons));
}

console.log('\nnot two post-sale sequences about one deal at once');
{
  world = freshWorld();
  world.campaigns.push({
    id: 'camp-onboard', user_id: USER, name: 'Onboarding', status: 'running',
    audience: 'post_sale', trigger_event: 'deal_won', trigger_offset_days: 1,
  });
  await enrolFromDeal(USER, world.campaigns[1], DEAL(), day(-275));

  const renewal = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  is('the renewal holds off while onboarding is still running',
     renewal.enrolled === 0 && renewal.reasons.in_other_post_sale === 2, JSON.stringify(renewal.reasons));

  // Onboarding finishes and its campaign is done.
  world.campaigns[1].status = 'completed';
  const afterwards = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  is('and goes ahead once it is over',
     afterwards.enrolled === 2, JSON.stringify(afterwards));
}

console.log('\nwhich occasion is this?');
{
  const renewalDeal = { renewal_date: '2027-01-15', closed_at: '2026-01-15T10:00:00Z' };
  is('a renewal is identified by its renewal date',
     cycleKeyFor('renewal_due', renewalDeal) === '2027-01-15', String(cycleKeyFor('renewal_due', renewalDeal)));
  is('a win is identified by when it closed, because it only closes once',
     cycleKeyFor('deal_won', renewalDeal) === '2026-01-15', String(cycleKeyFor('deal_won', renewalDeal)));
  is('a renewal with no date has no occasion, rather than a wrong one',
     cycleKeyFor('renewal_due', { renewal_date: null }) === null);
  is('and neither does an unclosed deal',
     cycleKeyFor('deal_won', { closed_at: null }) === null);
}

console.log('\nthe worker pass picks the right campaigns and the right deals');
{
  world = freshWorld();
  world.campaigns.push(
    { id: 'c-draft', user_id: USER, name: 'Draft renewals', status: 'draft', audience: 'post_sale', trigger_event: 'renewal_due', trigger_offset_days: 90 },
    { id: 'c-manual', user_id: USER, name: 'Manual', status: 'running', audience: 'post_sale', trigger_event: 'manual', trigger_offset_days: 0 },
    { id: 'c-cold', user_id: USER, name: 'Cold', status: 'running', audience: 'cold', trigger_event: null, trigger_offset_days: 0 },
  );
  const report = await processLifecycleTriggers();

  is('only the live, automatically triggered campaign is considered',
     report.campaigns === 1, JSON.stringify(report));
  is('a draft renewal campaign does not fire',
     !world.lifecycle_enrolments.some((r: any) => r.campaign_id === 'c-draft'));
  is('nor a manual one', !world.lifecycle_enrolments.some((r: any) => r.campaign_id === 'c-manual'));
  is('nor a cold one', !world.lifecycle_enrolments.some((r: any) => r.campaign_id === 'c-cold'));
  is('and the deal that is due does get enrolled',
     report.enrolled === 2, JSON.stringify(report));
}

console.log('\nthe worker only takes renewals whose start date has arrived');
{
  world = freshWorld();
  world.deals.push(
    { id: 'deal-far', user_id: USER, title: 'Far off', stage: 'won', closed_at: daysAgo(10),
      term_months: 12, renewal_date: day(200), renewal_status: 'upcoming', contact_id: 'contact-1' },
    { id: 'deal-done', user_id: USER, title: 'Renewed already', stage: 'won', closed_at: daysAgo(300),
      term_months: 12, renewal_date: day(30), renewal_status: 'renewed', contact_id: 'contact-1' },
    { id: 'deal-late', user_id: USER, title: 'Slipped', stage: 'won', closed_at: daysAgo(400),
      term_months: 12, renewal_date: day(-20), renewal_status: 'upcoming', contact_id: 'contact-3' },
  );
  // Their own contact. Sharing one with another deal in the same pass would
  // make this measure the one-row-per-campaign collision below instead.
  world.contacts.push({ id: 'contact-3', user_id: USER, email: 'late@elsewhere.com', is_unsubscribed: false, is_bounced: false });
  const report = await processLifecycleTriggers();
  const enrolledDeals = new Set(world.lifecycle_enrolments.map((r: any) => r.deal_id));

  is('a renewal 200 days out is left alone with a 90 day offset',
     !enrolledDeals.has('deal-far'), JSON.stringify([...enrolledDeals]));
  is('one already marked renewed is not chased',
     !enrolledDeals.has('deal-done'));
  /*
   * Deliberately included. A renewal that slipped past unnoticed is the one
   * that most needs an email, and a rule that only looks forward would skip
   * exactly the deals the sequence would have helped most.
   */
  is('one that has already slipped IS picked up',
     enrolledDeals.has('deal-late'), JSON.stringify([...enrolledDeals]));
  is('and the one it was set up for',
     enrolledDeals.has('deal-1') && report.enrolled > 0, JSON.stringify(report));
}

console.log('\none person renewing on two deals runs the sequence once');
{
  /*
   * campaign_contacts is one row per person per campaign, so somebody who
   * appears on two renewing accounts cannot be at two places in the same
   * sequence at once. The second deal waits rather than resetting them to
   * step one and losing the run already in flight.
   */
  world = freshWorld();
  world.deals.push({
    id: 'deal-2', user_id: USER, title: 'Second account', stage: 'won',
    closed_at: daysAgo(275), term_months: 12,
    renewal_date: day(60), renewal_status: 'upcoming', contact_id: 'contact-1',
  });

  await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  const second = await enrolFromDeal(USER, RENEWAL_CAMPAIGN(), world.deals[1], day(60));

  is('the same person is not enrolled a second time',
     second.enrolled === 0 && second.reasons.already_enrolled === 1, JSON.stringify(second.reasons));
  is('and their live run is not reset back to the start',
     world.campaign_contacts.filter((cc: any) => cc.contact_id === 'contact-1').length === 1,
     String(world.campaign_contacts.length));
}

console.log('\nturning a win-back on does not mailbomb every deal ever lost');
{
  world = freshWorld({ campaigns: [{
    id: 'camp-winback', user_id: USER, name: 'Win-back', status: 'running',
    audience: 'post_sale', trigger_event: 'deal_lost', trigger_offset_days: 180,
  }] });
  world.deals = [
    { id: 'lost-recent', user_id: USER, title: 'Lost 200d ago', stage: 'lost', closed_at: daysAgo(200), contact_id: 'contact-1' },
    { id: 'lost-ancient', user_id: USER, title: 'Lost 3 years ago', stage: 'lost', closed_at: daysAgo(1100), contact_id: 'contact-2' },
    { id: 'lost-fresh', user_id: USER, title: 'Lost last week', stage: 'lost', closed_at: daysAgo(7), contact_id: 'contact-2' },
  ];
  world.deal_participants = [];

  const report = await processLifecycleTriggers();
  const enrolledDeals = new Set(world.lifecycle_enrolments.map((r: any) => r.deal_id));

  is('a deal lost 200 days ago is due with a 180 day offset',
     enrolledDeals.has('lost-recent'), JSON.stringify([...enrolledDeals]));
  is('one lost last week is not due yet',
     !enrolledDeals.has('lost-fresh'));
  is('and one lost three years ago is history, not a campaign',
     !enrolledDeals.has('lost-ancient'), JSON.stringify([...enrolledDeals]));
  is('the run reports what it did', report.enrolled === 1, JSON.stringify(report));
}

console.log('\nanother account cannot be enrolled from your deals');
{
  world = freshWorld();
  const result = await enrolFromDeal(OTHER_USER, RENEWAL_CAMPAIGN(), DEAL(), day(90));
  is('nobody is found, so nobody is enrolled',
     result.enrolled === 0, JSON.stringify(result));
  is('and nothing was written', world.campaign_contacts.length === 0 && world.lifecycle_enrolments.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
