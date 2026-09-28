import { app } from './app.js';
import { env } from './config/env.js';
import { startSequenceWorker } from './jobs/workers/sequence.worker.js';
import { startVerificationWorker } from './jobs/workers/verification.worker.js';
import { startInboxScheduler } from './jobs/schedulers/inbox.scheduler.js';
import { startSseMaintenanceScheduler } from './jobs/schedulers/sse-maintenance.scheduler.js';
import { startWarmupScheduler } from './jobs/schedulers/warmup.scheduler.js';
import { startPlacementScheduler } from './jobs/schedulers/placement.scheduler.js';
import { startProspectRulesScheduler } from './jobs/schedulers/prospect-rules.scheduler.js';
import { startAbPromoteScheduler } from './jobs/schedulers/ab-promote.scheduler.js';
import { startBookingReminderScheduler } from './jobs/schedulers/booking-reminder.scheduler.js';
import { startDomainReverifyScheduler } from './jobs/schedulers/domain-reverify.scheduler.js';

const port = parseInt(env.PORT, 10);

// Disposers for everything started at boot, drained on shutdown.
const disposers: Array<() => void | Promise<void>> = [];

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API: ${env.API_BASE_URL}/api/v1`);
  console.log(`Health: ${env.API_BASE_URL}/health`);

  // Start background workers
  try {
    const sequenceWorker = startSequenceWorker();
    if (sequenceWorker) disposers.push(() => sequenceWorker.stop());
    console.log('Sequence worker started');
  } catch (err: any) {
    console.warn('Sequence worker failed to start:', err.message);
  }

  // Schedule periodic inbox sync (every 5 minutes)
  try {
    const inboxScheduler = startInboxScheduler();
    if (inboxScheduler) disposers.push(() => inboxScheduler.stop());
    console.log('Inbox sync scheduler started');
  } catch (err: any) {
    console.warn('Inbox scheduler failed to start:', err.message);
  }

  // Auto-verify contacts in the background (throttled)
  try {
    const verifyWorker = startVerificationWorker();
    if (verifyWorker) disposers.push(() => verifyWorker.stop());
    console.log('Verification worker started');
  } catch (err: any) {
    console.warn('Verification worker failed to start:', err.message);
  }

  // Daily SMTP send-count reset + bounce-rate recalculation (cross-tenant
  // maintenance — intentionally not exposed over HTTP, see sse.routes.ts)
  try {
    const sseMaintenance = startSseMaintenanceScheduler();
    if (sseMaintenance) disposers.push(() => sseMaintenance.stop());
    console.log('SSE maintenance scheduler started');
  } catch (err: any) {
    console.warn('SSE maintenance scheduler failed to start:', err.message);
  }

  // Warm-up engine: trickle warm-up emails between a user's own mailboxes.
  try {
    const warmup = startWarmupScheduler();
    if (warmup) disposers.push(() => warmup.stop());
    console.log('Warm-up scheduler started');
  } catch (err: any) {
    console.warn('Warm-up scheduler failed to start:', err.message);
  }

  // Inbox placement: look for the seed probes of any test still running.
  try {
    const placement = startPlacementScheduler();
    if (placement) disposers.push(() => placement.stop());
    console.log('Placement scheduler started');
  } catch (err: any) {
    console.warn('Placement scheduler failed to start:', err.message);
  }

  // Remind invitees the day before a booked meeting (cross-tenant).
  try {
    const bookingReminders = startBookingReminderScheduler();
    if (bookingReminders) disposers.push(() => bookingReminders.stop());
    console.log('Booking reminder scheduler started');
  } catch (err: any) {
    console.warn('Booking reminder scheduler failed to start:', err.message);
  }

  // Standing searches: prospect, verify and enrol on a cadence (cross-tenant).
  try {
    const prospectRules = startProspectRulesScheduler();
    if (prospectRules) disposers.push(() => prospectRules.stop());
    console.log('Standing search scheduler started');
  } catch (err: any) {
    console.warn('Standing search scheduler failed to start:', err.message);
  }

  // End settled A/B tests on campaigns that asked for it (cross-tenant).
  try {
    const abPromote = startAbPromoteScheduler();
    if (abPromote) disposers.push(() => abPromote.stop());
    console.log('A/B auto-promote scheduler started');
  } catch (err: any) {
    console.warn('A/B auto-promote scheduler failed to start:', err.message);
  }

  // Re-check sending/tracking domains that are marked verified, so a DKIM
  // rotation or an expired tracking-domain cert doesn't go unnoticed forever.
  try {
    const domainReverify = startDomainReverifyScheduler();
    if (domainReverify) disposers.push(() => domainReverify.stop());
    console.log('Domain re-verify scheduler started');
  } catch (err: any) {
    console.warn('Domain re-verify scheduler failed to start:', err.message);
  }
});

// Graceful shutdown: stop accepting connections, then drain workers/timers so
// the process exits cleanly when the orchestrator sends SIGTERM/SIGINT.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down gracefully...`);

  // Force-exit guard in case a handle refuses to close.
  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(() => console.log('HTTP server closed'));

  await Promise.allSettled(disposers.map((dispose) => dispose()));

  clearTimeout(forceExit);
  console.log('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

/*
 * Keep-alive longer than the proxy in front of us.
 *
 * Node closes an idle keep-alive socket after 5 seconds by default. Render's
 * proxy (like most load balancers) holds idle upstream connections open far
 * longer, so it regularly sends the next request down a socket Node has just
 * closed. That request gets a 502 from the proxy - no CORS headers, so the
 * browser can only say "Network Error" - and it looks completely random,
 * because it depends on how long the connection happened to sit idle.
 * headersTimeout must stay above keepAliveTimeout or Node rejects the
 * reused socket itself.
 */
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

/*
 * The last line of defence: one failed background job is not a reason to
 * drop every request in flight.
 *
 * With nothing here, a promise rejected in a worker with no catch, or an
 * 'error' emitted by a socket with no listener, ended the process. Render
 * restarted it, and every open request in every browser failed together -
 * the other half of the "random Network Error". These are logged loudly,
 * with the stack, so the cause is fixed at its source rather than hidden;
 * the process keeps serving meanwhile.
 */
process.on('unhandledRejection', (reason: any) => {
  console.error('[process] Unhandled promise rejection (contained):', reason?.stack || reason);
});
process.on('uncaughtException', (err: any) => {
  console.error('[process] Uncaught exception (contained):', err?.stack || err);
});
