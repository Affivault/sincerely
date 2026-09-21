/* ═══════════════════════════════════════════════════════════════════════
   Where does this domain actually keep its mailboxes?

   The old answer was `imap.<domain>`, and for a hosted mailbox that is
   almost always wrong. A domain on Spacemail, Titan, Private Email, IONOS
   or any of the registrar bundles publishes no `imap` host of its own - the
   mailboxes live on the PROVIDER'S hostname. So the form pre-filled a name
   that does not exist, the user pressed save, and the sync came back with
   "The IMAP host could not be found", which is true and useless: it names
   the symptom of a value the app itself invented.

   What makes a better answer possible is that the domain already tells you
   where its mail lives. The MX record names the provider - yieldstones.co.uk
   points at mx1.spacemail.com - and the mailbox hosts are siblings of that
   name, not of the customer's domain. Add RFC 6186 SRV records, which some
   providers publish explicitly, and most domains can be resolved without
   asking anybody anything.

   The rule that matters more than any of the guessing: a host is only ever
   offered once it has been shown to resolve. Guessing and checking is a
   different thing from guessing.
   ═══════════════════════════════════════════════════════════════════════ */

import { resolveDetailed, lookupMx } from './domain.service.js';

export interface DiscoveredHost {
  host: string;
  port: number;
  secure: boolean;
  /** How this was arrived at, so the UI can say and the user can judge. */
  via: 'srv' | 'provider' | 'domain';
}

export interface MailHostDiscovery {
  imap: DiscoveredHost | null;
  smtp: DiscoveredHost | null;
  /** The provider hostname the MX records pointed at, when there was one. */
  mail_provider: string | null;
  /** Plain-language account of what happened, for the form to show. */
  note: string;
}

/** Does this name resolve to anything at all? */
async function hostExists(name: string): Promise<boolean> {
  const [a, cname] = await Promise.all([
    resolveDetailed(name, 'A'),
    resolveDetailed(name, 'CNAME'),
  ]);
  return a.status === 'records' || cname.status === 'records'
    // A name that exists but has no A record of its own still exists; an
    // AAAA-only or provider-aliased host is not a reason to reject it.
    || a.status === 'nodata';
}

/**
 * The registrable-ish base of a mail exchanger.
 *
 * `mx1.spacemail.com` -> `spacemail.com`, and that is where the mailbox
 * hosts live. Two labels is right for .com and wrong for .co.uk, so the
 * common two-part public suffixes are kept whole. This does not need to be
 * a full public-suffix list: every candidate it produces is checked against
 * DNS before being offered, so a wrong guess costs one lookup and is
 * discarded.
 */
const TWO_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.za', 'co.jp', 'co.in',
  'com.br', 'com.mx', 'com.sg', 'com.tr',
]);

export function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  const take = TWO_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return parts.slice(-take).join('.');
}

/**
 * RFC 6186: a provider may simply publish where its clients should connect.
 *
 * `services` is ordered implicit-TLS variant first (`_imaps._tcp` before
 * `_imap._tcp`, `_submissions._tcp` before `_submission._tcp`), so a match
 * against `services[0]` is secure by definition. Beyond that, the only
 * ports that mean implicit TLS are 465 (SMTPS) and 993 (IMAPS) - checking
 * "not port 587" is meaningless here since 587 is an SMTP-submission port
 * that never appears in an IMAP SRV answer, and would mark a plaintext
 * port-143 IMAP host as secure.
 */
async function fromSrv(
  domain: string,
  services: string[],
): Promise<DiscoveredHost | null> {
  for (const [index, service] of services.entries()) {
    const answer = await resolveDetailed(`${service}.${domain}`, 'SRV');
    if (answer.status !== 'records') continue;

    const parsed = answer.records
      .map((r) => {
        const m = r.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/);
        return m ? { priority: Number(m[1]), port: Number(m[3]), host: m[4].replace(/\.$/, '') } : null;
      })
      .filter((r): r is { priority: number; port: number; host: string } => r !== null)
      // "." is the RFC's way of saying this service is not offered here.
      .filter((r) => r.host !== '' && r.host !== '.')
      .sort((a, b) => a.priority - b.priority);

    const best = parsed[0];
    if (best) {
      return {
        host: best.host,
        port: best.port,
        secure: index === 0 || best.port === 465 || best.port === 993,
        via: 'srv',
      };
    }
  }
  return null;
}

/** The names a mailbox host conventionally goes by, in order of likelihood. */
const IMAP_LABELS = ['imap', 'mail', 'imaps', 'secure', 'email'];
const SMTP_LABELS = ['smtp', 'mail', 'send', 'secure', 'email'];

async function firstResolving(
  bases: Array<{ base: string; via: DiscoveredHost['via'] }>,
  labels: string[],
  port: number,
): Promise<DiscoveredHost | null> {
  for (const { base, via } of bases) {
    /*
     * One base at a time, but all its labels at once. Doing every base in
     * parallel would find `mail.<customer-domain>` - a catch-all web host,
     * say - in preference to the provider's real IMAP server, purely on
     * which lookup returned first. Order is the whole point here.
     */
    const found = await Promise.all(
      labels.map(async (label) => (await hostExists(`${label}.${base}`) ? `${label}.${base}` : null)),
    );
    const hit = found.find((h) => h != null);
    if (hit) return { host: hit, port, secure: true, via };
  }
  return null;
}

/**
 * Work out the IMAP and SMTP hosts for a domain, returning only names that
 * exist in DNS.
 */
export async function discoverMailHosts(domain: string): Promise<MailHostDiscovery> {
  const clean = domain.replace(/^@/, '').toLowerCase().trim();
  const out: MailHostDiscovery = { imap: null, smtp: null, mail_provider: null, note: '' };
  if (!clean || !clean.includes('.')) {
    out.note = 'That does not look like a domain.';
    return out;
  }

  const [srvImap, srvSmtp, mx] = await Promise.all([
    fromSrv(clean, ['_imaps._tcp', '_imap._tcp']),
    fromSrv(clean, ['_submissions._tcp', '_submission._tcp']),
    lookupMx(clean),
  ]);

  /*
   * The provider's own domain, taken from the MX records. This is the whole
   * trick: mailboxes for a hosted domain live on the provider's hostnames,
   * and the MX record is the domain telling you which provider that is.
   */
  const providerBase = mx.length > 0 ? baseDomain(mx[0].exchange) : null;
  out.mail_provider = providerBase && providerBase !== clean ? providerBase : null;

  // The provider first. A customer domain's own `mail.` host is frequently a
  // webmail redirect or a parked page, and preferring it over the provider's
  // real server is how you produce a plausible host that cannot be connected to.
  const bases: Array<{ base: string; via: DiscoveredHost['via'] }> = [
    ...(out.mail_provider ? [{ base: out.mail_provider, via: 'provider' as const }] : []),
    { base: clean, via: 'domain' as const },
  ];

  out.imap = srvImap || await firstResolving(bases, IMAP_LABELS, 993);
  out.smtp = srvSmtp || await firstResolving(bases, SMTP_LABELS, 465);

  if (!mx.length) {
    out.note = `${clean} has no mail (MX) records, so it cannot receive mail. Double-check the address.`;
  } else if (out.imap && out.smtp) {
    out.note = out.mail_provider
      ? `${clean} keeps its mail with ${out.mail_provider} - filled in that provider's servers.`
      : `Found ${out.imap.host} and ${out.smtp.host} for ${clean}.`;
    // A discovered IMAP host without TLS is unusual enough to be worth a
    // second look before credentials are saved against it - most providers
    // expect an encrypted connection even where DNS makes a plaintext one
    // technically discoverable.
    if (out.imap.secure === false) {
      out.note += ` Note: ${out.imap.host} was found without encryption (port ${out.imap.port}) - confirm that with your provider before saving.`;
    }
  } else if (out.smtp && !out.imap) {
    out.note = `Found a sending server for ${clean} but no mailbox server. `
      + 'Enter the IMAP host from your provider, or replies will not be read.';
  } else {
    out.note = `Could not work out the mail servers for ${clean}. `
      + "Copy them from your provider's IMAP/SMTP settings page.";
  }

  return out;
}
