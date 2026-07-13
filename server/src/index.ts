import { app } from './app.js';
import { env } from './config/env.js';
import { startSequenceWorker } from './jobs/workers/sequence.worker.js';
import { startInboxWorker } from './jobs/workers/inbox.worker.js';
import { startVerificationWorker } from './jobs/workers/verification.worker.js';
import { scheduleInboxSync } from './jobs/schedulers/inbox.scheduler.js';
import { startSseMaintenanceScheduler } from './jobs/schedulers/sse-maintenance.scheduler.js';
import { startWarmupScheduler } from './jobs/schedulers/warmup.scheduler.js';

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

  try {
    const inboxWorker = startInboxWorker();
    if (inboxWorker) disposers.push(() => inboxWorker.close());
    console.log('Inbox sync worker started');
  } catch (err: any) {
    console.warn('Inbox worker failed to start:', err.message);
  }

  // Schedule periodic inbox sync (every 5 minutes)
  try {
    const inboxScheduler = scheduleInboxSync();
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
