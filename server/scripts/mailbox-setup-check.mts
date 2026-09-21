/* ═══════════════════════════════════════════════════════════════════════
   Collapsing a form is only safe if nothing broken can hide behind it.

   The connect dialog was three tabs - Account, Server, Options - which put
   the two things you need in order to connect at all on two different
   panels: the password on the first, the host on the second. "Check
   connection" could therefore fail for a reason sitting somewhere you were
   not looking, announced by a 6px amber dot on a tab.

   Replacing tabs with collapsible sections is an improvement only under one
   rule, and this file exists to make that rule assertable rather than
   aspirational:

     A CLOSED SECTION NEVER HIDES SOMETHING MISSING OR WRONG.

   Every assertion below was run against the original code first. The ones
   about hiding were checked by planting the obvious wrong version - a
   summary that reads "ok" whenever a host exists, an open-set that is just
   ['mailbox'] - and confirming they fail.

   Run: npx tsx scripts/mailbox-setup-check.mts
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
const modal = readFileSync(join(here, '../../client/src/pages/smtp/SmtpAccountModal.tsx'), 'utf8');

const {
  missingFields, mailboxLabel, serverSummary, sendingSummary, limitAdvice, sectionsToOpen,
} = await import('@lemlist/shared');

/** A mailbox that is fully, correctly filled in. Each test breaks one thing. */
const whole = {
  email_address: 'invest@yieldstones.co.uk',
  smtp_pass: 'hunter2',
  smtp_host: 'mail.spacemail.com',
  smtp_port: 465,
  imap_host: 'mail.spacemail.com',
  imap_port: 993,
  saved: false,
};

console.log('\nwhat is still missing, as one list');
{
  is('a complete mailbox is missing nothing', missingFields(whole).length === 0,
     JSON.stringify(missingFields(whole)));

  const blank = missingFields({ saved: false });
  is('an empty form names all four gaps', blank.length === 4, JSON.stringify(blank));
  is('and in the order they are asked for',
     blank.map((m) => m.key).join(',') === 'email_address,smtp_pass,smtp_host,smtp_port',
     blank.map((m) => m.key).join(','));

  /*
   * The first entry is where the user gets sent, so the address has to come
   * first - it is the field that fills in three of the others by itself.
   */
  is('the address is the first thing asked for', blank[0].key === 'email_address');

  /*
   * A saved mailbox keeps its password server-side and the field is
   * deliberately blank. Demanding one here would make every edit - changing
   * a daily limit, adding an IMAP host - require retyping a credential the
   * user may not have to hand.
   */
  const saved = missingFields({ ...whole, smtp_pass: '', saved: true });
  is('an existing mailbox is not asked to retype its password',
     saved.length === 0, JSON.stringify(saved));
  is('but a new one is',
     missingFields({ ...whole, smtp_pass: '', saved: false }).some((m) => m.key === 'smtp_pass'));

  // Whitespace is not a value. " " in the host field produced a form that
  // passed its own checks and a connection to nowhere.
  is('a field holding only spaces counts as empty',
     missingFields({ ...whole, smtp_host: '   ' }).some((m) => m.key === 'smtp_host'));
  is('and a zero port does too',
     missingFields({ ...whole, smtp_port: 0 }).some((m) => m.key === 'smtp_port'));

  // Labels are how you say it in a sentence: "Add your password first".
  is('gaps are named in words, not field names',
     blank.every((m) => /^[a-z]/.test(m.label) && !m.label.includes('_')),
     JSON.stringify(blank.map((m) => m.label)));

  /*
   * There were two lists - missingForCheck and missingForSave, the second
   * being the first plus a label. Two definitions that agree until one is
   * edited is exactly the shape that let imapHostFor drift, where the thing
   * that TESTED a mailbox and the thing that USED it disagreed about which
   * server it was on.
   */
  is('there is one list, not one for checking and one for saving',
     !/(const|function)\s+missingFor(Check|Save)\b/.test(modal),
     'the form still keeps two lists of required fields');
  is('and both buttons consult it',
     /if \(missing\.length\) \{ jumpTo\(missing\); return; \}[\s\S]{0,400}if \(missing\.length\) \{ jumpTo\(missing\); return; \}/.test(modal),
     'checking and saving no longer ask the same question');
}

console.log('\na mailbox nobody named is called by its address');
{
  /*
   * "Label" blocked saving and nothing filled it for a custom domain, so
   * connecting a mailbox on your own domain ended at "Add your label first"
   * - asking somebody to invent a name for a thing that already has one.
   */
  is('a typed name is kept', mailboxLabel('Outreach', 'a@b.com') === 'Outreach');
  is('an empty one falls back to the address', mailboxLabel('', 'a@b.com') === 'a@b.com');
  is('as does a whitespace one', mailboxLabel('   ', 'a@b.com') === 'a@b.com');
  is('and it is no longer something that can block a save',
     !missingFields({ ...whole }).some((m) => m.key === 'label'));
  is('the form applies the fallback when saving',
     /label: mailboxLabel\(form\.label, form\.email_address\)/.test(modal),
     'an unnamed mailbox would still be saved with an empty label');
}

console.log('\nthe one-line summary never says fine when it is not');
{
  const ok = serverSummary(whole);
  is('a complete pair reads clean', ok.tone === 'ok', JSON.stringify(ok));
  is('and names both servers',
     ok.text.includes('mail.spacemail.com:465') && ok.text.includes('mail.spacemail.com:993'),
     ok.text);

  /*
   * The load-bearing one. A mailbox with no incoming server can send
   * perfectly and will never show you a single reply - and that is the
   * state three real mailboxes sat in while the list showed them Verified.
   * With the section shut, this sentence is the only thing saying so.
   */
  const noImap = serverSummary({ ...whole, imap_host: '' });
  is('no incoming server is a warning, not a clean line',
     noImap.tone === 'warning', JSON.stringify(noImap));
  is('and it says what that costs you',
     /replies will not reach your inbox/i.test(noImap.text), noImap.text);

  const none = serverSummary({ ...whole, smtp_host: '', imap_host: '' });
  is('no outgoing server at all reads as empty', none.tone === 'empty', JSON.stringify(none));
  is('and says the mailbox cannot send', /cannot send/i.test(none.text), none.text);

  // Nothing may be reported as fine while any of it is absent.
  for (const [what, facts] of [
    ['outgoing host', { ...whole, smtp_host: '' }],
    ['incoming host', { ...whole, imap_host: '' }],
    ['both', { ...whole, smtp_host: '', imap_host: '' }],
  ] as const) {
    is(`a missing ${what} can never read as ok`, serverSummary(facts).tone !== 'ok',
       JSON.stringify(serverSummary(facts)));
  }
}

console.log('\nand nothing missing is ever behind a closed header');
{
  const shutTight = sectionsToOpen(whole);
  is('a mailbox with everything known opens as one short panel',
     shutTight.join(',') === 'mailbox', shutTight.join(','));

  /*
   * This is the assertion that makes collapsing safe at all. Break any
   * required field and the section holding it must be open - otherwise the
   * redesign is strictly worse than the tabs, which at least looked like
   * somewhere to go.
   */
  for (const [what, facts, want] of [
    ['the outgoing host', { ...whole, smtp_host: '' }, 'servers'],
    ['the outgoing port', { ...whole, smtp_port: 0 }, 'servers'],
    ['the password', { ...whole, smtp_pass: '' }, 'mailbox'],
    ['the address', { ...whole, email_address: '' }, 'mailbox'],
    ['the incoming host', { ...whole, imap_host: '' }, 'servers'],
  ] as const) {
    is(`a mailbox with no ${what} opens the section holding it`,
       sectionsToOpen(facts).includes(want), sectionsToOpen(facts).join(','));
  }

  is('the mailbox section is always open — it is the whole job',
     sectionsToOpen({ saved: false }).includes('mailbox'));

  /*
   * Sending and signature have defaults that work, so they are never forced
   * open. An over-limit value is reported in the summary line instead,
   * which is the point of the summary line.
   */
  is('sending is never forced open, because its defaults are safe',
     !sectionsToOpen({ saved: false }).includes('sending'));

  is('sections come back in the order they are asked',
     sectionsToOpen({ saved: false }).join(',') === 'mailbox,servers',
     sectionsToOpen({ saved: false }).join(','));
}

console.log('\nthe form is sections, and a gap opens its own');
{
  is('the tabs are gone', !/TabId|setTab\(/.test(modal),
     'the form still navigates by tab');
  is('sections are decided by the values, not by a default',
     /setOpenSections\(sectionsToOpen\(/.test(modal),
     'the open set is hard-coded rather than derived from what is filled in');

  /*
   * jumpTo used to setTab(fields[0].tab) - one tab, the first gap's. A
   * second gap on another tab stayed hidden behind its dot.
   */
  const jump = modal.slice(modal.indexOf('const jumpTo ='), modal.indexOf('const handleCheck'));
  is('every section holding a gap is opened, not just the first',
     /for \(const f of fields\) reveal\(f\.section\)/.test(jump), jump);

  /*
   * Opening must be one-way while the dialog is up. A section that shuts
   * itself because a field it holds got filled takes the neighbouring
   * fields with it, mid-edit.
   */
  const revealFn = modal.slice(modal.indexOf('const reveal ='), modal.indexOf('const toggleSection'));
  is('revealing never closes anything',
     /prev\.includes\(id\) \? prev : \[\.\.\.prev, id\]/.test(revealFn), revealFn);

  is('a closed section still shows its summary', /data-section-summary/.test(modal));
  is('and the summary is hidden once the section is open',
     /!open && summary && \(/.test(modal),
     'the summary would be repeated above the fields it summarises');

  /*
   * A domain whose MX lookup finds no usable servers leaves fields the user
   * has to fill. Saying so while the panel holding them is shut is the
   * exact failure this redesign is meant to remove.
   */
  is('a domain we could not resolve opens the server fields',
     /if \(!hosts\?\.smtp\?\.host \|\| !hosts\?\.imap\?\.host\) reveal\('servers'\)/.test(modal),
     'the note would point at a closed panel');
  is('and so does a domain with no mail records at all',
     /no mail \(MX\) records[\s\S]{0,120}reveal\('servers'\)/.test(modal));

  /*
   * A blank new form has no servers because nobody has said which mailbox
   * it is yet - not because anything is wrong. Opening all three panels on
   * an empty form shows fields that are about to fill themselves in.
   */
  is('a blank new form still opens as one panel',
     /setOpenSections\(\['mailbox'\]\)/.test(modal));
}

console.log('\nthe missing-imap warning is where the empty field is');
{
  /*
   * The summary covers the closed case. Open, the summary is hidden by
   * design - so the warning has to exist a second time, next to the field,
   * or opening the section makes the problem disappear.
   */
  const group = modal.slice(modal.indexOf('title="Incoming"'), modal.indexOf('</Group>', modal.indexOf('title="Incoming"')));
  is('an empty incoming host warns in place, not only in the summary',
     /!\(form\.imap_host \|\| ''\)\.trim\(\) && \(/.test(group), group.slice(-400));
  is('and says the replies stay with the provider',
     /never see the replies/.test(group), group.slice(-400));
}

console.log('\na daily limit has guidance attached to it');
{
  /*
   * The field was a bare number input with nothing to say what a survivable
   * figure looks like. Volume is the easiest way to get a new domain
   * filtered and the form said nothing at all about it.
   */
  is('a sensible limit passes quietly', limitAdvice(200).tone === 'ok');
  is('and so does a conservative one', limitAdvice(40).tone === 'ok');
  is('zero is called out — it means nothing sends',
     limitAdvice(0).tone === 'danger' && /will not send/.test(limitAdvice(0).note));
  is('above 200 is a warning', limitAdvice(350).tone === 'warning', JSON.stringify(limitAdvice(350)));
  is('and it says to add a mailbox rather than raise this one',
     /Add another mailbox/.test(limitAdvice(350).note), limitAdvice(350).note);
  is('far past what survives is stronger than a warning',
     limitAdvice(2000).tone === 'danger', JSON.stringify(limitAdvice(2000)));
  is('the advice quotes the number back',
     limitAdvice(2000).note.includes('2000'), limitAdvice(2000).note);

  is('the form shows it rather than storing it',
     /data-limit-warning/.test(modal), 'the guidance is computed and never rendered');
  is('and a dangerous value is an error on the field itself',
     /error=\{limit\.tone === 'danger' \? limit\.note : undefined\}/.test(modal));
}

console.log('\nthe sending summary is honest with the section shut');
{
  const clean = sendingSummary({ daily_send_limit: 200, signature_html: '<p>Hi</p>', signature_auto: true });
  is('a normal setup reads clean', clean.tone === 'ok', JSON.stringify(clean));
  is('and says both things', /200 a day/.test(clean.text) && /automatically/.test(clean.text), clean.text);

  is('a signature that is only markup counts as none',
     /no signature/.test(sendingSummary({ daily_send_limit: 200, signature_html: '<p></p><br>' }).text));
  is('one that is not auto-applied says so',
     /available in the composer/.test(
       sendingSummary({ daily_send_limit: 200, signature_html: 'Steven', signature_auto: false }).text));

  // An over-limit mailbox must not read as fine just because the panel is shut.
  const hot = sendingSummary({ daily_send_limit: 900, signature_html: 'Steven' });
  is('an unsurvivable limit is a warning even collapsed', hot.tone === 'warning', JSON.stringify(hot));
  is('and the collapsed line carries the reason', /900/.test(hot.text), hot.text);
  is('a zero limit is not quietly clean',
     sendingSummary({ daily_send_limit: 0 }).tone === 'warning');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} mailbox setup check(s) failed`);
