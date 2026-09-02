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
  /*
   * inbox_messages, named exactly as the database names it.
   *
   * This said `emails` when it was written, which is a table that has never
   * existed - so the fixture agreed with the service's wrong assumption and
   * every test passed against a query that would 404 in production. A
   * fixture invented from the same guess as the code is not evidence.
   * schema-guard.mts now checks these names against the migrations.
   */
  inbox_messages: any[];
  contacts: any[];
  leads: any[];
  crm_tasks: any[];
  suppression_list: any[];
  /** Everything the service inserted, so a write can be told from a read. */
  inserted: any[];
  /** Every update applied, so "was it remembered?" is answerable. */
  updated: any[];
  /** Every row removed, so undo can be checked rather than assumed. */
  deleted: any[];
}

let world: World;

function freshWorld(over: Partial<World> = {}): World {
  return {
    inbox_messages: [{
      id: MESSAGE, user_id: USER, subject: 'Re: Quick question',
      from_email: 'priya@northbeam.com', to_email: 'me@mine.com',
      direction: 'inbound', contact_id: CONTACT, campaign_id: CAMPAIGN,
      // The address comes from the joined contact, as it does in the query.
      contacts: { email: 'priya@northbeam.com' },
    }],
    contacts: [{
      id: CONTACT, user_id: USER, email: 'priya@northbeam.com',
      first_name: 'Priya', last_name: 'Raman', company: 'Northbeam', company_id: null,
    }],
    leads: [],
    crm_tasks: [],
    suppression_list: [],
    inserted: [],
    updated: [],
    deleted: [],
    ...over,
  };
}

/** A stand-in for the PostgREST client, matching the enrolment harness. */
function stub(table: string): any {
  let single = false;
  let counting = false;
  let deleting = false;
  let pendingUpdate: any = null;
  let cols = '';
  /** Rows this chain just inserted, so .select().single() can return them. */
  let justInserted: any[] = [];
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
    /*
     * An insert followed by .select().single() means "give me back the row I
     * just made" - which is what PostgREST does, and what every caller here
     * relies on to learn the new id.
     *
     * This used to fall through to rowsFor(), which has no filters on an
     * insert chain and so returned the FIRST row in the table. Every lead
     * created in a batch reported the id of the first one, and a bulk triage
     * would have written the same triage_ref onto forty messages - undo would
     * then delete one lead and leave thirty-nine, with every reply still
     * marked decided. The harness passed anyway, because it was agreeing with
     * itself. Same failure as the `emails` table: a fixture built from a
     * guess is not evidence.
     */
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
      return { data: rows, error: null, count: rows.length };
    }

    if (deleting) {
      const ids = new Set(rows.map((r) => r.id));
      (world as any)[table] = ((world as any)[table] ?? []).filter((r: any) => !ids.has(r.id));
      world.deleted.push(...rows.map((r) => ({ table, id: r.id })));
      return { data: null, error: null, count: rows.length };
    }

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
            justInserted.push(withId);
          }
          return chain;
        };
      }
      if (prop === 'update') {
        return (patch: any) => {
          // Applied lazily: the .eq() calls that scope it come after this in
          // the chain, so filtering now would update every row in the table.
          pendingUpdate = patch;
          return chain;
        };
      }
      if (prop === 'delete') { deleting = true; return () => chain; }
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
const { leadTitleFrom, BULK_TRIAGE_LIMIT } = await import('@lemlist/shared');

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
  world.inbox_messages[0].contact_id = null;
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

console.log('\nthe decision is remembered, or none of this is a feature');
{
  world = freshWorld();
  await triageService.triage(USER, MESSAGE, { decision: 'interested' });

  const msg = world.inbox_messages[0];
  is('the decision is written to the message',
     msg.triage_decision === 'interested', JSON.stringify(msg.triage_decision));
  is('with a timestamp, so it can be ordered and undone',
     !!msg.triaged_at, String(msg.triaged_at));
  is('and by whom', msg.triaged_by === USER, msg.triaged_by);
  is('the reference points at what it made, so undo is exact not a guess',
     msg.triage_ref === wrote('leads')[0]?.id, `${msg.triage_ref} vs ${wrote('leads')[0]?.id}`);
  // Scoped to the message: the promotion of the contact's lifecycle is a
  // separate, intended write and counting it here would just be noise.
  const msgUpdates = world.updated.filter((u: any) => u.table === 'inbox_messages');
  is('exactly one message row was updated, not the whole table',
     msgUpdates.length === 1 && msgUpdates[0].rows === 1, JSON.stringify(world.updated));
}

console.log('\ndeciding twice does not act twice');
{
  world = freshWorld();
  await triageService.triage(USER, MESSAGE, { decision: 'interested' });
  const before = wrote('leads').length;
  const again = await triageService.triage(USER, MESSAGE, { decision: 'not_interested' });

  is('a second decision on the same reply makes nothing new',
     wrote('leads').length === before && wrote('suppression_list').length === 0,
     JSON.stringify({ leads: wrote('leads').length, sup: wrote('suppression_list').length }));
  is('and says it was already handled', /Already triaged/.test(again.message), again.message);
}

console.log('\nundo removes exactly what the decision created');
{
  world = freshWorld();
  await triageService.triage(USER, MESSAGE, { decision: 'interested' });
  const leadId = wrote('leads')[0].id;
  // A second, unrelated lead that must survive.
  world.leads.push({ id: 'lead-other', user_id: USER, contact_id: 'someone-else', status: 'open', title: 'Untouched' });

  const undone = await triageService.undo(USER, MESSAGE);

  is('the lead it created is gone',
     !world.leads.some((l: any) => l.id === leadId), JSON.stringify(world.leads.map((l: any) => l.id)));
  is('and the unrelated lead is not',
     world.leads.some((l: any) => l.id === 'lead-other'), JSON.stringify(world.leads.map((l: any) => l.id)));
  is('the reply is back in the queue',
     world.inbox_messages[0].triage_decision === null, String(world.inbox_messages[0].triage_decision));
  is('every triage column is cleared together, not just the decision',
     world.inbox_messages[0].triaged_at === null && world.inbox_messages[0].triage_ref === null,
     JSON.stringify(world.inbox_messages[0]));
  is('and it says what happened', /Undone/.test(undone.message), undone.message);
}

console.log('\nundo of a follow-up removes the task, not a lead');
{
  world = freshWorld();
  await triageService.triage(USER, MESSAGE, { decision: 'later', snooze_days: 3 });
  const taskId = wrote('crm_tasks')[0].id;
  await triageService.undo(USER, MESSAGE);
  is('the follow-up is gone',
     !world.crm_tasks.some((t: any) => t.id === taskId), JSON.stringify(world.crm_tasks));
  is('and the reply is decidable again',
     world.inbox_messages[0].triage_decision === null);
}

console.log('\nundoing something never decided is refused');
{
  world = freshWorld();
  let err: any = null;
  await triageService.undo(USER, MESSAGE).catch((e) => { err = e; });
  is('with a reason rather than silently doing nothing',
     err && /has not been triaged/i.test(err.message), err?.message);
}

/* ═══════════════════════════════════════════════════════════════════════
   Clearing a queue, rather than one reply at a time.

   The reason triage exists at all: forty replies overnight, most of them
   the same answer. Two things have to hold or bulk is worse than useless.
   Every message must actually get its own decision recorded - a run that
   reports "40 marked" while writing one row is a lie that empties the
   queue. And one message that cannot be decided must not take the other
   thirty-nine with it.
   ═══════════════════════════════════════════════════════════════════════ */

/** A world with several distinct replies from several distinct people. */
function manyWorld(n: number): World {
  const w = freshWorld();
  w.inbox_messages = [];
  w.contacts = [];
  for (let i = 1; i <= n; i++) {
    const contactId = `contact-${i}`;
    const email = `person${i}@northbeam.com`;
    w.inbox_messages.push({
      id: `msg-${i}`, user_id: USER, subject: `Re: thread ${i}`,
      from_email: email, to_email: 'me@mine.com',
      direction: 'inbound', contact_id: contactId, campaign_id: CAMPAIGN,
      contacts: { email },
    });
    w.contacts.push({
      id: contactId, user_id: USER, email,
      first_name: `Person${i}`, last_name: 'Raman', company: `Company ${i}`, company_id: null,
    });
  }
  return w;
}

const allIds = (n: number) => Array.from({ length: n }, (_, i) => `msg-${i + 1}`);

console.log('\nbulk interested decides every reply in the selection');
{
  world = manyWorld(3);
  const result = await triageService.triageMany(USER, allIds(3), { decision: 'interested' });

  is('one lead per reply, not one for the batch',
     wrote('leads').length === 3, String(wrote('leads').length));
  is('every message carries its own decision',
     world.inbox_messages.every((m: any) => m.triage_decision === 'interested'),
     JSON.stringify(world.inbox_messages.map((m: any) => m.triage_decision)));
  is('each reference points at that reply\'s own lead, not a shared one',
     new Set(world.inbox_messages.map((m: any) => m.triage_ref)).size === 3,
     JSON.stringify(world.inbox_messages.map((m: any) => m.triage_ref)));
  is('the count reported is the count written',
     result.succeeded === 3 && result.failed === 0, JSON.stringify(result));
  is('and it reads as a sentence, not a status code',
     /3 replies marked interested/.test(result.message), result.message);
  is('every one of them is offered back for undo',
     result.undoable.length === 3, JSON.stringify(result.undoable));
}

console.log('\none reply that cannot be decided does not sink the rest');
{
  world = manyWorld(3);
  // The middle one was never linked to anybody, so no lead can be made.
  world.inbox_messages[1].contact_id = null;

  const result = await triageService.triageMany(USER, allIds(3), { decision: 'interested' });

  is('the other two are still decided',
     result.succeeded === 2 && result.failed === 1, JSON.stringify({ ok: result.succeeded, no: result.failed }));
  is('two leads exist, not zero and not three',
     wrote('leads').length === 2, String(wrote('leads').length));
  is('the one that failed is named, so it can be found again',
     result.outcomes.find((o: any) => !o.ok)?.message_id === 'msg-2',
     JSON.stringify(result.outcomes.map((o: any) => [o.message_id, o.ok])));
  is('with the reason it failed, in words',
     /nobody to make a lead about/i.test(result.outcomes.find((o: any) => !o.ok)?.error || ''),
     result.outcomes.find((o: any) => !o.ok)?.error);
  is('the failed one is left in the queue rather than marked done',
     world.inbox_messages[1].triage_decision == null, String(world.inbox_messages[1].triage_decision));
  is('and the summary admits the shortfall instead of rounding up',
     /2 marked interested, 1 could not be/.test(result.message), result.message);
  is('only the two that worked are offered for undo',
     result.undoable.length === 2 && !result.undoable.includes('msg-2'), JSON.stringify(result.undoable));
}

console.log('\nbulk not interested suppresses every address, with the reason');
{
  world = manyWorld(3);
  const result = await triageService.triageMany(USER, allIds(3), {
    decision: 'not_interested', reason: 'no_budget',
  });

  const sup = wrote('suppression_list');
  is('three addresses are suppressed', sup.length === 3, String(sup.length));
  is('each one is a different person, not the same row three times',
     new Set(sup.map((s: any) => s.email)).size === 3, JSON.stringify(sup.map((s: any) => s.email)));
  is('the reason is kept on all of them',
     sup.every((s: any) => String(s.notes || '').includes('no_budget')), JSON.stringify(sup.map((s: any) => s.notes)));
  is('no lead is invented for anybody who said no', wrote('leads').length === 0);
  is('and no follow-up either', wrote('crm_tasks').length === 0);
  is('the summary says what happened', /3 replies marked not interested/.test(result.message), result.message);
}

console.log('\nbulk not now dates every follow-up the same way');
{
  world = manyWorld(2);
  const result = await triageService.triageMany(USER, allIds(2), { decision: 'later', snooze_days: 30 });
  const tasks = wrote('crm_tasks');
  is('one follow-up per reply', tasks.length === 2, String(tasks.length));
  is('all dated a month out, because that is what was answered',
     tasks.every((t: any) => {
       const days = Math.round((new Date(`${t.due_date}T00:00:00Z`).getTime() - Date.now()) / 86400000);
       return days >= 29 && days <= 30;
     }), JSON.stringify(tasks.map((t: any) => t.due_date)));
  is('nobody is suppressed by saying not now', wrote('suppression_list').length === 0);
  is('and the references point at the tasks, so undo removes those',
     world.inbox_messages.every((m: any, i: number) => m.triage_ref === tasks[i]?.id),
     JSON.stringify(world.inbox_messages.map((m: any) => m.triage_ref)));
  is('reported as two, not one', result.succeeded === 2, JSON.stringify(result));
}

console.log('\nthe same reply named twice is decided once');
{
  world = manyWorld(2);
  const result = await triageService.triageMany(USER, ['msg-1', 'msg-1', 'msg-2'], { decision: 'interested' });
  is('a duplicated id is not reported as "already triaged" by its own run',
     result.succeeded === 2 && result.failed === 0, JSON.stringify(result.outcomes));
  is('and only two leads exist', wrote('leads').length === 2, String(wrote('leads').length));
}

console.log('\nbulk refuses what it cannot honestly do');
{
  world = manyWorld(1);
  let err: any = null;
  await triageService.triageMany(USER, [], { decision: 'interested' }).catch((e) => { err = e; });
  is('an empty selection is refused with a reason', err && /No replies were selected/i.test(err.message), err?.message);

  err = null;
  await triageService.triageMany(USER, allIds(1), { decision: 'whatever' } as any).catch((e) => { err = e; });
  is('an unknown decision is refused before anything is written',
     err && /Unknown decision/i.test(err.message) && world.inserted.length === 0, err?.message);

  err = null;
  const tooMany = Array.from({ length: BULK_TRIAGE_LIMIT + 1 }, (_, i) => `msg-${i}`);
  await triageService.triageMany(USER, tooMany, { decision: 'interested' }).catch((e) => { err = e; });
  is('more than the limit is refused rather than half-done',
     err && new RegExp(`more than ${BULK_TRIAGE_LIMIT}`).test(err.message), err?.message);
  is('and nothing was written on the way to refusing',
     world.inserted.length === 0, JSON.stringify(world.inserted));
}

console.log('\nanother account cannot bulk-triage your mail');
{
  world = manyWorld(3);
  const result = await triageService.triageMany('00000000-0000-0000-0000-0000000000ff', allIds(3), {
    decision: 'not_interested', reason: 'no_budget',
  });
  is('every message is refused as not found',
     result.succeeded === 0 && result.failed === 3, JSON.stringify(result));
  is('and nothing at all is written', world.inserted.length === 0, JSON.stringify(world.inserted));
  is('the replies stay in their owner\'s queue',
     world.inbox_messages.every((m: any) => m.triage_decision == null));
}

console.log('\nundoing a bulk run takes back everything it made');
{
  world = manyWorld(3);
  const run = await triageService.triageMany(USER, allIds(3), { decision: 'interested' });
  const madeIds = world.leads.map((l: any) => l.id);
  // An unrelated lead that must survive the undo.
  world.leads.push({ id: 'lead-other', user_id: USER, contact_id: 'someone-else', status: 'open', title: 'Untouched' });

  const undone = await triageService.undoMany(USER, run.undoable);

  is('all three decisions are undone', undone.undone === 3 && undone.failed === 0, JSON.stringify(undone));
  is('every lead the run made is gone',
     madeIds.every((id: string) => !world.leads.some((l: any) => l.id === id)),
     JSON.stringify(world.leads.map((l: any) => l.id)));
  is('the unrelated lead survives',
     world.leads.some((l: any) => l.id === 'lead-other'), JSON.stringify(world.leads.map((l: any) => l.id)));
  is('and all three replies are back in the queue',
     world.inbox_messages.every((m: any) => m.triage_decision === null && m.triage_ref === null),
     JSON.stringify(world.inbox_messages.map((m: any) => m.triage_decision)));
  is('reported in words rather than a count alone',
     /3 decisions undone/.test(undone.message), undone.message);
}

console.log('\nundoing what was never decided is counted as a failure, not a success');
{
  world = manyWorld(2);
  await triageService.triage(USER, 'msg-1', { decision: 'interested' });
  const undone = await triageService.undoMany(USER, ['msg-1', 'msg-2']);
  is('the decided one is undone and the untouched one is not claimed',
     undone.undone === 1 && undone.failed === 1, JSON.stringify(undone));
  is('and the summary says so', /1 undone, 1 could not be/.test(undone.message), undone.message);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
