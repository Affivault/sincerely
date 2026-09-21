-- ============================================================
-- 070: Inbox placement testing
--
-- Everything else in this product is in service of deliverability and
-- none of it could measure where mail actually lands. A seed test sends
-- the same message to mailboxes the account controls at each provider,
-- then reads those mailboxes over IMAP to find which folder it is in.
--
-- Seed mailboxes are ordinary smtp_accounts rows with is_seed set, so
-- they inherit every bit of connection, verification and IMAP plumbing
-- that already exists. The flag is what keeps them out of the sending
-- pool: a seed that quietly started carrying campaign mail would both
-- ruin the measurement and send from the wrong address.
-- ============================================================

alter table smtp_accounts
  add column if not exists is_seed boolean not null default false;

comment on column smtp_accounts.is_seed is
  'A seed mailbox: receives placement probes, never sends campaigns.';

-- Sending queries filter on this constantly; keep the common case cheap.
create index if not exists idx_smtp_accounts_sendable
  on smtp_accounts (user_id)
  where is_seed = false;

-- ============================================================
-- One run of a test
-- ============================================================

create table if not exists placement_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The mailbox under test.
  smtp_account_id uuid not null references smtp_accounts(id) on delete cascade,

  -- Where the message came from, when it was taken from real copy rather
  -- than typed. Null for an ad-hoc test.
  campaign_id uuid references campaigns(id) on delete set null,
  step_id uuid references campaign_steps(id) on delete set null,

  subject text not null,
  body_html text,

  -- The needle. Sent as a header and as the Message-ID local part, so a
  -- provider that rewrites one can still be matched on the other.
  token text not null unique,

  -- sending -> waiting -> complete. failed means nothing could be sent.
  status text not null default 'sending',
  error text,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_polled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_placement_tests_user
  on placement_tests (user_id, created_at desc);

-- The poller's working set: everything still being looked for, oldest
-- first. Partial, because finished tests are the overwhelming majority
-- and never need scanning again.
create index if not exists idx_placement_tests_waiting
  on placement_tests (last_polled_at nulls first)
  where status in ('sending', 'waiting');

alter table placement_tests enable row level security;

drop policy if exists "Users manage their own placement tests" on placement_tests;
create policy "Users manage their own placement tests"
  on placement_tests for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- One probe, to one seed
-- ============================================================

create table if not exists placement_results (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references placement_tests(id) on delete cascade,
  seed_account_id uuid not null references smtp_accounts(id) on delete cascade,

  -- Recorded at send time rather than derived later: a seed can be edited
  -- or deleted afterwards, and the result has to keep meaning what it
  -- meant when it was measured.
  provider text not null default 'other',
  seed_email text not null,

  -- pending | inbox | spam | missing | error
  --
  -- error is separate from missing on purpose. A probe that never left
  -- our own SMTP server says nothing about the receiving provider, and
  -- counting it as a delivery failure blames a spam filter for our
  -- outage.
  placement text not null default 'pending',

  -- The folder it was actually found in, kept so a surprising verdict can
  -- be checked rather than taken on trust.
  folder text,
  send_error text,
  found_at timestamptz,

  created_at timestamptz not null default now(),

  -- One probe per seed per test. Re-running a test makes a new test row.
  unique (test_id, seed_account_id)
);

create index if not exists idx_placement_results_test
  on placement_results (test_id);

alter table placement_results enable row level security;

-- Scoped through the parent test, which is where the owner lives.
drop policy if exists "Users read their own placement results" on placement_results;
create policy "Users read their own placement results"
  on placement_results for all
  using (
    exists (
      select 1 from placement_tests t
      where t.id = placement_results.test_id
        and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from placement_tests t
      where t.id = placement_results.test_id
        and t.user_id = auth.uid()
    )
  );
