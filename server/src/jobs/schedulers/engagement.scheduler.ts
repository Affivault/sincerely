import { supabaseAdmin } from '../../config/supabase.js';
import { engagementService, engagementMissing } from '../../services/engagement.service.js';
import { beat, isDraining } from '../../utils/heartbeat.js';
import { fetchAllPages } from '../../utils/batch.js';

/**
 * Keeps every account's engagement scores current.
 *
 * Every six hours, because the score fades with time as well as moving
 * with events: somebody who replied a month ago is cooler today than they
 * were yesterday without anything having happened. Why this is a job and
 * not SQL is written up in services/engagement.
 *
 * Accounts are taken from user_settings, which every account that has
 * opened the app has a row in. Cross-tenant, so it is a scheduler and
 * never an authenticated route; each account is scored on its own, and one
 * failing does not stop the rest.
 */

const SWEEP_MS = 6 * 60 * 60 * 1000;
/** The first sweep waits for the server to settle after a deploy. */
const FIRST_SWEEP_MS = 2 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let first: ReturnType<typeof setTimeout> | null = null;
let running = false;
/** Set once 096 is found missing, so the log says it once, not every sweep. */
let warned = false;

export async function runEngagementSweep(): Promise<number> {
  const accounts = await fetchAllPages((from, to) => supabaseAdmin
    .from('user_settings').select('user_id').order('user_id').range(from, to));

  let written = 0;
  for (const a of accounts as any[]) {
    if (isDraining()) break;
    try {
      written += await engagementService.rescoreAccount(a.user_id);
    } catch (err: any) {
      if (err?.statusCode === 503 || engagementMissing(err)) {
        if (!warned) console.warn('[Engagement] scores need migration 096_duplicates_views_engagement_noshow.sql; skipping until it is run');
        warned = true;
        return 0;
      }
      console.error(`[Engagement] ${a.user_id} failed:`, err?.message || err);
    }
  }
  warned = false;
  return written;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const n = await runEngagementSweep();
    if (n > 0) console.log(`[Engagement] rescored ${n} contact(s)`);
  } catch (err: any) {
    console.error('[Engagement] sweep failed:', err?.message || err);
    throw err; // so the heartbeat records the failure
  } finally {
    running = false;
  }
}

export function startEngagementScheduler() {
  if (timer) return { stop: () => {} };
  first = setTimeout(() => { beat('engagement', tick); }, FIRST_SWEEP_MS);
  timer = setInterval(() => beat('engagement', tick), SWEEP_MS);
  return {
    stop: () => {
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
      first = null;
      timer = null;
    },
  };
}
