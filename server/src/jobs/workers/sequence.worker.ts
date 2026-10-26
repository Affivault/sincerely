import { processDueSteps, processWebhookTimeouts, promoteDueScheduledCampaigns, reapStrandedContacts } from '../../services/sequence.service.js';
import { processScheduledEmails, reapStuckScheduledSends } from '../../services/inbox.service.js';
import { sweepChannelTasks } from '../../services/channel-tasks.service.js';
import { beat } from '../../utils/heartbeat.js';

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
/** The reapers look for work a dead process left behind; every 5 minutes is plenty. */
const REAP_EVERY_MS = 5 * 60 * 1000;
let lastReapAt = 0;

/**
 * Run one stage, and never let it take the others down with it.
 *
 * The three stages used to share a single try: a persistent failure in the
 * first (a missing column after a deploy, a query that times out) threw
 * past the other two on every tick, so webhook timeouts stopped resuming
 * and scheduled inbox emails stopped going out - for a reason that had
 * nothing to do with either of them.
 */
async function stage(failures: string[], label: string, run: () => Promise<number>, done: (n: number) => string) {
  try {
    const n = await run();
    if (n > 0) console.log(`[Sequence] ${done(n)}`);
  } catch (err: any) {
    console.error(`[Sequence] ${label} failed:`, err?.message || err);
    failures.push(`${label}: ${err?.message || err}`);
  }
}

async function tick() {
  if (isRunning) return; // Prevent overlapping runs
  isRunning = true;

  // Every stage still runs when one fails; the failures are thrown together
  // at the end so the heartbeat records the tick as failing. Swallowed here,
  // the status page showed 'Sending: ok' while a stage errored every tick.
  const failures: string[] = [];
  try {
    // Work a crashed or killed process left claimed but never finished.
    if (Date.now() - lastReapAt >= REAP_EVERY_MS) {
      lastReapAt = Date.now();
      await stage(failures, 'Stranded contacts', reapStrandedContacts, (n) => `Recovered ${n} stranded contact(s)`);
      await stage(failures, 'Stuck scheduled emails', reapStuckScheduledSends, (n) => `Marked ${n} interrupted scheduled email(s) failed`);
      // LinkedIn tasks nobody is going to do: the contact left, the agent gave
      // up, or it sat undone past the user's limit. Each parks a contact.
      await stage(failures, 'LinkedIn tasks', sweepChannelTasks, (n) => `Closed or skipped ${n} LinkedIn task(s)`);
    }
    // Scheduled campaigns whose start time has come, before anything is
    // picked up, so their contacts are due on this same tick.
    await stage(failures, 'Scheduled start', promoteDueScheduledCampaigns, (n) => `Started ${n} scheduled campaign(s)`);
    await stage(failures, 'Due steps', processDueSteps, (n) => `Processed ${n} due step(s)`);
    await stage(failures, 'Webhook timeouts', processWebhookTimeouts, (n) => `Resumed ${n} timed-out webhook wait(s)`);
    await stage(failures, 'Scheduled emails', processScheduledEmails, (n) => `Sent ${n} scheduled email(s)`);
  } finally {
    isRunning = false;
  }
  if (failures.length) throw new Error(failures.join('; '));
}

/**
 * Start the sequence worker.
 * Runs every 30 seconds to check for due steps.
 */
export function startSequenceWorker() {
  console.log('[Sequence] Worker started (30s interval)');

  // Run immediately on start
  beat('sending', tick);

  // Then run every 30 seconds
  intervalId = setInterval(() => beat('sending', tick), 30000);

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
