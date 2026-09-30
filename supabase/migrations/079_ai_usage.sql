-- 079: What Relay's AI costs, and where it stops.
--
-- 1. ai_usage: every Claude call Relay makes (reading a reply, drafting an
--    answer, writing a sequence, personal first lines) is counted here,
--    per account, per month (UTC, "2026-09"), per feature: calls, input
--    tokens and output tokens. Written only by the server.
-- 2. record_ai_usage(): adds one call to those counters in a single
--    statement, so two calls finishing together cannot lose each other's
--    tokens. Only the server may run it.
-- 3. user_settings.ai_monthly_token_cap: a lower monthly allowance, in
--    tokens, that the account chose for itself. Null = the server's
--    ceiling (AI_MONTHLY_TOKEN_CAP), which an account can never exceed.
--    When the allowance is used up, Relay keeps working on its rules until
--    the month turns.
--
-- Safe to run more than once.

create table if not exists ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  feature text not null,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, month, feature)
);

alter table ai_usage enable row level security;

drop policy if exists "Users read their own AI usage" on ai_usage;
create policy "Users read their own AI usage"
  on ai_usage for select
  using (auth.uid() = user_id);

create or replace function record_ai_usage(
  p_user_id uuid,
  p_month text,
  p_feature text,
  p_input bigint,
  p_output bigint
) returns void
language sql
as $$
  insert into ai_usage (user_id, month, feature, calls, input_tokens, output_tokens, updated_at)
  values (p_user_id, p_month, p_feature, 1, greatest(p_input, 0), greatest(p_output, 0), now())
  on conflict (user_id, month, feature) do update set
    calls = ai_usage.calls + 1,
    input_tokens = ai_usage.input_tokens + greatest(excluded.input_tokens, 0),
    output_tokens = ai_usage.output_tokens + greatest(excluded.output_tokens, 0),
    updated_at = now();
$$;

-- An account must not be able to reset or inflate its own counters.
revoke all on function record_ai_usage(uuid, text, text, bigint, bigint) from public;
revoke all on function record_ai_usage(uuid, text, text, bigint, bigint) from anon;
revoke all on function record_ai_usage(uuid, text, text, bigint, bigint) from authenticated;
grant execute on function record_ai_usage(uuid, text, text, bigint, bigint) to service_role;

alter table user_settings add column if not exists ai_monthly_token_cap bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_ai_cap_check') then
    alter table user_settings
      add constraint user_settings_ai_cap_check check (ai_monthly_token_cap is null or ai_monthly_token_cap >= 0);
  end if;
end $$;
