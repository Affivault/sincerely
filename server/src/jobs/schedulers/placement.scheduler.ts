import { placementService } from '../../services/placement.service.js';

/**
 * Looking for the probes.
 *
 * Mail takes minutes to arrive, so a placement test cannot be answered
 * inside the request that started it. This sweeps everything still being
 * looked for, oldest poll first.
 *
 * Every test resolves. A probe that has not appeared within the wait
 * window is recorded as missing rather than left pending forever - a
 * report stuck on "waiting" tells you nothing and never stops telling
 * you nothing, which is worse than a result you can act on.
 *
 * Cross-tenant, so it is a scheduler and never an authenticated route.
 */

const SWEEP_MS = 2 * 60 * 1000;
/** Per sweep. Each one opens an IMAP connection per outstanding seed. */
const BATCH = 5;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runPlacementSweep(): Promise<number> {
  const ids = await placementService.due(BATCH);
  let polled = 0;

  for (const id of ids) {
    try {
      await placementService.poll(id);
      polled++;
    } catch (err: any) {
      // One unreachable seed must not stop the rest of the sweep, and the
      // test stays waiting so the next pass tries it again.
      console.error(`[Placement] Sweep failed for test ${id}: ${err?.message || err}`);
    }
  }

  return polled;
}

export function startPlacementScheduler() {
  if (timer) return { stop: () => {} };

  const tick = async () => {
    // Overlap is the failure that matters here: an IMAP search over a big
    // mailbox can outlast the interval, and two sweeps racing would open
    // two connections to the same seed and trip the provider's limit.
    if (running) return;
    running = true;
    try {
      const polled = await runPlacementSweep();
      if (polled > 0) console.log(`[Placement] Polled ${polled} test(s)`);
    } catch (err: any) {
      console.error(`[Placement] Sweep error: ${err?.message || err}`);
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, SWEEP_MS);
  // Not on boot: a restart during a deploy would have every instance
  // sweeping at once. The first tick is one interval away.
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
