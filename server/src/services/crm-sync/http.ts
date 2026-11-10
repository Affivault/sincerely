/**
 * HTTP for the CRM adapters. Requests only ever go to the CRM's own API host
 * (fixed per adapter, never taken from user input), follow no redirects,
 * time out, and wait once and try again when the CRM says "too many
 * requests". Errors carry the CRM's own message and, for a missing
 * permission, say so in words a person can act on.
 */

export class CrmHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** A permission the token lacks (HubSpot names it in the error). */
    readonly missingScope?: string,
  ) {
    super(message);
    this.name = 'CrmHttpError';
  }
  /** Worth trying again later: a timeout, a rate limit or the CRM's own fault. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface CrmResponse {
  status: number;
  json: any;
  text: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** For tests: send a CRM's traffic somewhere else (a fake CRM on localhost). */
const overrides = new Map<string, string>();
export function overrideCrmHost(host: string, base: string | null): void {
  if (base) overrides.set(host, base.replace(/\/+$/, ''));
  else overrides.delete(host);
}

export async function crmRequest(
  host: string,
  method: Method,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<CrmResponse> {
  if (!path.startsWith('/')) throw new Error('CRM path must start with /');
  const base = overrides.get(host) ?? `https://${host}`;
  const url = `${base}${path}`;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Sincerely-CRM-Sync/1.0',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (err: any) {
      throw new CrmHttpError(`${host} ${err?.name === 'AbortError' ? 'did not answer in time' : 'could not be reached'}`, 0);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

    // One patient retry on a rate limit, waiting what the CRM asks (at most 10s).
    if (res.status === 429 && attempt === 0) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(Math.min(10_000, Number.isFinite(after) && after > 0 ? after * 1000 : 2_000));
      continue;
    }
    return { status: res.status, json, text };
  }
}

/** The CRM's own words for a failed response. */
export function crmErrorMessage(res: CrmResponse): string {
  const j = res.json;
  const msg = j?.message || j?.error || j?.error_info || (typeof j === 'string' ? j : '') || res.text.slice(0, 200) || `HTTP ${res.status}`;
  return String(msg).slice(0, 300);
}
