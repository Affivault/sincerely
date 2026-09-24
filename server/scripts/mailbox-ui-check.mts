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

console.log('\nthe readiness verdict reads like a sentence somebody wrote');
{
  const svc = readFileSync(join(here, '../src/services/readiness.service.ts'), 'utf8');
  const panel = readFileSync(join(here, '../../client/src/components/delivery/ReadinessPanel.tsx'), 'utf8');

  /*
   * The screenshot said: "You can send, but link tracking domain will cost
   * you deliverability." No article, because the check's label was slotted
   * straight into a template - which is exactly what makes copy read as
   * generated rather than written.
   */
  is('the risky sentence has its article',
     /but your \$\{warned\[0\]\.label\.toLowerCase\(\)\}/.test(svc),
     'a label is still being slotted in bare');

  // "1 of 8 checks need attention" - the verb did not agree either.
  is('the count agrees with its verb',
     /need\{problems === 1 \? 's' : ''\} attention/.test(panel),
     'the header still says "1 ... need attention"');
  is('and so does its noun',
     /check\{problems === 1 \? '' : 's'\}/.test(panel));

  is('the verdict is not shouted in capitals',
     !/uppercase tracking-wider', v\.chip/.test(panel),
     'SEND WITH CARE is still a hazard placard');
}

console.log('\nan absence of evidence is not a pass');
{
  const svc = readFileSync(join(here, '../src/services/readiness.service.ts'), 'utf8');
  const { worseStatus } = await import('@lemlist/shared');

  /*
   * "Nothing sent yet - no bounce history to judge" carried a green tick,
   * which is the same mistake as a 100% health score on a mailbox that has
   * never sent: reassurance manufactured out of nothing.
   */
  const bounce = svc.slice(svc.indexOf('function bounceRateCheck'));
  is('no send history reports as unknown, not pass',
     /label: 'Bounce rate', status: 'unknown'/.test(bounce),
     'a green tick is still claiming an untested clean record');

  /*
   * The invariant is about the VERDICT, not about which of two equal-rank
   * strings the reducer happens to return. An earlier version of this
   * asserted worseStatus('unknown','pass') === 'pass' and failed against
   * correct code, because ties return the left-hand side - which changes
   * nothing, since the verdict only looks for 'warn' and 'fail'.
   */
  const verdictOf = (worst: string) => worst === 'fail' ? 'blocked' : worst === 'warn' ? 'risky' : 'ready';
  is('a report of passes and unmeasured checks is still ready',
     verdictOf(['pass', 'unknown', 'pass'].reduce((a, b) => worseStatus(a as any, b as any), 'pass')) === 'ready');
  is('an unmeasured check cannot mask a real failure',
     verdictOf(['pass', 'unknown', 'fail'].reduce((a, b) => worseStatus(a as any, b as any), 'pass')) === 'blocked');
  is('nor a warning',
     verdictOf(['unknown', 'warn'].reduce((a, b) => worseStatus(a as any, b as any), 'pass')) === 'risky');
}

console.log('\nthe page shows what needs you, not all eight checks');
{
  const panel = readFileSync(join(here, '../../client/src/components/delivery/ReadinessPanel.tsx'), 'utf8');

  /*
   * Four cards, one per editorial group, listing every check at equal
   * weight - so the single thing that wanted doing sat fifth of eight,
   * styled identically to seven that did not, under headings nobody
   * navigates by. Roughly a thousand pixels to say "one thing".
   */
  is('the four group cards are gone', !/GROUP_ORDER\.map/.test(panel),
     'the evidence is still rendered as four equal-weight cards');
  is('warnings and failures are listed first',
     /const attention = report\.checks\.filter/.test(panel));
  is('the settled ones are collapsed behind one line',
     /data-show-settled/.test(panel));
  is('and that line counts them honestly, separating the unmeasured',
     /not measured yet/.test(panel));
  is('unknown has a colourless marker rather than a tick',
     /unknown: \{[\s\S]{0,200}Icon: Minus/.test(panel),
     'not-measured still wears a status colour');
}

console.log('\nconnecting is one step that tests, and a pass is remembered');
{
  const svc = readFileSync(join(here, '../src/services/smtp.service.ts'), 'utf8');
  const ctl = readFileSync(join(here, '../src/controllers/smtp.controller.ts'), 'utf8');
  const modal = readFileSync(join(here, '../../client/src/pages/smtp/SmtpAccountModal.tsx'), 'utf8');

  /*
   * The form said "Connection verified", then saved the mailbox unverified,
   * so it arrived in the list as "Not verified - Test it now". And nothing
   * stopped a mailbox that could not send from being saved at all.
   */
  is('create can test before saving', /async create\(userId: string, input: any, opts: \{ verify\?: boolean \}/.test(svc));
  is('a failed test saves nothing and says why', /'verify_failed', \{ verification \}/.test(svc));
  is('a passed test is saved verified, by the server', /verification\?\.success \? \{ is_verified: true \} : \{\}/.test(svc));
  is('verified is never taken from the request body', !/'is_verified'/.test(svc.slice(svc.indexOf('const SMTP_ACCOUNT_FIELDS'), svc.indexOf('] as const;'))));
  is('the endpoint takes the verify flag', /req\.query\.verify === '1'/.test(ctl));
  is('the wizard connects through it', /smtpApi\.create\([\s\S]{0,160}\{ verify: verified \}\)/.test(modal));
  is('the same address cannot be connected twice', /is already connected/.test(svc));

  // Migration 023 added the columns; the allow-list never did, so every
  // signature was dropped on save.
  is('a signature is saved', /'signature_html', 'signature_auto'/.test(svc));
}

console.log('\nthe right kind of password, explained where it is typed');
{
  const { providerGuide, PROVIDER_GUIDES, isSendOnlyProvider } = await import('@lemlist/shared');
  is('Gmail says it wants an app password', /app password/i.test(providerGuide('Gmail').secret));
  is('and links to where to make one', /myaccount\.google\.com\/apppasswords/.test(providerGuide('Gmail').link?.url || ''));
  is('Microsoft 365 warns that SMTP sign-in is off by default', /off by default/i.test(providerGuide('Outlook / Microsoft 365').gotcha || ''));
  is('an unknown provider still gets guidance', providerGuide('Nope').steps.length > 0);
  is('every guide has steps', Object.values(PROVIDER_GUIDES).every((g: any) => g.steps.length > 0));
  is('relays are known to have no inbox', isSendOnlyProvider('SendGrid') && !isSendOnlyProvider('Gmail'));
}

console.log('\na new mailbox never starts at a limit the form calls dangerous');
{
  const modal = readFileSync(join(here, '../../client/src/pages/smtp/SmtpAccountModal.tsx'), 'utf8');
  is('the starting limit is capped', /Math\.min\(preset\.recommended_daily_limit \|\| 200, 200\)/.test(modal));
  is('and no preset bypasses the cap', !/daily_send_limit: (preset|detected)\.recommended_daily_limit/.test(modal));
}

console.log('\na mailbox is opened, not re-set-up, to be checked');
{
  const ui = readFileSync(join(here, '../../client/src/components/delivery/MailboxList.tsx'), 'utf8');
  const page = readFileSync(join(here, '../../client/src/pages/smtp/EmailAccountsPage.tsx'), 'utf8');
  is('a row opens the mailbox panel', /onClick=\{onOpen\}/.test(ui));
  is('the panel is linkable', /searchParams\.get\('mailbox'\)/.test(page) && /<MailboxDrawer/.test(page));
  // The repair corrects hosts that do not exist; it cannot invent one never set.
  is('no incoming server opens the settings, not the repair',
     /state\.action === 'set-imap'\s*\?\s*\{ label: 'Add incoming server', run: onEdit/.test(ui));
  is('the connect wizard is linkable', /searchParams\.get\('connect'\)/.test(page));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} mailbox UI check(s) failed`);
