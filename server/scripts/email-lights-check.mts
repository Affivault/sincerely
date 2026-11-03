/* ═══════════════════════════════════════════════════════════════════════
   Email traffic lights, people held without an email, and the campaign
   gate that only emails the lights it is set to.

   The promise being checked: an address is green, amber, red or "no
   email" by ONE definition, and that definition is what the dot on a row,
   the chip counts, the launch counts, enrolment and the sender all use.
   A campaign set to green never emails an unchecked or bad address - an
   unchecked one waits for its free check, and goes out only if it passes.

   Run: npx tsx scripts/email-lights-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emailState, emailLight, lightGate, lightCounts, heldMatchKey, normalizeSendLights,
  DEFAULT_SEND_LIGHTS, verificationLabel,
} from '@lemlist/shared';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), 'utf8');
let passed = 0;
let failed = 0;
function is(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`); }
}

const at = '2026-10-01T00:00:00Z';
const valid = { email: 'a@b.co', dcs_verified_at: at, dcs_score: 92, dcs_syntax_ok: true, dcs_domain_ok: true };
const risky = { ...valid, dcs_score: 60 };
const unchecked = { email: 'a@b.co', dcs_verified_at: null };
const bounced = { ...valid, is_bounced: true };
const noMx = { ...valid, dcs_domain_ok: false };
const bad = { ...valid, dcs_score: 20 };

console.log('\none definition of each light');
{
  is('verified is green', emailLight(valid) === 'green');
  is('risky is amber', emailLight(risky) === 'amber');
  is('not checked yet is amber', emailLight(unchecked) === 'amber' && emailState(unchecked) === 'unverified');
  is('bounced is red, whatever the score said', emailLight(bounced) === 'red' && emailState(bounced) === 'bounced');
  is('no mail server is red', emailLight(noMx) === 'red');
  is('a low score is red', emailLight(bad) === 'red');
  is('no address is "none"', emailLight({ email: '' }) === 'none' && emailLight({}) === 'none');
  is('the export says it in the same words', verificationLabel(bounced) === 'Bounced' && verificationLabel(unchecked) === 'Unverified' && verificationLabel(valid) === 'Valid');
  const c = lightCounts({ valid: 3, risky: 2, unverified: 5, invalid: 1, not_found: 4, no_email: 7 });
  is('chip counts fold the states into lights', c.green === 3 && c.amber === 7 && c.red === 5 && c.none === 7, JSON.stringify(c));
}

console.log('\nthe send gate');
{
  is('campaigns from before the lights are not gated', lightGate(bad, null, 0) === 'send');
  is('green campaign sends to green', lightGate(valid, ['green'], 0) === 'send');
  is('green campaign holds an unchecked address for its check', lightGate(unchecked, ['green'], 1) === 'wait');
  is('...but not forever', lightGate(unchecked, ['green'], 80) === 'skip');
  is('green campaign skips risky', lightGate(risky, ['green'], 0) === 'skip');
  is('green campaign skips red', lightGate(bounced, ['green'], 0) === 'skip');
  is('amber campaign sends unchecked and risky', lightGate(unchecked, ['green', 'amber'], 0) === 'send' && lightGate(risky, ['green', 'amber'], 0) === 'send');
  is('nothing is ever sent to "no email"', lightGate({ email: '' }, ['green', 'amber', 'red'], 0) === 'skip');
  is('new campaigns default to green only', JSON.stringify(DEFAULT_SEND_LIGHTS) === '["green"]');
  is('stored lights are cleaned', JSON.stringify(normalizeSendLights(['red', 'blue', 'green'])) === '["green","red"]' && normalizeSendLights(null) === null);
}

console.log('\nheld people are recognised when they come back');
{
  const a = heldMatchKey({ linkedin_url: 'https://www.linkedin.com/in/ivo-marr-1/' });
  const b = heldMatchKey({ linkedin_url: 'http://uk.linkedin.com/in/ivo-marr-1?trk=x' });
  is('the same profile, however it is written', !!a && a === b, `${a} / ${b}`);
  is('name and company, case and spacing aside', heldMatchKey({ first_name: 'Ivo ', last_name: 'MARR', company: 'Marr  Properties' }) === heldMatchKey({ first_name: 'ivo', last_name: 'marr', company: 'marr properties' }));
  is('nobody to recognise, nothing held', heldMatchKey({ company: 'Acme' }) === null);
}

console.log('\nthe database');
{
  const sql = read('../../supabase/migrations/110_email_lights_held_people.sql');
  is('migration 110 is pure ASCII', !/[^\x00-\x7F]/.test(sql));
  is('and has no BEGIN/COMMIT of its own', !/^\s*(BEGIN|COMMIT)\s*;/im.test(sql));
  is('held people are one per person per account', /UNIQUE INDEX IF NOT EXISTS idx_held_people_user_match ON held_people\(user_id, match_key\)/.test(sql));
  is('held people are private to their account', /ENABLE ROW LEVEL SECURITY/.test(sql) && /auth\.uid\(\) = user_id/.test(sql));
  is('a deleted list does not delete the people in it', /REFERENCES contact_lists\(id\) ON DELETE SET NULL/.test(sql));
  is('existing campaigns are left ungated (no default on the column)', /ADD COLUMN IF NOT EXISTS send_lights text\[\];/.test(sql));
  is('only the three lights can be stored', /send_lights <@ ARRAY\['green', 'amber', 'red'\]/.test(sql));
}

console.log('\nthe server keeps the promise');
{
  const seq = read('../src/services/sequence.service.ts');
  const gate = seq.indexOf('lightGate(');
  const dcs = seq.indexOf('DCS threshold check');
  is('the sender checks the light before every email', gate > 0 && gate < dcs);
  is('an unchecked address is checked (free) while it waits', /action === 'wait'[\s\S]{0,200}verifyContact\(/.test(seq));
  const enrol = read('../src/services/campaign-contacts.service.ts');
  is('enrolment turns away red and risky when not chosen', /drop\(id, 'light_red'/.test(enrol) && /drop\(id, 'light_amber'/.test(enrol));
  const camp = read('../src/services/campaigns.service.ts');
  is('a new campaign is created green-only', /send_lights: DEFAULT_SEND_LIGHTS, \.\.\.pickCampaignFields/.test(camp));
  is('the lights can be changed while it runs', /k === 'send_lights'/.test(camp));
  const contacts = read('../src/services/contacts.service.ts');
  is('the list filter treats unchecked as amber', /dcs_verified_at\.is\.null,is_bounced\.is\.false/.test(contacts));
  is('the counts use the shared definition', /emailState\(\{ \.\.\.r, email: 'counted' \}\)/.test(contacts));
  is('an import releases held people it now has emails for', /heldPeopleService\.releaseMatches\(userId, uniqueValid\)/.test(contacts));
  is('the email finder is gone', !/find-emails|importEmailFinder/.test(read('../src/routes/contact.routes.ts') + read('../src/controllers/contacts.controller.ts')));
}

console.log('\nthe screens');
{
  const client = (p: string) => read(`../../client/src/${p}`);
  const imp = client('pages/contacts/BulkImportPage.tsx');
  is('import keeps people without an email', /contactsApi\.holdPeople\(/.test(imp) && !/importFindEmails/.test(imp));
  const list = client('pages/contacts/ContactsListPage.tsx');
  is('both pages show the light chips', /<LightChips/.test(list) && !/enabled: listKind === 'lead',\n\s+refetchInterval/.test(list));
  is('"No email" shows the held people', /lights\.includes\('none'\)[\s\S]{0,80}<HeldPeoplePanel/.test(list));
  is('selected people can be enriched in bulk', /testId: 'bulk-enrich'/.test(list) && /enrichSelected/.test(list));
  is('launch shows who gets emails', /<SendLightsPicker/.test(client('pages/campaigns/CampaignCreatePage.tsx')));
  is('and a running campaign can change it', /<CampaignLightsCard/.test(client('pages/campaigns/CampaignDetailPage.tsx')));
}

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, `${failed} email light check(s) failed`);
