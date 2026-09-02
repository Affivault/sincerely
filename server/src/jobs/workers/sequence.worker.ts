import { processDueSteps, processWebhookTimeouts } from '../../services/sequence.service.js';
import { processScheduledEmails } from '../../services/inbox.service.js';
import { processLifecycleTriggers } from '../../services/post-sale.service.js';

/**
 * Sequence Worker
 *
 * Runs on a periodic timer to:
 * 1. Process campaign contacts whose next_send_at has arrived
 * 2. Process webhook wait timeouts
 *
 * This is the heartbeat of the sequence engine.
 */

let isRunning = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

async function tick() {
  if (isRunning) return; // Prevent overlapping runs
  isRunning = true;

  try {
    // Process contacts that are due for their next step
    const processed = await processDueSteps();
    if (processed > 0) {
      console.log(`[Sequence] Processed ${processed} due step(s)`);
    }

    // Process webhook wait timeouts
    const timedOut = await processWebhookTimeouts();
    if (timedOut > 0) {
      console.log(`[Sequence] Resumed ${timedOut} timed-out webhook wait(s)`);
    }

    // Process scheduled inbox emails that are due for sending
    const scheduled = await processScheduledEmails();
    if (scheduled > 0) {
      console.log(`[Sequence] Sent ${scheduled} scheduled email(s)`);
    }

    /*
     * Sequences that start themselves off the CRM: a renewal coming up, a
     * deal won, a deal lost. Reported with its reasons rather than a bare
     * count — an automation that enrolled nobody and cannot say why is the
     * commonest way one stays broken for a month without anybody noticing.
     */
    const lifecycle = await processLifecycleTriggers();
    if (lifecycle.enrolled > 0 || lifecycle.skipped > 0) {
      const why = Object.entries(lifecycle.reasons)
        .map(([reason, n]) => `${reason}: ${n}`)
        .join(', ');
      console.log(
        `[Lifecycle] ${lifecycle.enrolled} enrolled, ${lifecycle.skipped} skipped` +
        ` across ${lifecycle.campaigns} campaign(s)${why ? ` (${why})` : ''}`,
      );
    }
  } catch (err: any) {
    console.error('[Sequence] Worker error:', err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the sequence worker.
 * Runs every 30 seconds to check for due steps.
 */
export function startSequenceWorker() {
  console.log('[Sequence] Worker started (30s interval)');

  // Run immediately on start
  tick();

  // Then run every 30 seconds
  intervalId = setInterval(tick, 30000);

  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('[Sequence] Worker stopped');
      }
    },
  };
}
