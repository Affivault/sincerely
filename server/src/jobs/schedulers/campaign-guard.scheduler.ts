import { runOpenGuardSweep } from '../../services/signal-guard.service.js';
import { beat } from '../../utils/heartbeat.js';

/**
 * The open-rate guard's sweep.
 *
 * Bounces and complaints arrive as events and are judged the moment they
 * do. An unopened email is not an event - nothing happens when somebody
 * does not read it - so a collapse in opens can only be found by looking.
 * Every half hour is plenty: the guard only judges sends a day old, so the
 * evidence moves slowly, and the point is to stop tomorrow's sends.
 *
 * Cross-tenant, so it is a scheduler and never an authenticated route.
 */

const SWEEP_MS = 30 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const n = await runOpenGuardSweep();
    if (n > 0) console.log(`[CampaignGuard] paused ${n} campaign(s) for an open-rate collapse`);
  } catch (err: any) {
    console.error('[CampaignGuard] sweep failed:', err.message);
    throw err; // so the heartbeat records the failure
  } finally {
    running = false;
  }
}

export function startCampaignGuardScheduler() {
  if (timer) return { stop: () => {} };
  timer = setInterval(() => beat('campaign_guard', tick), SWEEP_MS);
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
