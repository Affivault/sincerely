/*
 * Finding DKIM, and being honest when we cannot.
 *
 * The thing worth understanding before reading any of this: DNS offers no
 * way to ask which DKIM selectors a domain has. There is no listing, no
 * wildcard, no enumeration. A key lives at <selector>._domainkey.<domain>
 * and you can only look up a name you already know.
 *
 * So the check GUESSES. That is fine, and for Google and Microsoft it works
 * every time. What is not fine is reporting a guess that missed as though
 * it were an absence - telling somebody with perfectly good DKIM that they
 * have none, and giving them no way to correct it.
 *
 * Half the assertions here are about finding it. The other half are about
 * what is said when it is not found, which is the half that was wrong.
 */
import assert from 'node:assert';

process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

/** A fake zone. Everything not in here does not exist. */
let ZONE: Record<string, { type: string; data: string }[]> = {};
let queried: string[] = [];

const TYPE_NUM: Record<string, number> = { A: 1, CNAME: 5, MX: 15, TXT: 16 };

/*
 * Set when the zone under test answers NOERROR for names that are not in
 * it - a wildcard, or a provider that never says NXDOMAIN. Real zones do
 * this, and it is what makes the presence probe untrustworthy, so it has to
 * be simulable here.
 */
let ALWAYS_NOERROR = false;

/**
 * A name EXISTS if it has records of any type, or if anything lives below
 * it - an empty non-terminal. Modelling this is not decoration: it is the
 * exact distinction the DKIM presence probe reads, and a stub that answered
 * NXDOMAIN for every recordless name would have made the probe look broken
 * while the real thing worked.
 */
const nameExists = (name: string) =>
  ZONE[name] !== undefined || Object.keys(ZONE).some((k) => k.endsWith(`.${name}`));

(globalThis as any).fetch = async (url: string) => {
  const u = new URL(String(url));
  const name = (u.searchParams.get('name') || '').toLowerCase();
  const type = u.searchParams.get('type') || 'TXT';
  queried.push(`${type} ${name}`);
  const records = (ZONE[name] || []).filter((r) => r.type === type);
  const exists = ALWAYS_NOERROR || nameExists(name);
  return new Response(JSON.stringify({
    // NOERROR with no answers is NODATA: the name is there, this type is not.
    Status: records.length > 0 || exists ? 0 : 3,
    Answer: records.map((r) => ({ type: TYPE_NUM[r.type], data: r.data })),
  }), { status: 200, headers: { 'content-type': 'application/dns-json' } });
};

let saved: any = null;
let domainRow: any = null;
const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = () => {
  const chain: any = {
    select: () => chain, eq: () => chain,
    update: (patch: any) => { saved = patch; return chain; },
    single: async () => ({ data: domainRow ? { ...domainRow, ...(saved || {}) } : null, error: null }),
    maybeSingle: async () => ({ data: domainRow, error: null }),
  };
  return chain;
};

const { domainService } = await import('../src/services/domain.service.js');

const base = (domain: string) => ({
  [domain]: [{ type: 'TXT', data: '"v=spf1 include:_spf.google.com ~all"' }],
});
const KEY = '"v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ"';

function domain(row: Partial<any> = {}) {
  domainRow = {
    id: 'd1', user_id: 'u1', domain: 'northbeam.io',
    verification_token: 'sincerely-verify=abc',
    dkim_selector: null, dkim_selector_source: null,
    ...row,
  };
  saved = null;
  queried = [];
  ALWAYS_NOERROR = false;
}

console.log('a selector on the guess list is found');
{
  ZONE = { ...base('northbeam.io'), 'google._domainkey.northbeam.io': [{ type: 'TXT', data: KEY }] };
  domain();
  const { dns } = await domainService.verify('u1', 'd1');
  is('DKIM is found', dns.dkim.found === true, dns.dkim.note);
  is('and names the selector', dns.dkim.selector === 'google', String(dns.dkim.selector));
  is('and it is remembered for next time',
     saved?.dkim_selector === 'google', JSON.stringify(saved?.dkim_selector));
  is('marked as our own finding, not a statement by a person',
     saved?.dkim_selector_source === 'detected', String(saved?.dkim_selector_source));
}

console.log('\nselectors the old list missed are found now');
{
  // Every one of these is a real provider's default that the previous
  // eight-name list did not contain.
  for (const selector of ['zoho', 'postmark', 'mailjet', 'klaviyo', 'titan1', 'brevo', 'sendgrid']) {
    ZONE = { ...base('northbeam.io'), [`${selector}._domainkey.northbeam.io`]: [{ type: 'TXT', data: KEY }] };
    domain();
    const { dns } = await domainService.verify('u1', 'd1');
    is(`"${selector}" is found`, dns.dkim.found === true && dns.dkim.selector === selector,
       `${dns.dkim.found} / ${dns.dkim.selector}`);
  }
}

console.log('\nA MISS IS NOT AN ABSENCE, AND MUST NOT CLAIM TO BE');
{
  // Amazon SES publishes three CNAMEs at random 32-character tokens. No
  // guess list can ever contain them; this domain HAS working DKIM.
  ZONE = {
    ...base('northbeam.io'),
    'l7ntpqhfhkfqf7bzvphxbqk4fvzqk5ya._domainkey.northbeam.io': [
      { type: 'CNAME', data: 'l7ntpqhfhkfqf7bzvphxbqk4fvzqk5ya.dkim.amazonses.com' },
    ],
  };
  domain();
  const { dns } = await domainService.verify('u1', 'd1');

  is('it is honestly not found', dns.dkim.found === false);
  /*
   * The sentence that was wrong. "No DKIM record found" told this account
   * its working setup was broken. It must say what actually happened.
   */
  is('the note does NOT claim there is no DKIM',
     !/no dkim record found/i.test(dns.dkim.note), dns.dkim.note);
  is('it says guessing is what failed',
     /guess/i.test(dns.dkim.note), dns.dkim.note);
  is('and offers the way out',
     /selector/i.test(dns.dkim.note), dns.dkim.note);
  is('reporting how many names were tried',
     (dns.dkim.checked_selectors || 0) > 20, String(dns.dkim.checked_selectors));
  is('and nothing is remembered from a miss',
     saved?.dkim_selector === undefined, JSON.stringify(saved?.dkim_selector));
}

console.log('\ntelling us the selector is the way out, and it works');
{
  const SES = 'l7ntpqhfhkfqf7bzvphxbqk4fvzqk5ya';
  ZONE = {
    ...base('northbeam.io'),
    [`${SES}._domainkey.northbeam.io`]: [
      { type: 'CNAME', data: `${SES}.dkim.amazonses.com` },
    ],
  };
  domain();
  const { dns } = await domainService.setDkimSelector('u1', 'd1', SES);

  is('the unguessable selector is found once given',
     dns.dkim.found === true, dns.dkim.note);
  is('named correctly', dns.dkim.selector === SES, String(dns.dkim.selector));
  is('stored as a statement by a person',
     saved?.dkim_selector === SES && saved?.dkim_selector_source === 'manual',
     JSON.stringify([saved?.dkim_selector, saved?.dkim_selector_source]));
  is('and the domain now counts as DKIM-ready', saved?.dkim_ok === true);
}

console.log('\nwhat somebody actually pastes');
{
  ZONE = { ...base('northbeam.io'), 'hs1-4021._domainkey.northbeam.io': [{ type: 'TXT', data: KEY }] };
  // People paste the whole host, because that is what their DNS panel shows.
  domain();
  const a = await domainService.setDkimSelector('u1', 'd1', 'hs1-4021._domainkey');
  is('a pasted "<selector>._domainkey" is understood', a.dns.dkim.found === true, a.dns.dkim.note);

  domain();
  const b = await domainService.setDkimSelector('u1', 'd1', 'hs1-4021._domainkey.northbeam.io');
  is('so is the full host', b.dns.dkim.found === true, b.dns.dkim.note);

  domain();
  const c = await domainService.setDkimSelector('u1', 'd1', '  hs1-4021  ');
  is('and stray whitespace', c.dns.dkim.found === true, c.dns.dkim.note);

  domain();
  ZONE = { ...base('northbeam.io') };
  const bad = await domainService.setDkimSelector('u1', 'd1', 'not a selector!').then(() => null, (e) => e);
  is('nonsense is refused with a sentence that explains the shape',
     !!bad && /before ._?domainkey/i.test(bad.message || ''), bad?.message);
}

console.log('\na wrong selector says so, rather than blaming DKIM');
{
  ZONE = { ...base('northbeam.io'), 'google._domainkey.northbeam.io': [{ type: 'TXT', data: KEY }] };
  domain();
  const { dns } = await domainService.setDkimSelector('u1', 'd1', 'wrongname');
  /*
   * The domain DOES have DKIM, so saying it does not would be its own lie.
   * What must not happen is the wrong name being silently accepted: it would
   * be tried first on every future check and shown back as confirmed.
   */
  is('DKIM is still reported as working, because it is', dns.dkim.found === true);
  is('but the note says their name resolves to nothing',
     dns.dkim.note.includes('Nothing at "wrongname._domainkey.northbeam.io"'), dns.dkim.note);
  is('and names the one that does work',
     dns.dkim.note.includes('google'), dns.dkim.note);
  is('the dead name is NOT stored',
     saved?.dkim_selector === 'google', String(saved?.dkim_selector));
  is('nor claimed as a statement by a person',
     saved?.dkim_selector_source === 'detected', String(saved?.dkim_selector_source));
}

console.log('\na known selector is tried first, and clearing goes back to guessing');
{
  ZONE = { ...base('northbeam.io'), 'custom9._domainkey.northbeam.io': [{ type: 'TXT', data: KEY }] };
  domain({ dkim_selector: 'custom9', dkim_selector_source: 'manual' });
  const { dns } = await domainService.verify('u1', 'd1');
  is('a stored selector is used on a plain re-check', dns.dkim.selector === 'custom9');
  // The presence probe asks about bare _domainkey before any selector, so
  // this looks for the first SELECTOR lookup rather than the first lookup.
  is('and it was the first selector looked up',
     queried.find((q) => /[a-z0-9]\._domainkey/.test(q))?.includes('custom9') === true,
     queried.filter((q) => q.includes('_domainkey')).slice(0, 3).join(' | '));
  is('a manual selector is never overwritten by a guess',
     saved?.dkim_selector === undefined, JSON.stringify(saved?.dkim_selector));

  domain({ dkim_selector: 'custom9', dkim_selector_source: 'manual' });
  await domainService.setDkimSelector('u1', 'd1', '');
  is('clearing it returns to guessing',
     saved?.dkim_selector === null && saved?.dkim_selector_source === null,
     JSON.stringify([saved?.dkim_selector, saved?.dkim_selector_source]));
}

/*
 * The registrar-bundled mailbox providers.
 *
 * This section is a real domain, copied from the live zone that exposed the
 * gap: MX on spacemail.com, SPF include:spf.spacemail.com, and a perfectly
 * good key at spacemail._domainkey. Nothing knew that mx1.spacemail.com
 * meant Spacemail, and "spacemail" was not on the guess list, so a working
 * setup was reported as having no DKIM. None of these providers is a
 * household name and between them they are what a great many small domains
 * send from, which is exactly this product's population.
 */
console.log('a registrar-bundled provider is recognised and its selector found');
{
  ZONE = {
    'yieldstones.co.uk': [
      { type: 'TXT', data: '"v=spf1 include:spf.spacemail.com ~all"' },
      { type: 'TXT', data: '"sincerely-verify=abc"' },
    ],
    'spacemail._domainkey.yieldstones.co.uk': [{ type: 'TXT', data: KEY }],
  };
  ZONE['yieldstones.co.uk'].push({ type: 'MX', data: '0 mx1.spacemail.com.' });
  domain({ domain: 'yieldstones.co.uk' });
  const { dns } = await domainService.verify('u1', 'd1');

  is('the provider is identified from its MX', dns.provider_hint === 'Spacemail', String(dns.provider_hint));
  is('the SPF include is credited to it', dns.spf.includes_provider === true);
  is('and the selector is found without anybody typing it',
     dns.dkim.found === true && dns.dkim.selector === 'spacemail',
     `${dns.dkim.selector} / ${dns.dkim.note}`);
}

console.log('the signing provider is found even when the MX is somebody else');
{
  /*
   * Receiving on Google, signing with IONOS - a half-finished migration,
   * and the ordinary shape of any domain whose mailboxes and whose sending
   * are different companies. Provider detection reads MX, which is about
   * INBOUND mail, so it says Google and offers "google". The record that
   * matters is IONOS's, and the SPF line names it in plain sight.
   *
   * "ionos1" is deliberately not on the generic fallback list, so this
   * assertion can only pass by way of the SPF includes.
   */
  ZONE = {
    'northbeam.io': [
      { type: 'TXT', data: '"v=spf1 include:_spf.google.com include:_spf-eu.ionos.com ~all"' },
      { type: 'MX', data: '1 aspmx.l.google.com.' },
    ],
    'ionos1._domainkey.northbeam.io': [{ type: 'TXT', data: KEY }],
  };
  domain();
  const { dns } = await domainService.verify('u1', 'd1');

  is('MX still reports the mailbox provider', dns.provider_hint === 'Google Workspace', String(dns.provider_hint));
  is('but the SPF include supplies the signer’s selectors too',
     dns.dkim.found === true && dns.dkim.selector === 'ionos1',
     `${dns.dkim.selector} / ${dns.dkim.note}`);
}

/*
 * Whether DKIM exists AT ALL is a different question from what it is
 * called, and unlike the second one, DNS will answer it.
 *
 * Every key lives under _domainkey.<domain>. A name with children exists
 * even when it holds no records of its own, and a resolver reports that
 * (NOERROR, no answers) differently from a name that is not in the zone
 * (NXDOMAIN). So a miss can be told apart from an absence, which is the
 * thing guessing could never do.
 */
console.log('an unguessable selector is still proved to exist');
{
  // A selector no list would ever contain - the shape Amazon SES uses.
  ZONE = {
    ...base('northbeam.io'),
    'gk7xq2mzld4vp9rnw3tc6fh8sjy5abke._domainkey.northbeam.io': [{ type: 'TXT', data: KEY }],
  };
  domain();
  const { dns } = await domainService.verify('u1', 'd1');

  is('guessing does not find it, because it cannot', dns.dkim.found === false, dns.dkim.note);
  is('but the keys are proved to be there', dns.dkim.subtree === 'present', String(dns.dkim.subtree));
  is('and the wording says so rather than implying absence',
     /does have DKIM keys published/.test(dns.dkim.note), dns.dkim.note);
  is('it still asks for the selector, which is the only missing thing',
     /enter it below|enter your selector/i.test(dns.dkim.note), dns.dkim.note);
}

console.log('a domain with genuinely no DKIM is told so plainly');
{
  ZONE = { ...base('northbeam.io') };
  domain();
  const { dns } = await domainService.verify('u1', 'd1');

  is('the subtree is reported absent', dns.dkim.subtree === 'absent', String(dns.dkim.subtree));
  is('and this time we do say there is none',
     /No DKIM is published/.test(dns.dkim.note), dns.dkim.note);

  /*
   * Nothing lives under _domainkey, so every selector guess is a foregone
   * miss. Spending 35 lookups proving that is waste.
   */
  is('and no selector guesses were spent looking for it',
     queried.filter((q) => /[a-z0-9]\._domainkey/.test(q)).length === 0,
     queried.filter((q) => q.includes('_domainkey')).join(' | '));
}

console.log('a zone that never says NXDOMAIN is not guessed about');
{
  /*
   * The failure that matters. A wildcard makes every name look present,
   * including _domainkey - so the probe would cheerfully report DKIM keys
   * on a domain that has none. It must refuse to answer instead.
   */
  ZONE = { ...base('northbeam.io') };
  domain();
  ALWAYS_NOERROR = true;
  const { dns } = await domainService.verify('u1', 'd1');

  is('the probe declines rather than claiming keys exist',
     dns.dkim.subtree === 'unknown', String(dns.dkim.subtree));
  is('and it certainly does not say they are there',
     !/does have DKIM keys/.test(dns.dkim.note), dns.dkim.note);
  is('nor that they are missing, which it also cannot know',
     !/No DKIM is published/.test(dns.dkim.note), dns.dkim.note);
  is('it says the guess list missed and asks for the name',
     /not proof/.test(dns.dkim.note), dns.dkim.note);
}

console.log('the presence probe cannot be fooled by its own control name');
{
  ZONE = { ...base('northbeam.io'), 'google._domainkey.northbeam.io': [{ type: 'TXT', data: KEY }] };
  domain();
  await domainService.verify('u1', 'd1');
  const control = queried.find((q) => q.includes('nx-probe'));
  is('a random control name is looked up to test the zone', !!control, queried.slice(0, 4).join(' | '));
  is('and it is random, not a fixed string somebody could publish',
     /[0-9a-f]{16}\.nx-probe\./.test(control || ''), String(control));
}

/*
 * The screen has to actually show the box.
 *
 * This section exists because of a mistake made while building it: the
 * selector panel was written, styled and wired to the mutation, and then
 * never placed in the returned JSX. Typecheck passed. The bundle built and
 * shrank by nothing anyone would notice. Every assertion above went green,
 * because every one of them tests the server. The only thing wrong was that
 * no human could see it, which is the entire feature.
 *
 * Reading the file is crude, but it catches the one failure the rest of
 * this harness structurally cannot.
 */
console.log('\nthe selector box is on the screen, not just in the file');
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../../client/src/pages/domains/DomainsPage.tsx'), 'utf8');

  is('the panel is defined', /const\s+dkimHelp\s*=/.test(page));

  // Defined once and used nowhere is exactly the bug. A second mention,
  // inside a JSX expression container, is what makes it visible.
  const rendered = /\{[^{}]*\bdkimHelp\b[^{}]*\}/.test(
    page.replace(/const\s+dkimHelp\s*=[\s\S]*?\n  \);\n/, ''),
  );
  is('and it is rendered somewhere in the returned markup', rendered,
     'dkimHelp is declared but never appears in JSX - nobody can see it');

  is('the input saves through the selector endpoint',
     /domainApi\.setDkimSelector\(/.test(page));

  // The note is the server's, which is the only place that knows how many
  // selectors were tried and whether one was given.
  is('the wording shown comes from the check, not the page',
     /dkim\?\.note/.test(page));

  is('and the old flat claim of absence is gone from the client',
     !/No DKIM record found/.test(page),
     'the page still asserts DKIM does not exist, which it cannot know');

  // "we could not find it" and "you have not got one" are different news.
  is('the verdict is driven by the presence probe, not just the guess result',
     /dkim\?\.subtree/.test(page));
  is('and proven-present is not dressed as a failure',
     /subtree === 'present'/.test(page));
  is('the evidence is shown to anyone who wants to check our working',
     /What we checked/.test(page));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} dkim check(s) failed`);
