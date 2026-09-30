import { runWatchdog } from '../../services/system-status.service.js';
import { beat } from '../../utils/heartbeat.js';

/**
 * The watchdog: every five minutes, look for what has quietly stopped -
 * a job, a mailbox, a campaign - and tell each account about it once,
 * then again when it clears. Cross-tenant; never an authenticated route.
 */

const TICK_MS = 5 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

async function tick() {
  const { raised, cleared } = await runWatchdog();
  if (raised || cleared) console.log(`[Watchdog] ${raised} new issue(s), ${cleared} cleared`);
}

export function startWatchdogScheduler() {
  console.log('[Watchdog] Scheduler started (every 5 minutes)');
  // After the other jobs have had a chance to beat once, or everything
  // would read as "never ran" on the first look after a deploy.
  setTimeout(() => beat('watchdog', tick), 2 * 60 * 1000);
  timer = setInterval(() => beat('watchdog', tick), TICK_MS);
  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.log('[Watchdog] Scheduler stopped');
      }
    },
  };
}
