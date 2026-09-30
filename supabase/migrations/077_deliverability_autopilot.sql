-- 077: Deliverability autopilot, and bounces that arrive as email.
--
-- 1. Each mailbox carries an autopilot state: active, slowed, resting or
--    recovering. The autopilot rests a mailbox that is bouncing or being
--    blocked, brings it back gradually, and moves its volume to healthy
--    mailboxes meanwhile. evidence_from is where the next judgement starts
--    reading, so a mailbox coming back from a rest is judged on what it
--    sends now, not on the bounces that sent it to rest.
-- 2. autopilot_holds: a receiving provider (gmail.com, outlook.com, or a
--    company domain) that has started refusing your mail is paused for a
--    few hours rather than hammered.
-- 3. autopilot_events: everything the autopilot did, in plain words, for
--    the activity log and the weekly summary.
-- 4. Settings: autopilot on or off (on by default), and when the last
--    weekly summary went out.
-- 5. inbox_messages.bounce_checked_at: bounce notices are now read (they
--    were filed under Other mail and never acted on). This marks a message
--    as read for bounces so the sweep does not read it twice.
--
-- Safe to run more than once.

alter table smtp_accounts add column if not exists autopilot_state text not null default 'active';
alter table smtp_accounts add column if not exists autopilot_reason text;
alter table smtp_accounts add column if not exists autopilot_since timestamptz;
alter table smtp_accounts add column if not exists autopilot_rest_until timestamptz;
alter table smtp_accounts add column if not exists autopilot_recovery_day integer not null default 0;
alter table smtp_accounts add column if not exists autopilot_evidence_from timestamptz;
alter table smtp_accounts add column if not exists autopilot_last_rest_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'smtp_accounts_autopilot_state_check') then
    alter table smtp_accounts add constraint smtp_accounts_autopilot_state_check
      check (autopilot_state in ('active', 'slowed', 'resting', 'recovering'));
  end if;
end $$;

create table if not exists autopilot_holds (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  held_until timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create index if not exists idx_autopilot_holds_until on autopilot_holds (user_id, held_until);

alter table autopilot_holds enable row level security;

drop policy if exists "Users read their own autopilot holds" on autopilot_holds;
create policy "Users read their own autopilot holds"
  on autopilot_holds for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists autopilot_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  smtp_account_id uuid references smtp_accounts(id) on delete set null,
  provider text,
  kind text not null,
  title text not null,
  detail text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_autopilot_events_user on autopilot_events (user_id, created_at desc);

alter table autopilot_events enable row level security;

drop policy if exists "Users read their own autopilot events" on autopilot_events;
create policy "Users read their own autopilot events"
  on autopilot_events for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table user_settings add column if not exists autopilot_enabled boolean not null default true;
alter table user_settings add column if not exists autopilot_digest_sent_at timestamptz;

alter table inbox_messages add column if not exists bounce_checked_at timestamptz;

-- The sweep reads recent notices that have not been checked yet.
create index if not exists idx_inbox_messages_bounce_unchecked
  on inbox_messages (received_at desc)
  where bounce_checked_at is null and direction = 'inbound';

-- The autopilot reads each account's last seven days of sends and bounces.
create index if not exists idx_campaign_activities_type_time
  on campaign_activities (activity_type, occurred_at desc);
