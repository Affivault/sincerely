import { autoVerifyPending } from '../../services/verification.service.js';

/**
 * Verification Worker
 *
 * Periodically drains a small, throttled batch of unverified contacts for
 * users who enabled auto-verification, running each through the DCS pipeline
 * (syntax + MX + SMTP). A small batch per tick keeps imports instant and
 * avoids hammering remote mail servers (which would hurt sender reputation).
 */

const TICK_MS = 20_000;       // every 20s
const BATCH_PER_TICK = 10;    // small batch — SMTP checks are slow

let isRunning = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

async function tick() {
  if (isRunning) return; // never overlap — a slow SMTP batch just delays the next tick
  isRunning = true;
  try {
    const processed = await autoVerifyPending(BATCH_PER_TICK);
    if (processed > 0) console.log(`[Verify] Auto-verified ${processed} contact(s)`);
  } catch (err: any) {
    console.error('[Verify] Worker error:', err.message);
  } finally {
    isRunning = false;
  }
}

export function startVerificationWorker() {
  console.log('[Verify] Auto-verification worker started (20s interval)');
  tick();
  intervalId = setInterval(tick, TICK_MS);
  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('[Verify] Worker stopped');
      }
    },
  };
}
