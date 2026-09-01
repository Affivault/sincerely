/* ═══════════════════════════════════════════════════════════════════════
   What an add actually did.

   Adding people to a campaign answered with two numbers, and the first one
   was wrong. `added` was `finalIds.length` — the list after the filters,
   which still contained everybody already enrolled. So re-importing a list
   reported the full count and inserted nothing, and there was no way to
   tell that from a real add. The second number, `skipped`, carried no
   reason, so the interface guessed one and always guessed the same one:
   "already in other active campaigns", whatever had really happened.

   Two filters are also new here, and they matter more than the reporting:
   a contact with no address, and one who unsubscribed or is suppressed,
   used to be enrolled and then fail one at a time at send time — which is
   how a campaign ends up with a bounce rate it did not have to have.

   So this drives the real service against a stubbed database and asserts
   the counts and the reasons, because a count nobody can check is a count
   nobody should believe.

   Run: npx tsx scripts/enrolment-check.mts
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
const CAMPAIGN = 'camp-1';
const LIST = 'list-1';

interface World {
  campaigns: any[];
  contacts: any[];
  list_contacts: any[];
  contact_lists: any[];
  campaign_contacts: any[];
  suppression_list: any[];
  deals: any[];
  deal_participants: any[];
  /** Rows the service inserted, so the harness can tell a real write from a count. */
  inserted: any[];
}

let world: World;

function contact(over: Partial<any> = {}): any {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`,
    user_id: USER,
    email: 'someone@northwind.example',
    first_name: 'Someone',
    last_name: 'Else',
    location: null,
    is_unsubscribed: false,
    is_bounced: false,
    ...over,
  };
}

/**
 * A stand-in for the PostgREST client.
 *
 * Three things it has to get right, because getting any of them wrong
 * would make the harness agree with whatever the service does rather than
 * with what the database would: `.in()` filtering, `head: true` counts
 * returning no rows, and `.insert()` actually recording something.
 */
function stub(table: string): any {
  let single = false;
  let counting = false;
  let deleting = false;
  let cols = '';
  const eqs: [string, any][] = [];
  const ins: [string, any[]][] = [];
  const neqs: [string, any][] = [];

  const rowsFor = (): any[] => {
    let rows: any[] = (world as any)[table] ?? [];
    /*
     * Embedded filters (`deal.stage`, `contact_lists.user_id`) name a column
     * on the joined row, which does not exist yet at this point. Applying one
     * here matches nothing and empties the result — which for a guard reads
     * as "nobody is protected" and would have the harness reporting a pass
     * while the real filter never ran. They are resolved after the join.
     */
    for (const [col, value] of eqs) {
      if (col.includes('.')) continue;
      rows = rows.filter((r) => r[col] === value);
    }
    for (const [col, values] of ins) {
      if (col.includes('.')) continue;
      rows = rows.filter((r) => values.includes(r[col]));
    }
    for (const [col, value] of neqs) rows = rows.filter((r) => r[col] !== value);
    return rows;
  };

  const resolve = () => {
    if (deleting) return { data: null, error: null, count: 0 };
    let rows = rowsFor();
    if (counting) return { data: null, error: null, count: rows.length };

    /*
     * PostgREST embeds a related row under the table's name when the select
     * asks for it, and `!inner` drops rows with no match. The cross-campaign
     * block reads campaign_contacts that way, so without this the joined
     * campaign is undefined, the service skips every row, and the harness
     * would report the block working when it had never run.
     */
    /*
     * The open-deal guard reads participants with `deal:deals!inner(stage)`
     * and filters on `deal.stage`. Without resolving the embed here the
     * filter would look for a column literally called "deal.stage", match
     * nothing, and the harness would cheerfully report the guard working
     * while it silently let everybody through.
     */
    if (table === 'deal_participants' && /deals!inner/.test(cols)) {
      rows = rows
        .map((r) => ({ ...r, deal: world.deals.find((d) => d.id === r.deal_id) || null }))
        .filter((r) => r.deal !== null);
      for (const [col, values] of ins) {
        if (col === 'deal.stage') rows = rows.filter((r) => values.includes(r.deal.stage));
      }
    }
    /*
     * The CRM-only guard reads memberships as
     * `contact_lists!inner(kind, user_id, is_trashed)` and filters on the
     * joined columns. Same trap as the two above: without the join the guard
     * sees nothing, lets everybody through, and the harness calls it a pass.
     */
    if (table === 'list_contacts' && /contact_lists!inner/.test(cols)) {
      rows = rows
        .map((r) => ({ ...r, contact_lists: world.contact_lists.find((l) => l.id === r.list_id) || null }))
        .filter((r) => r.contact_lists !== null);
      for (const [col, value] of eqs) {
        if (col === 'contact_lists.user_id') rows = rows.filter((r) => r.contact_lists.user_id === value);
        if (col === 'contact_lists.is_trashed') {
          rows = rows.filter((r) => Boolean(r.contact_lists.is_trashed) === value);
        }
      }
    }
    if (table === 'campaign_contacts' && /campaigns!inner/.test(cols)) {
      rows = rows
        .map((r) => ({ ...r, campaigns: world.campaigns.find((c) => c.id === r.campaign_id) || null }))
        .filter((r) => r.campaigns !== null);
    }
    if (single) {
      return {
        data: rows[0] ?? null,
        error: rows[0] ? null : { code: 'PGRST116', message: 'no rows' },
        count: rows.length,
      };
    }
    return { data: rows, error: null, count: rows.length };
  };

  const chain: any = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return chain; };
      if (prop === 'select') {
        return (selected?: string, opts?: any) => {
          cols = selected || '';
          if (opts?.count) counting = true;
          return chain;
        };
      }
      if (prop === 'eq') return (col: string, value: any) => { eqs.push([col, value]); return chain; };
      if (prop === 'neq') return (col: string, value: any) => { neqs.push([col, value]); return chain; };
      if (prop === 'in') return (col: string, values: any[]) => { ins.push([col, values]); return chain; };
      if (prop === 'delete') return () => { deleting = true; return chain; };
      if (prop === 'insert') {
        return (rows: any[]) => {
          for (const row of rows) {
            world.inserted.push({ table, ...row });
            if (table === 'campaign_contacts') world.campaign_contacts.push(row);
          }
          return chain;
        };
      }
      if (prop === 'upsert') {
        return (rows: any[]) => {
          for (const row of rows) {
            if (table === 'list_contacts') {
              const already = world.list_contacts.some(
                (r) => r.list_id === row.list_id && r.contact_id === row.contact_id,
              );
              if (!already) world.list_contacts.push(row);
            }
          }
          return chain;
        };
      }
      if (prop === 'then') return (res: any) => res(resolve());
      return () => chain;
    },
    apply() { return chain; },
  });
  return chain;
}

(supabaseAdmin as any).from = stub;
(supabaseAdmin as any).rpc = () => Promise.resolve({ data: null, error: null });

const { campaignContactsService } = await import('../src/services/campaign-contacts.service.js');

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

/**
 * A campaign bound to a list, everybody on the list, nobody enrolled yet.
 * Each scenario starts from this and breaks exactly one thing.
 */
function freshWorld(people: any[], opts: { boundToList?: boolean } = {}): World {
  const bound = opts.boundToList !== false;
  return {
    campaigns: [{
      id: CAMPAIGN, user_id: USER, name: 'Q3 outbound',
      list_id: bound ? LIST : null, status: 'draft',
    }],
    contacts: people,
    list_contacts: bound ? people.map((p) => ({ list_id: LIST, contact_id: p.id })) : [],
    // The list everybody starts on is a lead list, which is what it has
    // always been in effect — an outreach audience a campaign sends to.
    contact_lists: [{ id: LIST, user_id: USER, name: 'Q3 leads', kind: 'lead', is_trashed: false }],
    campaign_contacts: [],
    suppression_list: [],
    deals: [],
    deal_participants: [],
    inserted: [],
  };
}

const reasonsOf = (r: any) => Object.entries(r.reasons).map(([k, v]) => `${k}=${v}`).sort().join(',');

/* ─────────────────────────────────────────────────────────────────── */

console.log('\na clean add reports what it inserted');
{
  const a = contact({ id: 'a', email: 'ana@northwind.example' });
  const b = contact({ id: 'b', email: 'ben@northwind.example' });
  world = freshWorld([a, b]);

  const result = await campaignContactsService.add(CAMPAIGN, ['a', 'b']);
  is('both went in', result.added === 2, JSON.stringify(result));
  is('nobody was skipped', result.skipped === 0 && reasonsOf(result) === '', reasonsOf(result));
  is('and two rows were actually written',
     world.inserted.filter((r) => r.table === 'campaign_contacts').length === 2,
     JSON.stringify(world.inserted));
}

console.log('\nre-adding people already in the campaign adds nobody');
{
  // The bug this whole file exists for. `added` was the count after the
  // filters, which still included everyone already enrolled — so a
  // re-imported list reported a full add and inserted nothing at all.
  const a = contact({ id: 'a', email: 'ana@northwind.example' });
  const b = contact({ id: 'b', email: 'ben@northwind.example' });
  world = freshWorld([a, b]);
  world.campaign_contacts = [
    { campaign_id: CAMPAIGN, contact_id: 'a' },
    { campaign_id: CAMPAIGN, contact_id: 'b' },
  ];

  const result = await campaignContactsService.add(CAMPAIGN, ['a', 'b']);
  is('added is zero, not two', result.added === 0, JSON.stringify(result));
  is('both are reported as skipped', result.skipped === 2, JSON.stringify(result));
  is('with the real reason', reasonsOf(result) === 'already_enrolled=2', reasonsOf(result));
  is('and nothing was written',
     world.inserted.filter((r) => r.table === 'campaign_contacts').length === 0,
     JSON.stringify(world.inserted));
}

console.log('\nand a partial re-add counts only the new ones');
{
  const a = contact({ id: 'a', email: 'ana@northwind.example' });
  const b = contact({ id: 'b', email: 'ben@northwind.example' });
  const c = contact({ id: 'c', email: 'cara@northwind.example' });
  world = freshWorld([a, b, c]);
  world.campaign_contacts = [{ campaign_id: CAMPAIGN, contact_id: 'a' }];

  const result = await campaignContactsService.add(CAMPAIGN, ['a', 'b', 'c']);
  is('two new, one already there', result.added === 2 && result.skipped === 1,
     JSON.stringify(result));
  is('and the skip is named', reasonsOf(result) === 'already_enrolled=1', reasonsOf(result));
}

console.log('\ncontacts who cannot be emailed are stopped at the door');
{
  /*
   * These used to be enrolled and then fail one at a time at send time,
   * which is both slower and worse: a hard bounce on an address we already
   * knew was dead costs domain reputation for nothing.
   */
  const ok = contact({ id: 'ok', email: 'ana@northwind.example' });
  const blank = contact({ id: 'blank', email: '', first_name: 'No', last_name: 'Address' });
  const gone = contact({ id: 'gone', email: 'gone@northwind.example', is_unsubscribed: true });
  const dead = contact({ id: 'dead', email: 'dead@northwind.example', is_bounced: true });
  world = freshWorld([ok, blank, gone, dead]);

  const result = await campaignContactsService.add(CAMPAIGN, ['ok', 'blank', 'gone', 'dead']);
  is('only the one who can be emailed goes in', result.added === 1, JSON.stringify(result));
  is('and each refusal has its own reason',
     reasonsOf(result) === 'bounced=1,no_email=1,unsubscribed=1', reasonsOf(result));
  is('the skipped people are named, so they can be found',
     result.skips.length === 3 && result.skips.every((s) => s.contact_id),
     JSON.stringify(result.skips));
}

console.log('\nsuppression is honoured here too, not only at send time');
{
  const ok = contact({ id: 'ok', email: 'ana@northwind.example' });
  const quiet = contact({ id: 'quiet', email: 'Quiet@Northwind.example' });
  world = freshWorld([ok, quiet]);
  // Stored lower-cased, as the suppression service writes it. The contact's
  // address is mixed case on purpose: a case-sensitive comparison here would
  // email somebody who asked not to be.
  world.suppression_list = [{ user_id: USER, email: 'quiet@northwind.example' }];

  const result = await campaignContactsService.add(CAMPAIGN, ['ok', 'quiet']);
  is('the suppressed contact is left out regardless of case',
     result.added === 1 && reasonsOf(result) === 'suppressed=1', JSON.stringify(result));
}

console.log('\nsomebody else’s contacts are reported, not silently dropped');
{
  const mine = contact({ id: 'mine', email: 'ana@northwind.example' });
  const theirs = contact({ id: 'theirs', user_id: OTHER_USER, email: 'x@elsewhere.example' });
  world = freshWorld([mine]);
  world.contacts.push(theirs);

  const result = await campaignContactsService.add(CAMPAIGN, ['mine', 'theirs']);
  is('only mine is added', result.added === 1, JSON.stringify(result));
  is('and the other is accounted for', reasonsOf(result) === 'not_yours=1', reasonsOf(result));
}

console.log('\nan active campaign elsewhere blocks a second sequence, and says which');
{
  const a = contact({ id: 'a', email: 'ana@northwind.example' });
  const b = contact({ id: 'b', email: 'ben@northwind.example' });
  world = freshWorld([a, b]);
  world.campaigns.push({
    id: 'camp-2', user_id: USER, name: 'Winter push', list_id: 'list-2', status: 'running',
  });
  world.campaign_contacts = [{ campaign_id: 'camp-2', contact_id: 'b' }];

  const result = await campaignContactsService.add(CAMPAIGN, ['a', 'b']);
  is('the one in another campaign is held back',
     result.added === 1 && reasonsOf(result) === 'in_other_campaign=1', JSON.stringify(result));
  is('and the reason names the campaign, so it is actionable',
     result.skips[0]?.detail === 'Winter push', JSON.stringify(result.skips));
}

console.log('\nnot being on the bound lead list is its own reason');
{
  // The reason the interface was most often wrong about: it reported these
  // as "already in other active campaigns", which sends somebody looking
  // through their campaigns for a problem that is in their lists.
  const a = contact({ id: 'a', email: 'ana@northwind.example' });
  const stray = contact({ id: 'stray', email: 'stray@northwind.example' });
  world = freshWorld([a, stray]);
  world.list_contacts = [{ list_id: LIST, contact_id: 'a' }];

  const result = await campaignContactsService.add(CAMPAIGN, ['a', 'stray']);
  is('the one off the list is skipped for that reason',
     result.added === 1 && reasonsOf(result) === 'not_in_list=1', JSON.stringify(result));
}

console.log('\nenrol puts people on the list first, so that reason cannot apply');
{
  const a = contact({ id: 'a', email: 'ana@northwind.example' });
  const stray = contact({ id: 'stray', email: 'stray@northwind.example' });
  world = freshWorld([a, stray]);
  world.list_contacts = [{ list_id: LIST, contact_id: 'a' }];

  const result = await campaignContactsService.enroll(CAMPAIGN, ['a', 'stray']);
  is('both are enrolled', result.added === 2, JSON.stringify(result));
  is('and nobody is skipped for a list they were just added to',
     result.skipped === 0, reasonsOf(result));
}

console.log('\nodd inputs do not produce odd answers');
{
  const a = contact({ id: 'a', email: 'ana@northwind.example' });
  world = freshWorld([a]);

  const empty = await campaignContactsService.add(CAMPAIGN, []);
  is('an empty request adds nothing and claims nothing',
     empty.added === 0 && empty.skipped === 0, JSON.stringify(empty));

  // The same id twice is one person, not two — counting it twice would make
  // the totals disagree with the number of rows that exist.
  world = freshWorld([a]);
  const doubled = await campaignContactsService.add(CAMPAIGN, ['a', 'a']);
  is('the same contact listed twice is added once',
     doubled.added === 1 && doubled.skipped === 0, JSON.stringify(doubled));
}

console.log('\nthe named sample is capped, so a huge import stays a small answer');
{
  const many = Array.from({ length: 250 }, (_, i) =>
    contact({ id: `x${i}`, email: `x${i}@northwind.example`, is_unsubscribed: true }));
  world = freshWorld(many);

  const result = await campaignContactsService.add(CAMPAIGN, many.map((m) => m.id));
  is('every skip is counted', result.skipped === 250 && result.reasons.unsubscribed === 250,
     JSON.stringify(result.reasons));
  is('but only a sample is named', result.skips.length === 100, String(result.skips.length));
}


/* ─── Nobody you are currently negotiating with ───────────────────────── */

console.log('\na live deal keeps somebody out of a cold campaign');
{
  const alice = contact({ id: 'c-alice', email: 'alice@northbeam.example' });
  const bob = contact({ id: 'c-bob', email: 'bob@northbeam.example' });
  const carol = contact({ id: 'c-carol', email: 'carol@loomly.example' });
  world = freshWorld([alice, bob, carol], { boundToList: false });

  /*
   * Alice leads an open deal. Bob is a participant on it — the security
   * reviewer, say. Cold-pitching either while a contract is being read is
   * the same mistake, so both must be held back.
   */
  world.deals = [
    { id: 'd-open', user_id: USER, contact_id: alice.id, stage: 'proposal' },
    { id: 'd-won', user_id: USER, contact_id: carol.id, stage: 'won' },
  ];
  world.deal_participants = [
    { id: 'p-1', user_id: USER, deal_id: 'd-open', contact_id: bob.id },
  ];

  const result = await campaignContactsService.add(CAMPAIGN, [alice.id, bob.id, carol.id]);

  is('the person leading the open deal is skipped',
     result.skips.some((s) => s.contact_id === alice.id && s.reason === 'on_open_deal'),
     JSON.stringify(result.skips));
  is('so is a participant on it, not just the primary contact',
     result.skips.some((s) => s.contact_id === bob.id && s.reason === 'on_open_deal'));

  /*
   * A won deal is not a negotiation. Refusing to email a past customer
   * would quietly kill every upsell campaign, which is the opposite of
   * what this guard is for.
   */
  is('somebody whose deal is already won is still enrollable',
     !result.skips.some((s) => s.contact_id === carol.id),
     JSON.stringify(result.skips.map((s) => [s.contact_id, s.reason])));
  is('and is the only one who actually goes in',
     result.added === 1, `added ${result.added}`);
  is('the reason is reported so a deliberate cross-sell is still possible',
     result.reasons.on_open_deal === 2, JSON.stringify(result.reasons));
}

console.log('\nno deals means no interference');
{
  const dave = contact({ id: 'c-dave', email: 'dave@fernpath.example' });
  world = freshWorld([dave], { boundToList: false });
  const result = await campaignContactsService.add(CAMPAIGN, [dave.id]);
  is('an account with no deals enrolls exactly as it always did',
     result.added === 1 && !result.reasons.on_open_deal, JSON.stringify(result));
}

console.log('\nCRM contacts are not cold-email material');
{
  const CRM = 'list-crm';
  const customer = contact({ id: 'c-cust', email: 'ceo@acme.example' });
  const both = contact({ id: 'c-both', email: 'vp@acme.example' });
  const prospect = contact({ id: 'c-pros', email: 'new@fernpath.example' });
  const unfiled = contact({ id: 'c-unfiled', email: 'nobody@nowhere.example' });

  world = freshWorld([customer, both, prospect, unfiled], { boundToList: false });
  world.contact_lists = [
    { id: LIST, user_id: USER, name: 'Q3 leads', kind: 'lead', is_trashed: false },
    { id: CRM, user_id: USER, name: 'Customers', kind: 'contact', is_trashed: false },
  ];
  world.list_contacts = [
    { list_id: CRM, contact_id: customer.id },
    // On both: somebody deliberately put this one into an outreach audience.
    { list_id: CRM, contact_id: both.id },
    { list_id: LIST, contact_id: both.id },
    { list_id: LIST, contact_id: prospect.id },
    // `unfiled` is on nothing at all.
  ];

  const result = await campaignContactsService.add(
    CAMPAIGN, [customer.id, both.id, prospect.id, unfiled.id],
  );

  is('somebody filed only in a contact list is not enrolled',
     result.skips.some((s) => s.contact_id === customer.id && s.reason === 'crm_contact_only'),
     JSON.stringify(result.skips.map((s) => [s.contact_id, s.reason])));
  is('being on a lead list too is a deliberate act, and clears it',
     !result.skips.some((s) => s.contact_id === both.id),
     JSON.stringify(result.skips.map((s) => [s.contact_id, s.reason])));
  is('an ordinary lead-list prospect is untouched',
     !result.skips.some((s) => s.contact_id === prospect.id));
  is('and somebody on no list at all still enrolls — unfiled is not protected',
     !result.skips.some((s) => s.contact_id === unfiled.id),
     JSON.stringify(result.skips.map((s) => [s.contact_id, s.reason])));
  is('so three go in, not four',
     result.added === 3, `added ${result.added}`);
  is('and the reason says why the fourth did not',
     result.reasons.crm_contact_only === 1, JSON.stringify(result.reasons));
}

console.log('\na trashed contact list stops protecting anybody');
{
  const CRM = 'list-crm';
  const ghost = contact({ id: 'c-ghost', email: 'ghost@acme.example' });
  world = freshWorld([ghost], { boundToList: false });
  // Deleting the CRM list is how you say "this person is fair game again".
  world.contact_lists = [
    { id: CRM, user_id: USER, name: 'Old customers', kind: 'contact', is_trashed: true },
  ];
  world.list_contacts = [{ list_id: CRM, contact_id: ghost.id }];

  const result = await campaignContactsService.add(CAMPAIGN, [ghost.id]);
  is('membership of a trashed list does not hold somebody back',
     result.added === 1 && !result.reasons.crm_contact_only, JSON.stringify(result));
}

console.log('\nanother account’s contact list cannot shield your contact');
{
  const CRM = 'list-theirs';
  const mine = contact({ id: 'c-mine', email: 'mine@acme.example' });
  world = freshWorld([mine], { boundToList: false });
  world.contact_lists = [
    { id: CRM, user_id: OTHER_USER, name: 'Their CRM', kind: 'contact', is_trashed: false },
  ];
  world.list_contacts = [{ list_id: CRM, contact_id: mine.id }];

  const result = await campaignContactsService.add(CAMPAIGN, [mine.id]);
  is('the guard is scoped to the sending account',
     result.added === 1 && !result.reasons.crm_contact_only, JSON.stringify(result));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
