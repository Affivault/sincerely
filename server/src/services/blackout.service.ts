import { supabaseAdmin } from '../config/supabase.js';
import { mergeBlackoutDates, normalizeBlackoutDates } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The days an account never sends on, for the sequence engine.

   See shared/blackout for what an entry means. This is only the read:
   the account's list from user_settings, merged with the campaign's own.

   Read for every due contact, so it is memoised briefly like the bounce
   guard's settings - a holiday added a minute late costs nothing, a round
   trip per send on an eight-hundred-contact campaign does.

   Never throws, and a database without migration 091 is simply an account
   with no closed days: the engine must keep sending exactly as it did.
   ═══════════════════════════════════════════════════════════════════════ */

const CACHE_MS = 60_000;
const cache = new Map<string, { value: string[]; expires: number }>();

export async function accountBlackoutDates(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value: string[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('user_settings')
      .select('blackout_dates')
      .eq('user_id', userId)
      .maybeSingle();
    if (!error && data) value = normalizeBlackoutDates((data as any).blackout_dates);
  } catch {
    // No list is the safe reading: it is what every account had before 091.
  }
  cache.set(userId, { value, expires: Date.now() + CACHE_MS });
  return value;
}

/** Drop the memoised list after the account edits it. */
export function invalidateBlackoutDates(userId: string): void {
  cache.delete(userId);
}

/** Every closed day for this campaign: the account's, then its own. */
export async function campaignBlackoutDates(campaign: { user_id?: string | null; blackout_dates?: unknown } | null | undefined): Promise<string[]> {
  if (!campaign) return [];
  const own = normalizeBlackoutDates(campaign.blackout_dates);
  return mergeBlackoutDates(await accountBlackoutDates(campaign.user_id), own);
}
