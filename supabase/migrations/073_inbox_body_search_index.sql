-- ============================================================================
-- 073  Searching inside message bodies      OPTIONAL - read the trade-off
-- ============================================================================
--
-- RUN 072 FIRST. This depends on the pg_trgm and btree_gin extensions that
-- 072 creates, and it will fail on its own against a database that has not
-- had 072 applied.
--
-- WHAT THIS IS FOR
--
-- The Unibox search box does not only match the subject and the sender, it
-- also matches the text of the message:
--
--     body_text ILIKE '%term%'
--
-- 072 indexed the subject and the sender address and deliberately left this
-- one out, because it is a different size of decision.
--
-- THE TRADE-OFF, PLAINLY
--
--   FOR    Without it, every Unibox search reads the full text of every
--          message in the account. This is the single most expensive query
--          in the product and it is on a screen people use all day.
--
--   AGAINST A trigram index over full message bodies is LARGE. Bodies are
--          thousands of times longer than a subject line, and the index
--          holds every three character sequence in all of them. Expect it
--          to be comparable to, or larger than, the text it indexes: on the
--          order of a few hundred megabytes for a hundred thousand
--          messages. It also has to be maintained on every insert, and the
--          IMAP sync inserts continuously.
--
-- WHICH TO CHOOSE
--
--   Run it if searching message text matters to how you work and the
--   mailbox is large enough that search feels slow.
--
--   Skip it if you mostly search by sender or subject. 072 already covers
--   both of those, and body search will keep working exactly as it does
--   today - it will just stay a scan.
--
-- This is reversible. To undo it:
--
--     drop index if exists idx_inbox_messages_user_body_trgm;
--
-- ============================================================================

set search_path = public, extensions;

-- fastupdate buffers new entries in an unsorted pending list and folds them
-- into the index in batches, which is what keeps the IMAP sync's inserts
-- cheap. It is the default; it is stated here because it is the property
-- that makes this index affordable to maintain, not an incidental setting.
create index if not exists idx_inbox_messages_user_body_trgm
  on inbox_messages using gin (user_id, body_text gin_trgm_ops)
  with (fastupdate = on);

analyze inbox_messages;
