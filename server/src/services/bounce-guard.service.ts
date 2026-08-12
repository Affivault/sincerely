import { supabaseAdmin } from '../config/supabase.js';
import { wilsonLowerBound } from '../utils/stats.js';
import { fireEvent } from './webhook.service.js';
import type { BounceVerdict } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Stop a campaign that is burning the sending domain.

   bounce_rate has always been calculated and shown, and nothing has ever
   acted on it. Feed in a bought or stale list and the platform sends
   through a 40% bounce rate until the run finishes. Mailbox providers read
   that as a spam signal, and unlike almost every other mistake in cold
   email it is not undone by stopping afterwards — the domain's reputation
   is the thing that was spent.

   Two guards, and both matter:

     · A floor on sample size. Judged on rate alone, two bounces out of
       three is 67% and would pause a campaign on its third send, which
       would teach everyone to switch the protection off.

     · The lower bound of a Wilson interval rather than the raw rate, so
       the question asked is "given what we have seen, is the true rate
       *confidently* above the threshold" and not "did a couple of bad
       addresses happen to land early".

   A healthy cold list bounces at two or three percent. The default
   threshold of eight leaves room for a bad day and still catches a list
   that is genuinely broken.
   ═══════════════════════════════════════════════════════════════════════ */

/** Below this many sends, the rate is not evidence of anything. */
export const MIN_SENDS_BEFORE_GUARD = 20;

/** Ships on, unlike the opt-in features — see the migration for why. */
const DEFAULT_THRESHOLD_PERCENT = 8;

/** Shared with the client so the page shows the same numbers the guard judges on. */
export type { BounceVerdict } from '@lemlist/shared';

interface GuardSettings {
  enabled: boolean;
  thresholdPercent: number;
}

const settingsCache = new Map<string, { value: GuardSettings; expires: number }>();
const SETTINGS_CACHE_MS = 60_000;

/**
 * The account's guard settings, memoised briefly.
 *
 * Read on every bounce, and a bad list produces a great many bounces in a
 * short time — the one situation where this must not add a round trip per
 * event. Never throws: a settings lookup failing must not stop a send being
 * recorded, so it falls back to the protective defaults.
 */
async function guardSettings(userId: string): Promise<GuardSettings> {
  const cached = settingsCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.value;

  let value: GuardSettings = { enabled: true, thresholdPercent: DEFAULT_THRESHOLD_PERCENT };
  try {
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('bounce_guard_enabled, bounce_guard_threshold')
      .eq('user_id', userId)
      .maybeSingle();
    if (data) {
      value = {
        // A pre-045 database returns undefined for both. Undefined must read
        // as "protected", not as "switched off".
        enabled: data.bounce_guard_enabled !== false,
        thresholdPercent: Number(data.bounce_guard_threshold) > 0
          ? Number(data.bounce_guard_threshold)
          : DEFAULT_THRESHOLD_PERCENT,
      };
    }
  } catch {
    // Fall through with the protective defaults.
  }

  settingsCache.set(userId, { value, expires: Date.now() + SETTINGS_CACHE_MS });
  return value;
}

/** Drop a user's memoised guard settings after they change them. */
export function invalidateGuardSettings(userId: string): void {
  settingsCache.delete(userId);
}

/**
 * Where this campaign stands, without acting on it.
 *
 * Exported separately from the enforcement so the campaign page can show the
 * same numbers the breaker is judging on — a threshold nobody can see coming
 * is one that feels arbitrary when it fires.
 */
export async function assessCampaign(userId: string, campaignId: string): Promise<BounceVerdict> {
  const { thresholdPercent } = await guardSettings(userId);

  const [{ count: sentCount }, { count: bouncedCount }] = await Promise.all([
    supabaseAdmin.from('campaign_activities')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).eq('activity_type', 'sent'),
    supabaseAdmin.from('campaign_activities')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).eq('activity_type', 'bounced'),
  ]);

  const sent = sentCount || 0;
  const bounced = bouncedCount || 0;
  const rate = sent > 0 ? bounced / sent : 0;
  const confidentRate = wilsonLowerBound(bounced, sent);
  const threshold = thresholdPercent / 100;

  if (sent < MIN_SENDS_BEFORE_GUARD) {
    return {
      sent, bounced, rate, confidentRate, thresholdPercent, trip: false,
      note: `Too early to judge — ${sent} of ${MIN_SENDS_BEFORE_GUARD} sends needed before the bounce guard can act.`,
    };
  }

  if (confidentRate > threshold) {
    return {
      sent, bounced, rate, confidentRate, thresholdPercent, trip: true,
      note: `${bounced} of ${sent} sends bounced (${(rate * 100).toFixed(1)}%), which is above your ${thresholdPercent}% limit.`,
    };
  }

  return {
    sent, bounced, rate, confidentRate, thresholdPercent, trip: false,
    note: sent === 0
      ? 'Nothing sent yet.'
      : `${bounced} of ${sent} sends bounced (${(rate * 100).toFixed(1)}%), within your ${thresholdPercent}% limit.`,
  };
}

/**
 * Check a campaign after a bounce and stop it if the list is burning.
 *
 * Called from the send path's bounce handler, so it runs at the moment the
 * evidence changes and never on a schedule that could be hours late — the
 * whole point is to stop the *next* thousand sends, not to report on the
 * last thousand.
 *
 * Returns the verdict, or null when the guard is off or the campaign is no
 * longer running. Never throws: a failure here must not turn a recorded
 * bounce into an unrecorded one.
 */
export async function guardAfterBounce(
  userId: string,
  campaignId: string,
): Promise<BounceVerdict | null> {
  try {
    const { enabled } = await guardSettings(userId);
    if (!enabled) return null;

    const verdict = await assessCampaign(userId, campaignId);
    if (!verdict.trip) return verdict;

    // Conditioned on 'running' so two concurrent bounce handlers cannot both
    // pause it, and so a campaign the user paused a moment ago is not
    // relabelled with a reason they did not cause.
    const { data: paused, error } = await supabaseAdmin
      .from('campaigns')
      .update({
        status: 'paused',
        paused_reason: `Paused automatically: ${verdict.note} Sending through a bounce rate this high damages your sending domain.`,
        paused_at: new Date().toISOString(),
      })
      .eq('id', campaignId)
      .eq('status', 'running')
      .select('id, name')
      .maybeSingle();

    if (error) {
      // A pre-045 database has no paused_reason column. Pausing still matters
      // more than explaining, so retry without the explanation.
      if (/paused_reason|paused_at/.test(error.message)) {
        await supabaseAdmin
          .from('campaigns')
          .update({ status: 'paused' })
          .eq('id', campaignId)
          .eq('status', 'running');
      } else {
        console.error(`[BounceGuard] Could not pause campaign ${campaignId}:`, error.message);
        return verdict;
      }
    }

    if (paused || !error) {
      console.warn(
        `[BounceGuard] Paused campaign ${campaignId} — ${verdict.bounced}/${verdict.sent} bounced ` +
        `(${(verdict.rate * 100).toFixed(1)}%, lower bound ${(verdict.confidentRate * 100).toFixed(1)}%, ` +
        `limit ${verdict.thresholdPercent}%)`,
      );
      fireEvent(userId, 'campaign.paused', {
        campaign_id: campaignId,
        reason: 'bounce_rate',
        sent: verdict.sent,
        bounced: verdict.bounced,
        bounce_rate: Math.round(verdict.rate * 1000) / 10,
        threshold_percent: verdict.thresholdPercent,
      }).catch(() => {});
    }

    return verdict;
  } catch (err: any) {
    console.error(`[BounceGuard] Check failed for campaign ${campaignId}:`, err?.message || err);
    return null;
  }
}
