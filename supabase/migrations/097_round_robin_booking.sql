-- 097: Team round-robin booking.
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once.
--
-- One booking link that spreads meetings across several teammates. The
-- visitor sees every time at least one of them is free; whoever is free at
-- the time they pick, and has had the fewest meetings from that link
-- lately, gets it. The meeting then belongs to that teammate in full: their
-- calendar, their contact, their deal, their mailbox for the confirmation.
--
-- It is a team setting, OFF by default. Nothing below changes how any
-- existing link behaves: every link stays 'single' (just its owner) until
-- the team switches round robin on AND somebody sets a link to it. Switching
-- the team setting off again pauses round-robin links rather than quietly
-- handing every meeting to one person.
--
-- Server-only, like everything since 084: the new table has row level
-- security on and no policies, because the browser never reads it directly.


-- ---------------------------------------------------------------------------
-- 1. The team switch
-- ---------------------------------------------------------------------------

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS round_robin_enabled boolean NOT NULL DEFAULT false;


-- ---------------------------------------------------------------------------
-- 2. How a link assigns its meetings
-- ---------------------------------------------------------------------------
--
--   assignment   'single'       the link's owner takes every meeting (as before)
--                'round_robin'  spread across the hosts in booking_link_hosts
--
--   round_robin_strategy
--                'balanced'     the free host with the fewest meetings from
--                               this link in the last 30 days; ties go to
--                               whoever was given one least recently
--                'priority'     the free host with the best (lowest) priority
--                               number; ties are then balanced as above

ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS assignment text NOT NULL DEFAULT 'single';
ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS round_robin_strategy text NOT NULL DEFAULT 'balanced';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_links_assignment_known') THEN
    ALTER TABLE booking_links ADD CONSTRAINT booking_links_assignment_known
      CHECK (assignment IN ('single', 'round_robin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_links_round_robin_strategy_known') THEN
    ALTER TABLE booking_links ADD CONSTRAINT booking_links_round_robin_strategy_known
      CHECK (round_robin_strategy IN ('balanced', 'priority'));
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 3. Who takes a round-robin link's meetings
-- ---------------------------------------------------------------------------
--
-- Two separate off switches, on purpose:
--   is_active       set by the link's owner ("leave Sam out of this one")
--   host_paused     set by the host themselves ("I am away this week")
-- so the owner saving the list of hosts never undoes a host's own pause.
--
-- Membership of the team is checked by the server every time a page loads
-- and every time somebody books, so a teammate who leaves stops being
-- offered at once even if their row here is still in place.

CREATE TABLE IF NOT EXISTS booking_link_hosts (
  link_id          uuid NOT NULL REFERENCES booking_links(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  priority         integer NOT NULL DEFAULT 1,
  is_active        boolean NOT NULL DEFAULT true,
  host_paused      boolean NOT NULL DEFAULT false,
  last_assigned_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, user_id),
  CONSTRAINT booking_link_hosts_priority_sane CHECK (priority BETWEEN 1 AND 100)
);

-- "Which round-robin links am I in", for the host's own pause switch.
CREATE INDEX IF NOT EXISTS idx_booking_link_hosts_user ON booking_link_hosts (user_id);

ALTER TABLE booking_link_hosts ENABLE ROW LEVEL SECURITY;

-- Fairness counts meetings per host per link over the last 30 days.
CREATE INDEX IF NOT EXISTS idx_crm_events_link_host_booked
  ON crm_events (booking_link_id, user_id, booked_at)
  WHERE booking_link_id IS NOT NULL;
