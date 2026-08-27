/* ═══════════════════════════════════════════════════════════════════════
   Prove that a request body cannot write a column it has no business
   writing.

   The same hole has been found and fixed five separate times — contacts,
   campaign steps, campaigns, then six services in one go. Every fix was
   correct and none of them stopped the next one appearing, because nothing
   was checking. This checks.

   It does not read the source and guess. Reading the source is how the
   first version of this script decided `pickCampaignFields(...)` was
   unguarded: a filter it didn't recognise looks identical to no filter at
   all. Instead it swaps the Supabase client for a recorder, calls each
   service method for real with a body laced with `user_id`, `sends_today`
   and friends, and asserts none of them reach the write. It tests the
   property that matters, not the spelling of the guard.

   Run: npx tsx scripts/audit-write-paths.mts
   ═══════════════════════════════════════════════════════════════════════ */

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'audit';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'audit';
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.STRIPE_SECRET_KEY ||= '';

const { supabaseAdmin } = await import('../src/config/supabase.js');
const { protectedColumns } = await import('../src/utils/writable-fields.js');

/** Everything a write was asked to persist during one call. */
let recorded: { table: string; op: string; payload: any }[] = [];

/**
 * A plausible existing row.
 *
 * The recorder has to answer reads with *something*: a service that looks up
 * the record before updating it, or checks ownership first, otherwise throws
 * "not found" and never reaches its write — and a write path that never runs
 * is a write path this audit hasn't actually checked. The fields here are the
 * ones services commonly branch on.
 */
const EXISTING_ROW = {
  id: '00000000-0000-0000-0000-000000000002',
  user_id: '00000000-0000-0000-0000-000000000001',
  name: 'Existing',
  status: 'draft',
  is_default: false,
  is_preset: false,
  provider: 'slack',
  config: {},
  filter_config: { conditions: [], logic: 'and' },
  steps: [],
  events: [],
};

/**
 * A stand-in for the query builder that records writes and answers reads with
 * EXISTING_ROW, so a service under test walks its normal path instead of
 * erroring out early.
 */
function recorder(table: string): any {
  // PostgREST returns a bare object for .single()/.maybeSingle() and an array
  // otherwise. Getting that wrong strands whole paths: a service that iterates
  // a list result throws "rows is not iterable" before it ever writes, and the
  // audit then clears a path it never actually ran.
  let single = false;
  const chain: any = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'single' || prop === 'maybeSingle') {
        return () => { single = true; return chain; };
      }
      if (prop === 'then') {
        return (resolve: any) => resolve({
          data: single ? EXISTING_ROW : [EXISTING_ROW],
          error: null,
          // Zero, so plan-quota checks ("you already have 1 inbox") don't
          // reject the very calls this audit needs to reach.
          count: 0,
        });
      }
      if (prop === 'insert' || prop === 'update' || prop === 'upsert') {
        return (payload: any) => {
          for (const row of Array.isArray(payload) ? payload : [payload]) {
            recorded.push({ table, op: prop, payload: row });
          }
          return chain;
        };
      }
      return () => chain;
    },
    apply() { return chain; },
  });
  return chain;
}

(supabaseAdmin as any).from = recorder;
(supabaseAdmin as any).rpc = () => Promise.resolve({ data: null, error: null });

/** A body that asks for everything it shouldn't have. */
const POISON: Record<string, any> = {};
for (const column of protectedColumns()) POISON[column] = 'ATTACKER';

interface Case {
  name: string;
  /** Extra legitimate fields, so the call gets far enough to write. */
  body?: Record<string, any>;
  run: (body: any) => Promise<unknown>;
}

const [
  smtp, lists, tags, template, webhook, asset, campaigns, campaignSteps, contacts, crm, leads, companies, settings, segments, integrations,
] = await Promise.all([
  import('../src/services/smtp.service.js'),
  import('../src/services/lists.service.js'),
  import('../src/services/tags.service.js'),
  import('../src/services/template.service.js'),
  import('../src/services/webhook.service.js'),
  import('../src/services/asset.service.js'),
  import('../src/services/campaigns.service.js'),
  import('../src/services/campaign-steps.service.js'),
  import('../src/services/contacts.service.js'),
  import('../src/services/crm.service.js'),
  import('../src/services/leads.service.js'),
  import('../src/services/companies.service.js'),
  import('../src/services/settings.service.js'),
  import('../src/services/segments.service.js'),
  import('../src/services/integrations.service.js'),
]);

const USER = '00000000-0000-0000-0000-000000000001';
const ID = '00000000-0000-0000-0000-000000000002';

const cases: Case[] = [
  { name: 'smtp.create', body: { label: 'x', email_address: 'a@b.c', smtp_host: 'h', smtp_port: 587, smtp_user: 'u', smtp_pass: 'p' },
    run: (b) => (smtp as any).smtpService.create(USER, b) },
  { name: 'smtp.update', run: (b) => (smtp as any).smtpService.update(USER, ID, b) },
  { name: 'lists.create', body: { name: 'L' }, run: (b) => (lists as any).listsService.create(USER, b) },
  { name: 'lists.update', body: { name: 'L' }, run: (b) => (lists as any).listsService.update(USER, ID, b) },
  { name: 'tags.create', body: { name: 'T' }, run: (b) => (tags as any).tagsService.create(USER, b) },
  { name: 'tags.update', body: { name: 'T' }, run: (b) => (tags as any).tagsService.update(USER, ID, b) },
  { name: 'template.createEmail', body: { name: 'E' }, run: (b) => (template as any).templateService.createEmailTemplate(USER, b) },
  { name: 'template.updateEmail', body: { name: 'E' }, run: (b) => (template as any).templateService.updateEmailTemplate(USER, ID, b) },
  { name: 'template.createSequence', body: { name: 'S', steps: [] }, run: (b) => (template as any).templateService.createSequenceTemplate(USER, b) },
  { name: 'template.updateSequence', body: { name: 'S' }, run: (b) => (template as any).templateService.updateSequenceTemplate(USER, ID, b) },
  { name: 'webhook.updateEndpoint', body: { label: 'W' }, run: (b) => (webhook as any).updateEndpoint(USER, ID, b) },
  { name: 'asset.createTemplate', body: { name: 'A' }, run: (b) => (asset as any).createTemplate(USER, b) },
  { name: 'asset.updateTemplate', body: { name: 'A' }, run: (b) => (asset as any).updateTemplate(USER, ID, b) },
  { name: 'campaigns.create', body: { name: 'C' }, run: (b) => (campaigns as any).campaignsService.create(USER, b) },
  { name: 'campaignSteps.add', body: { step_type: 'email' }, run: (b) => (campaignSteps as any).campaignStepsService.add(ID, b) },
  { name: 'campaignSteps.update', body: { subject: 'x' }, run: (b) => (campaignSteps as any).campaignStepsService.update(ID, ID, b) },
  { name: 'contacts.create', body: { email: 'a@b.c' }, run: (b) => (contacts as any).contactsService.create(USER, b) },
  { name: 'contacts.update', body: { email: 'a@b.c' }, run: (b) => (contacts as any).contactsService.update(USER, ID, b) },
  { name: 'crm.createDeal', body: { title: 'D' }, run: (b) => (crm as any).crmService.createDeal(USER, b) },
  { name: 'crm.updateDeal', body: { title: 'D' }, run: (b) => (crm as any).crmService.updateDeal(USER, ID, b) },
  { name: 'crm.createTask', body: { title: 'T' }, run: (b) => (crm as any).crmService.createTask(USER, b) },
  { name: 'crm.createNote', body: { body: 'N', contact_id: ID }, run: (b) => (crm as any).crmService.createNote(USER, b) },
  { name: 'crm.addParticipant', body: { contact_id: ID, role: 'Champion' }, run: (b) => (crm as any).crmService.addParticipant(USER, ID, b) },
  { name: 'crm.updateParticipant', body: { role: 'Blocker' }, run: (b) => (crm as any).crmService.updateParticipant(USER, ID, ID, b) },
  { name: 'leads.create', body: { contact_id: ID, title: 'L' }, run: (b) => (leads as any).leadsService.create(USER, b) },
  { name: 'leads.update', body: { title: 'L' }, run: (b) => (leads as any).leadsService.update(USER, ID, b) },
  { name: 'companies.update', body: { name: 'Co' }, run: (b) => (companies as any).companiesService.update(USER, ID, b) },
  { name: 'settings.update', body: { first_name: 'F' }, run: (b) => (settings as any).settingsService.update(USER, b) },
  { name: 'segments.create', body: { name: 'S', filter_config: { conditions: [], logic: 'and' } }, run: (b) => (segments as any).segmentsService.create(USER, b) },
  { name: 'segments.update', body: { name: 'S' }, run: (b) => (segments as any).segmentsService.update(USER, ID, b) },
  { name: 'integrations.update', body: { events: ['email.replied'] }, run: (b) => (integrations as any).updateIntegration(USER, ID, b) },
];

let failures = 0;
let ran = 0;
const unreached: string[] = [];

for (const testCase of cases) {
  recorded = [];
  const body = { ...POISON, ...(testCase.body || {}) };
  let aborted: string | null = null;
  try {
    await testCase.run(body);
  } catch (err: any) {
    // Services throw freely against a stubbed client — validation, a missing
    // relation, a provider runtime that wants the network. Anything written
    // before the throw is still recorded and still checked. But if the throw
    // came *before* any write, this path went unexercised, and an unexercised
    // path is one this audit has not actually cleared — so say so.
    aborted = err?.message || String(err);
  }

  const writes = recorded.filter((r) => r.op !== 'select');
  if (writes.length === 0) {
    unreached.push(`${testCase.name}: ${aborted || 'returned without writing'}`);
    console.log(`  ??   ${testCase.name.padEnd(28)} never reached its write — ${aborted || 'no write'}`);
    continue;
  }
  ran++;

  const leaked = new Set<string>();
  for (const write of writes) {
    for (const [key, value] of Object.entries(write.payload || {})) {
      if (value === 'ATTACKER') leaked.add(`${write.table}.${key}`);
    }
  }

  if (leaked.size > 0) {
    failures++;
    console.log(`  FAIL ${testCase.name.padEnd(28)} wrote ${[...leaked].join(', ')}`);
  } else {
    console.log(`  ok   ${testCase.name.padEnd(28)} ${writes.length} write(s), nothing leaked`);
  }
}

console.log(`\n${ran} write path(s) exercised, ${failures} leaking, ${unreached.length} unverified.\n`);

if (unreached.length > 0) {
  console.error('Unverified — these never reached a write, so nothing was proven about them:');
  for (const line of unreached) console.error(`  ${line}`);
  console.error('\nGive the case a body that gets it as far as its insert/update.\n');
  process.exit(1);
}

if (failures > 0) {
  console.error(
    'A crafted request body reached Postgres with columns it should not control.\n' +
    'Filter the payload: writable(input, TABLE_FIELDS) from utils/writable-fields.\n',
  );
  process.exit(1);
}
