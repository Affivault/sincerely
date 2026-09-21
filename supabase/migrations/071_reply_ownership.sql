-- ============================================================
-- 071: Replies get an owner and a clock
--
-- Forty replies land, three matter, and the three get lost. A reply
-- could already be classified (sara_intent) and triaged into a
-- disposition (interested / later / not interested), but nothing said
-- whose job it was or how long somebody had been waiting. For one
-- person that is survivable; for four it is the whole job, and "I
-- thought you had it" is how a booked meeting becomes a competitor's.
--
-- Three separate things, and the existing columns only covered the
-- first:
--   triage    - what is this?      (existed)
--   ownership - whose is it?       (here)
--   the clock - since when?        (here)
-- ============================================================

alter table inbox_messages
  -- Who owns answering this. Null is a real state and the queue reports
  -- it: unowned work is the work that actually gets dropped.
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,

  -- When a human actually replied. The clock stops here, and it is
  -- deliberately not the same as triage: deciding a reply is
  -- "interested" is not answering the person who sent it.
  add column if not exists first_response_at timestamptz,
  add column if not exists first_response_by uuid references auth.users(id) on delete set null,

  -- Deliberately parked until this time. Without somewhere to put
  -- "ask me in March", the only way to clear it from the queue is to
  -- pretend it is done - and an overdue count that includes handled
  -- work is a number people stop reading.
  add column if not exists snoozed_until timestamptz,
  add column if not exists snooze_note text;

comment on column inbox_messages.first_response_at is
  'When a human replied. Not the same as being triaged.';
comment on column inbox_messages.snoozed_until is
  'Parked with a date. Parked is not late, and not forgotten.';

-- ============================================================
-- The queue's own index
--
-- The working set is inbound, human, unanswered mail. That is a small
-- slice of a table that grows forever, so the index carries the
-- predicate rather than the whole table.
--
-- auto_reply_kind is in the predicate because an out-of-office must
-- never reach the queue: a clock started by a robot makes the overdue
-- count meaningless within a week, and people stop looking - which is
-- worse than no queue at all, because the real ones are then hidden
-- behind a number nobody trusts.
-- ============================================================

create index if not exists idx_inbox_reply_queue
  on inbox_messages (user_id, received_at desc)
  where first_response_at is null
    and auto_reply_kind is null;

-- "What is on my plate" is the commonest filter once more than one
-- person is answering.
create index if not exists idx_inbox_assigned
  on inbox_messages (assigned_to, received_at desc)
  where assigned_to is not null
    and first_response_at is null;

-- Waking parked replies: a small, oldest-first sweep.
create index if not exists idx_inbox_snoozed
  on inbox_messages (snoozed_until)
  where snoozed_until is not null
    and first_response_at is null;
