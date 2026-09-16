-- 063: When you are actually free.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- Migration 062 gave the calendar kinds of meeting. This gives it the other
-- half of a scheduler: the rules that decide which moments may be offered to
-- somebody else at all.
--
-- Two tables, because they answer two different questions.
--
--   calendar_availability       which hours of which days you work. One row
--                               per window, so "9-12 and 1-5" is two rows
--                               and a split day is expressible rather than
--                               something the model has to pretend away.
--
--   calendar_scheduling_prefs   everything that is true once per account -
--                               the timezone the hours are written in, the
--                               gaps either side of a meeting, how much
--                               notice you need, how many bookings a day is
--                               too many.
--
-- The timezone lives on the preferences, not on each window, and that is
-- deliberate. "I work 9 to 5" is a statement about a wall clock somewhere;
-- storing an offset per row would freeze it, and every window would be an
-- hour wrong for half the year.
--
-- Still nothing public here. A booking page needs a slug, a landing route
-- and a great deal of care about what a stranger may see, and none of that
-- is settled yet - so none of it is in this file.

-- ---------------------------------------------------------------------------
-- 1. Working hours
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar_availability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 0 = Sunday through 6 = Saturday, matching JavaScript's getDay() so the
  -- client never has to remember which end the week starts.
  weekday      smallint NOT NULL,
  -- Minutes from midnight, on the wall clock of the account's timezone.
  -- Stored as integers rather than `time` because every calculation that
  -- uses them is arithmetic on minutes, and converting back and forth is
  -- one more place to lose half an hour.
  start_minute integer NOT NULL,
  end_minute   integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- One window may not start twice on the same day.
  UNIQUE (user_id, weekday, start_minute)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_availability_weekday_real') THEN
    ALTER TABLE calendar_availability ADD CONSTRAINT calendar_availability_weekday_real
      CHECK (weekday BETWEEN 0 AND 6);
  END IF;

  -- A window has to be inside the day and has to have a length. A zero-width
  -- window offers no slots but costs a row in every computation forever, and
  -- a backwards one silently offers none while looking like it should.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_availability_window_sane') THEN
    ALTER TABLE calendar_availability ADD CONSTRAINT calendar_availability_window_sane
      CHECK (
        start_minute >= 0
        AND end_minute <= 1440
        AND end_minute > start_minute
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_calendar_availability_user
  ON calendar_availability (user_id, weekday, start_minute);

ALTER TABLE calendar_availability ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'calendar_availability'
       AND policyname = 'Users can manage their own availability'
  ) THEN
    CREATE POLICY "Users can manage their own availability"
      ON calendar_availability FOR ALL USING (auth.uid() = user_id);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The rules around a booking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar_scheduling_prefs (
  user_id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The wall clock the windows above are written against.
  timezone               text NOT NULL DEFAULT 'UTC',
  -- Breathing room either side of a meeting. Travel, notes, a cup of tea.
  buffer_before_minutes  integer NOT NULL DEFAULT 0,
  buffer_after_minutes   integer NOT NULL DEFAULT 0,
  -- How soon is too soon. Four hours by default, so nobody books you at
  -- 09:02 for 09:15 on a morning you have not looked at your calendar.
  minimum_notice_minutes integer NOT NULL DEFAULT 240,
  -- Null means no cap. A number is the point at which a day is full however
  -- much white space is left on it.
  max_bookings_per_day   integer,
  -- What the offered times land on: :00 and :30, or every quarter hour.
  slot_interval_minutes  integer NOT NULL DEFAULT 15,
  -- How far ahead a stranger may reach. Beyond this you do not yet know
  -- what your life looks like.
  booking_horizon_days   integer NOT NULL DEFAULT 60,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_prefs_buffers_sane') THEN
    ALTER TABLE calendar_scheduling_prefs ADD CONSTRAINT calendar_prefs_buffers_sane
      CHECK (
        buffer_before_minutes BETWEEN 0 AND 240
        AND buffer_after_minutes BETWEEN 0 AND 240
      );
  END IF;

  -- A month of notice is not notice, it is a closed diary; and a negative
  -- one would offer times that have already happened.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_prefs_notice_sane') THEN
    ALTER TABLE calendar_scheduling_prefs ADD CONSTRAINT calendar_prefs_notice_sane
      CHECK (minimum_notice_minutes BETWEEN 0 AND 43200);
  END IF;

  -- A zero or negative interval would make slot generation loop forever.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_prefs_interval_sane') THEN
    ALTER TABLE calendar_scheduling_prefs ADD CONSTRAINT calendar_prefs_interval_sane
      CHECK (slot_interval_minutes IN (5, 10, 15, 20, 30, 60));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_prefs_horizon_sane') THEN
    ALTER TABLE calendar_scheduling_prefs ADD CONSTRAINT calendar_prefs_horizon_sane
      CHECK (booking_horizon_days BETWEEN 1 AND 365);
  END IF;

  -- A cap of zero means "never bookable", which is a thing you express by
  -- clearing your hours, not by a cap nobody would think to look at.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_prefs_cap_sane') THEN
    ALTER TABLE calendar_scheduling_prefs ADD CONSTRAINT calendar_prefs_cap_sane
      CHECK (max_bookings_per_day IS NULL OR max_bookings_per_day BETWEEN 1 AND 50);
  END IF;
END;
$$;

ALTER TABLE calendar_scheduling_prefs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'calendar_scheduling_prefs'
       AND policyname = 'Users can manage their own scheduling preferences'
  ) THEN
    CREATE POLICY "Users can manage their own scheduling preferences"
      ON calendar_scheduling_prefs FOR ALL USING (auth.uid() = user_id);
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_calendar_prefs_updated_at ON calendar_scheduling_prefs;
CREATE TRIGGER trg_calendar_prefs_updated_at
  BEFORE UPDATE ON calendar_scheduling_prefs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. A working week to start from
--
-- Monday to Friday, nine to five, for every account that already exists.
-- The alternative is a scheduler that offers nothing at all until somebody
-- finds a settings page they have no reason to know about.
--
-- Deliberately does NOT seed preferences: those default correctly on insert,
-- and a row here would freeze every account at UTC whether or not that is
-- where they are.
-- ---------------------------------------------------------------------------

INSERT INTO calendar_availability (user_id, weekday, start_minute, end_minute)
SELECT u.id, d.weekday, 540, 1020   -- 09:00 to 17:00
  FROM auth.users u
 CROSS JOIN (VALUES (1), (2), (3), (4), (5)) AS d(weekday)
ON CONFLICT (user_id, weekday, start_minute) DO NOTHING;
