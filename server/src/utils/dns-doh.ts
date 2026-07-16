// DNS-over-HTTPS resolver. Managed hosts (Railway, Render, this sandbox…)
// frequently break classic UDP/TCP DNS on port 53 — which makes both DNS
// verification AND outbound SMTP/IMAP "time out", because Node resolves the
// mail host through that broken resolver before it can even open a socket.
//
// Resolving over HTTPS (port 443, which these hosts always allow) and then
// connecting by IP sidesteps the whole problem.

import dns from 'dns';

const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });

const DNS_TYPE = { A: 1, AAAA: 28, TXT: 16, MX: 15, CNAME: 5 } as const;
type DnsType = keyof typeof DNS_TYPE;

const DOH_ENDPOINTS = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'];

async function dohQuery(endpoint: string, name: string, type: DnsType): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${endpoint}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (json.Status !== 0 && json.Status !== 3) return null; // NOERROR or NXDOMAIN
    const answers: any[] = Array.isArray(json.Answer) ? json.Answer : [];
    return answers.filter((a) => a.type === DNS_TYPE[type]).map((a) => String(a.data));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve records via Cloudflare → Google DoH → OS resolver. Missing → []. */
export async function resolveDoh(name: string, type: DnsType): Promise<string[]> {
  for (const endpoint of DOH_ENDPOINTS) {
    const answers = await dohQuery(endpoint, name, type);
    if (answers !== null) return answers;
  }
  try {
    if (type === 'A') return await resolver.resolve4(name);
    if (type === 'AAAA') return await resolver.resolve6(name);
    if (type === 'TXT') return (await resolver.resolveTxt(name)).map((c) => c.join(''));
    if (type === 'MX') return (await resolver.resolveMx(name)).map((r) => `${r.priority} ${r.exchange}`);
    return await resolver.resolveCname(name);
  } catch {
    return [];
  }
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
