/* ═══════════════════════════════════════════════════════════════════════
   Blacklists: is a sending domain, or the server it sends from, listed?

   A listing on one of the big blocklists is the fastest way for mail to
   stop arriving: Gmail, Outlook and most company filters consult them, and
   a listed domain or IP is refused or junked whatever the content says.
   The lists are queried over DNS, which is free.

   Reading the answer needs care, because "no" has several spellings and
   one of them looks exactly like "yes":

     NXDOMAIN               not listed
     127.0.0.2 and up       listed (each list has its own return codes)
     127.255.255.x          Spamhaus refusing to answer (public resolver,
                            or over the free limit): NOT a listing
     127.0.0.1              URIBL and SURBL refusing to answer: NOT a
                            listing
     anything else, errors  could not check

   And one more: a resolver that cannot reach the list at all can say
   NXDOMAIN for everything, which reads as "clean". So each list's own test
   entry (127.0.0.2, or its test domain) is looked up too, and a list that
   does not report its test entry as listed is "could not check".

   Spamhaus does not answer the public resolvers this server uses (Render
   blocks ordinary DNS, so lookups go over HTTPS to Cloudflare and Google).
   With a free Spamhaus Data Query Service key (SPAMHAUS_DQS_KEY) the
   lookups go to the key's own zone and are answered.
   ═══════════════════════════════════════════════════════════════════════ */

export type BlocklistKind = 'domain' | 'ip';

export interface BlocklistDef {
  id: string;
  name: string;
  zone: string;
  /** The zone under a Spamhaus DQS key, when the list is Spamhaus's. */
  dqs_zone?: string;
  kind: BlocklistKind;
  /** Where to look up a listing and ask for removal. */
  delist_url: string;
  /** An entry every list keeps listed for testing (RFC 5782). If it does not
   *  come back listed, the list is not really answering us. */
  test_target: string;
}

export const BLOCKLISTS: BlocklistDef[] = [
  { id: 'spamhaus-dbl', test_target: 'dbltest.com', name: 'Spamhaus DBL', zone: 'dbl.spamhaus.org', dqs_zone: 'dbl.dq.spamhaus.net', kind: 'domain', delist_url: 'https://check.spamhaus.org/' },
  { id: 'surbl', test_target: 'test.surbl.org', name: 'SURBL', zone: 'multi.surbl.org', kind: 'domain', delist_url: 'https://surbl.org/surbl-analysis' },
  { id: 'uribl', test_target: 'test.uribl.com', name: 'URIBL', zone: 'multi.uribl.com', kind: 'domain', delist_url: 'https://admin.uribl.com/' },
  { id: 'spamhaus-zen', test_target: '127.0.0.2', name: 'Spamhaus ZEN', zone: 'zen.spamhaus.org', dqs_zone: 'zen.dq.spamhaus.net', kind: 'ip', delist_url: 'https://check.spamhaus.org/' },
  { id: 'spamcop', test_target: '127.0.0.2', name: 'SpamCop', zone: 'bl.spamcop.net', kind: 'ip', delist_url: 'https://www.spamcop.net/bl.shtml' },
  { id: 'barracuda', test_target: '127.0.0.2', name: 'Barracuda', zone: 'b.barracudacentral.org', kind: 'ip', delist_url: 'https://www.barracudacentral.org/rbl/removal-request' },
  { id: 'psbl', test_target: '127.0.0.2', name: 'PSBL', zone: 'psbl.surriel.com', kind: 'ip', delist_url: 'https://psbl.org/' },
  { id: 'mailspike', test_target: '127.0.0.2', name: 'Mailspike', zone: 'bl.mailspike.net', kind: 'ip', delist_url: 'https://mailspike.org/iplookup.html' },
];

export type BlocklistReading = 'listed' | 'clean' | 'unchecked';

/** What one list's DNS answer means. `status` is the resolver's (records, nodata, nxdomain, unreachable). */
export function readBlocklistAnswer(listId: string, status: string, records: string[]): BlocklistReading {
  if (status === 'nxdomain' || status === 'nodata') return 'clean';
  if (status !== 'records' || !records.length) return 'unchecked';
  const codes = records.map((r) => r.trim()).filter((r) => /^127\.\d+\.\d+\.\d+$/.test(r));
  if (!codes.length) return 'unchecked';
  // Spamhaus's "I won't answer you" codes.
  if (codes.every((c) => c.startsWith('127.255.255.'))) return 'unchecked';
  // URIBL and SURBL answer 127.0.0.1 to a query they refuse.
  if ((listId === 'uribl' || listId === 'surbl') && codes.every((c) => c === '127.0.0.1')) return 'unchecked';
  if (listId === 'spamhaus-zen') return codes.some((c) => /^127\.0\.0\.(?:[2-9]|1[01])$/.test(c)) ? 'listed' : 'unchecked';
  // DBL lists at 127.0.1.x; 127.0.1.255 is its "bad query".
  if (listId === 'spamhaus-dbl') return codes.some((c) => /^127\.0\.1\.\d+$/.test(c) && c !== '127.0.1.255') ? 'listed' : 'unchecked';
  // Mailspike's other codes grade reputation; only .2 is a listing.
  if (listId === 'mailspike') return codes.includes('127.0.0.2') ? 'listed' : 'clean';
  return codes.some((c) => c !== '127.0.0.1') ? 'listed' : 'unchecked';
}

/** The DNS name to look up: the domain, or the IPv4 address reversed, under the list's zone. */
export function blocklistQuery(target: string, list: BlocklistDef, dqsKey?: string): string | null {
  const zone = dqsKey && list.dqs_zone ? `${dqsKey}.${list.dqs_zone}` : list.zone;
  if (list.kind === 'domain') return `${target.toLowerCase().replace(/\.$/, '')}.${zone}`;
  const m = target.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m ? `${m[4]}.${m[3]}.${m[2]}.${m[1]}.${zone}` : null;
}

export interface BlacklistHit {
  list: string;
  /** The domain or IP that is listed. */
  target: string;
  kind: BlocklistKind;
  delist_url: string;
}

export interface BlacklistStatus {
  /** At least one list gave an answer. */
  checked: boolean;
  listed: BlacklistHit[];
  /** How many lookups gave an answer. */
  checked_count: number;
  /** Lists that would not answer. */
  unchecked: string[];
  /** The mail server IP checked, when it is the account's own (not Gmail's or Microsoft's). */
  server_ip: string | null;
  checked_at: string | null;
}

/* Hosted mail providers whose sending IPs are shared by millions and
   managed by the provider: checking them says nothing about this sender. */
const SHARED_PROVIDERS = /(?:^|\.)(?:gmail\.com|google\.com|googlemail\.com|outlook\.com|office365\.com|hotmail\.com|live\.com|microsoft\.com|yahoo\.com|aol\.com|icloud\.com|me\.com|zoho\.(?:com|eu|in)|fastmail\.com|protonmail\.ch|proton\.me|gmx\.(?:com|net|de)|mail\.ru|yandex\.(?:com|ru)|amazonaws\.com|sendgrid\.net|mailgun\.org|sparkpostmail\.com|postmarkapp\.com|mandrillapp\.com|brevo\.com|sendinblue\.com|titan\.email|secureserver\.net|ionos\.(?:com|co\.uk|de)|one\.com|hostinger\.com)$/i;

/** True when the SMTP host is a big provider's shared server, which is not worth checking. */
export function isSharedMailHost(host: string | null | undefined): boolean {
  return !!host && SHARED_PROVIDERS.test(host.trim().toLowerCase().replace(/\.$/, ''));
}
