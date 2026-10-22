-- 090: Remember what was attached to an email in the inbox.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- Synced mail kept the text and dropped every attachment without a trace,
-- so a reply carrying a signed contract or a requested PDF looked like a
-- bare "see attached". The name, type and size of each attachment are now
-- kept, so the message says what came with it and where to open it. The
-- files themselves stay in the mailbox they arrived in.
--
-- attachments is a JSON array of {filename, content_type, size}, or NULL
-- for messages synced before this migration.

ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS attachments jsonb;
