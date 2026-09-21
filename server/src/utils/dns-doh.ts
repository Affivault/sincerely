// DNS-over-HTTPS resolver. Managed hosts (Railway, Render, this sandbox…)
// frequently break classic UDP/TCP DNS on port 53 — which makes both DNS
// verification AND outbound SMTP/IMAP "time out", because Node resolves the
// mail host through that broken resolver before it can even open a socket.
//
// Resolving over HTTPS (port 443, which these hosts always allow) and then
// connecting by IP sidesteps the whole problem.

import dns from 'dns';

const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });

const DNS_TYPE = { A: 1, AAAA: 28, TXT: 16, MX: 15, CNAME: 5, SRV: 33 } as const;
export type DnsType = keyof typeof DNS_TYPE;

const DOH_ENDPOINTS = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'];

/* ═══════════════════════════════════════════════════════════════════════
   One resolver, because two of them drifted.

   There used to be a second copy of all of this inside domain.service, and
   during the DKIM work it was taught something this one was not: that an
   empty answer is three different facts, not one.

     records     the name exists and has records of this type
     nodata      the name EXISTS but has no records of this type (NOERROR)
     nxdomain    the name does not exist at all, at any type
     unreachable nobody would answer, so we know nothing

   That distinction is load-bearing in two places. The DKIM presence probe
   reads NXDOMAIN-vs-NODATA at `_domainkey` to tell "you have no DKIM" from
   "we could not guess the selector". And the mailbox repair only replaces a
   host it can prove does not exist - a rule that silently becomes "replace
   anything we could not resolve" if the layer underneath flattens the two.

   This copy flattened them, and everything built on it - the Add Mailbox
   domain check, the tracking-domain CNAME check, every host lookup in the
   send and sync paths - was reading the weaker answer. Two implementations
   of the same thing is how one of them ends up wrong.
   ═══════════════════════════════════════════════════════════════════════ */

export type DnsAnswer = {
  status: 'records' | 'nodata' | 'nxdomain' | 'unreachable';
  records: string[];
};

async function dohQuery(endpoint: string, name: string, type: DnsType): Promise<DnsAnswer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${endpoint}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    // NXDOMAIN is a definitive "this name does not exist".
    if (json.Status === 3) return { status: 'nxdomain', records: [] };
    // Anything but NOERROR (SERVFAIL, REFUSED…) means the endpoint could not
    // say, which is not the same as there being nothing to say.
    if (json.Status !== 0) return null;
    const answers: any[] = Array.isArray(json.Answer) ? json.Answer : [];
    const records = answers.filter((a) => a.type === DNS_TYPE[type]).map((a) => String(a.data));
    return { status: records.length > 0 ? 'records' : 'nodata', records };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve via Cloudflare → Google DoH → OS resolver, keeping the reason. */
export async function resolveDetailed(name: string, type: DnsType): Promise<DnsAnswer> {
  for (const endpoint of DOH_ENDPOINTS) {
    const answer = await dohQuery(endpoint, name, type);
    if (answer !== null) return answer;
  }
  try {
    const records = type === 'A' ? await resolver.resolve4(name)
      : type === 'AAAA' ? await resolver.resolve6(name)
      : type === 'TXT' ? (await resolver.resolveTxt(name)).map((chunks) => `"${chunks.join('" "')}"`)
      : type === 'MX' ? (await resolver.resolveMx(name)).map((r) => `${r.priority} ${r.exchange}`)
      // Presentation format, so the DoH and OS paths parse identically.
      : type === 'SRV' ? (await resolver.resolveSrv(name)).map((r) => `${r.priority} ${r.weight} ${r.port} ${r.name}`)
      : await resolver.resolveCname(name);
    return { status: records.length > 0 ? 'records' : 'nodata', records };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOTFOUND' || code === 'NXDOMAIN') return { status: 'nxdomain', records: [] };
    if (code === 'ENODATA') return { status: 'nodata', records: [] };
    return { status: 'unreachable', records: [] };
  }
}

/** Resolve records via Cloudflare → Google DoH → OS resolver. Missing → []. */
export async function resolveDoh(name: string, type: DnsType): Promise<string[]> {
  return (await resolveDetailed(name, type)).records;
}


/**
 * Resolve a mail server hostname to an IPv4 address via DoH. Returns null if
 * it can't be resolved (caller should then fall back to the raw hostname).
 * Passthrough when the host is already an IP literal.
 */
export async function resolveHostIp(host: string): Promise<string | null> {
  if (!host) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host; // already IPv4
  const a = await resolveDoh(host, 'A');
  return a.length > 0 ? a[0] : null;
}
