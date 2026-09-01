import { supabaseAdmin } from '../../config/supabase.js';
import { inboxSyncService } from '../../services/inbox-sync.service.js';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Periodically run the real inbox sync (inbox-sync.service.ts) for every
 * user with a connected, verified mailbox.
 *
 * This used to hand accounts off to a BullMQ worker running an older, since-
 * replaced sync: it re-fetched the entire current day on every tick (IMAP's
 * SINCE compares dates, not instants), queried the database once per message
 * to dedupe, never read Sent, and had no per-run cap. inbox-sync.service.ts
 * fixed all of that, but was only ever reachable through the manual
 * "Sync now" button — so every mailbox synced automatically was, until now,
 * silently going through the broken path regardless. Calling the same
 * service here closes that gap; the old worker and its queue are gone.
 *
 * Cross-tenant, so it is a scheduler and never an authenticated route.
 */
export function startInboxScheduler() {
  let running = false;

  async function tick() {
    if (running) return; // never overlap — a slow mailbox must not pile up runs
    running = true;
    try {
      const { data: accounts, error } = await supabaseAdmin
        .from('smtp_accounts')
        .select('user_id')
        .eq('is_active', true)
        .eq('is_verified', true);

      if (error) {
        console.error('[InboxScheduler] Could not list accounts:', error.message);
        return;
      }

      const userIds = Array.from(new Set((accounts || []).map((a) => a.user_id)));
      for (const userId of userIds) {
        try {
          await inboxSyncService.syncInbox(userId);
        } catch (err: any) {
          // One user's mailbox failure must not stop the sweep for everyone else.
          console.error(`[InboxScheduler] Sync failed for user ${userId}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error('[InboxScheduler] Sweep failed:', err.message);
    } finally {
      running = false;
    }
  }

  // Run immediately then on interval — replies should catch up promptly
  // after a deploy, not wait a full cycle.
  tick();
  const intervalId = setInterval(tick, SYNC_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(intervalId);
      console.log('Inbox sync scheduler stopped');
    },
  };
}
