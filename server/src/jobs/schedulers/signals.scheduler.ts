import { runSignalSweep } from '../../services/signals.service.js';
import { beat } from '../../utils/heartbeat.js';

/**
 * Moments: hourly, every account - the own-data detectors, and for those
 * who switched it on, a bounded read of company websites
 * (services/signals). Cross-tenant; never an authenticated route.
 */

const TICK_MS = 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let kickoff: ReturnType<typeof setTimeout> | null = null;

async function tick() {
  await runSignalSweep();
}

export function startSignalsScheduler() {
  console.log('[Moments] Scheduler started (hourly)');
  kickoff = setTimeout(() => beat('signals', tick), 11 * 60 * 1000);
  timer = setInterval(() => beat('signals', tick), TICK_MS);
  return {
    stop: () => {
      if (kickoff) { clearTimeout(kickoff); kickoff = null; }
      if (timer) { clearInterval(timer); timer = null; console.log('[Moments] Scheduler stopped'); }
    },
  };
}
