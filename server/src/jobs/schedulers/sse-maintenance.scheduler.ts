import { resetDailySendCounts, recalculateBounceRates } from '../../services/sse.service.js';

/**
 * SSE Maintenance Scheduler
 *
 * Runs the daily send-count reset and bounce-rate recalculation on an
 * internal timer. These operate across every tenant's smtp_accounts, so
 * they must never be reachable via an authenticated-user HTTP route —
 * only this in-process scheduler triggers them.
 */

let lastResetDay: string | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

async function tick() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastResetDay) {
    try {
      const count = await resetDailySendCounts();
      // Only commit the guard once the reset actually succeeds — otherwise a
      // transient DB/network error on one tick permanently skips the reset
      // for the rest of the day (every hourly tick after would see
      // today === lastResetDay and never retry), leaving every tenant's
      // sends_today/warmup_sent_today counters un-zeroed for up to 24h.
      lastResetDay = today;
      if (count > 0) console.log(`[SSE Maintenance] Reset daily send counts for ${count} account(s)`);
    } catch (err: any) {
      console.error('[SSE Maintenance] resetDailySendCounts failed:', err.message);
    }
  }

  try {
    await recalculateBounceRates();
  } catch (err: any) {
    console.error('[SSE Maintenance] recalculateBounceRates failed:', err.message);
  }
}

/**
 * Start the SSE maintenance scheduler. Checks hourly whether the daily
 * reset is due (UTC day boundary) and recalculates bounce rates each tick.
 */
export function startSseMaintenanceScheduler() {
  console.log('[SSE Maintenance] Scheduler started (hourly interval)');

  tick();
  intervalId = setInterval(tick, 60 * 60 * 1000);

  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('[SSE Maintenance] Scheduler stopped');
      }
    },
  };
}
