/* ═══════════════════════════════════════════════════════════════════════
   Duplicates, merges, saved views, bulk edit, the engagement score and
   the no-show follow-up: the pure parts, pinned.

   The matching rules exist twice on purpose - in Postgres, where every
   contact can be compared, and in shared, where the merge screen explains a
   match - so the cases below are the ones both must agree on. The SQL side
   is checked against the same strings by reading the migration for the
   rules it must contain.

   Run: npx tsx scripts/contact-hygiene-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  matchEmail, matchLinkedin, bestLifecycle, defaultMergeChoices, mergeFieldValues, duplicateGroupKey,
  sanitizeViewConfig, sameViewConfig, engagementScore, describeEngagement, storedFactors,
  renderNoShowTemplate, unknownNoShowTags, DEFAULT_NO_SHOW_BODY, BULK_EDIT_FIELDS,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, '../../supabase/migrations/096_duplicates_views_engagement_noshow.sql'), 'utf8');
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');

console.log('\nthe same mailbox, however it is written');
is('case is ignored', matchEmail('Ada@Example.com') === 'ada@example.com');
is('a +tag is the same mailbox', matchEmail('ada+news@example.com') === 'ada@example.com');
is('Gmail ignores dots', matchEmail('a.d.a@gmail.com') === 'ada@gmail.com');
is('googlemail is gmail', matchEmail('Ada.L+x@googlemail.com') === 'adal@gmail.com');
is('dots elsewhere matter', matchEmail('a.da@example.com') === 'a.da@example.com');
is('not an address is no key', matchEmail('nobody') === null && matchEmail('') === null);
is('the SQL drops +tags and Gmail dots too',
  /split_part\(v_local, '\+', 1\)/.test(migration) && /replace\(v_local, '\.', ''\)/.test(migration));

console.log('\nthe same LinkedIn profile');
is('scheme, www, slash and query do not matter',
  matchLinkedin('https://www.linkedin.com/in/ada-lovelace/?trk=x') === 'in/ada-lovelace'
  && matchLinkedin('linkedin.com/in/ada-lovelace') === 'in/ada-lovelace');
is('a country subdomain is the same profile', matchLinkedin('http://uk.linkedin.com/in/Ada-Lovelace') === 'in/ada-lovelace');
is('"n/a" matches nothing', matchLinkedin('n/a') === null);

console.log('\nmerging');
is('customer beats contact beats prospect', bestLifecycle(['prospect', 'customer', 'contact']) === 'customer');
is('a merge never demotes', bestLifecycle(['contact', null]) === 'contact');
{
  const a = { id: 'a', updated_at: '2026-01-01T00:00:00Z', email: 'a@x.com', job_title: 'CTO', phone: null };
  const b = { id: 'b', updated_at: '2026-06-01T00:00:00Z', email: 'b@x.com', job_title: 'CEO', phone: '+44' };
  const c = { id: 'c', updated_at: '2026-03-01T00:00:00Z', email: 'c@x.com', job_title: '', phone: null };
  const choices = defaultMergeChoices([a, b, c], 'a');
  is('filled over blank, newest first', choices.job_title === 'b' && choices.phone === 'b', JSON.stringify(choices));
  is('the address stays the primary\'s by default', choices.email === 'a');
  const values = mergeFieldValues([a, b, c], 'a', choices);
  is('only changed values are sent', values.job_title === 'CEO' && values.phone === '+44' && !('email' in values), JSON.stringify(values));
}
is('a group key ignores order and repeats', duplicateGroupKey(['b', 'a', 'b']) === 'a,b');
is('merge keeps the most advanced enrolment', /WHEN 'replied' THEN 9/.test(migration) && /cc\.current_step_order DESC/.test(migration));
is('every statement in merge_contacts is scoped to the account',
  (migration.match(/WHERE user_id = p_user_id/g) || []).length >= 15);

console.log('\nsaved views');
{
  const v = sanitizeViewConfig({ lifecycle: 'prospect', search: '  acme ', status: 'risky', sort_by: 'engagement_score', sort_dir: 'desc', evil: 1, list_id: 'nope' });
  is('only known keys survive', JSON.stringify(v) === JSON.stringify({ lifecycle: 'prospect', search: 'acme', status: 'risky', sort_by: 'engagement_score', sort_dir: 'desc' }), JSON.stringify(v));
  is('junk in, nothing out', JSON.stringify(sanitizeViewConfig('x')) === '{}' && JSON.stringify(sanitizeViewConfig({ sort_by: 'user_id' })) === '{}');
  is('same rows means same view', sameViewConfig({ search: 'a', status: '' }, { search: 'a' }) && !sameViewConfig({ search: 'a' }, { search: 'b' }));
}

console.log('\nbulk edit');
is('the address is never bulk-editable', !(BULK_EDIT_FIELDS as readonly string[]).includes('email'));
is('the server checks the field against the list, and caps the count',
  /BULK_EDIT_FIELDS as readonly string\[\]\)\.includes\(field\)/.test(src('services/contact-hygiene.service.ts'))
  && /ids\.length > BULK_EDIT_MAX/.test(src('services/contact-hygiene.service.ts')));

console.log('\nengagement');
{
  const now = new Date('2026-10-26T12:00:00Z');
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  is('nothing is zero', engagementScore([], now).score === 0);
  const reply = engagementScore([{ kind: 'reply', at: ago(0) }], now).score;
  is('one fresh reply is about half', reply >= 45 && reply <= 52, String(reply));
  const both = engagementScore([{ kind: 'reply', at: ago(0) }, { kind: 'meeting', at: ago(0) }], now).score;
  is('a reply and a meeting is about 80', both >= 78 && both <= 84, String(both));
  const old = engagementScore([{ kind: 'reply', at: ago(90) }], now).score;
  is('three months fades a reply to an eighth', old < reply / 4, `${old} vs ${reply}`);
  const opens = engagementScore(Array.from({ length: 200 }, () => ({ kind: 'open' as const, at: ago(0) })), now).score;
  is('opens alone cannot make anybody hot', opens < 45, String(opens));
  is('a meeting not yet held does not count', engagementScore([{ kind: 'meeting', at: ago(-7) }], now).score === 0);
  is('past the window counts for nothing', engagementScore([{ kind: 'reply', at: ago(400) }], now).score === 0);
  const r = engagementScore([{ kind: 'reply', at: ago(2) }, { kind: 'open', at: ago(1) }, { kind: 'open', at: ago(3) }], now);
  const sum = r.factors.reduce((n, f) => n + f.points, 0);
  is('the parts add up to the score, within rounding', Math.abs(sum - r.score) <= 1, `${sum} vs ${r.score}`);
  is('the why reads like a sentence', /^1 reply \(\+\d+\), 2 opens \(\+\d+\)$/.test(describeEngagement(r.factors)), describeEngagement(r.factors));
  is('stored factors are counts', JSON.stringify(storedFactors(r)).includes('"replies":1'));
  is('only human opens and clicks are fetched', /\.in\('activity_type', \['opened', 'clicked'\]\)/.test(src('services/engagement.service.ts')));
}

console.log('\nno-show follow-up');
{
  const out = renderNoShowTemplate(DEFAULT_NO_SHOW_BODY, {
    first_name: '', meeting: 'Intro call', meeting_date: 'Monday', organiser: 'Maud', booking_link: 'https://x/b/maud',
  });
  is('a blank name takes the fallback', out.startsWith('Hi there,'), out.split('\n')[0]);
  is('the link and the organiser are filled in', out.includes('https://x/b/maud') && out.trim().endsWith('Maud'));
  is('a typo is left visible', renderNoShowTemplate('{{frist_name}}', {}) === '{{frist_name}}');
  is('and reported', unknownNoShowTags('Hi {{frist_name}} {{organiser}}').join() === 'frist_name');
  is('no_show is an allowed status in the migration', /'no_show'\)\)/.test(migration));
  is('the follow-up is claimed before it is sent',
    /\.is\('no_show_followup_sent_at', null\)/.test(src('services/no-show.service.ts')));
  is('and sent through the booking mail path', /bookingMail\.noShowFollowUp/.test(src('services/no-show.service.ts')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
