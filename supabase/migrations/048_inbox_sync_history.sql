-- ============================================================================
-- 048: Bring history with a connected mailbox, and sync it properly.
--
-- Connecting a mailbox fetched the last seven days of INBOX and nothing else,
-- with no setting anywhere. The inbox opened nearly empty, a reply to a
-- campaign sent three weeks earlier was invisible, and every thread was
-- one-sided because the Sent folder was never read at all.
--
-- Three things are needed to fix that properly:
--
--   1. A chosen window. A month suits most people; six months on a busy
--      mailbox is tens of thousands of messages and should be opted into.
--
--   2. Somewhere to remember progress per folder. A six-month backfill cannot
--      run in one request, so it runs in slices and has to survive a restart,
--      a timeout, and a connection that drops halfway.
--
--   3. A database-level guarantee against duplicates. The old sync asked
--      "have I stored this one?" with a separate query per message, which is
--      both a round trip per message and a race: two overlapping syncs could
--      each be told no and both insert.
--
-- Safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. How far back this mailbox reaches.
--
-- On the account rather than the user: someone may want six months of the
-- inbox they actually sell from and one month of everything else, and the
-- cost of the choice is per mailbox.
-- ----------------------------------------------------------------------------
ALTER TABLE smtp_accounts
  ADD COLUMN IF NOT EXISTS inbox_sync_months integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'smtp_accounts_inbox_sync_months_check'
  ) THEN
    ALTER TABLE smtp_accounts
      ADD CONSTRAINT smtp_accounts_inbox_sync_months_check
      CHECK (inbox_sync_months IN (1, 3, 6));
  END IF;
END $$;

-- Why the last sync failed, so the mailbox can say so instead of the inbox
-- simply looking empty.
ALTER TABLE smtp_accounts
  ADD COLUMN IF NOT EXISTS last_inbox_sync_error text;

-- ----------------------------------------------------------------------------
-- 2. Per-folder sync state.
--
-- A table rather than more columns on smtp_accounts, because there is one of
-- these per folder and the set of folders grows: INBOX and Sent today,
-- Archive and Spam are the obvious next ones.
--
-- uid_validity is not decoration. IMAP UIDs are only meaningful within a
-- UIDVALIDITY generation; a server that renumbers a mailbox starts again at 1,
-- so a stored "last UID seen" of 40000 would silently skip every message until
-- the mailbox grew past it again. Storing it is what makes "fetch UID N+1:*"
-- safe to rely on.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imap_folder_state (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  smtp_account_id  uuid NOT NULL REFERENCES smtp_accounts(id) ON DELETE CASCADE,
  -- The server's own name for it ("INBOX", "[Gmail]/Sent Mail", "Sent Items").
  folder           text NOT NULL,
  -- What it is for, since the name differs by provider.
  role             text NOT NULL DEFAULT 'inbox',
  uid_validity     bigint,
  last_uid         bigint,
  -- How far back the backfill has reached. Null = it has not started.
  backfill_cursor  timestamptz,
  backfill_done    boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_imap_folder_state_account_folder
  ON imap_folder_state (smtp_account_id, folder);

CREATE INDEX IF NOT EXISTS idx_imap_folder_state_pending
  ON imap_folder_state (smtp_account_id)
  WHERE NOT backfill_done;

ALTER TABLE imap_folder_state ENABLE ROW LEVEL SECURITY;

-- Reached through the owning smtp_account, which is the thing that carries the
-- user id.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'imap_folder_state' AND policyname = 'Users manage their own folder sync state'
  ) THEN
    CREATE POLICY "Users manage their own folder sync state"
      ON imap_folder_state FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM smtp_accounts a
          WHERE a.id = imap_folder_state.smtp_account_id AND a.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS imap_folder_state_updated_at ON imap_folder_state;
CREATE TRIGGER imap_folder_state_updated_at
  BEFORE UPDATE ON imap_folder_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Make a duplicate message impossible.
--
-- Any existing duplicates have to go first, or the index cannot be built. The
-- oldest row of each set is kept: it is the one other rows already reference.
--
-- Only rows carrying a Message-ID are covered, because that is the only field
-- that identifies a message across folders and accounts. Mail with no
-- Message-ID at all is handled by (account, folder, uid) below.
-- ----------------------------------------------------------------------------
DELETE FROM inbox_messages a
USING inbox_messages b
WHERE a.message_id IS NOT NULL
  AND a.message_id = b.message_id
  AND a.user_id = b.user_id
  AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_messages_user_message_id
  ON inbox_messages (user_id, message_id)
  WHERE message_id IS NOT NULL;

-- The fallback identity, for mail that arrives without a Message-ID. Without
-- it those messages were re-inserted on every single sync, forever, because
-- the old dedupe check skipped them entirely.
DELETE FROM inbox_messages a
USING inbox_messages b
WHERE a.message_id IS NULL
  AND b.message_id IS NULL
  AND a.imap_uid IS NOT NULL
  AND a.imap_uid = b.imap_uid
  AND a.smtp_account_id = b.smtp_account_id
  AND COALESCE(a.imap_folder, 'INBOX') = COALESCE(b.imap_folder, 'INBOX')
  AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_messages_account_folder_uid
  ON inbox_messages (smtp_account_id, imap_folder, imap_uid)
  WHERE imap_uid IS NOT NULL AND message_id IS NULL;

-- ----------------------------------------------------------------------------
-- 4. Reading a mailbox's history back.
--
-- The inbox lists by received_at within a user; with six months of mail behind
-- it that ordering is worth an index of its own.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inbox_messages_user_received
  ON inbox_messages (user_id, received_at DESC);

-- "How far back does this mailbox go", asked once per mailbox by the sync
-- status endpoint.
CREATE INDEX IF NOT EXISTS idx_inbox_messages_account_received
  ON inbox_messages (smtp_account_id, received_at);
