-- 079: Proving replies stop sequences, and the Notifications switches.
--
-- 1. reply_checks: the last result of each account's reply check - a real
--    email sent from one of its mailboxes, answered by another, read back
--    by inbox sync, matched and stopped. One row per account. The status
--    page shows it, the watchdog raises it after two failures in a row,
--    and the daily automatic check uses it to know when it last ran.
-- 2. user_settings.reply_check_daily: whether that check runs on its own
--    once a day. On unless switched off on the status page.
-- 3. user_settings.last_digest_sent_at: when the weekly digest last went
--    out, so it is sent once a week however many servers are running.
--
-- 4. Chat integrations (Slack, Discord, Telegram, Teams) were never
--    subscribed to the watchdog's "something needs attention" and "it
--    cleared" events - the integration settings could not even offer them
--    - so problems the status page promised to send to Slack never went.
--    Existing ones are subscribed to them now, and to spam complaints.
--
-- Spam complaints need no new table: they are recorded as campaign
-- activities ("complained") and on the suppression list, both of which
-- already allow them.
--
-- Safe to run more than once.

create table if not exists reply_checks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_run_at timestamptz,
  ok boolean,
  skipped boolean not null default false,
  failed_at text,
  detail text,
  result jsonb,
  consecutive_failures integer not null default 0,
  last_ok_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table reply_checks enable row level security;

drop policy if exists "Users read their own reply checks" on reply_checks;
create policy "Users read their own reply checks"
  on reply_checks for select
  using (auth.uid() = user_id);

alter table user_settings add column if not exists reply_check_daily boolean not null default true;
alter table user_settings add column if not exists last_digest_sent_at timestamptz;

update user_integrations
set events = array(
  select distinct e from unnest(events || array['system.attention', 'system.resolved', 'email.complained']) as e
)
where provider in ('slack', 'discord', 'telegram', 'teams')
  and not (events @> array['system.attention', 'system.resolved', 'email.complained']);
