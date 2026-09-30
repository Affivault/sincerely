import { runAutopilot, sweepBounceNotices } from '../../services/autopilot.service.js';

/**
 * The deliverability autopilot's heartbeat.
 *
 * Every ten minutes: read any bounce notices nobody has read yet, then
 * judge every mailbox and receiving provider on the week's evidence and
 * act on what the rules decide. Cross-tenant, so it is a scheduler and
 * never an authenticated route.
 *
 * Ten minutes because the damage a bad list does is measured in hours: a
 * mailbox bouncing at 20% should stop within the same sending window, not
 * at tomorrow's run.
 */

const TICK_MS = 10 * 60 * 1000;
/** Notice batches per tick - enough to clear a backlog within the hour. */
const SWEEP_BATCHES = 4;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick() {
  // A slow tick must not overlap the next one and double-act.
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < SWEEP_BATCHES; i++) {
      const { checked } = await sweepBounceNotices();
      if (checked < 300) break;
    }
    const { users, changed } = await runAutopilot();
    if (changed > 0) console.log(`[Autopilot] ${changed} change(s) across ${users} account(s)`);
  } catch (err: any) {
    console.error('[Autopilot] Tick failed:', err?.message || err);
  } finally {
    running = false;
  }
}

export function startAutopilotScheduler() {
  console.log('[Autopilot] Scheduler started (every 10 minutes)');
  // Shortly after boot rather than at it, so startup is not slowed.
  setTimeout(tick, 30_000);
  timer = setInterval(tick, TICK_MS);
  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.log('[Autopilot] Scheduler stopped');
      }
    },
  };
}
