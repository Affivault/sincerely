/* ═══════════════════════════════════════════════════════════════════════
   Can one account reach another account's rows?

   Two cross-tenant leaks were found by hand in the last fortnight - a
   contact-tag read and a campaign reference on createDeal - and both were
   fixed correctly. Neither fix stopped the next one appearing, because
   nothing was checking. audit-write-paths.mts already guards the other hole
   in this pair (a request body writing a column it does not own). This
   guards ownership: whether a method scopes what it touches to the caller.

   It does NOT read the source and look for `.eq('user_id', ...)`. That is
   how you get a false positive on templateService.getEmailTemplate, which
   queries by id alone and then refuses in application code one line later -
   perfectly safe, and indistinguishable from a leak if you are grepping.

   Instead the fake database honours filters. The world belongs to OWNER.
   Every method is called as INTRUDER. A query scoped to the caller comes
   back empty; an unscoped one comes back holding OWNER's row, and then the
   only thing that can save it is the service refusing. So the assertion is
   on the outcome a real attacker would see:

     - nothing OWNER owns is returned
     - nothing OWNER owns is updated or deleted

   A thrown 403 or 404 is a pass. Returning nothing is a pass. Handing back
   OWNER's data is a failure however tidy the code looks.

   Run: npx tsx scripts/audit-tenant-isolation.mts
   ═══════════════════════════════════════════════════════════════════════ */

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'audit';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'audit';
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.STRIPE_SECRET_KEY ||= '';

const { supabaseAdmin } = await import('../src/config/supabase.js');

const OWNER = '00000000-0000-0000-0000-00000000000a';
const INTRUDER = '00000000-0000-0000-0000-00000000000b';

/** Stamped on every row OWNER owns, so a leak is unmistakable in a result. */
const SECRET = 'OWNER-ONLY-SECRET';

/* ── The world, every row of it OWNER's ────────────────────────────── */

const ID = {
  contact: '10000000-0000-0000-0000-000000000001',
  campaign: '20000000-0000-0000-0000-000000000001',
  step: '20000000-0000-0000-0000-000000000002',
  deal: '30000000-0000-0000-0000-000000000001',
  task: '30000000-0000-0000-0000-000000000002',
  note: '30000000-0000-0000-0000-000000000003',
  participant: '30000000-0000-0000-0000-000000000004',
  lead: '40000000-0000-0000-0000-000000000001',
  list: '50000000-0000-0000-0000-000000000001',
  company: '60000000-0000-0000-0000-000000000001',
  template: '70000000-0000-0000-0000-000000000001',
  sequence: '70000000-0000-0000-0000-000000000002',
  segment: '80000000-0000-0000-0000-000000000001',
  tag: '80000000-0000-0000-0000-000000000002',
  smtp: '90000000-0000-0000-0000-000000000001',
  message: 'a0000000-0000-0000-0000-000000000001',
  webhook: 'b0000000-0000-0000-0000-000000000001',
  integration: 'b0000000-0000-0000-0000-000000000002',
  asset: 'c0000000-0000-0000-0000-000000000001',
  apikey: 'd0000000-0000-0000-0000-000000000001',
  eventType: 'd0000000-0000-0000-0000-000000000002',
  bookingLink: 'd0000000-0000-0000-0000-000000000005',
};

const owned = (id: string, extra: Record<string, any> = {}) => ({
  id,
  user_id: OWNER,
  name: SECRET,
  title: SECRET,
  subject: SECRET,
  body: SECRET,
  label: SECRET,
  email: `${SECRET}@owner.test`,
  secret: SECRET,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...extra,
});

type World = Record<string, any[]>;
let world: World;

function freshWorld(): World {
  return {
    contacts: [owned(ID.contact, { first_name: SECRET, last_name: SECRET, lifecycle: 'contact', is_unsubscribed: false, is_bounced: false })],
    campaigns: [owned(ID.campaign, { status: 'draft', list_id: null })],
    campaign_steps: [owned(ID.step, { campaign_id: ID.campaign, step_order: 0, step_type: 'email' })],
    campaign_contacts: [owned('c0ffee00-0000-0000-0000-000000000001', { campaign_id: ID.campaign, contact_id: ID.contact, status: 'pending' })],
    campaign_activities: [owned('c0ffee00-0000-0000-0000-000000000002', { campaign_id: ID.campaign, contact_id: ID.contact, activity_type: 'sent' })],
    deals: [owned(ID.deal, { stage: 'lead', value: 1000, contact_id: ID.contact, position: 0 })],
    crm_tasks: [owned(ID.task, { deal_id: ID.deal, is_done: false })],
    crm_notes: [owned(ID.note, { deal_id: ID.deal, contact_id: ID.contact, pinned: false })],
    deal_participants: [owned(ID.participant, { deal_id: ID.deal, contact_id: ID.contact, role: 'Champion' })],
    crm_events: [owned('30000000-0000-0000-0000-000000000005', { starts_at: '2026-02-01T00:00:00Z', type: 'meeting' })],
    calendar_availability: [owned('d0000000-0000-0000-0000-000000000003', { weekday: 1, start_minute: 540, end_minute: 1020 })],
    calendar_scheduling_prefs: [owned('d0000000-0000-0000-0000-000000000004', { timezone: 'Secret/Zone', buffer_before_minutes: 0, buffer_after_minutes: 0, minimum_notice_minutes: 240, max_bookings_per_day: null, slot_interval_minutes: 15, booking_horizon_days: 60 })],
    booking_links: [owned(ID.bookingLink, { slug: 'owner-secret-slug', headline: SECRET, event_type_id: ID.eventType, is_active: true, views: 3, bookings: 2, archived_at: null, duration_minutes: null, collect_phone: false, collect_company: false, question: null })],
    calendar_event_types: [owned(ID.eventType, { colour: '#6366f1', duration_minutes: 30, location_kind: 'video', is_default: true, archived_at: null })],
    leads: [owned(ID.lead, { contact_id: ID.contact, status: 'open' })],
    contact_lists: [owned(ID.list, { kind: 'lead' })],
    list_contacts: [owned('50000000-0000-0000-0000-000000000009', { list_id: ID.list, contact_id: ID.contact })],
    companies: [owned(ID.company, { domain: 'owner.test' })],
    email_templates: [owned(ID.template, { is_preset: false, usage_count: 0 })],
    sequence_templates: [owned(ID.sequence, { is_preset: false, steps: [] })],
    saved_segments: [owned(ID.segment, { filter_config: { conditions: [], logic: 'and' } })],
    tags: [owned(ID.tag, { color: '#fff' })],
    contact_tags: [owned('80000000-0000-0000-0000-000000000009', { tag_id: ID.tag, contact_id: ID.contact })],
    smtp_accounts: [owned(ID.smtp, { email_address: `${SECRET}@owner.test`, is_active: true, smtp_pass_encrypted: 'x' })],
    inbox_messages: [owned(ID.message, { direction: 'inbound', from_email: `${SECRET}@owner.test`, to_email: 'me@x.test', is_read: false, triage_decision: null })],
    webhook_endpoints: [owned(ID.webhook, { url: 'https://owner.test/hook', events: [] })],
    integrations: [owned(ID.integration, { provider: 'slack', config: {}, events: [] })],
    asset_templates: [owned(ID.asset, {})],
    api_keys: [owned(ID.apikey, { key_hash: 'x', revoked_at: null })],
    user_settings: [owned('e0000000-0000-0000-0000-000000000001', { first_name: SECRET })],
    suppression_list: [owned('f0000000-0000-0000-0000-000000000001', { email: `${SECRET}@owner.test`, reason: 'manual' })],
  };
}

/* ── A fake PostgREST that actually applies the filters ───────────── */

let writes: { table: string; op: string; matched: any[] }[] = [];

function parseOrClause(clause: string): { col: string; op: string; value: string }[] {
  // "is_archived.is.null,is_archived.eq.false" -> disjunction terms.
  return clause.split(',').map((term) => {
    const [col, op, ...rest] = term.split('.');
    return { col, op, value: rest.join('.') };
  }).filter((t) => t.col && t.op);
}

function matches(row: any, col: string, op: string, value: any): boolean {
  const actual = col.includes('.') ? row[col.split('.').pop()!] : row[col];
  switch (op) {
    case 'eq': return String(actual) === String(value);
    case 'neq': return String(actual) !== String(value);
    case 'is': return value === 'null' || value === null ? (actual === null || actual === undefined) : actual === value;
    case 'in': return Array.isArray(value) ? value.map(String).includes(String(actual)) : false;
    case 'gt': return actual > value;
    case 'gte': return actual >= value;
    case 'lt': return actual < value;
    case 'lte': return actual <= value;
    default: return true;
  }
}

function table(name: string): any {
  let single = false;
  let counting = false;
  let deleting = false;
  let pendingUpdate: any = null;
  /** Rows this chain just wrote, so .select() returns them and not the table. */
  let justInserted: any[] = [];
  const filters: { op: string; col: string; value: any }[] = [];
  const orGroups: string[] = [];

  const rowsFor = (): any[] => {
    let rows: any[] = (world[name] ?? []).slice();
    for (const f of filters) {
      if (f.op === 'not') {
        rows = rows.filter((r) => !matches(r, f.col, 'is', f.value));
        continue;
      }
      rows = rows.filter((r) => matches(r, f.col, f.op, f.value));
    }
    // A disjunction is only a scope if every branch of it is one, which for
    // these services it never is - but applying it keeps results honest.
    for (const group of orGroups) {
      const terms = parseOrClause(group);
      rows = rows.filter((r) => terms.some((t) => matches(r, t.col, t.op, t.value)));
    }
    return rows;
  };

  const resolve = () => {
    /*
     * An insert or upsert followed by .select() returns the rows written,
     * which is what PostgREST does. Falling through to rowsFor() here
     * returned the WHOLE table - no filters are set on an insert chain - so
     * every upsert looked like it was handing back everybody's rows. It
     * flagged availabilityService.updatePrefs as a leak when that method is
     * perfectly safe, which is the kind of false alarm that gets an audit
     * switched off.
     */
    if (justInserted.length > 0) {
      const written = justInserted;
      justInserted = [];
      return { data: single ? written[0] : written, error: null, count: written.length };
    }

    const rows = rowsFor();

    if (pendingUpdate) {
      writes.push({ table: name, op: 'update', matched: rows });
      for (const row of rows) Object.assign(row, pendingUpdate);
      pendingUpdate = null;
      return { data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
    }
    if (deleting) {
      writes.push({ table: name, op: 'delete', matched: rows });
      const ids = new Set(rows.map((r) => r.id));
      world[name] = (world[name] ?? []).filter((r) => !ids.has(r.id));
      return { data: null, error: null, count: rows.length };
    }
    if (counting) return { data: null, error: null, count: rows.length };
    if (single) return { data: rows[0] ?? null, error: null, count: rows.length };
    return { data: rows, error: null, count: rows.length };
  };

  const chain: any = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return chain; };
      if (prop === 'select') return (_s?: string, opts?: any) => { if (opts?.count) counting = true; return chain; };
      if (prop === 'eq') return (c: string, v: any) => { filters.push({ op: 'eq', col: c, value: v }); return chain; };
      if (prop === 'neq') return (c: string, v: any) => { filters.push({ op: 'neq', col: c, value: v }); return chain; };
      if (prop === 'in') return (c: string, v: any) => { filters.push({ op: 'in', col: c, value: v }); return chain; };
      if (prop === 'is') return (c: string, v: any) => { filters.push({ op: 'is', col: c, value: v }); return chain; };
      if (prop === 'not') return (c: string, _o: string, v: any) => { filters.push({ op: 'not', col: c, value: v }); return chain; };
      if (prop === 'gt') return (c: string, v: any) => { filters.push({ op: 'gt', col: c, value: v }); return chain; };
      if (prop === 'gte') return (c: string, v: any) => { filters.push({ op: 'gte', col: c, value: v }); return chain; };
      if (prop === 'lt') return (c: string, v: any) => { filters.push({ op: 'lt', col: c, value: v }); return chain; };
      if (prop === 'lte') return (c: string, v: any) => { filters.push({ op: 'lte', col: c, value: v }); return chain; };
      if (prop === 'or') return (clause: string) => { orGroups.push(clause); return chain; };
      if (prop === 'insert' || prop === 'upsert') {
        return (payload: any) => {
          const rows = (Array.isArray(payload) ? payload : [payload]).map((r: any, i: number) => ({
            id: `new-${name}-${i}`, ...r,
          }));
          // An insert creates the caller's own row; it cannot reach OWNER's.
          world[name] = [...(world[name] ?? []), ...rows];
          justInserted = rows;
          writes.push({ table: name, op: 'insert', matched: [] });
          return chain;
        };
      }
      if (prop === 'update') return (patch: any) => { pendingUpdate = patch; return chain; };
      if (prop === 'delete') { deleting = true; return () => chain; }
      if (prop === 'then') return (res: any) => res(resolve());
      return () => chain;
    },
    apply() { return chain; },
  });
  return chain;
}

(supabaseAdmin as any).from = table;
(supabaseAdmin as any).rpc = () => Promise.resolve({ data: null, error: null });

/* ── Assertions ───────────────────────────────────────────────────── */

/** Does anything in here belong to OWNER? */
function leaks(value: unknown, seen = new Set<any>()): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.includes(SECRET) || value === OWNER;
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((v) => leaks(v, seen));
  return Object.values(value as Record<string, unknown>).some((v) => leaks(v, seen));
}

let pass = 0;
let fail = 0;
const problems: string[] = [];

function judge(name: string, returned: unknown, threw: unknown) {
  const readLeak = !threw && leaks(returned);
  const touched = writes.filter((w) => w.matched.some((r) => r.user_id === OWNER));

  if (!readLeak && touched.length === 0) {
    pass++;
    console.log(`  ok   ${name}${threw ? '  (refused)' : ''}`);
    return;
  }
  fail++;
  const detail = [
    readLeak ? `returned OWNER data` : '',
    touched.length ? `${touched.map((w) => `${w.op} ${w.table}`).join(', ')} on OWNER rows` : '',
  ].filter(Boolean).join('; ');
  console.log(`  FAIL ${name} — ${detail}`);
  problems.push(`${name}: ${detail}`);
}

/* ── The methods, called as somebody else ─────────────────────────── */

const [
  contacts, campaigns, campaignSteps, campaignContacts, crm, calendar, booking, leads, lists, companies,
  template, segments, tags, smtp, inbox, triage, webhook, integrations, asset, apikey, settings, suppression,
] = await Promise.all([
  import('../src/services/contacts.service.js'),
  import('../src/services/campaigns.service.js'),
  import('../src/services/campaign-steps.service.js'),
  import('../src/services/campaign-contacts.service.js'),
  import('../src/services/crm.service.js'),
  import('../src/services/calendar.service.js'),
  import('../src/services/booking.service.js'),
  import('../src/services/leads.service.js'),
  import('../src/services/lists.service.js'),
  import('../src/services/companies.service.js'),
  import('../src/services/template.service.js'),
  import('../src/services/segments.service.js'),
  import('../src/services/tags.service.js'),
  import('../src/services/smtp.service.js'),
  import('../src/services/inbox.service.js'),
  import('../src/services/triage.service.js'),
  import('../src/services/webhook.service.js'),
  import('../src/services/integrations.service.js'),
  import('../src/services/asset.service.js'),
  import('../src/services/apikey.service.js'),
  import('../src/services/settings.service.js'),
  import('../src/services/suppression.service.js'),
]);

const S = (m: any, key: string) => (m as any)[key];

/*
 * Declared as object + method name rather than as a closure, so the method
 * can be checked to exist before it is called.
 *
 * This matters more than it looks. A closure calling a method that is not
 * there throws TypeError, and this audit scores a throw as "the service
 * refused" - so every typo and every method that has since been renamed
 * reads as a pass. Two were already hiding in here: `campaignsController
 * .getStats` and `leadsService.get`, neither of which has ever existed.
 * Nothing about the output gave them away.
 */
interface Case {
  name: string;
  /** The object holding the method, so its existence can be verified. */
  on: any;
  method: string;
  args: any[];
}

/** Free functions exported from a module, wrapped so they fit the same shape. */
const fn = (module: any, name: string) => ({ [name]: module[name] });

const contactsService = S(contacts, 'contactsService');
const campaignsService = S(campaigns, 'campaignsService');
const crmService = S(crm, 'crmService');
const leadsService = S(leads, 'leadsService');
const listsService = S(lists, 'listsService');
const companiesService = S(companies, 'companiesService');
const templateService = S(template, 'templateService');
const segmentsService = S(segments, 'segmentsService');
const tagsService = S(tags, 'tagsService');
const smtpService = S(smtp, 'smtpService');
const inboxService = S(inbox, 'inboxService');
const triageService = S(triage, 'triageService');
const bookingService = S(booking, 'bookingService');
const calendarService = S(calendar, 'calendarService');
const availabilityService = S(calendar, 'availabilityService');

const cases: Case[] = [
  // Contacts
  { name: 'contacts.get',            on: contactsService, method: 'get',    args: [INTRUDER, ID.contact] },
  { name: 'contacts.update',         on: contactsService, method: 'update', args: [INTRUDER, ID.contact, { first_name: 'x' }] },
  { name: 'contacts.delete',         on: contactsService, method: 'delete', args: [INTRUDER, ID.contact] },
  { name: 'contacts.getCampaignsForContact', on: contactsService, method: 'getCampaignsForContact', args: [INTRUDER, ID.contact] },

  // Campaigns
  { name: 'campaigns.get',           on: campaignsService, method: 'get',    args: [INTRUDER, ID.campaign] },
  { name: 'campaigns.update',        on: campaignsService, method: 'update', args: [INTRUDER, ID.campaign, { name: 'x' }] },
  { name: 'campaigns.delete',        on: campaignsService, method: 'delete', args: [INTRUDER, ID.campaign] },
  { name: 'campaigns.assertOwnership', on: campaignsService, method: 'assertOwnership', args: [INTRUDER, ID.campaign] },
  { name: 'campaigns.getStats',      on: campaignsService, method: 'getStats', args: [ID.campaign] },
  { name: 'campaigns.clone',         on: campaignsService, method: 'clone',  args: [INTRUDER, ID.campaign] },

  // Deals and the CRM
  { name: 'crm.dealDetail',          on: crmService, method: 'dealDetail',       args: [INTRUDER, ID.deal] },
  { name: 'crm.updateDeal',          on: crmService, method: 'updateDeal',       args: [INTRUDER, ID.deal, { title: 'x' }] },
  { name: 'crm.deleteDeal',          on: crmService, method: 'deleteDeal',       args: [INTRUDER, ID.deal] },
  { name: 'crm.listParticipants',    on: crmService, method: 'listParticipants', args: [INTRUDER, ID.deal] },
  { name: 'crm.addParticipant',      on: crmService, method: 'addParticipant',   args: [INTRUDER, ID.deal, { contact_id: ID.contact, role: 'Champion' }] },
  { name: 'crm.removeParticipant',   on: crmService, method: 'removeParticipant', args: [INTRUDER, ID.deal, ID.participant] },
  { name: 'crm.dealStageHistory',    on: crmService, method: 'dealStageHistory', args: [INTRUDER, ID.deal] },
  { name: 'crm.updateTask',          on: crmService, method: 'updateTask',       args: [INTRUDER, ID.task, { is_done: true }] },
  { name: 'crm.deleteTask',          on: crmService, method: 'deleteTask',       args: [INTRUDER, ID.task] },
  { name: 'crm.updateNote',          on: crmService, method: 'updateNote',       args: [INTRUDER, ID.note, { body: 'x' }] },
  { name: 'crm.deleteNote',          on: crmService, method: 'deleteNote',       args: [INTRUDER, ID.note] },
  { name: 'crm.contactSummary',      on: crmService, method: 'contactSummary',   args: [INTRUDER, ID.contact] },

  // Calendar
  { name: 'calendar.getType',     on: calendarService, method: 'getType',     args: [INTRUDER, ID.eventType] },
  { name: 'calendar.updateType',  on: calendarService, method: 'updateType',  args: [INTRUDER, ID.eventType, { name: 'x' }] },
  { name: 'calendar.archiveType', on: calendarService, method: 'archiveType', args: [INTRUDER, ID.eventType] },
  // Booking links: the account side. The public side takes no user id at
  // all - it is reached by slug - so it is covered by its own harness
  // rather than here, where every case asks 'does passing a stranger's id
  // get you somebody else's row'.
  { name: 'booking.getLink',      on: bookingService, method: 'getLink',      args: [INTRUDER, ID.bookingLink] },
  { name: 'booking.updateLink',   on: bookingService, method: 'updateLink',   args: [INTRUDER, ID.bookingLink, { headline: 'x' }] },
  { name: 'booking.archiveLink',  on: bookingService, method: 'archiveLink',  args: [INTRUDER, ID.bookingLink] },
  { name: 'booking.listLinks',    on: bookingService, method: 'listLinks',    args: [INTRUDER] },
  { name: 'booking.linkBookings', on: bookingService, method: 'linkBookings', args: [INTRUDER, ID.bookingLink] },
  { name: 'booking.sendLinkInReply', on: bookingService, method: 'sendLinkInReply', args: [INTRUDER, ID.message] },
  { name: 'availability.listWindows',    on: availabilityService, method: 'listWindows',    args: [INTRUDER] },
  { name: 'availability.replaceWindows', on: availabilityService, method: 'replaceWindows', args: [INTRUDER, [{ weekday: 1, start_minute: 540, end_minute: 1020 }]] },
  { name: 'availability.getPrefs',       on: availabilityService, method: 'getPrefs',       args: [INTRUDER] },
  { name: 'availability.updatePrefs',    on: availabilityService, method: 'updatePrefs',    args: [INTRUDER, { timezone: 'UTC' }] },
  { name: 'availability.busyBetween',    on: availabilityService, method: 'busyBetween',    args: [INTRUDER, new Date('2026-01-01'), new Date('2026-12-31')] },

  // Leads
  { name: 'leads.update',            on: leadsService, method: 'update',  args: [INTRUDER, ID.lead, { title: 'x' }] },
  { name: 'leads.remove',            on: leadsService, method: 'remove',  args: [INTRUDER, ID.lead] },
  { name: 'leads.archive',           on: leadsService, method: 'archive', args: [INTRUDER, ID.lead, 'x'] },
  { name: 'leads.convert',           on: leadsService, method: 'convert', args: [INTRUDER, ID.lead, {}] },

  // Lists
  { name: 'lists.get',               on: listsService, method: 'get',               args: [INTRUDER, ID.list] },
  { name: 'lists.update',            on: listsService, method: 'update',            args: [INTRUDER, ID.list, { name: 'x' }] },
  { name: 'lists.delete',            on: listsService, method: 'delete',            args: [INTRUDER, ID.list] },
  { name: 'lists.getContactsInList', on: listsService, method: 'getContactsInList', args: [INTRUDER, ID.list, {}] },
  { name: 'lists.addContacts',       on: listsService, method: 'addContacts',       args: [INTRUDER, ID.list, [ID.contact]] },

  // Companies
  { name: 'companies.get',           on: companiesService, method: 'get',      args: [INTRUDER, ID.company] },
  { name: 'companies.update',        on: companiesService, method: 'update',   args: [INTRUDER, ID.company, { name: 'x' }] },
  { name: 'companies.delete',        on: companiesService, method: 'delete',   args: [INTRUDER, ID.company] },
  { name: 'companies.activity',      on: companiesService, method: 'activity', args: [INTRUDER, ID.company] },

  // Templates
  { name: 'template.getEmail',       on: templateService, method: 'getEmailTemplate',       args: [INTRUDER, ID.template] },
  { name: 'template.updateEmail',    on: templateService, method: 'updateEmailTemplate',    args: [INTRUDER, ID.template, { name: 'x' }] },
  { name: 'template.deleteEmail',    on: templateService, method: 'deleteEmailTemplate',    args: [INTRUDER, ID.template] },
  { name: 'template.duplicateEmail', on: templateService, method: 'duplicateEmailTemplate', args: [INTRUDER, ID.template] },
  { name: 'template.getSequence',    on: templateService, method: 'getSequenceTemplate',    args: [INTRUDER, ID.sequence] },
  { name: 'template.deleteSequence', on: templateService, method: 'deleteSequenceTemplate', args: [INTRUDER, ID.sequence] },

  // Segments, tags
  { name: 'segments.get',            on: segmentsService, method: 'get',          args: [INTRUDER, ID.segment] },
  { name: 'segments.update',         on: segmentsService, method: 'update',       args: [INTRUDER, ID.segment, { name: 'x' }] },
  { name: 'segments.delete',         on: segmentsService, method: 'delete',       args: [INTRUDER, ID.segment] },
  { name: 'segments.refreshCount',   on: segmentsService, method: 'refreshCount', args: [INTRUDER, ID.segment] },
  { name: 'tags.update',             on: tagsService,     method: 'update',       args: [INTRUDER, ID.tag, { name: 'x' }] },
  { name: 'tags.delete',             on: tagsService,     method: 'delete',       args: [INTRUDER, ID.tag] },

  // Mailboxes
  { name: 'smtp.get',                on: smtpService, method: 'get',             args: [INTRUDER, ID.smtp] },
  { name: 'smtp.update',             on: smtpService, method: 'update',          args: [INTRUDER, ID.smtp, { label: 'x' }] },
  { name: 'smtp.delete',             on: smtpService, method: 'delete',          args: [INTRUDER, ID.smtp] },
  { name: 'smtp.assertOwnership',    on: smtpService, method: 'assertOwnership', args: [INTRUDER, ID.smtp] },

  // Inbox
  { name: 'inbox.get',               on: inboxService, method: 'get',             args: [INTRUDER, ID.message] },
  { name: 'inbox.getThread',         on: inboxService, method: 'getThread',       args: [INTRUDER, ID.message] },
  { name: 'inbox.markRead',          on: inboxService, method: 'markRead',        args: [INTRUDER, ID.message] },
  { name: 'inbox.archive',           on: inboxService, method: 'archive',         args: [INTRUDER, ID.message] },
  { name: 'inbox.toggleStar',        on: inboxService, method: 'toggleStar',      args: [INTRUDER, ID.message] },
  { name: 'inbox.setTag',            on: inboxService, method: 'setTag',          args: [INTRUDER, ID.message, 'interested'] },
  { name: 'inbox.markThreadRead',    on: inboxService, method: 'markThreadRead',  args: [INTRUDER, ID.message] },
  { name: 'inbox.archiveThread',     on: inboxService, method: 'archiveThread',   args: [INTRUDER, ID.message] },

  // Triage
  { name: 'triage.triage',           on: triageService, method: 'triage', args: [INTRUDER, ID.message, { decision: 'interested' }] },
  { name: 'triage.undo',             on: triageService, method: 'undo',   args: [INTRUDER, ID.message] },

  // Module-level functions
  { name: 'webhook.getEndpoint',     on: webhook,      method: 'getEndpoint',       args: [INTRUDER, ID.webhook] },
  { name: 'webhook.updateEndpoint',  on: webhook,      method: 'updateEndpoint',    args: [INTRUDER, ID.webhook, { label: 'x' }] },
  { name: 'webhook.deleteEndpoint',  on: webhook,      method: 'deleteEndpoint',    args: [INTRUDER, ID.webhook] },
  { name: 'webhook.regenerateSecret', on: webhook,     method: 'regenerateSecret',  args: [INTRUDER, ID.webhook] },
  { name: 'webhook.getDeliveries',   on: webhook,      method: 'getDeliveries',     args: [INTRUDER, ID.webhook, {}] },
  { name: 'integrations.update',     on: integrations, method: 'updateIntegration', args: [INTRUDER, ID.integration, { events: [] }] },
  { name: 'integrations.delete',     on: integrations, method: 'deleteIntegration', args: [INTRUDER, ID.integration] },
  { name: 'integrations.getActivity', on: integrations, method: 'getActivity',      args: [INTRUDER, ID.integration, {}] },
  { name: 'asset.getTemplate',       on: asset,        method: 'getTemplate',       args: [INTRUDER, ID.asset] },
  { name: 'asset.updateTemplate',    on: asset,        method: 'updateTemplate',    args: [INTRUDER, ID.asset, { name: 'x' }] },
  { name: 'asset.deleteTemplate',    on: asset,        method: 'deleteTemplate',    args: [INTRUDER, ID.asset] },
  { name: 'apikey.revokeKey',        on: apikey,       method: 'revokeKey',         args: [INTRUDER, ID.apikey] },
];

/*
 * Campaign sub-resources are a different shape and have to be checked at a
 * different level.
 *
 * campaignStepsService.list takes a campaign id and no user id at all: the
 * guard lives in the controller, which calls assertOwnership first. Calling
 * the service directly therefore "leaks" every time, which is a fact about
 * the harness and not about the app - and an audit that cries wolf is an
 * audit somebody switches off. So these go through the controller, which is
 * the boundary an actual request crosses.
 */
const campaignsController = (await import('../src/controllers/campaigns.controller.js')).campaignsController as any;

function fakeReq(userId: string, params: Record<string, string>, body: any = {}) {
  return { userId, params, body, query: {} } as any;
}

/** Captures whatever the controller sends, so it can be inspected for a leak. */
function fakeRes() {
  const sent: any[] = [];
  const res: any = {
    statusCode: 200,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: any) { sent.push(payload); return res; },
    send(payload?: any) { sent.push(payload); return res; },
  };
  res.sent = sent;
  return res;
}

async function viaController(handler: string, params: Record<string, string>, body: any = {}) {
  /*
   * A handler name that does not exist would throw TypeError, and this audit
   * scores a throw as "refused" - so a typo would read as a pass. It did:
   * `getStats` was audited here for a while and no such handler has ever
   * existed. Checked explicitly so the mistake is loud.
   */
  if (typeof campaignsController[handler] !== 'function') {
    throw new Error(`AUDIT BUG: campaignsController.${handler} does not exist`);
  }
  const res = fakeRes();
  let thrown: unknown = null;
  await campaignsController[handler](
    fakeReq(INTRUDER, params, body),
    res,
    (err: unknown) => { thrown = err; },
  );
  // next(err) is how these controllers refuse; treat it as the throw it is.
  if (thrown) throw thrown;
  return res.sent;
}

/** Wrapped so controller cases fit the same object+method shape. */
const viaControllerCase = (name: string, handler: string, params: Record<string, string>, body: any = {}): Case => ({
  name,
  on: { call: () => viaController(handler, params, body) },
  method: 'call',
  args: [],
});

const controllerCases: Case[] = [
  viaControllerCase('GET  /campaigns/:id/steps',    'getSteps',    { id: ID.campaign }),
  viaControllerCase('GET  /campaigns/:id/contacts', 'getContacts', { id: ID.campaign }),
  viaControllerCase('POST /campaigns/:id/steps',    'addStep',     { id: ID.campaign }, { step_type: 'email' }),
  // A leaked webhook token is a standing ability to post events into
  // somebody else's campaign, so it is worth its own case.
  viaControllerCase('GET  /campaigns/:id/webhook-token', 'getWebhookToken', { id: ID.campaign }),
  viaControllerCase('GET  /campaigns/:id/sender-pool',   'getSenderPool',   { id: ID.campaign }),
];

async function runAll(group: Case[]) {
  for (const c of group) {
    /*
     * Existence first, and as a hard failure. A method that is not there
     * throws, a throw means "refused", and "refused" is a pass - so without
     * this every renamed or mistyped method silently reports as isolated.
     * Two were doing exactly that before this check existed.
     */
    if (typeof c.on?.[c.method] !== 'function') {
      fail++;
      console.log(`  FAIL ${c.name} — AUDIT BUG: no such method "${c.method}"`);
      problems.push(`${c.name}: audited a method that does not exist`);
      continue;
    }

    world = freshWorld();
    writes = [];
    let returned: unknown;
    let threw: unknown = null;
    try {
      returned = await c.on[c.method](...c.args);
    } catch (err) {
      threw = err;
    }
    judge(c.name, returned, threw);
  }
}

console.log(`calling ${cases.length} service methods as an account that owns nothing\n`);
await runAll(cases);

console.log(`\nand ${controllerCases.length} campaign sub-resource endpoints, where the guard`);
console.log('lives in the controller rather than the service\n');
await runAll(controllerCases);

if (problems.length) {
  console.log('\nmethods that handed an intruder somebody else\'s data:\n');
  for (const p of problems) console.log(`  ${p}`);
}

console.log(`\n${pass} isolated, ${fail} leaking\n`);
process.exit(fail ? 1 : 0);
