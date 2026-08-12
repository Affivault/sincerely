import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { env } from '../config/env.js';
import { resolveDoh } from '../utils/dns-doh.js';
import { normalizeDomain } from './domain.service.js';

/* ═══════════════════════════════════════════════════════════════════════
   A tracking domain of your own.

   Every account's open pixels, click links and unsubscribe links point at
   one shared host. Spam filters judge the domains that appear *inside* a
   message, not only the one it was sent from, so a link domain that has
   been reported is a signal on its own — and one shared across every
   account makes deliverability a shared fate. One customer sending
   something that gets it listed degrades everyone's mail at once, and none
   of them can see why, because the cause isn't theirs.

   The delicate part is what "verified" is allowed to mean. A CNAME
   pointing here proves DNS is correct and proves nothing about TLS. An
   email is not editable once sent, so switching an account's links to a
   host that cannot serve HTTPS breaks every link in every message they
   send from that moment — permanently, including the unsubscribe link,
   which is the one that has to work. So DNS is only the first half:
   nothing is marked verified until the domain has answered a real HTTPS
   request from us.
   ═══════════════════════════════════════════════════════════════════════ */

/** The host customers point their CNAME at — where this API is served. */
export function trackingCnameTarget(): string {
  try {
    return new URL(env.TRACKING_BASE_URL).hostname;
  } catch {
    return 'localhost';
  }
}

/**
 * What a verifying request looks for.
 *
 * A plain 200 is not enough: a parked domain, a hosting placeholder or a
 * catch-all CDN will happily return one. The endpoint answers with this
 * exact marker, so a success means the request genuinely reached *this*
 * application and not something that merely exists at that name.
 */
export const TRACKING_HEALTH_MARKER = 'sincerely-tracking-ok';

export interface TrackingDomainRecord {
  id: string;
  domain: string;
  verified: boolean;
  verified_at: string | null;
  last_error: string | null;
  last_checked_at: string | null;
}

/** The CNAME the customer has to create, ready to display. */
export function cnameInstruction(domain: string) {
  const host = domain.split('.')[0];
  return {
    type: 'CNAME' as const,
    host,
    name: domain,
    value: trackingCnameTarget(),
    ttl: 3600,
  };
}

const activeCache = new Map<string, { value: string | null; expires: number }>();
const ACTIVE_CACHE_MS = 5 * 60_000;

/**
 * The base URL to build this account's tracking links from.
 *
 * Called for every email, so it is memoised — and it falls back to the
 * shared host whenever anything is missing or wrong. A tracking link that
 * fails to resolve is worse than a shared one: the unsubscribe link is
 * built from this, and an unsubscribe that 404s is the difference between
 * an annoyed recipient and a spam complaint.
 */
export async function trackingBaseUrl(userId: string): Promise<string> {
  const cached = activeCache.get(userId);
  if (cached && cached.expires > Date.now()) {
    return cached.value || env.TRACKING_BASE_URL;
  }

  let domain: string | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('tracking_domains')
      .select('domain')
      .eq('user_id', userId)
      .eq('verified', true)
      .limit(1)
      .maybeSingle();
    if (data?.domain) domain = data.domain;
  } catch {
    // Pre-047 database, or a transient failure. The shared host still works.
  }

  activeCache.set(userId, { value: domain, expires: Date.now() + ACTIVE_CACHE_MS });
  return domain ? `https://${domain}` : env.TRACKING_BASE_URL;
}

/** Forget a user's memoised tracking host after they change it. */
export function invalidateTrackingBaseUrl(userId: string): void {
  activeCache.delete(userId);
}

/**
 * Does the CNAME point at us?
 *
 * Resolved over DoH for the same reason everything else here is: managed
 * hosts routinely break port-53 DNS, and a verification that fails because
 * of the platform's resolver looks exactly like a customer's mistake.
 */
async function cnamePointsHere(domain: string): Promise<{ ok: boolean; found: string[] }> {
  const target = trackingCnameTarget().toLowerCase();
  const answers = await resolveDoh(domain, 'CNAME');
  const found = (answers || []).map((a) => a.replace(/\.$/, '').toLowerCase());
  return { ok: found.some((a) => a === target || a.endsWith(`.${target}`)), found };
}

/**
 * Does the domain actually serve this application over HTTPS?
 *
 * The half that matters. Checks for the marker rather than a 200, because
 * parked domains and CDN catch-alls return 200 for anything.
 */
async function servesOverHttps(domain: string): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://${domain}/api/track/health`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Sincerely-TrackingDomainCheck/1.0' },
    });
    if (!res.ok) {
      return { ok: false, detail: `answered HTTPS with ${res.status}` };
    }
    const body = (await res.text()).trim();
    if (!body.includes(TRACKING_HEALTH_MARKER)) {
      return { ok: false, detail: 'answered, but not with this application — check the CNAME target' };
    }
    return { ok: true, detail: 'serving over HTTPS' };
  } catch (err: any) {
    const message = String(err?.message || err);
    if (/abort|timeout/i.test(message)) {
      return { ok: false, detail: 'no HTTPS response within 8 seconds' };
    }
    if (/certificate|SSL|TLS/i.test(message)) {
      return {
        ok: false,
        detail: 'no valid HTTPS certificate yet — add this domain to your hosting provider so it can issue one',
      };
    }
    return { ok: false, detail: `could not be reached over HTTPS (${message})` };
  } finally {
    clearTimeout(timer);
  }
}

export const trackingDomainService = {
  async get(userId: string): Promise<TrackingDomainRecord | null> {
    const { data, error } = await supabaseAdmin
      .from('tracking_domains')
      .select('id, domain, verified, verified_at, last_error, last_checked_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (/tracking_domains/.test(error.message)) return null; // pre-047
      throw new AppError(error.message, 500);
    }
    return (data as TrackingDomainRecord) || null;
  },

  /**
   * Claim a domain. Unverified until it proves itself, so adding one never
   * changes a single link until it is known to work.
   */
  async set(userId: string, input: string): Promise<TrackingDomainRecord> {
    const domain = normalizeDomain(input);

    // A bare registrable domain is almost certainly a mistake: pointing
    // acme.com at us by CNAME would take the customer's website down, and
    // a CNAME at the apex is invalid at most registrars anyway.
    if (domain.split('.').length < 3) {
      throw new AppError(
        `Use a subdomain such as track.${domain} — pointing ${domain} itself at us would take your website offline.`,
        400,
      );
    }

    await supabaseAdmin.from('tracking_domains').delete().eq('user_id', userId);
    invalidateTrackingBaseUrl(userId);

    const { data, error } = await supabaseAdmin
      .from('tracking_domains')
      .insert({ user_id: userId, domain, verified: false })
      .select('id, domain, verified, verified_at, last_error, last_checked_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new AppError('That domain is already in use as a tracking domain.', 409);
      }
      throw new AppError(error.message, 500);
    }
    return data as TrackingDomainRecord;
  },

  /**
   * Check the domain and activate it only if both halves pass.
   *
   * Also *de*activates a domain that has stopped working. A certificate
   * expiring or a CNAME being removed would otherwise leave every link in
   * every future email pointing at a dead host, and falling back to the
   * shared domain is far better than that.
   */
  async verify(userId: string): Promise<TrackingDomainRecord & { checks: { label: string; ok: boolean; detail: string }[] }> {
    const record = await this.get(userId);
    if (!record) throw new AppError('No tracking domain set', 404);

    const dns = await cnamePointsHere(record.domain);
    const https = dns.ok
      ? await servesOverHttps(record.domain)
      : { ok: false, detail: 'skipped until the CNAME resolves' };

    const checks = [
      {
        label: `CNAME points at ${trackingCnameTarget()}`,
        ok: dns.ok,
        detail: dns.ok
          ? 'found'
          : dns.found.length
            ? `points at ${dns.found.join(', ')} instead`
            : 'no CNAME record found yet — DNS can take a few minutes',
      },
      { label: 'Serves this application over HTTPS', ok: https.ok, detail: https.detail },
    ];

    const verified = dns.ok && https.ok;
    const failure = checks.find((c) => !c.ok);

    const { data, error } = await supabaseAdmin
      .from('tracking_domains')
      .update({
        verified,
        verified_at: verified ? new Date().toISOString() : null,
        last_error: verified ? null : (failure ? `${failure.label}: ${failure.detail}` : null),
        last_checked_at: new Date().toISOString(),
      })
      .eq('id', record.id)
      .select('id, domain, verified, verified_at, last_error, last_checked_at')
      .single();

    if (error) throw new AppError(error.message, 500);
    invalidateTrackingBaseUrl(userId);
    return { ...(data as TrackingDomainRecord), checks };
  },

  async remove(userId: string): Promise<void> {
    const { error } = await supabaseAdmin.from('tracking_domains').delete().eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    invalidateTrackingBaseUrl(userId);
  },
};
