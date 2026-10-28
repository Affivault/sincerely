import { supabaseAdmin } from '../config/supabase.js';

/*
 * Suspension. A suspended account is turned away by the auth middleware on
 * every request (web session and API key alike), and billing gives it no
 * sends and no credits, so its campaigns and rules stop in the background
 * too. The answer is cached for a short while: this runs on every request.
 *
 * Until migration 101 is run the table does not exist and nobody is
 * suspended, which is what the platform did before.
 */

const TTL_MS = 30_000;
const cache = new Map<string, { suspended: boolean; at: number }>();

// Accounts that stop calling would otherwise stay in the map for good.
setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entry] of cache) if (entry.at < cutoff) cache.delete(id);
}, 60_000).unref();

export const ACCOUNT_SUSPENDED = 'This account has been suspended. Contact Sincerely support if you think this is a mistake.';

export const accountControls = {
  async isSuspended(userId: string): Promise<boolean> {
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.suspended;
    const { data, error } = await supabaseAdmin
      .from('account_controls')
      .select('suspended_at')
      .eq('user_id', userId)
      .maybeSingle();
    // A missing table (migration 101 not run) or a blip must not lock
    // everyone out: fail open, and do not cache the miss.
    if (error) return false;
    const suspended = !!data?.suspended_at;
    cache.set(userId, { suspended, at: Date.now() });
    return suspended;
  },

  /** Called after a suspend or unsuspend so it takes effect on the next request. */
  forget(userId: string) {
    cache.delete(userId);
  },
};
