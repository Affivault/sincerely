/* ═══════════════════════════════════════════════════════════════════════
   How much mail a connected mailbox brings with it.

   Connecting a mailbox used to fetch the last seven days of INBOX and
   nothing else, with no setting anywhere. So the inbox opened nearly empty,
   a reply to a campaign sent three weeks ago was invisible, and every
   thread was one-sided because the Sent folder was never read.

   The window is a real choice: a month is enough for most people and costs
   little, six months on a busy mailbox is tens of thousands of messages and
   is worth opting into deliberately. Whichever is chosen, the backfill runs
   in bounded slices and remembers where it got to, so it survives a
   restart, a timeout and a connection that drops halfway.
   ═══════════════════════════════════════════════════════════════════════ */

/** How far back a newly connected mailbox reaches. */
export const SYNC_WINDOW_MONTHS = [1, 3, 6] as const;
export type SyncWindowMonths = (typeof SYNC_WINDOW_MONTHS)[number];

export const DEFAULT_SYNC_WINDOW_MONTHS: SyncWindowMonths = 1;

export function isSyncWindow(value: unknown): value is SyncWindowMonths {
  return (SYNC_WINDOW_MONTHS as readonly number[]).includes(Number(value));
}

export function syncWindowLabel(months: SyncWindowMonths): string {
  return months === 1 ? 'Last month' : `Last ${months} months`;
}

/** The folders this platform reads. Sent matters: a thread needs both halves. */
export type SyncFolderRole = 'inbox' | 'sent';

export interface FolderSyncState {
  folder: string;
  role: SyncFolderRole;
  /**
   * IMAP's own generation counter for the mailbox. If the server changes it,
   * every UID we hold is meaningless and the mailbox has to be re-read.
   */
  uid_validity: number | null;
  /** Highest UID already stored, so new mail is fetched by UID, not by date. */
  last_uid: number | null;
  /** How far back the backfill has reached. Null = it has not started. */
  backfill_cursor: string | null;
  backfill_done: boolean;
  updated_at: string | null;
}

/** What one account's sync has achieved, for the UI to report honestly. */
export interface InboxSyncProgress {
  smtp_account_id: string;
  email_address: string;
  window_months: SyncWindowMonths;
  /** The oldest message this mailbox has reached, or null before it starts. */
  oldest_synced_at: string | null;
  /** True once history back to the window has been read. */
  history_complete: boolean;
  /** Messages stored for this mailbox. */
  stored: number;
  last_synced_at: string | null;
  last_error: string | null;
}

export interface InboxSyncResult {
  synced: number;
  newMessages: number;
  /** Older messages pulled in by the backfill on this run. */
  backfilled: number;
  /** True while there is still history left to fetch. */
  more: boolean;
  errors?: string[];
  progress?: InboxSyncProgress[];
}
