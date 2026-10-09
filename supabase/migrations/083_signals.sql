-- 083: Moments - who to email today, and why.
--
-- 1. signals: each moment Relay finds - someone reading again, a "not now"
--    whose time has come, a lost deal three months on, several people at
--    one company engaging, a yes that went quiet, a past replier who moved
--    on, or a change on a company's website. Each carries its evidence.
--    dedupe_key stops the same moment being raised twice.
-- 2. company_pages: the pages Relay watches on each company's website
--    (home, careers, news) and what they said last time, so a change can
--    be seen.
-- 3. user_settings.signals_web: watch company websites. Off until the
--    person switches it on.
-- 4. user_settings.signal_topics: what counts as a moment on a website for
--    this account, e.g. [{"label": "Hiring a fleet manager", "on": true}].
--
-- Safe to run more than once.

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  contact_id uuid references contacts(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  headline text not null,
  detail text,
  evidence_url text,
  evidence_quote text,
  strength smallint not null default 2,
  opener text,
  status text not null default 'new',
  dedupe_key text not null,
  occurred_at timestamptz not null default now(),
  acted_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signals_status_check') then
    alter table signals add constraint signals_status_check check (status in ('new', 'acted', 'dismissed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'signals_strength_check') then
    alter table signals add constraint signals_strength_check check (strength between 1 and 3);
  end if;
end $$;

create unique index if not exists idx_signals_dedupe on signals (user_id, dedupe_key);
create index if not exists idx_signals_user_status on signals (user_id, status, occurred_at desc);

alter table signals enable row level security;

drop policy if exists "Users read their own signals" on signals;
create policy "Users read their own signals"
  on signals for select
  using (auth.uid() = user_id);

create table if not exists company_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null,
  url text not null,
  fingerprint text,
  content text,
  fetched_at timestamptz,
  changed_at timestamptz,
  failures integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_pages_kind_check') then
    alter table company_pages add constraint company_pages_kind_check check (kind in ('home', 'careers', 'news'));
  end if;
end $$;

create unique index if not exists idx_company_pages_url on company_pages (user_id, company_id, url);
create index if not exists idx_company_pages_due on company_pages (user_id, fetched_at);

alter table company_pages enable row level security;

drop policy if exists "Users read their own company pages" on company_pages;
create policy "Users read their own company pages"
  on company_pages for select
  using (auth.uid() = user_id);

alter table user_settings add column if not exists signals_web boolean not null default false;
alter table user_settings add column if not exists signal_topics jsonb not null default '[]'::jsonb;
