-- The "Check connection" flow lets a user verify a separate IMAP username
-- (e.g. a custom mail server where the IMAP login differs from the mailbox's
-- email address), but smtp_accounts had no column to persist it — the value
-- was silently dropped on save, so real reply-sync and warm-up then
-- authenticated with the wrong (unverified) username. See smtp.service.ts,
-- inbox.scheduler.ts and warmup.service.ts, which now read this column.
alter table smtp_accounts add column if not exists imap_user text;
