import { runDigests, runMonthlyResults } from '../../services/digest.service.js';
import { beat } from '../../utils/heartbeat.js';
import { adminInsightsService } from '../../services/admin-insights.service.js';

/**
 * The weekly digest: every half hour, send the digest of any account whose
 * Monday 08:00 (in its own time zone) has passed since the last one - and,
 * on the 1st, last month's results. The owners' admin alerts ride along
 * on the same half-hourly tick (they are not a job anyone else sees).
 * Cross-tenant; never an authenticated route.
 */

const TICK_MS = 30 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let kickoff: ReturnType<typeof setTimeout> | null = null;

async function tick() {
  const { sent } = await runDigests();
  if (sent) console.log(`[Digest] ${sent} weekly digest(s) sent`);
  const monthly = await runMonthlyResults();
  if (monthly.sent) console.log(`[Results] ${monthly.sent} monthly results email(s) sent`);
  try {
    const alerts = await adminInsightsService.runAlerts();
    if (alerts.length) console.log(`[AdminAlerts] Sent: ${alerts.join(', ')}`);
  } catch (err: any) {
    console.warn(`[AdminAlerts] Check failed: ${err?.message || err}`);
  }
}

export function startDigestScheduler() {
  console.log('[Digest] Scheduler started (every 30 minutes)');
  kickoff = setTimeout(() => beat('digest', tick), 3 * 60 * 1000);
  timer = setInterval(() => beat('digest', tick), TICK_MS);
  return {
    stop: () => {
      if (kickoff) { clearTimeout(kickoff); kickoff = null; }
      if (timer) { clearInterval(timer); timer = null; console.log('[Digest] Scheduler stopped'); }
    },
  };
}
