import { supabaseAdmin } from '../config/supabase.js';
import { emailDomain, isFreeMailDomain } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Don't drop thirty emails into one company inside a minute.

   Nothing limited how fast a campaign reached a single recipient domain.
   A list sorted by company — which is how most exports arrive — sends
   every address at acme.com back to back, and that burst is what a
   receiving gateway is built to notice. The result is the sending domain
   getting flagged at that organisation, so the company you most wanted to
   reach is the first to stop receiving you.

   Counted per account rather than per campaign, because two campaigns
   hitting the same company at once is the same burst as far as the
   gateway is concerned.

   Consumer providers are exempt: gmail.com is not an organisation, and
   capping it would throttle any campaign aimed at freelancers and
   one-person businesses to a handful of sends an hour for nothing.
   ═══════════════════════════════════════════════════════════════════════ */

const DEFAULT_HOURLY_LIMIT = 5;

/** The hour this send belongs to. Bucketed, so counters expire naturally. */
export function currentDomainPeriod(now = new Date()): Date {
  const period = new Date(now);
  period.setUTCMinutes(0, 0, 0);
  return period;
}

/** When the next bucket opens — where a blocked contact gets rescheduled to. */
export function nextDomainPeriod(now = new Date()): Date {
  const next = currentDomainPeriod(now);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

const limitCache = new Map<string, { value: number; expires: number }>();
const LIMIT_CACHE_MS = 60_000;

/**
 * The account's per-domain hourly limit, memoised.
 *
 * Read once per send, so it must not be a round trip each time. Falls back
 * to the default rather than to "unlimited" when the lookup fails: a
 * throttle that silently switches itself off under load is not a throttle.
 */
async function hourlyLimit(userId: string): Promise<number> {
  const cached = limitCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.value;

  let value = DEFAULT_HOURLY_LIMIT;
  try {
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('domain_hourly_limit')
      .eq('user_id', userId)
      .maybeSingle();
    // Zero is a deliberate "unlimited", so only undefined/null falls back.
    if (data && data.domain_hourly_limit !== null && data.domain_hourly_limit !== undefined) {
      value = Number(data.domain_hourly_limit);
    }
  } catch {
    // Keep the default.
  }

  limitCache.set(userId, { value, expires: Date.now() + LIMIT_CACHE_MS });
  return value;
}

/** Drop a user's memoised limit after they change it. */
export function invalidateDomainLimit(userId: string): void {
  limitCache.delete(userId);
}

export interface DomainReservation {
  /** False when this send would exceed the hourly limit for the domain. */
  granted: boolean;
  /** The domain that was counted. Empty when nothing was counted. */
  domain: string;
  /** The bucket it was counted in, needed to refund. */
  period: Date | null;
  /** When to try again, when refused. */
  retryAt: Date | null;
}

/**
 * Claim one send against a recipient domain's hourly allowance.
 *
 * Granted without counting when the address is at a consumer provider,
 * unparseable, or the account has set no limit — in each case there is
 * nothing meaningful to throttle and no reason to write a row.
 *
 * Never throws. A throttle failing open is a burst; a throttle failing
 * *closed* is a campaign that silently stops, which is worse. So a database
 * problem here grants the send and says so in the log.
 */
export async function reserveDomainSend(userId: string, email: string): Promise<DomainReservation> {
  const domain = emailDomain(email);
  const none: DomainReservation = { granted: true, domain: '', period: null, retryAt: null };

  if (!domain || isFreeMailDomain(domain)) return none;

  const limit = await hourlyLimit(userId);
  if (limit <= 0) return none;

  const period = currentDomainPeriod();
  try {
    const { data, error } = await supabaseAdmin.rpc('reserve_domain_send', {
      p_user_id: userId,
      p_domain: domain,
      p_period_start: period.toISOString(),
      p_limit: limit,
    });
    if (error) {
      // Pre-046 database, or a transient failure. Let the send through rather
      // than stalling every campaign on a missing migration.
      console.warn(`[DomainThrottle] reserve_domain_send unavailable, allowing send: ${error.message}`);
      return none;
    }
    if (data === true) return { granted: true, domain, period, retryAt: null };
    return { granted: false, domain, period, retryAt: nextDomainPeriod() };
  } catch (err: any) {
    console.warn(`[DomainThrottle] reserve failed, allowing send: ${err?.message || err}`);
    return none;
  }
}

/** Give back a slot the send never used. */
export async function refundDomainSend(userId: string, reservation: DomainReservation): Promise<void> {
  if (!reservation.domain || !reservation.period) return;
  try {
    await supabaseAdmin.rpc('refund_domain_send', {
      p_user_id: userId,
      p_domain: reservation.domain,
      p_period_start: reservation.period.toISOString(),
    });
  } catch (err: any) {
    console.warn(`[DomainThrottle] refund failed for ${reservation.domain}: ${err?.message || err}`);
  }
}
