-- 081: Results - what the outreach produced, and sharing it.
--
-- 1. report_shares: read-only links to a period's results, for a manager
--    or a client. The token is the only key; a link is for one fixed
--    period, can hide campaign names, counts its views and can be
--    switched off (revoked_at). Read only through the server: no policy,
--    so no signed-in user can read another account's tokens directly.
-- 2. user_settings.monthly_results: last month's results by email on the
--    1st. On unless switched off in Settings, Notifications.
-- 3. user_settings.last_results_month: which month that email last
--    covered ("2026-09"), so it goes once however many servers run.
--
-- Safe to run more than once.

create table if not exists report_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  title text not null,
  period_label text not null,
  period_from timestamptz not null,
  period_to timestamptz not null,
  show_campaigns boolean not null default true,
  views integer not null default 0,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_report_shares_user on report_shares (user_id) where revoked_at is null;

alter table report_shares enable row level security;

alter table user_settings add column if not exists monthly_results boolean not null default true;
alter table user_settings add column if not exists last_results_month text;
