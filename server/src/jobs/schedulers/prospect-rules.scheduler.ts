import { runDueRules } from '../../services/prospect-rules.service.js';

/**
 * Standing searches. Cross-tenant, so a scheduler and never a route.
 * Hourly is plenty: the finest cadence a rule can have is daily.
 */
const SWEEP_MS = 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const n = await runDueRules();
    if (n > 0) console.log(`[ProspectRules] ran ${n} standing search(es)`);
  } catch (err: any) {
    console.error('[ProspectRules] sweep failed:', err.message);
  } finally {
    running = false;
  }
}

export function startProspectRulesScheduler() {
  if (timer) return { stop: () => {} };
  timer = setInterval(tick, SWEEP_MS);
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
