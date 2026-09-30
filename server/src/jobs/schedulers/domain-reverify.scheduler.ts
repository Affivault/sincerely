import { supabaseAdmin } from '../../config/supabase.js';
import { domainService } from '../../services/domain.service.js';
import { trackingDomainService } from '../../services/tracking-domain.service.js';
import { beat } from '../../utils/heartbeat.js';

/**
 * Re-checks sending domains and tracking domains that are currently marked
 * verified, so a stale "verified" flag doesn't sit in the database forever.
 *
 * Both `domainService.verify` and `trackingDomainService.verify` already
 * deactivate a domain that has stopped passing its checks (a rotated DKIM
 * key, an expired tracking-domain certificate, a repointed CNAME) - but until
 * now that only ever ran when someone clicked "Verify" by hand. Nothing
 * re-ran it on a schedule, so a domain that broke after being verified once
 * stayed "verified" indefinitely: campaigns kept launching against a
 * DKIM/SPF/DMARC state nobody had checked in weeks, and tracking links -
 * including unsubscribe links - kept pointing at a host that might no longer
 * answer.
 *
 * Cross-tenant, so this is a scheduler and never an authenticated route.
 */

const SWEEP_MS = 6 * 60 * 60 * 1000;
/** Per sweep, per table. Each check is a handful of DNS lookups (or an HTTPS
 * probe), so this stays small enough that a sweep can't pile up. */
const BATCH = 10;
/** Don't re-check a domain sooner than this after its last check. */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function dueSendingDomains(): Promise<{ id: string; user_id: string }[]> {
  const { data, error } = await supabaseAdmin
    .from('sending_domains')
    .select('id, user_id, last_checked_at')
    .eq('is_verified', true)
    .lt('last_checked_at', new Date(Date.now() - MIN_AGE_MS).toISOString())
    .order('last_checked_at', { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(error.message);
  return data || [];
}

async function dueTrackingDomains(): Promise<{ id: string; user_id: string }[]> {
  const { data, error } = await supabaseAdmin
    .from('tracking_domains')
    .select('id, user_id, last_checked_at')
    .eq('verified', true)
    .lt('last_checked_at', new Date(Date.now() - MIN_AGE_MS).toISOString())
    .order('last_checked_at', { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function runDomainReverifySweep(): Promise<{ sending: number; tracking: number }> {
  let sending = 0;
  let tracking = 0;

  for (const row of await dueSendingDomains()) {
    try {
      await domainService.verify(row.user_id, row.id);
      sending++;
    } catch (err: any) {
      // One domain's DNS being unreachable must not stop the rest of the
      // sweep; it stays "verified" until the next pass tries it again.
      console.error(`[DomainReverify] Sending domain ${row.id} failed: ${err?.message || err}`);
    }
  }

  for (const row of await dueTrackingDomains()) {
    try {
      await trackingDomainService.verify(row.user_id);
      tracking++;
    } catch (err: any) {
      console.error(`[DomainReverify] Tracking domain ${row.id} failed: ${err?.message || err}`);
    }
  }

  return { sending, tracking };
}

export function startDomainReverifyScheduler() {
  if (timer) return { stop: () => {} };

  const tick = async () => {
    // Overlap is the failure that matters: a sweep that outlasts the
    // interval must not race a second one re-checking the same domains.
    if (running) return;
    running = true;
    try {
      const { sending, tracking } = await runDomainReverifySweep();
      if (sending > 0 || tracking > 0) {
        console.log(`[DomainReverify] Re-checked ${sending} sending domain(s), ${tracking} tracking domain(s)`);
      }
    } catch (err: any) {
      console.error(`[DomainReverify] Sweep error: ${err?.message || err}`);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => beat('domain_reverify', tick), SWEEP_MS);
  // Not on boot: every instance re-verifying everything on a deploy would
  // be a burst of DNS/HTTPS probes for domains nobody asked to re-check yet.
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
