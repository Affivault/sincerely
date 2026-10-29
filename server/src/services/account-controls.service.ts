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
interface ControlState { suspended: boolean; revokedAt: number | null; sendingPaused: boolean; at: number }
const cache = new Map<string, ControlState>();

// Accounts that stop calling would otherwise stay in the map for good.
setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entry] of cache) if (entry.at < cutoff) cache.delete(id);
}, 60_000).unref();

export const ACCOUNT_SUSPENDED = 'This account has been suspended. Contact Sincerely support if you think this is a mistake.';

async function load(userId: string): Promise<ControlState | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  let { data, error } = await supabaseAdmin
    .from('account_controls')
    .select('suspended_at, sessions_revoked_at, sending_paused_at')
    .eq('user_id', userId)
    .maybeSingle();
  // Before migration 102 only suspension exists.
  if (error && /sessions_revoked_at|sending_paused_at/.test(error.message || '')) {
    ({ data, error } = await supabaseAdmin.from('account_controls').select('suspended_at').eq('user_id', userId).maybeSingle() as any);
  }
  // A missing table (migration 101 not run) or a blip must not lock
  // everyone out: fail open, and do not cache the miss.
  if (error) return null;
  const row: any = data || {};
  const state: ControlState = {
    suspended: !!row.suspended_at,
    revokedAt: row.sessions_revoked_at ? new Date(row.sessions_revoked_at).getTime() : null,
    sendingPaused: !!row.sending_paused_at,
    at: Date.now(),
  };
  cache.set(userId, state);
  return state;
}

export const accountControls = {
  async isSuspended(userId: string): Promise<boolean> {
    return !!(await load(userId))?.suspended;
  },

  /** Was this token issued before the owner signed the account out everywhere? */
  async isRevoked(userId: string, issuedAtSec: number | undefined): Promise<boolean> {
    const revokedAt = (await load(userId))?.revokedAt;
    return !!revokedAt && !!issuedAtSec && issuedAtSec * 1000 < revokedAt;
  },

  /** Has the owner put a hold on everything this account sends? */
  async isSendingPaused(userId: string): Promise<boolean> {
    return !!(await load(userId))?.sendingPaused;
  },

  /** Called after a change so it takes effect on the next request. */
  forget(userId: string) {
    cache.delete(userId);
  },
};
