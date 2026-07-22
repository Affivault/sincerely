import { supabaseAdmin } from '../../config/supabase.js';
import { inboxSyncQueue } from '../queues.js';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Periodically enqueue inbox sync jobs for all active SMTP accounts.
 * Runs every 5 minutes.
 */
export function scheduleInboxSync() {
  if (!inboxSyncQueue) {
    console.log('Inbox sync scheduler skipped — no Redis connection');
    return null;
  }
  const queue = inboxSyncQueue;
  let isRunning = false;
  async function syncAll() {
    if (isRunning) return; // Skip if a previous enqueue pass is still in flight
    isRunning = true;
    try {
      // Get all verified, active SMTP accounts
      const { data: accounts } = await supabaseAdmin
        .from('smtp_accounts')
        .select('id, user_id, smtp_host, smtp_user, imap_user, email_address')
        .eq('is_active', true)
        .eq('is_verified', true);

      if (!accounts || accounts.length === 0) return;

      for (const account of accounts) {
        await queue.add(
          `inbox-sync-${account.id}`,
          {
            userId: account.user_id,
            smtpAccountId: account.id,
            imapHost: '', // Worker will derive from SMTP host
            imapPort: 993,
            imapSecure: true,
            imapUser: account.imap_user || account.smtp_user || account.email_address,
          },
          {
            // Deduplicate: don't enqueue if already pending for this account
            jobId: `inbox-${account.id}-${Math.floor(Date.now() / SYNC_INTERVAL_MS)}`,
          }
        );
      }
    } catch (err) {
      console.error('Inbox sync scheduler error:', err);
    } finally {
      isRunning = false;
    }
  }

  // Run immediately then on interval
  syncAll();
  const intervalId = setInterval(syncAll, SYNC_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(intervalId);
      console.log('Inbox sync scheduler stopped');
    },
  };
}
