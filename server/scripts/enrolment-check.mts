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
  campaign_contacts: any[];
  suppression_list: any[];
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
    for (const [col, value] of eqs) rows = rows.filter((r) => r[col] === value);
    for (const [col, values] of ins) rows = rows.filter((r) => values.includes(r[col]));
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
    campaign_contacts: [],
    suppression_list: [],
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
