import { warmupService } from '../../services/warmup.service.js';

/**
 * Warm-up Scheduler
 *
 * Trickles warm-up emails between each user's own verified mailboxes on a short
 * interval, so a mailbox's daily warm-up volume is spread across the day rather
 * than sent in a burst (bursts look like spam). Cross-tenant — never exposed
 * over an authenticated HTTP route.
 */

const SEND_MS = 12 * 60 * 1000;    // send warm-up mail every 12 minutes
const ENGAGE_MS = 10 * 60 * 1000;  // open / reply / rescue every 10 minutes
let sendId: ReturnType<typeof setInterval> | null = null;
let engageId: ReturnType<typeof setInterval> | null = null;

async function sendTick() {
  try {
    const sent = await warmupService.runWarmupTick();
    if (sent > 0) console.log(`[Warmup] sent ${sent} warm-up email(s) this tick`);
  } catch (err: any) {
    console.error('[Warmup] send tick failed:', err.message);
  }
}

async function engageTick() {
  try {
    const r = await warmupService.runEngagementTick();
    if (r.opened + r.replied + r.rescued > 0) {
      console.log(`[Warmup] engaged — opened ${r.opened}, replied ${r.replied}, rescued ${r.rescued}`);
    }
  } catch (err: any) {
    console.error('[Warmup] engage tick failed:', err.message);
  }
}

export function startWarmupScheduler() {
  console.log('[Warmup] Scheduler started (send 12m / engage 10m)');
  // Stagger the kickoffs so send and engage don't fire together at boot.
  const k1 = setTimeout(sendTick, 60 * 1000);
  const k2 = setTimeout(engageTick, 3 * 60 * 1000);
  sendId = setInterval(sendTick, SEND_MS);
  engageId = setInterval(engageTick, ENGAGE_MS);

  return {
    stop: () => {
      clearTimeout(k1); clearTimeout(k2);
      if (sendId) { clearInterval(sendId); sendId = null; }
      if (engageId) { clearInterval(engageId); engageId = null; }
      console.log('[Warmup] Scheduler stopped');
    },
  };
}
