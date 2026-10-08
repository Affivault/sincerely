-- 082: Campaigns that improve themselves.
--
-- 1. campaigns.relay_improve: "Let Relay improve this campaign". Off until
--    the person switches it on.
-- 2. campaigns.relay_improve_auto: run each new test without asking first.
--    Off by default: Relay shows each new version and waits for Approve,
--    Edit or Skip.
-- 3. campaign_experiments: every test Relay proposes or runs - which email,
--    what it changed (subject, opening line or closing question), why, the
--    original and the new version, the sends and replies of each, how
--    likely the new one was to be better, and the plain-words result.
--    One running test per campaign at a time.
--
-- Tests use the A/B split the builder already has (subject_b, body_html_b)
-- and are judged on replies, never opens.
--
-- Safe to run more than once.

alter table campaigns add column if not exists relay_improve boolean not null default false;
alter table campaigns add column if not exists relay_improve_auto boolean not null default false;

create table if not exists campaign_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step_id uuid not null references campaign_steps(id) on delete cascade,
  email_number integer not null,
  element text not null,
  status text not null default 'proposed',
  why text,
  original jsonb not null,
  challenger jsonb not null,
  a_sent integer not null default 0,
  a_replies integer not null default 0,
  b_sent integer not null default 0,
  b_replies integer not null default 0,
  probability_b_better numeric,
  summary text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  decided_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_experiments_element_check') then
    alter table campaign_experiments
      add constraint campaign_experiments_element_check check (element in ('subject', 'opening', 'ask'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campaign_experiments_status_check') then
    alter table campaign_experiments
      add constraint campaign_experiments_status_check
      check (status in ('proposed', 'running', 'won', 'kept', 'skipped', 'stopped', 'undone'));
  end if;
end $$;

-- At most one live test (proposed or running) per campaign.
create unique index if not exists idx_campaign_experiments_one_live
  on campaign_experiments (campaign_id) where status in ('proposed', 'running');

create index if not exists idx_campaign_experiments_campaign
  on campaign_experiments (campaign_id, created_at desc);

alter table campaign_experiments enable row level security;

drop policy if exists "Users read their own experiments" on campaign_experiments;
create policy "Users read their own experiments"
  on campaign_experiments for select
  using (auth.uid() = user_id);
