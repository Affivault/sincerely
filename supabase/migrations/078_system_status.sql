-- 078: Is everything running?
--
-- 1. job_heartbeats: every background job (sending, inbox sync, autopilot,
--    warm-up and the rest) records when it last started, finished and
--    succeeded, so the status page can tell a stalled job from a quiet
--    one. One row per job. Written and read only by the server.
-- 2. system_alerts: what the watchdog has already told each account
--    about, so a problem is announced once (Slack/webhook) and its
--    clearing is announced once too.
--
-- Safe to run more than once.

create table if not exists job_heartbeats (
  job text primary key,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  duration_ms integer,
  instance text,
  updated_at timestamptz not null default now()
);

-- Server-only: no policy, so no signed-in user can read or write it
-- directly. The status page reads it through the server.
alter table job_heartbeats enable row level security;

create table if not exists system_alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  level text not null,
  title text not null,
  detail text,
  first_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (user_id, key)
);

create index if not exists idx_system_alerts_open on system_alerts (user_id) where resolved_at is null;

alter table system_alerts enable row level security;

drop policy if exists "Users read their own system alerts" on system_alerts;
create policy "Users read their own system alerts"
  on system_alerts for select
  using (auth.uid() = user_id);
