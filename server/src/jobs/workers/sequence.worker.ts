import { processDueSteps, processWebhookTimeouts, promoteDueScheduledCampaigns } from '../../services/sequence.service.js';
import { processScheduledEmails } from '../../services/inbox.service.js';

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

/**
 * Run one stage, and never let it take the others down with it.
 *
 * The three stages used to share a single try: a persistent failure in the
 * first (a missing column after a deploy, a query that times out) threw
 * past the other two on every tick, so webhook timeouts stopped resuming
 * and scheduled inbox emails stopped going out - for a reason that had
 * nothing to do with either of them.
 */
async function stage(label: string, run: () => Promise<number>, done: (n: number) => string) {
  try {
    const n = await run();
    if (n > 0) console.log(`[Sequence] ${done(n)}`);
  } catch (err: any) {
    console.error(`[Sequence] ${label} failed:`, err?.message || err);
  }
}

async function tick() {
  if (isRunning) return; // Prevent overlapping runs
  isRunning = true;

  try {
    // Scheduled campaigns whose start time has come, before anything is
    // picked up, so their contacts are due on this same tick.
    await stage('Scheduled start', promoteDueScheduledCampaigns, (n) => `Started ${n} scheduled campaign(s)`);
    await stage('Due steps', processDueSteps, (n) => `Processed ${n} due step(s)`);
    await stage('Webhook timeouts', processWebhookTimeouts, (n) => `Resumed ${n} timed-out webhook wait(s)`);
    await stage('Scheduled emails', processScheduledEmails, (n) => `Sent ${n} scheduled email(s)`);
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
