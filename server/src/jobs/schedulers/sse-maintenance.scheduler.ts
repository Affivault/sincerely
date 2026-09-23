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
      // Safe to run on every boot: the service only zeroes mailboxes whose
      // own last_send_reset_at predates today, so a restart mid-day no longer
      // hands every mailbox a second day's allowance. This in-memory guard
      // just saves the query on the remaining ticks of the day.
      const count = await resetDailySendCounts();
      // Only commit the guard once the reset actually succeeds — otherwise a
      // transient DB/network error on one tick permanently skips the reset
      // for the rest of the day.
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
