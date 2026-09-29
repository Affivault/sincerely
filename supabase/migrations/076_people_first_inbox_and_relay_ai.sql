-- 076: People-first inbox, Relay that reads, leads that fill themselves in.
--
-- 1. Every inbound message gets a kind: person, bulk, notification,
--    transactional or internal. Only people reach the inbox, the counts and
--    Relay. Rows stored before this are sorted by the app itself, in the
--    background, the first time the inbox is opened (mail_kind stays null
--    until then and is treated as a person).
-- 2. Relay keeps a one-line summary, a next step, and which engine read the
--    reply (Claude, or the keyword fallback).
-- 3. relay_previous_intent records what Relay used to think when a re-read
--    changes its mind, so contacts it wrongly unsubscribed can be offered
--    back.
-- 4. Contacts remember whether the address is a shared inbox (hello@,
--    partnerships@) and when they were last filled in from their domain.
-- 5. Settings hold what you sell and how you sound, for Relay's drafts and
--    the sequence writer.
--
-- Safe to run more than once.

alter table inbox_messages add column if not exists mail_kind text;
alter table inbox_messages add column if not exists sender_name text;
alter table inbox_messages add column if not exists relay_summary text;
alter table inbox_messages add column if not exists relay_next_step text;
alter table inbox_messages add column if not exists relay_engine text;
alter table inbox_messages add column if not exists relay_previous_intent text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inbox_messages_mail_kind_check') then
    alter table inbox_messages add constraint inbox_messages_mail_kind_check
      check (mail_kind is null or mail_kind in ('person', 'bulk', 'notification', 'transactional', 'internal'));
  end if;
end $$;

-- The people inbox, newest first.
create index if not exists idx_inbox_people_recent
  on inbox_messages (user_id, received_at desc)
  where mail_kind is null or mail_kind = 'person';

-- Other mail, and the background sort that finds unsorted rows.
create index if not exists idx_inbox_mail_kind
  on inbox_messages (user_id, mail_kind, received_at desc);

-- Contacts Relay unsubscribed on a reading it has since changed its mind about.
create index if not exists idx_inbox_relay_previous
  on inbox_messages (user_id)
  where relay_previous_intent is not null;

alter table contacts add column if not exists is_role_address boolean;
alter table contacts add column if not exists enriched_at timestamptz;

create index if not exists idx_contacts_unenriched
  on contacts (user_id)
  where enriched_at is null;

alter table user_settings add column if not exists relay_offer text not null default '';
alter table user_settings add column if not exists relay_tone text not null default 'friendly';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_relay_tone_check') then
    alter table user_settings add constraint user_settings_relay_tone_check
      check (relay_tone in ('friendly', 'direct', 'formal'));
  end if;
end $$;
