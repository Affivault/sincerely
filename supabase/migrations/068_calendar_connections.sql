-- 068: Calendars this account keeps somewhere else.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- The one thing that can make a booking page WRONG rather than merely
-- incomplete. Everything so far reasons about the diary Sincerely can see;
-- a meeting somebody put in Google an hour ago is invisible to it, so the
-- page cheerfully offers a time that is already gone. The prospect books
-- it, and now two people expect the same half hour.
--
-- What this stores is deliberately small: enough to ask Google what is
-- busy, and nothing about what those meetings ARE. A free/busy answer is a
-- list of intervals with no titles, no attendees and no notes, which is the
-- least this needs and therefore all it should ever hold.
--
-- Tokens are encrypted at rest with the same key the SMTP passwords use.
-- They are not stored in plain text at any point, and no column here is
-- ever returned to the client.

CREATE TABLE IF NOT EXISTS calendar_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider       text NOT NULL,
  -- The account at the far end, shown so somebody with three Google logins
  -- can tell which one they connected.
  account_email  text,
  -- Encrypted. Never selected into anything the client can see.
  access_token   text NOT NULL,
  -- Google only returns this on the first consent, so losing it means
  -- sending the account back through the consent screen with prompt=consent.
  refresh_token  text,
  expires_at     timestamptz,
  -- Which calendars to read. Empty means the account's primary one.
  calendar_ids   text[] NOT NULL DEFAULT ARRAY['primary'],
  -- Reading is what makes the booking page correct. Writing is a
  -- convenience, and some people want their work calendar consulted but
  -- not written to.
  read_busy      boolean NOT NULL DEFAULT true,
  write_events   boolean NOT NULL DEFAULT true,
  -- Set when the far end stops accepting the token: revoked access, a
  -- changed password, a deleted app. The UI reads this to say so plainly
  -- rather than silently offering times it cannot vouch for.
  broken_at      timestamptz,
  broken_reason  text,
  last_synced_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- One connection per provider account. Reconnecting updates rather than
  -- accumulating duplicates that would each be consulted on every lookup.
  UNIQUE (user_id, provider, account_email)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_connections_provider_known') THEN
    ALTER TABLE calendar_connections ADD CONSTRAINT calendar_connections_provider_known
      CHECK (provider IN ('google', 'microsoft'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_calendar_connections_user
  ON calendar_connections (user_id, provider);

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'calendar_connections'
       AND policyname = 'Users can manage their own calendar connections'
  ) THEN
    CREATE POLICY "Users can manage their own calendar connections"
      ON calendar_connections FOR ALL USING (auth.uid() = user_id);
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_calendar_connections_updated_at ON calendar_connections;
CREATE TRIGGER trg_calendar_connections_updated_at
  BEFORE UPDATE ON calendar_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- The last answer we got, kept so an outage cannot open the diary
--
-- Free/busy is fetched live when somebody loads a booking page. If Google
-- is unreachable at that moment there are only two things to do, and one of
-- them is wrong: offer the slots anyway - which is precisely the
-- double-booking this exists to prevent - or refuse to show any times at
-- all, which breaks the page for a problem the visitor did not cause.
--
-- So the last good answer is kept. A brief outage then degrades to slightly
-- stale busy data rather than to none, which is the failure mode that costs
-- nobody a meeting. Rows older than the horizon are worthless and get swept.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar_busy_cache (
  connection_id uuid NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  -- The UTC day this covers. Whole days, because that is the granularity a
  -- booking page asks in and it keeps the cache small enough to read in one
  -- query.
  day           date NOT NULL,
  -- [{start, end}], already merged. No titles: free/busy does not return
  -- them and this must never start wanting them.
  intervals     jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, day)
);

CREATE INDEX IF NOT EXISTS idx_calendar_busy_cache_fetched
  ON calendar_busy_cache (fetched_at);

ALTER TABLE calendar_busy_cache ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'calendar_busy_cache'
       AND policyname = 'Busy cache follows its connection'
  ) THEN
    CREATE POLICY "Busy cache follows its connection"
      ON calendar_busy_cache FOR ALL USING (
        EXISTS (
          SELECT 1 FROM calendar_connections c
           WHERE c.id = calendar_busy_cache.connection_id
             AND c.user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- A booking Sincerely put in somebody else's calendar
--
-- So a meeting is written once rather than on every sync, and so cancelling
-- here can delete the right event over there.
-- ---------------------------------------------------------------------------

ALTER TABLE crm_events
  ADD COLUMN IF NOT EXISTS external_event_id     text,
  ADD COLUMN IF NOT EXISTS external_connection_id uuid REFERENCES calendar_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_events_external
  ON crm_events (external_connection_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
