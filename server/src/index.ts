import { app } from './app.js';
import { env } from './config/env.js';
import { startEmailWorker } from './jobs/workers/email.worker.js';
import { startSequenceWorker } from './jobs/workers/sequence.worker.js';
import { startInboxWorker } from './jobs/workers/inbox.worker.js';
import { startVerificationWorker } from './jobs/workers/verification.worker.js';
import { scheduleInboxSync } from './jobs/schedulers/inbox.scheduler.js';

const port = parseInt(env.PORT, 10);

// Disposers for everything started at boot, drained on shutdown.
const disposers: Array<() => void | Promise<void>> = [];

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API: ${env.API_BASE_URL}/api/v1`);
  console.log(`Health: ${env.API_BASE_URL}/health`);

  // Start background workers
  try {
    const emailWorker = startEmailWorker();
    if (emailWorker) disposers.push(() => emailWorker.close());
    console.log('Email worker started');
  } catch (err: any) {
    console.warn('Email worker failed to start (Redis may not be available):', err.message);
  }

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
