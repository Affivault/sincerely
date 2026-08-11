import { supabaseAdmin } from '../../config/supabase.js';
import { analyticsService } from '../../services/analytics.service.js';
import { campaignsService } from '../../services/campaigns.service.js';

/**
 * A/B auto-promote.
 *
 * For campaigns that opted in, this ends a test the moment its result is
 * real: the winning variant becomes the only variant and the rest of the
 * campaign sends it. Without this the test runs forever, splitting volume
 * between a subject line that works and one that doesn't, long after there
 * was anything left to learn.
 *
 * Only ever promotes on `winner`, which the analytics service sets solely
 * when a two-proportion z-test clears p < 0.05 with enough sends per arm.
 * A variant that is merely ahead is left alone — automatic action on noise
 * is worse than no automatic action.
 *
 * Cross-tenant, so it is a scheduler and never an authenticated route.
 */

const SWEEP_MS = 30 * 60 * 1000; // every half hour; tests don't resolve fast
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runAbPromoteSweep(): Promise<number> {
  const { data: campaigns, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, user_id')
    .eq('ab_auto_promote', true)
    .eq('status', 'running');

  // The column arrives with migration 041 — until it is applied there is
  // simply nothing opted in, which is not an error worth logging every tick.
  if (error) {
    if (/ab_auto_promote/.test(error.message)) return 0;
    throw new Error(error.message);
  }

  let promoted = 0;
  for (const campaign of campaigns || []) {
    try {
      const report = await analyticsService.campaignAbTest(campaign.user_id, campaign.id);
      if (!report.has_ab_test) continue;

      for (const step of report.steps) {
        if (!step.winner || !step.significant) continue;
        await campaignsService.promoteAbVariant(campaign.user_id, campaign.id, step.step_id, step.winner);
        promoted++;
        console.log(
          `[AbPromote] campaign ${campaign.id} step ${step.step_number}: promoted variant ` +
          `${step.winner.toUpperCase()} (p=${step.p_value?.toFixed(4)})`,
        );
      }
    } catch (err: any) {
      // One campaign's failure must not stop the sweep for everyone else.
      console.error(`[AbPromote] campaign ${campaign.id} failed:`, err.message);
    }
  }
  return promoted;
}

async function tick() {
  if (running) return; // never overlap — a big account's activity scan can run long
  running = true;
  try {
    const n = await runAbPromoteSweep();
    if (n > 0) console.log(`[AbPromote] promoted ${n} winning variant(s) this sweep`);
  } catch (err: any) {
    console.error('[AbPromote] sweep failed:', err.message);
  } finally {
    running = false;
  }
}

export function startAbPromoteScheduler() {
  if (timer) return { stop: () => {} };
  timer = setInterval(tick, SWEEP_MS);
  // Not on boot: a deploy restarting several instances at once would have
  // them all sweep together, and there is nothing time-critical here.
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
