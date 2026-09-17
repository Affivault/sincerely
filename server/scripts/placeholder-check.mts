/* ═══════════════════════════════════════════════════════════════════════
   One cast of fictional people, and it is the one the previews use.

   Placeholder text had drifted into a crowd of invented brands and
   strangers - Yieldtrak, Northbeam, Thomas Vance, Jordan Ellis, John Doe -
   scattered across the forms with no relation to each other or to the
   sample data a preview actually renders. Somebody signing up on their
   first day reads "e.g. Thomas Vance - Growth, Yieldtrak" in the signature
   box and reasonably wonders who that is and why the product knows them.

   Northbeam was the worse half. It is a real company, and it appeared both
   as a form placeholder and on the landing page beside a fabricated line of
   dialogue attributed to a named person at it.

   This file is the fence. Every name a new user might read has to come from
   `PLACEHOLDER` in shared, which is built from the same constants the
   preview renderer fills merge tags with - so the name in the empty box is
   the name that shows up when the box is filled in.

   Run: npx tsx scripts/placeholder-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '../../client/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(CLIENT).map((f) => ({ path: relative(CLIENT, f), text: readFileSync(f, 'utf8') }));

/*
 * Names that must never reach a user again.
 *
 * Kept as a list of the actual offenders rather than a clever heuristic:
 * a regex for "looks like a brand" would either miss these or flag half the
 * copy in the app, and the point is to nail down the specific drift that
 * happened, not to police English.
 */
const BANNED = ['Yieldtrak', 'Northbeam', 'Thomas Vance', 'Jordan Ellis', 'John Doe', 'Sarah Chen'];

/*
 * `/lp2` is out of scope, and deliberately so.
 *
 * This check is about placeholders - the greyed-out example text in an
 * empty box, and the sample data a preview renders. LandingPageV2 carries
 * something different: three testimonials attributed to named people at
 * named companies, with specific figures ("2% to 14% reply rate", "98.7%
 * inbox rate"). None of them is real, and the route is live and public.
 *
 * Renaming those people to the sample cast would make this file pass while
 * leaving fabricated customer endorsements on a public marketing page -
 * laundering the problem rather than fixing it, and making it harder to
 * find next time. Whether to keep, cut or replace marketing copy is the
 * owner's call, not a lint rule's, so it is raised with them instead of
 * quietly rewritten here.
 */
const OUT_OF_SCOPE = ['pages/LandingPageV2.tsx'];

/** Strip comments — internal prose may reference whatever it likes. */
function userFacing(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

console.log('\nno invented brand reaches a new user');
for (const name of BANNED) {
  const hits = files
    .filter((f) => !OUT_OF_SCOPE.includes(f.path.replace(/\\/g, '/')))
    .filter((f) => userFacing(f.text).includes(name))
    .map((f) => f.path);
  is(`"${name}" appears in no user-facing string`, hits.length === 0, hits.join(', '));
}

console.log('\nthe placeholder cast is the preview cast');
{
  const shared = readFileSync(join(here, '../../shared/src/merge-tags.ts'), 'utf8');

  is('PLACEHOLDER is exported from shared', /export const PLACEHOLDER = \{/.test(shared));

  /*
   * The load-bearing property. If these were hand-typed copies rather than
   * derived, they would agree today and drift the first time anybody edited
   * the sample contact - which is exactly how the app ended up with five
   * different fictional companies.
   */
  const block = shared.slice(shared.indexOf('export const PLACEHOLDER = {'));
  const body = block.slice(0, block.indexOf('} as const;'));
  is('the contact fields are derived from the preview contact',
     /SAMPLE_PREVIEW_CONTACT\./.test(body), body);
  is('the sender fields are derived from the preview sender',
     /SAMPLE_PREVIEW_SENDER\./.test(body), body);
  is('nothing in it is a hand-typed person or company name',
     !/'(?!acme\.example\.com)[A-Z][a-z]+ [A-Z]/.test(body), body);
}

console.log('\nthe forms use it rather than their own inventions');
{
  /*
   * Checked per file because "it is imported somewhere" is not the same as
   * "this form uses it" - and these are the forms a new account meets in
   * its first ten minutes.
   */
  const wants = [
    'pages/smtp/SmtpAccountModal.tsx',
    'pages/settings/SettingsPage.tsx',
    'pages/crm/DealsPage.tsx',
    'pages/public/BookPage.tsx',
    'components/crm/CrmPrimitives.tsx',
    'pages/LandingPage.tsx',
  ];
  for (const want of wants) {
    const file = files.find((f) => f.path.replace(/\\/g, '/') === want);
    is(`${want} draws its names from shared`,
       !!file && /PLACEHOLDER\./.test(file.text),
       file ? 'imported but never used' : 'file not found');
  }
}

console.log('\nexample domains are the ones reserved for the purpose');
{
  /*
   * RFC 2606 reserves example.com/.net/.org and .example so that nobody has
   * to wonder whether a placeholder address belongs to a real person. An
   * address at a domain somebody owns is a mail-to link waiting to happen.
   */
  const shared = readFileSync(join(here, '../../shared/src/merge-tags.ts'), 'utf8');
  const block = shared.slice(shared.indexOf('export const SAMPLE_PREVIEW_CONTACT'));
  const addresses = Array.from(block.matchAll(/'[^']*@([^']+)'/g), (m) => m[1]);
  is('every sample address uses a reserved domain',
     addresses.length > 0 && addresses.every((d) => /(^|\.)example\.(com|net|org)$|\.example$/.test(d)),
     addresses.join(', '));
}

console.log('\nthe tracking domain tells you where to add the certificate');
{
  /*
   * The DNS record alone gets a name that resolves and a handshake that
   * fails: the certificate comes from the host, and no host issues one for a
   * domain it has not been told about. The copy used to say "add it to your
   * hosting provider" without saying where, which is a step nobody can
   * follow and the step everybody was stuck on.
   */
  const panel = files.find((f) => f.path.endsWith('TrackingDomainPanel.tsx'));
  const text = panel?.text || '';
  is('the panel exists to check', !!panel);
  is('the two steps are numbered', /Step 1/.test(text) && /Step 2/.test(text));
  is('it names where to go, not just "your hosting provider"',
     /Custom Domains/.test(text), 'the certificate step is still unactionable');
  is('and says why the DNS record alone is not enough',
     /will not issue one for a/.test(text));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} placeholder check(s) failed`);
