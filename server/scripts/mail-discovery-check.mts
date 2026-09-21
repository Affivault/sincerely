/*
 * Finding where a domain actually keeps its mailboxes.
 *
 * The bug this replaces: the Add Mailbox form filled in `imap.<domain>` for
 * any domain it did not have a preset for. For a hosted mailbox that name
 * does not exist - the mailboxes are on the PROVIDER'S hostname - so the
 * form offered a host that could never connect, the user saved it, and the
 * sync came back days later with "The IMAP host could not be found",
 * blaming them for a value the app had invented.
 *
 * The zone in these fixtures is the real yieldstones.co.uk, copied from a
 * live lookup: MX on spacemail.com, no imap/mail host of its own, and -
 * this is the part that makes `imap.<provider>` no better a guess than
 * `imap.<domain>` - imap.spacemail.com does not resolve either. The answer
 * is mail.spacemail.com, and the only way to know that is to look.
 *
 * Run: npx tsx scripts/mail-discovery-check.mts
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

/*
 * Silence the OS resolver before anything imports the lookup layer.
 *
 * When both DoH endpoints fail, the layer falls back to the system
 * resolver - which in this container works, and reaches the real internet.
 * That made the "nobody could answer" case quietly consult live DNS and
 * come back with a genuine NXDOMAIN for imap.yieldstones.co.uk, so the test
 * for "uncertainty changes nothing" was measuring certainty instead. Every
 * lookup in this file now goes through the stub below or fails.
 */
const dnsMod = await import('node:dns');
for (const method of ['resolve4', 'resolveTxt', 'resolveMx', 'resolveCname', 'resolveSrv'] as const) {
  (dnsMod.promises.Resolver.prototype as any)[method] = async () => {
    throw Object.assign(new Error('harness: no system resolver'), { code: 'ECONNREFUSED' });
  };
}

const TYPE_NUM: Record<string, number> = { A: 1, CNAME: 5, MX: 15, TXT: 16, SRV: 33 };

let ZONE: Record<string, { type: string; data: string }[]> = {};
let queried: string[] = [];
/** Names the stub answers SERVFAIL for: present or absent, nobody can say. */
let UNANSWERABLE = new Set<string>();

const nameExists = (name: string) =>
  ZONE[name] !== undefined || Object.keys(ZONE).some((k) => k.endsWith(`.${name}`));

(globalThis as any).fetch = async (url: string) => {
  const u = new URL(String(url));
  const name = (u.searchParams.get('name') || '').toLowerCase();
  /*
   * The lookup layer sends the type by NAME (`type=MX`), which DoH accepts
   * alongside the numeric form. An earlier version of this stub parsed it
   * as a number, got NaN, and answered every query as TXT - so every
   * assertion here failed against a service that was working correctly.
   */
  const type = (u.searchParams.get('type') || 'TXT').toUpperCase();
  queried.push(`${type} ${name}`);
  // SERVFAIL. Not an answer, and specifically not the answer "no".
  if (UNANSWERABLE.has(name)) {
    return new Response(JSON.stringify({ Status: 2 }), {
      status: 200, headers: { 'content-type': 'application/dns-json' },
    });
  }
  const records = (ZONE[name] || []).filter((r) => r.type === type);
  return new Response(JSON.stringify({
    Status: records.length > 0 || nameExists(name) ? 0 : 3,
    Answer: records.map((r) => ({ type: TYPE_NUM[r.type], data: r.data })),
  }), { status: 200, headers: { 'content-type': 'application/dns-json' } });
};

/**
 * What the repair wrote, or null when it wrote nothing.
 *
 * "Wrote nothing" is the assertion most of the repair section turns on, so
 * the stub has to be able to distinguish a refusal from a write of the same
 * values - hence recording the patch rather than a boolean.
 */
let saved: any = null;
const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    update: (patch: any) => { saved = patch; return chain; },
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
  };
  return chain;
};

const { discoverMailHosts, baseDomain } = await import('../src/services/mail-discovery.service.js');
const { repairImapHost } = await import('../src/services/mailbox-repair.service.js');

/** The real zone, as it resolves today. */
const SPACEMAIL_ZONE = () => {
  ZONE = {
    'yieldstones.co.uk': [
      { type: 'MX', data: '0 mx1.spacemail.com.' },
      { type: 'MX', data: '0 mx2.spacemail.com.' },
    ],
    // The provider's real hosts. Note the absence of imap.spacemail.com.
    'mail.spacemail.com': [{ type: 'A', data: '198.177.121.32' }],
    'smtp.spacemail.com': [{ type: 'A', data: '198.177.121.36' }],
    'mx1.spacemail.com': [{ type: 'A', data: '198.177.121.1' }],
  };
  queried = [];
};

console.log('\nthe base of a mail exchanger');
{
  is('a .com provider', baseDomain('mx1.spacemail.com') === 'spacemail.com', baseDomain('mx1.spacemail.com'));
  is('a deep host', baseDomain('a.b.c.example.net') === 'example.net', baseDomain('a.b.c.example.net'));
  // Two labels is right for .com and cuts a .co.uk domain in half.
  is('a two-part public suffix keeps three labels',
     baseDomain('mx.mail.example.co.uk') === 'example.co.uk', baseDomain('mx.mail.example.co.uk'));
  is('an apex is left alone', baseDomain('example.com') === 'example.com', baseDomain('example.com'));
  is('a trailing dot does not produce an empty label',
     baseDomain('mx1.spacemail.com.') === 'spacemail.com', baseDomain('mx1.spacemail.com.'));
}

console.log('\nthe real domain that produced the bug');
{
  SPACEMAIL_ZONE();
  const found = await discoverMailHosts('yieldstones.co.uk');

  is('the provider is read off the MX record',
     found.mail_provider === 'spacemail.com', String(found.mail_provider));
  is('IMAP is the provider’s host, not the customer’s',
     found.imap?.host === 'mail.spacemail.com', JSON.stringify(found.imap));
  is('on the submission port, over TLS',
     found.imap?.port === 993 && found.imap?.secure === true, JSON.stringify(found.imap));
  is('SMTP likewise', found.smtp?.host === 'smtp.spacemail.com', JSON.stringify(found.smtp));
  is('and it says where the answer came from',
     found.imap?.via === 'provider', String(found.imap?.via));

  /*
   * The assertion the whole module exists for. imap.yieldstones.co.uk is
   * what the form used to fill in, and it is not a name.
   */
  is('the invented host is nowhere near the result',
     JSON.stringify(found).includes('imap.yieldstones.co.uk') === false, JSON.stringify(found));
  is('the note names the provider so the user can sanity-check it',
     found.note.includes('spacemail.com'), found.note);
}

console.log('\na host is never offered unless it resolves');
{
  // A domain with mail service but no mailbox hosts anywhere to be found.
  ZONE = {
    'northbeam.io': [{ type: 'MX', data: '10 mx.someprovider.example.' }],
    'mx.someprovider.example': [{ type: 'A', data: '203.0.113.9' }],
  };
  queried = [];
  const found = await discoverMailHosts('northbeam.io');

  is('no IMAP host is invented', found.imap === null, JSON.stringify(found.imap));
  is('no SMTP host is invented', found.smtp === null, JSON.stringify(found.smtp));
  is('and it says so plainly rather than guessing',
     /Could not work out the mail servers/.test(found.note), found.note);
  is('it did look, though',
     queried.some((q) => q.includes('imap.someprovider.example')), queried.slice(0, 6).join(' | '));
}

console.log('\nthe provider is preferred over the customer’s own lookalike host');
{
  /*
   * `mail.<customer domain>` very often exists and is a webmail redirect or
   * a parked page. Resolving is not the same as being a mail server, so
   * when the domain plainly hosts its mail elsewhere, the provider wins.
   */
  ZONE = {
    'northbeam.io': [{ type: 'MX', data: '0 mx1.spacemail.com.' }],
    'mail.northbeam.io': [{ type: 'A', data: '203.0.113.50' }],
    'mail.spacemail.com': [{ type: 'A', data: '198.177.121.32' }],
    'smtp.spacemail.com': [{ type: 'A', data: '198.177.121.36' }],
  };
  queried = [];
  const found = await discoverMailHosts('northbeam.io');

  is('the provider host wins', found.imap?.host === 'mail.spacemail.com', JSON.stringify(found.imap));
}

console.log('\na domain that really does run its own mail');
{
  ZONE = {
    'northbeam.io': [{ type: 'MX', data: '10 mx.northbeam.io.' }],
    'mx.northbeam.io': [{ type: 'A', data: '203.0.113.1' }],
    'imap.northbeam.io': [{ type: 'A', data: '203.0.113.2' }],
    'smtp.northbeam.io': [{ type: 'A', data: '203.0.113.3' }],
  };
  queried = [];
  const found = await discoverMailHosts('northbeam.io');

  is('its own hosts are used', found.imap?.host === 'imap.northbeam.io', JSON.stringify(found.imap));
  is('and that is reported as the domain’s own, not a provider’s',
     found.imap?.via === 'domain' && found.mail_provider === null,
     `${found.imap?.via} / ${found.mail_provider}`);
}

console.log('\nan explicit SRV record beats every guess');
{
  // RFC 6186. When a provider publishes this, there is nothing to infer.
  ZONE = {
    'northbeam.io': [{ type: 'MX', data: '0 mx1.spacemail.com.' }],
    '_imaps._tcp.northbeam.io': [{ type: 'SRV', data: '0 1 993 imap.declared.example.' }],
    '_submissions._tcp.northbeam.io': [{ type: 'SRV', data: '0 1 465 smtp.declared.example.' }],
    'mail.spacemail.com': [{ type: 'A', data: '198.177.121.32' }],
  };
  queried = [];
  const found = await discoverMailHosts('northbeam.io');

  is('IMAP comes from the SRV record',
     found.imap?.host === 'imap.declared.example' && found.imap?.via === 'srv',
     JSON.stringify(found.imap));
  is('with the port it declared', found.imap?.port === 993, String(found.imap?.port));
  is('SMTP too', found.smtp?.host === 'smtp.declared.example', JSON.stringify(found.smtp));
}

console.log('\n"." in an SRV record means the service is not offered');
{
  // RFC 2782 says a single dot as the target means "not available here".
  // Treating it as a hostname would fill the field with ".".
  ZONE = {
    'northbeam.io': [{ type: 'MX', data: '10 mx.northbeam.io.' }],
    '_imaps._tcp.northbeam.io': [{ type: 'SRV', data: '0 1 993 .' }],
    'imap.northbeam.io': [{ type: 'A', data: '203.0.113.2' }],
  };
  queried = [];
  const found = await discoverMailHosts('northbeam.io');

  is('the refusal is not mistaken for a hostname',
     found.imap?.host !== '.' && found.imap?.host !== '', JSON.stringify(found.imap));
  is('and the search carries on without it',
     found.imap?.host === 'imap.northbeam.io', JSON.stringify(found.imap));
}

console.log('\na domain with no mail at all');
{
  ZONE = { 'northbeam.io': [{ type: 'TXT', data: '"v=spf1 -all"' }] };
  queried = [];
  const found = await discoverMailHosts('northbeam.io');

  is('says the address cannot receive mail',
     /no mail \(MX\) records/.test(found.note), found.note);
}

/*
 * Repairing the accounts that were already saved with an invented host.
 *
 * Discovery stops new ones being created that way and does nothing for the
 * mailboxes already pointing at a name that never existed. Telling somebody
 * to go and edit three of them by hand, to undo a mistake the software made,
 * is not a fix.
 *
 * The safety argument is the whole design, so most of these assertions are
 * about what it REFUSES to touch. A name that returns NXDOMAIN cannot be
 * connected to by anybody, from anywhere, ever - so there is no working
 * configuration to destroy. Anything else is left alone, including a host
 * that looks wrong, because wrong-looking is not the same as impossible.
 */
console.log('\nan invented IMAP host is replaced with a real one');
{
  SPACEMAIL_ZONE();
  saved = null;
  const result = await repairImapHost({
    id: 'a1', user_id: 'u1',
    email_address: 'scott@yieldstones.co.uk',
    imap_host: 'imap.yieldstones.co.uk',
    imap_port: 993,
  });

  is('it reports a repair', result.repaired === true, result.note);
  is('from the name that does not exist',
     result.from === 'imap.yieldstones.co.uk', String(result.from));
  is('to the provider’s real server',
     result.to === 'mail.spacemail.com', String(result.to));
  is('and that is what got written',
     saved?.imap_host === 'mail.spacemail.com', JSON.stringify(saved));
  is('the stale failure is cleared with it',
     saved?.last_inbox_sync_error === null, JSON.stringify(saved?.last_inbox_sync_error));
  is('the password is not among the things it touched',
     saved !== null && !('smtp_pass_encrypted' in saved) && !('imap_pass' in saved),
     JSON.stringify(Object.keys(saved || {})));
  is('and it explains itself in words, naming both hosts',
     result.note.includes('imap.yieldstones.co.uk') && result.note.includes('mail.spacemail.com'),
     result.note);
}

console.log('\na host that resolves is never touched, however wrong it looks');
{
  /*
   * The important refusal. This host exists; it may be the wrong server, it
   * may have the wrong port, the mailbox may be failing for some other
   * reason entirely. None of that is knowable from DNS, and rewriting
   * settings on a hunch is how software loses the right to touch them.
   */
  ZONE = {
    'yieldstones.co.uk': [{ type: 'MX', data: '0 mx1.spacemail.com.' }],
    'imap.yieldstones.co.uk': [{ type: 'A', data: '203.0.113.77' }],
    'mail.spacemail.com': [{ type: 'A', data: '198.177.121.32' }],
  };
  queried = [];
  saved = null;
  const result = await repairImapHost({
    id: 'a1', user_id: 'u1',
    email_address: 'scott@yieldstones.co.uk',
    imap_host: 'imap.yieldstones.co.uk',
    imap_port: 993,
  });

  is('nothing is repaired', result.repaired === false, result.note);
  is('and nothing at all is written', saved === null, JSON.stringify(saved));
  is('it says why, and says what to do instead',
     /exists in DNS/.test(result.note) && /by hand/.test(result.note), result.note);
}

console.log('\nuncertainty is not grounds for changing anything');
{
  // Every lookup fails at the transport. "We could not tell" is not the
  // same as "it is not there", and only the second one licenses a change.
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => { throw new Error('network down'); };
  saved = null;
  const result = await repairImapHost({
    id: 'a1', user_id: 'u1',
    email_address: 'scott@yieldstones.co.uk',
    imap_host: 'imap.yieldstones.co.uk',
    imap_port: 993,
  });
  (globalThis as any).fetch = realFetch;

  is('an unreachable resolver repairs nothing', result.repaired === false, result.note);
  is('and writes nothing', saved === null, JSON.stringify(saved));
}

console.log('\nSERVFAIL on the stored host alone still changes nothing');
{
  /*
   * The sharp version, and the one that actually pins the rule down.
   *
   * Here everything else resolves perfectly and discovery has a good
   * answer ready - only the stored host is unanswerable. A gate written as
   * "not confirmed present" would happily overwrite it; the rule is
   * "confirmed absent", and SERVFAIL is not absence. Without this case the
   * looser gate passes every other assertion in this file, because they
   * all break the whole resolver at once and fail earlier for an unrelated
   * reason.
   */
  SPACEMAIL_ZONE();
  UNANSWERABLE = new Set(['imap.yieldstones.co.uk']);
  saved = null;
  const result = await repairImapHost({
    id: 'a1', user_id: 'u1',
    email_address: 'scott@yieldstones.co.uk',
    imap_host: 'imap.yieldstones.co.uk',
    imap_port: 993,
  });
  UNANSWERABLE = new Set();

  is('a host nobody can answer for is not declared missing',
     result.repaired === false, result.note);
  is('and nothing is written, though a replacement was available',
     saved === null, JSON.stringify(saved));
}

console.log('\na fixed address is somebody’s deliberate choice');
{
  ZONE = { 'yieldstones.co.uk': [{ type: 'MX', data: '0 mx1.spacemail.com.' }] };
  queried = [];
  saved = null;
  const result = await repairImapHost({
    id: 'a1', user_id: 'u1',
    email_address: 'scott@yieldstones.co.uk',
    imap_host: '127.0.0.1',
    imap_port: 1143,
  });

  is('an IP address is left alone', result.repaired === false, result.note);
  is('nothing is written', saved === null, JSON.stringify(saved));
  is('and no DNS lookup was wasted on it',
     queried.length === 0, queried.join(' | '));
}

console.log('\nnothing to put in its place is not a repair either');
{
  ZONE = {
    'yieldstones.co.uk': [{ type: 'MX', data: '0 mx1.nowhere.example.' }],
    'mx1.nowhere.example': [{ type: 'A', data: '203.0.113.5' }],
  };
  queried = [];
  saved = null;
  const result = await repairImapHost({
    id: 'a1', user_id: 'u1',
    email_address: 'scott@yieldstones.co.uk',
    imap_host: 'imap.yieldstones.co.uk',
    imap_port: 993,
  });

  is('no host is invented to fill the gap', result.repaired === false, result.note);
  is('nothing is written', saved === null, JSON.stringify(saved));
  is('and it points at the provider’s own settings page',
     /provider/.test(result.note), result.note);
}

console.log('\nthe form no longer invents a host');
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const modal = readFileSync(
    join(here, '../../client/src/pages/smtp/SmtpAccountModal.tsx'), 'utf8',
  );

  /*
   * A template literal building imap.${domain} is the bug itself. It is
   * checked in the page rather than only in the service because the service
   * can be perfectly correct while the form ignores it.
   */
  is('`imap.${domain}` is gone from the form',
     !/imap\.\$\{domain\}/.test(modal),
     'the form is still building an IMAP host out of the customer domain');
  is('and `smtp.${domain}` with it',
     !/smtp\.\$\{domain\}/.test(modal));
  is('it fills in what the server discovered instead',
     /hosts\?\.imap\?\.host/.test(modal));
  is('and a server that cannot answer leaves the field empty',
     /hosts\?\.imap\?\.host \|\| undefined/.test(modal));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} mail discovery check(s) failed`);
