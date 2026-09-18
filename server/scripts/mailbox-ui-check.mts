/* ═══════════════════════════════════════════════════════════════════════
   One honest status per mailbox.

   The list this replaces answered "is this mailbox working?" six times per
   row - a coloured dot, "Authenticated", "Verified", "Warming", "100%" and
   a sends counter - and got it wrong. Three mailboxes on one domain showed
   green Verified, green Authenticated and a confident 100% deliverability
   while none of them could read a reply and one could not send at all.

   Six indicators that can all be green while the thing is broken are not
   six indicators. They are decoration.

   The fixtures below are those three mailboxes, in the states the
   screenshots showed them in.

   Run: npx tsx scripts/mailbox-ui-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const { resolveMailboxState, mailboxScore } = await import('@lemlist/shared');

/** A mailbox with nothing wrong with it, to vary one fact at a time from. */
const healthy = {
  is_active: true,
  is_verified: true,
  imap_host: 'mail.spacemail.com',
  sync_error: null,
  domain_verified: true,
  domain_known: true,
  warmup_mode: false,
};

console.log('\nthe three mailboxes from the screenshot');
{
  /*
   * invest@ - sending refused (553, wrong login) and reading the wrong
   * inbox. The old row: Authenticated, Verified, Warming, 100%.
   */
  const invest = resolveMailboxState({
    ...healthy,
    warmup_mode: true,
    sync_error: 'This mailbox is set to sign in as acquisitions@yieldstones.co.uk, so syncing it would read acquisitions@yieldstones.co.uk’s inbox instead of its own.',
  });
  is('a mailbox reading the wrong inbox reads as broken', invest.tone === 'broken', invest.tone);
  is('and says so first, not "Warming"', invest.label === 'Not receiving', invest.label);
  is('carrying the reason, not a colour', invest.detail.includes('sign in as acquisitions'), invest.detail);
  is('and offering the thing that fixes it', invest.action === 'fix-connection', String(invest.action));

  // acquisitions@ - no mailbox server at all, so replies never arrive.
  const acquisitions = resolveMailboxState({ ...healthy, warmup_mode: true, imap_host: null });
  is('no mailbox server reads as send-only', acquisitions.label === 'Send only', acquisitions.label);
  is('not as ready', acquisitions.tone === 'warning', acquisitions.tone);
  is('and it explains what that costs',
     /replies will not reach/.test(acquisitions.detail), acquisitions.detail);

  // scott@ - the one that was genuinely fine.
  const scott = resolveMailboxState({ ...healthy, warmup_mode: true });
  is('a working mailbox is quiet', scott.tone === 'ready', scott.tone);
  is('and warming is a state, not a warning', scott.label === 'Warming up', scott.label);
  is('with no action demanded of anybody', scott.action === null, String(scott.action));
}

console.log('\nthe order is what stops you first');
{
  /*
   * Every one of these is wrong at once. The point of a single status is
   * that it has to choose, and choosing badly is how "Warming" ended up
   * being the loudest thing on a mailbox that could not send.
   */
  const everything = resolveMailboxState({
    is_active: true,
    is_verified: false,
    imap_host: null,
    sync_error: 'The IMAP host could not be found.',
    domain_verified: false,
    domain_known: false,
    warmup_mode: true,
  });
  is('an observed failure outranks every stored flag',
     everything.label === 'Not receiving', everything.label);

  const untested = resolveMailboxState({ ...healthy, is_verified: false, imap_host: null, domain_verified: false });
  is('an untested mailbox is named before its gaps',
     untested.label === 'Not tested', untested.label);

  const sendOnly = resolveMailboxState({ ...healthy, imap_host: null, domain_verified: false });
  is('receiving outranks the domain - a reply you never see is gone',
     sendOnly.label === 'Send only', sendOnly.label);

  const noDomain = resolveMailboxState({ ...healthy, domain_verified: false, domain_known: false });
  is('and the domain outranks warm-up, which is a choice',
     noDomain.label === 'Domain not added', noDomain.label);
  is('a known but unverified domain says so distinctly',
     resolveMailboxState({ ...healthy, domain_verified: false, domain_known: true }).label === 'Domain unverified');
}

console.log('\na repair note is news, not a fault');
{
  const repaired = resolveMailboxState({
    ...healthy,
    sync_error: 'Fixed automatically: "imap.yieldstones.co.uk" does not exist in DNS.',
  });
  is('a mailbox that was just fixed is not shown as broken', repaired.tone === 'ready', repaired.tone);
}

console.log('\na paused mailbox is not a broken one');
{
  const paused = resolveMailboxState({ ...healthy, is_active: false, is_verified: false, imap_host: null });
  is('switched off reads as paused', paused.label === 'Paused', paused.label);
  is('quietly, with nothing to fix', paused.tone === 'idle' && paused.action === null);
}

console.log('\na score nobody has earned is not shown');
{
  /*
   * health_score starts at 100 and only moves on a bounce, so a mailbox
   * that has never sent anything displayed a confident green 100% in the
   * largest type in the row - a number with no evidence behind it.
   */
  is('a mailbox that has never sent has no score',
     mailboxScore({ health_score: 100, total_sent: 0 }) === null);
  is('one that has sent keeps its score',
     mailboxScore({ health_score: 92, total_sent: 340 }) === 92);
  is('including a bad one', mailboxScore({ health_score: 41, total_sent: 12 }) === 41);
}

console.log('\nthe list shows one status, and the row acts on it');
{
  const ui = readFileSync(join(here, '../../client/src/components/delivery/MailboxList.tsx'), 'utf8');

  is('the row derives its state from the shared resolver',
     /resolveMailboxState\(\{/.test(ui), 'the row is deciding for itself again');
  is('and the score through the guard, not straight off the record',
     /mailboxScore\(account\)/.test(ui) && !/account\.health_score\}%/.test(ui),
     'a raw health_score is being printed');

  /*
   * The old row hid three unlabelled 28px icons behind a hover, which is
   * unusable on a touchscreen and invisible to anyone scanning. One
   * labelled button, and only the one the state calls for.
   */
  is('the remedy button is driven by the state’s action',
     /state\.action === 'fix-connection'/.test(ui) && /data-remedy/.test(ui));
  is('and there is no hover-to-reveal action cluster',
     !/opacity-60 group-hover:opacity-100/.test(ui),
     'actions are still hidden until hover');

  // Broken rows first: a list ordered by creation date buries the one row
  // that needs a person underneath the ones that do not.
  is('rows needing attention sort to the top',
     /rank\[sa\.tone\] - rank\[sb\.tone\]/.test(ui));
  is('and the header says how many, in one sentence',
     /need\{needsAttention === 1 \? 's' : ''\} attention/.test(ui));
}

console.log('\nthe page no longer leads with a settings panel');
{
  const page = readFileSync(join(here, '../../client/src/pages/smtp/EmailAccountsPage.tsx'), 'utf8');

  /*
   * A 1m/3m/6m preference had the most valuable space on the screen, above
   * the list of mailboxes it configures, and repeated itself per row. It
   * belongs to a mailbox, so it now lives inside one.
   */
  is('the history panel is gone from above the list',
     !/<MailHistoryPanel \/>/.test(page), 'settings still sit above the content');
  is('the seven-column table is gone', !/min-w-\[880px\]/.test(page),
     'the list still needs a horizontal scrollbar for three mailboxes');
  is('the list is the new one', /<MailboxList/.test(page));
  is('and search only appears once it earns its place',
     /list\.length > 8 &&/.test(page), 'a filter box above three rows is chrome');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} mailbox UI check(s) failed`);
