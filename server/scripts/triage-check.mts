/* ═══════════════════════════════════════════════════════════════════════
   What pressing one key on a reply actually did.

   Triage is three irreversible-ish decisions behind single keystrokes, so
   the thing that matters is that each one does exactly what it says and
   nothing else. "Not now" in particular must not suppress, archive or
   otherwise bury somebody - it is the answer that most often turns into
   revenue later, and a tidying-up side effect would quietly lose it.

   Drives the real service against a stubbed database, because the
   interesting behaviour is which rows get written and what the person is
   told afterwards, not whether the SQL client works.

   Run: npx tsx scripts/triage-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'check';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'check';
process.env.TRACKING_SECRET ||= 'check-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.STRIPE_SECRET_KEY ||= '';

const { supabaseAdmin } = await import('../src/config/supabase.js');

const USER = '00000000-0000-0000-0000-000000000001';
const CONTACT = 'contact-1';
const CAMPAIGN = 'camp-1';
const MESSAGE = 'msg-1';

interface World {
  emails: any[];
  contacts: any[];
  leads: any[];
  crm_tasks: any[];
  suppression_list: any[];
  /** Everything the service inserted, so a write can be told from a read. */
  inserted: any[];
}

let world: World;

function freshWorld(over: Partial<World> = {}): World {
  return {
    emails: [{
      id: MESSAGE, user_id: USER, subject: 'Re: Quick question',
      from_email: 'priya@northbeam.com', to_email: 'me@mine.com',
      direction: 'inbound', contact_id: CONTACT,
      contact_email: 'priya@northbeam.com', campaign_id: CAMPAIGN,
    }],
    contacts: [{
      id: CONTACT, user_id: USER, email: 'priya@northbeam.com',
      first_name: 'Priya', last_name: 'Raman', company: 'Northbeam', company_id: null,
    }],
    leads: [],
    crm_tasks: [],
    suppression_list: [],
    inserted: [],
    ...over,
  };
}

/** A stand-in for the PostgREST client, matching the enrolment harness. */
function stub(table: string): any {
  let single = false;
  let counting = false;
  let cols = '';
  const eqs: [string, any][] = [];
  const ins: [string, any[]][] = [];

  const rowsFor = (): any[] => {
    let rows: any[] = (world as any)[table] ?? [];
    for (const [col, value] of eqs) {
      if (col.includes('.')) continue;
      rows = rows.filter((r) => r[col] === value);
    }
    for (const [col, values] of ins) {
      if (col.includes('.')) continue;
      rows = rows.filter((r) => values.includes(r[col]));
    }
    return rows;
  };

  const resolve = () => {
    const rows = rowsFor();
    if (counting) return { data: null, error: null, count: rows.length };
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
      if (prop === 'in') return (col: string, values: any[]) => { ins.push([col, values]); return chain; };
      if (prop === 'insert' || prop === 'upsert') {
        return (rows: any) => {
          for (const row of Array.isArray(rows) ? rows : [rows]) {
            const withId = { id: `${table}-${world.inserted.length + 1}`, ...row };
            world.inserted.push({ table, ...withId });
            (world as any)[table] = [...((world as any)[table] ?? []), withId];
          }
          return chain;
        };
      }
      if (prop === 'update') {
        return (patch: any) => {
          for (const row of rowsFor()) Object.assign(row, patch);
          return chain;
        };
      }
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

const { triageService } = await import('../src/services/triage.service.js');
const { leadTitleFrom } = await import('@lemlist/shared');

const wrote = (table: string) => world.inserted.filter((r) => r.table === table);

console.log('interested makes a lead that carries the thread');
{
  world = freshWorld();
  const result = await triageService.triage(USER, MESSAGE, { decision: 'interested' });

  const leads = wrote('leads');
  is('exactly one lead is created', leads.length === 1, JSON.stringify(leads));
  is('it is about the person who replied',
     leads[0]?.contact_id === CONTACT, JSON.stringify(leads[0]));
  is('the campaign travels with it, so the deal can be attributed later',
     leads[0]?.campaign_id === CAMPAIGN, JSON.stringify(leads[0]));
  is('it is named after the company, not "New lead"',
     String(leads[0]?.title || '').includes('Northbeam'), leads[0]?.title);
  is('the source says where it came from',
     leads[0]?.source === 'Campaign reply', leads[0]?.source);
  is('and the result names the lead rather than saying "done"',
     /Lead created/.test(result.message) && !!result.lead_id, result.message);

  is('nobody is suppressed by saying yes', wrote('suppression_list').length === 0);
  is('and no follow-up task is invented', wrote('crm_tasks').length === 0);
}

console.log('\ninterested twice does not make two leads');
{
  world = freshWorld({
    leads: [{ id: 'lead-existing', user_id: USER, contact_id: CONTACT, status: 'open', title: 'Northbeam' }],
  });
  const result = await triageService.triage(USER, MESSAGE, { decision: 'interested' });
  is('the existing open lead is reported, not duplicated',
     wrote('leads').length === 0 && result.lead_id === 'lead-existing', JSON.stringify(result));
  is('and it says so plainly', /Already a lead/.test(result.message), result.message);
}

console.log('\ninterested needs somebody to be about');
{
  world = freshWorld();
  world.emails[0].contact_id = null;
  let err: any = null;
  await triageService.triage(USER, MESSAGE, { decision: 'interested' }).catch((e) => { err = e; });
  is('an unlinked message is refused with a reason a person can act on',
     err && /nobody to make a lead about/i.test(err.message), err?.message);
  is('and nothing is written', wrote('leads').length === 0);
}

console.log('\nnot now schedules a follow-up and changes nothing else');
{
  world = freshWorld();
  const result = await triageService.triage(USER, MESSAGE, { decision: 'later', snooze_days: 7 });

  const tasks = wrote('crm_tasks');
  is('one follow-up is created', tasks.length === 1, JSON.stringify(tasks));
  is('it is dated, not vague', !!tasks[0]?.due_date, JSON.stringify(tasks[0]));
  is('it is attached to the person', tasks[0]?.contact_id === CONTACT);
  is('its type says what it is', tasks[0]?.type === 'follow_up', tasks[0]?.type);

  /*
   * The important half. "Not now" is the answer most likely to become
   * revenue, so tidying the person away - suppressing them, or making a
   * lead they did not agree to - would quietly cost money.
   */
  is('nobody is suppressed by saying not now', wrote('suppression_list').length === 0);
  is('and no lead is invented', wrote('leads').length === 0);
  is('the result says when, so the keystroke is legible',
     /Follow-up set for/.test(result.message) && !!result.due_at, result.message);

  const days = Math.round((new Date(result.due_at!).getTime() - Date.now()) / 86400000);
  is('seven days means seven days', days === 7, `${days} days`);
}

console.log('\nnot now falls back to a sensible default');
{
  world = freshWorld();
  const result = await triageService.triage(USER, MESSAGE, { decision: 'later' });
  const days = Math.round((new Date(result.due_at!).getTime() - Date.now()) / 86400000);
  is('no answer given means a week, not today', days === 7, `${days} days`);

  world = freshWorld();
  const zero = await triageService.triage(USER, MESSAGE, { decision: 'later', snooze_days: 0 });
  const zeroDays = Math.round((new Date(zero.due_at!).getTime() - Date.now()) / 86400000);
  is('zero days is treated as unanswered rather than as "due now"',
     zeroDays === 7, `${zeroDays} days`);
}

console.log('\nnot interested is answered once, everywhere');
{
  world = freshWorld();
  const result = await triageService.triage(USER, MESSAGE, {
    decision: 'not_interested', reason: 'no_budget',
  });

  const sup = wrote('suppression_list');
  is('the address is suppressed', sup.length === 1, JSON.stringify(sup));
  is('the reason they gave is kept',
     String(sup[0]?.notes || '').includes('no_budget'), JSON.stringify(sup[0]));
  is('no lead is created for somebody who said no', wrote('leads').length === 0);
  is('and no follow-up either', wrote('crm_tasks').length === 0);
  is('the result names the address that will not be emailed',
     result.suppressed_email === 'priya@northbeam.com', JSON.stringify(result));
}

console.log('\na made-up reason is not recorded as though it were real');
{
  world = freshWorld();
  await triageService.triage(USER, MESSAGE, { decision: 'not_interested', reason: 'because-i-said-so' });
  const sup = wrote('suppression_list');
  is('an unknown reason is stored as "other" rather than as itself',
     String(sup[0]?.notes || '').includes('other'), JSON.stringify(sup[0]));
}

console.log('\nlead titles are readable at a glance');
{
  is('the company wins, because that is what a lead is called',
     leadTitleFrom({ company: 'Northbeam', contactName: 'Priya Raman', email: 'p@n.com', subject: 'Re: hi' }) === 'Northbeam');
  is('the person is the fallback',
     leadTitleFrom({ company: null, contactName: 'Priya Raman', email: 'p@n.com' }) === 'Priya Raman');
  is('then the address, minus the domain',
     leadTitleFrom({ email: 'priya@northbeam.com' }) === 'priya');
  is('the subject is last, with the Re: stripped',
     leadTitleFrom({ subject: 'Re: Quick question' }) === 'Quick question');
  is('and something is always returned',
     leadTitleFrom({}) === 'New lead');
  is('whitespace does not count as a company',
     leadTitleFrom({ company: '   ', contactName: 'Priya' }) === 'Priya');
}

console.log('\nanother account cannot triage your mail');
{
  world = freshWorld();
  let err: any = null;
  await triageService.triage('00000000-0000-0000-0000-0000000000ff', MESSAGE, { decision: 'interested' })
    .catch((e) => { err = e; });
  is('the message is not found for the wrong account', err && /not found/i.test(err.message), err?.message);
  is('and nothing is written', world.inserted.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
