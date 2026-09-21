/* ═══════════════════════════════════════════════════════════════════════
   One definition per idea.

   The most expensive bug of this whole effort was two functions called
   imapHostFor in two services. They agreed for months, then one of them
   was taught to read the imap_host column and the other was not - so the
   thing that TESTED a mailbox and the thing that USED it disagreed about
   which server it was on, and three mailboxes reported "Verified" while
   none of them could read a reply.

   Duplicates that agree are not safe. They are the state immediately
   before the bug.

   This is the fence. It fails on a second copy of any name it knows to be
   load-bearing, and the list grows whenever another one is found.

   Run: npx tsx scripts/no-duplicate-definitions.mts
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
const ROOT = join(here, '../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = walk(ROOT).map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, 'utf8') }));

/** Where each top-level function of this name is declared. */
function declaredIn(name: string): string[] {
  const pattern = new RegExp(`^(?:export )?(?:async )?function ${name}\\b`, 'm');
  return files.filter((f) => pattern.test(f.text)).map((f) => f.path);
}

/*
 * Names that decide something the rest of the system depends on. A second
 * copy of any of these is a disagreement waiting to be written.
 */
const SINGLE: Array<{ name: string; why: string }> = [
  { name: 'imapHostFor', why: 'two of these disagreed about which server a mailbox lives on' },
  { name: 'dohQuery', why: 'one copy learned nxdomain-vs-nodata and the other did not' },
  { name: 'resolveDetailed', why: 'the DKIM probe and the repair safety rule both read its status' },
  { name: 'sendable', why: 'three copies of "can this mailbox send", agreeing until one is edited' },
  { name: 'isSenderMismatch', why: 'the form, the sync guard and the repair must agree exactly' },
  { name: 'resolveMailboxState', why: 'one status per mailbox means one function deciding it' },
  { name: 'missingFields', why: 'the connect form had one list for testing and another for saving' },
  { name: 'serverSummary', why: 'the line shown with a section shut must match what opens it' },
  { name: 'sectionsToOpen', why: 'what starts open is the only thing keeping a gap visible' },
  { name: 'rateReadout', why: 'one rule about when a percentage has earned the right to be one' },
  { name: 'setupNudge', why: 'the sidebar and the dashboard must agree about the same account' },
  { name: 'stepHasVariantB', why: 'the sender and the report disagreed about what an A/B test is' },
  { name: 'assignVariant', why: 'two ways of picking an arm would split the same contact both ways' },
  { name: 'abStatusLine', why: 'the campaign page and the panel must describe one test the same way' },
  { name: 'placementSummary', why: 'one set of rules about when placement may be reported as a rate' },
  { name: 'classifyFolder', why: 'inbox-versus-spam decided twice is a report that disagrees with itself' },
];

console.log('\nnothing load-bearing is defined twice');
for (const { name, why } of SINGLE) {
  const where = declaredIn(name);
  is(`${name} is defined at most once — ${why}`,
     where.length <= 1,
     `declared in: ${where.join(', ')}`);
}

console.log('\nand the warm-up copy of imapHostFor really is gone');
{
  // Warm-up honoured imap_host all along while the sync did not. Both now
  // go through the one in inbox-sync.
  const warmup = files.find((f) => f.path.endsWith('warmup.service.ts'));
  is('warm-up no longer carries its own',
     !!warmup && !/function imapHostFor/.test(warmup.text),
     'warm-up still decides for itself which server a mailbox is on');
  is('and gets the answer from the sync',
     !!warmup && /imapHostFor as syncImapHostFor/.test(warmup.text),
     'warm-up is not importing the one definition');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} duplicate-definition check(s) failed`);
