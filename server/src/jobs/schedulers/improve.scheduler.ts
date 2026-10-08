import { runImproveSweep } from '../../services/experiments.service.js';
import { beat } from '../../utils/heartbeat.js';

/**
 * Campaigns that improve themselves: hourly, one turn each for every
 * campaign whose owner switched it on - propose a test, settle one, or
 * wait (services/experiments). Cross-tenant; never an authenticated route.
 */

const TICK_MS = 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let kickoff: ReturnType<typeof setTimeout> | null = null;

async function tick() {
  await runImproveSweep();
}

export function startImproveScheduler() {
  console.log('[Improve] Scheduler started (hourly)');
  kickoff = setTimeout(() => beat('improve', tick), 7 * 60 * 1000);
  timer = setInterval(() => beat('improve', tick), TICK_MS);
  return {
    stop: () => {
      if (kickoff) { clearTimeout(kickoff); kickoff = null; }
      if (timer) { clearInterval(timer); timer = null; console.log('[Improve] Scheduler stopped'); }
    },
  };
}
