import { warmupService } from '../../services/warmup.service.js';

/**
 * Warm-up Scheduler
 *
 * Trickles warm-up emails between each user's own verified mailboxes on a short
 * interval, so a mailbox's daily warm-up volume is spread across the day rather
 * than sent in a burst (bursts look like spam). Cross-tenant — never exposed
 * over an authenticated HTTP route.
 */

const TICK_MS = 12 * 60 * 1000; // every 12 minutes
let intervalId: ReturnType<typeof setInterval> | null = null;

async function tick() {
  try {
    const sent = await warmupService.runWarmupTick();
    if (sent > 0) console.log(`[Warmup] sent ${sent} warm-up email(s) this tick`);
  } catch (err: any) {
    console.error('[Warmup] tick failed:', err.message);
  }
}

export function startWarmupScheduler() {
  console.log('[Warmup] Scheduler started (12-minute interval)');
  // Small initial delay so it never competes with boot-time work.
  const kickoff = setTimeout(tick, 60 * 1000);
  intervalId = setInterval(tick, TICK_MS);

  return {
    stop: () => {
      clearTimeout(kickoff);
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      console.log('[Warmup] Scheduler stopped');
    },
  };
}
