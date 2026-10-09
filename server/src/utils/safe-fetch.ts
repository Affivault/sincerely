/* ═══════════════════════════════════════════════════════════════════════
   Reading a public web page without being turned against the network
   we run on.

   The website watcher fetches pages on domains that came from people's
   lead lists - which is to say, from anyone. So every request is held to
   the same rules as an outbound webhook: http(s) only, standard ports,
   every address the host resolves to must be public, and the connection
   is pinned to those checked addresses so DNS cannot swap in a private
   one between the check and the request. Redirects are followed by hand,
   a few at most, and each hop is checked again. Bodies are capped.
   ═══════════════════════════════════════════════════════════════════════ */

import dns from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';
import { isPrivateOrReservedIp, pinnedLookup } from '../services/webhook.service.js';
import { WATCH_USER_AGENT } from '@lemlist/shared';

export interface FetchedPage {
  status: number;
  /** Where the page actually came from, after redirects. */
  url: string;
  contentType: string;
  body: string;
}

const MAX_REDIRECTS = 3;

/** Public addresses for a URL's host, or a reason it may not be fetched. */
async function check(raw: string): Promise<{ url: URL; addresses: string[] } | { error: string }> {
  let url: URL;
  try { url = new URL(raw); } catch { return { error: 'not a URL' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'not http(s)' };
  if (url.username || url.password) return { error: 'credentials in URL' };
  if (url.port && url.port !== '80' && url.port !== '443') return { error: 'non-standard port' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return { error: 'internal host' };
  let addresses: string[];
  if (net.isIP(host)) addresses = [host];
  else {
    try { addresses = (await dns.promises.lookup(host, { all: true })).map((a) => a.address); } catch { return { error: 'does not resolve' }; }
  }
  if (!addresses.length || addresses.some(isPrivateOrReservedIp)) return { error: 'private address' };
  return { url, addresses };
}

function getOnce(url: URL, addresses: string[], timeoutMs: number, maxBytes: number): Promise<{ status: number; location: string | null; contentType: string; body: string }> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        'User-Agent': `Mozilla/5.0 (compatible; ${WATCH_USER_AGENT}/1.0)`,
        Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
        'Accept-Language': 'en',
      },
      lookup: pinnedLookup(addresses),
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode || 0;
      const contentType = String(res.headers['content-type'] || '');
      const location = res.headers.location ? String(res.headers.location) : null;
      if (status >= 300 && status < 400) { res.resume(); resolve({ status, location, contentType, body: '' }); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(); resolve({ status, location: null, contentType, body: Buffer.concat(chunks).toString('utf8') }); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status, location: null, contentType, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * GET a public page as text. Never throws: a page that cannot be read
 * comes back with status 0 and the reason in `body`.
 */
export async function safeGetText(raw: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 1_500_000;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ok = await check(current);
    if ('error' in ok) return { status: 0, url: current, contentType: '', body: ok.error };
    try {
      const res = await getOnce(ok.url, ok.addresses, timeoutMs, maxBytes);
      if (res.status >= 300 && res.status < 400 && res.location) {
        current = new URL(res.location, ok.url).toString();
        continue;
      }
      return { status: res.status, url: ok.url.toString(), contentType: res.contentType, body: res.body };
    } catch (err) {
      return { status: 0, url: current, contentType: '', body: (err as Error)?.message || 'request failed' };
    }
  }
  return { status: 0, url: current, contentType: '', body: 'too many redirects' };
}
