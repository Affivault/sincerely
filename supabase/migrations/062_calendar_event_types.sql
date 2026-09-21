-- 062: Give the calendar a vocabulary of its own.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- The calendar has been the weakest room in the house. Events carry a `type`
-- that is one of exactly two strings, 'call' or 'meeting', hard-coded in the
-- client with a colour to match - so there is no way to say "this is a demo"
-- or "this is an onboarding session", and no way to change what any of it
-- looks like.
--
-- A kind of meeting is a real object, not a string. It has a name, a colour,
-- a normal length and a normal place (a video call, a phone call, an
-- address). Once it exists, three things become possible that are not
-- possible today: a calendar you can actually read at a glance, booking a
-- meeting in one click because its length is already known, and - later - a
-- booking link, which is only ever "a kind of meeting other people may put
-- in your diary".
--
-- This migration is deliberately only the first of those. Nothing here
-- concerns availability rules or public booking; those columns would sit
-- unused until the work that needs them exists.

-- ---------------------------------------------------------------------------
-- 1. Kinds of meeting
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar_event_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  -- Stored as a hex string rather than a palette index, so a colour somebody
  -- picks is the colour they get and is not silently remapped when the
  -- palette changes.
  colour           text NOT NULL DEFAULT '#6366f1',
  -- How long one of these usually runs. This is what lets a click on the
  -- grid become a booking without asking a second question.
  duration_minutes integer NOT NULL DEFAULT 30,
  -- Where it happens by default: a video call, a phone call, somewhere real.
  location_kind    text NOT NULL DEFAULT 'video',
  -- The one offered first, and the one a quick-add uses.
  is_default       boolean NOT NULL DEFAULT false,
  -- Retired rather than deleted: events already point at it, and a calendar
  -- that loses the colour of last quarter's meetings is worse than one
  -- carrying a type nobody books any more.
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_event_types_colour_is_hex') THEN
    ALTER TABLE calendar_event_types ADD CONSTRAINT calendar_event_types_colour_is_hex
      CHECK (colour ~* '^#[0-9a-f]{6}$');
  END IF;

  -- A zero or negative length would render as a zero-height block that
  -- cannot be clicked, and a day-long "call" is a typo rather than a plan.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_event_types_duration_sane') THEN
    ALTER TABLE calendar_event_types ADD CONSTRAINT calendar_event_types_duration_sane
      CHECK (duration_minutes >= 5 AND duration_minutes <= 1440);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_event_types_location_known') THEN
    ALTER TABLE calendar_event_types ADD CONSTRAINT calendar_event_types_location_known
      CHECK (location_kind IN ('video', 'phone', 'in_person', 'other'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_calendar_event_types_user
  ON calendar_event_types (user_id) WHERE archived_at IS NULL;

-- Exactly one default per account. A partial unique index rather than a
-- trigger: two defaults is a state the database should simply not hold.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_event_types_one_default
  ON calendar_event_types (user_id) WHERE is_default AND archived_at IS NULL;

ALTER TABLE calendar_event_types ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'calendar_event_types'
       AND policyname = 'Users can manage their own calendar event types'
  ) THEN
    CREATE POLICY "Users can manage their own calendar event types"
      ON calendar_event_types FOR ALL USING (auth.uid() = user_id);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. What an event needs to be drawn properly
-- ---------------------------------------------------------------------------

ALTER TABLE crm_events
  ADD COLUMN IF NOT EXISTS event_type_id    uuid REFERENCES calendar_event_types(id) ON DELETE SET NULL,
  -- A one-off colour for this event alone, overriding its type. Null is the
  -- normal case and means "whatever the type says".
  ADD COLUMN IF NOT EXISTS colour           text,
  -- Cancelled meetings stay on the calendar, struck through. Deleting them
  -- loses the fact that the slot was ever taken, which is the thing you are
  -- looking for when you ask why a week went nowhere.
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS conferencing_url text,
  -- The zone the organiser was in when they made it, so a meeting booked at
  -- 3pm in London still reads as 3pm in London after they fly to New York.
  ADD COLUMN IF NOT EXISTS timezone         text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_events_status_known') THEN
    ALTER TABLE crm_events ADD CONSTRAINT crm_events_status_known
      CHECK (status IN ('confirmed', 'cancelled', 'tentative'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_events_colour_is_hex') THEN
    ALTER TABLE crm_events ADD CONSTRAINT crm_events_colour_is_hex
      CHECK (colour IS NULL OR colour ~* '^#[0-9a-f]{6}$');
  END IF;

  -- An event that ends before it starts draws as a negative-height block and
  -- breaks every overlap calculation that looks at it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_events_ends_after_starts') THEN
    ALTER TABLE crm_events ADD CONSTRAINT crm_events_ends_after_starts
      CHECK (ends_at IS NULL OR ends_at >= starts_at);
  END IF;
END;
$$;

-- The query the week and day views run on every navigation: everything in a
-- window, in order. Without this it is a full scan of the account's history
-- to draw seven days.
CREATE INDEX IF NOT EXISTS idx_crm_events_user_window
  ON crm_events (user_id, starts_at)
  WHERE status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 3. Something to start from
--
-- An empty type list means the first thing anybody sees is a form asking
-- them to invent a taxonomy before they can book a meeting. Four sensible
-- kinds, coloured apart, for every account that already exists. New accounts
-- get the same set from the application on first read.
--
-- ON CONFLICT DO NOTHING against (user_id, name), so re-running this file
-- adds nothing and a type somebody has renamed or recoloured is never reset.
-- ---------------------------------------------------------------------------

INSERT INTO calendar_event_types (user_id, name, colour, duration_minutes, location_kind, is_default)
SELECT u.id, seed.name, seed.colour, seed.duration, seed.location_kind, seed.is_default
  FROM auth.users u
 CROSS JOIN (VALUES
   ('Intro call',    '#6366f1', 30, 'video',     true),
   ('Discovery',     '#0ea5e9', 45, 'video',     false),
   ('Demo',          '#10b981', 60, 'video',     false),
   ('Follow-up',     '#f59e0b', 15, 'phone',     false)
 ) AS seed(name, colour, duration, location_kind, is_default)
ON CONFLICT (user_id, name) DO NOTHING;

-- Point existing events at the closest seeded type, so nothing on anybody's
-- calendar renders as an uncoloured blank after this runs.
UPDATE crm_events e
   SET event_type_id = t.id
  FROM calendar_event_types t
 WHERE t.user_id = e.user_id
   AND e.event_type_id IS NULL
   AND t.name = CASE WHEN e.type = 'call' THEN 'Follow-up' ELSE 'Intro call' END;

DROP TRIGGER IF EXISTS trg_calendar_event_types_updated_at ON calendar_event_types;
CREATE TRIGGER trg_calendar_event_types_updated_at
  BEFORE UPDATE ON calendar_event_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
