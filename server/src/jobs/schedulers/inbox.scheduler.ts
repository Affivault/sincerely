import { supabaseAdmin } from '../../config/supabase.js';
import { inboxSyncService } from '../../services/inbox-sync.service.js';
import { beat } from '../../utils/heartbeat.js';
import { fetchAllPages } from '../../utils/batch.js';
import { inboxRemindersService } from '../../services/inbox-reminders.service.js';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
/*
 * Snoozes and nudges run every minute, not with the five-minute sync:
 * "snooze until 2pm" that comes back at 2:04 reads as broken. Each tick is
 * two small indexed statements, so the extra frequency costs nothing.
 */
const REMINDER_INTERVAL_MS = 60 * 1000;

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
      // Paged: PostgREST caps an unpaged select at 1000 rows, so every
      // mailbox past the first thousand silently never synced.
      const accounts = await fetchAllPages<{ user_id: string }>((from, to) => supabaseAdmin
        .from('smtp_accounts')
        .select('user_id')
        .eq('is_active', true)
        .eq('is_verified', true)
        .order('id')
        .range(from, to))
        .catch((err: any) => { throw new Error(`Could not list accounts: ${err.message}`); });

      const userIds = Array.from(new Set(accounts.map((a) => a.user_id)));
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
      throw err; // so the heartbeat records the failure
    } finally {
      running = false;
    }
  }

  /*
   * Wake snoozed conversations and check due nudges, across every account.
   * Separate from the sync so a slow mailbox can never hold a snooze past
   * its time, and with its own heartbeat so the status page can say which
   * of the two has stopped.
   */
  async function remindersTick() {
    const { woken, fired, answered } = await inboxRemindersService.sweep();
    if (woken || fired || answered) {
      console.log(`[InboxScheduler] Reminders: ${woken} snoozed message(s) back, ${fired} nudge(s) fired, ${answered} answered in time`);
    }
  }

  // Run immediately then on interval — replies should catch up promptly
  // after a deploy, not wait a full cycle.
  beat('inbox', tick);
  const intervalId = setInterval(() => beat('inbox', tick), SYNC_INTERVAL_MS);
  beat('inbox_reminders', remindersTick);
  const remindersId = setInterval(() => beat('inbox_reminders', remindersTick), REMINDER_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(intervalId);
      clearInterval(remindersId);
      console.log('Inbox sync scheduler stopped');
    },
  };
}
