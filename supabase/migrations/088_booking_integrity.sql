-- 088_booking_integrity.sql
--
-- book_slot, taught three things it got wrong.
--
-- 1. All-day events blocked the wrong day.
--    An all-day event is stored as the local midnight that began its day
--    in the zone it was entered in. date_trunc('day', starts_at) truncates
--    in the SESSION zone, which on Supabase is UTC: Tokyo's midnight on the
--    5th is 15:00 UTC on the 4th, so the 4th was blocked and the 5th was
--    left bookable. The day is now read in the event's own zone (falling
--    back to the organiser's), and blocked from that date's midnight to the
--    next one in the organiser's zone - the zone their working hours are in.
--
-- 2. The daily cap could be overrun by two people booking at once.
--    max_bookings_per_day was checked in the application before the lock
--    was taken, so two bookings racing for the last place on a day both
--    passed. The cap is now counted here, after the advisory lock, and a
--    full day raises DAY_FULL, which the server turns into a plain message.
--    Only meetings booked through a link count (booking_link_id IS NOT
--    NULL), matching the application rule.
--
-- 3. Both of the above need the organiser's zone, so book_slot takes
--    p_timezone and p_max_per_day. Adding parameters makes a NEW function
--    rather than replacing the old one, and two overloads would make the
--    named-argument call ambiguous, so the 16-argument version is dropped
--    first. Safe to run more than once.
--
-- Run after 087. Run it once the server code from the same change is
-- deployed: that code falls back to the 16-argument signature while this
-- has not been run, but the server before it only knows that signature,
-- which this removes.

-- ---------------------------------------------------------------------------
-- The local date of an instant, in an event's zone if it has a usable one.
--
-- A stored zone the database cannot read (crm_events.timezone is free text)
-- must not fail a booking, so it falls back rather than raising.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION booking_local_day(
  p_at          timestamptz,
  p_event_tz    text,
  p_fallback_tz text
) RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_event_tz IS NOT NULL AND p_event_tz <> '' THEN
    BEGIN
      RETURN (p_at AT TIME ZONE p_event_tz)::date;
    EXCEPTION WHEN invalid_parameter_value THEN
      NULL;
    END;
  END IF;
  RETURN (p_at AT TIME ZONE p_fallback_tz)::date;
END;
$$;

-- ---------------------------------------------------------------------------
-- book_slot, with the organiser's zone and daily cap
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS book_slot(
  uuid, uuid, timestamptz, timestamptz, integer, integer,
  text, uuid, text, text, text, text, text, uuid, text, uuid
);

CREATE OR REPLACE FUNCTION book_slot(
  p_user_id          uuid,
  p_link_id          uuid,
  p_starts_at        timestamptz,
  p_ends_at          timestamptz,
  p_buffer_before    integer,
  p_buffer_after     integer,
  p_title            text,
  p_contact_id       uuid,
  p_contact_name     text,
  p_contact_email    text,
  p_invitee_message  text,
  p_invitee_timezone text,
  p_manage_token     text,
  p_event_type_id    uuid,
  p_location         text,
  p_exclude_event_id uuid DEFAULT NULL,
  p_timezone         text DEFAULT NULL,
  p_max_per_day      integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz          text := 'UTC';
  v_guard_start timestamptz;
  v_guard_end   timestamptz;
  v_clash       integer;
  v_day         date;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
  v_on_day      integer;
  v_id          uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- The organiser's zone, or UTC if it is missing or unreadable.
  IF p_timezone IS NOT NULL AND p_timezone <> '' THEN
    BEGIN
      PERFORM now() AT TIME ZONE p_timezone;
      v_tz := p_timezone;
    EXCEPTION WHEN invalid_parameter_value THEN
      v_tz := 'UTC';
    END;
  END IF;

  v_guard_start := p_starts_at - make_interval(mins => COALESCE(p_buffer_before, 0));
  v_guard_end   := p_ends_at   + make_interval(mins => COALESCE(p_buffer_after, 0));

  -- Timed meetings.
  SELECT count(*) INTO v_clash
    FROM crm_events e
   WHERE e.user_id = p_user_id
     AND e.status <> 'cancelled'
     AND NOT COALESCE(e.all_day, false)
     AND (p_exclude_event_id IS NULL OR e.id <> p_exclude_event_id)
     AND tstzrange(e.starts_at,
                   COALESCE(e.ends_at, e.starts_at + interval '1 hour'), '[)')
         && tstzrange(v_guard_start, v_guard_end, '[)');

  -- All-day blocks, on the organiser's day. Only rows near the slot are
  -- considered (OFFSET 0 keeps the cheap filter ahead of the zone maths):
  -- a local day starts at most 14 hours either side of the UTC one.
  IF v_clash = 0 THEN
    SELECT count(*) INTO v_clash
      FROM (
        SELECT booking_local_day(a.starts_at, a.timezone, v_tz) AS d
          FROM (
            SELECT e.starts_at, e.timezone
              FROM crm_events e
             WHERE e.user_id = p_user_id
               AND e.status <> 'cancelled'
               AND COALESCE(e.all_day, false)
               AND (p_exclude_event_id IS NULL OR e.id <> p_exclude_event_id)
               AND e.starts_at > v_guard_start - interval '3 days'
               AND e.starts_at < v_guard_end + interval '3 days'
            OFFSET 0
          ) a
      ) days
     WHERE tstzrange(days.d::timestamp AT TIME ZONE v_tz,
                     (days.d + 1)::timestamp AT TIME ZONE v_tz, '[)')
           && tstzrange(v_guard_start, v_guard_end, '[)');
  END IF;

  IF v_clash > 0 THEN
    RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'unique_violation';
  END IF;

  -- The daily cap, counted under the same lock as the clash check, so two
  -- bookings racing for the last place on a day cannot both win it.
  IF p_max_per_day IS NOT NULL THEN
    v_day       := (p_starts_at AT TIME ZONE v_tz)::date;
    v_day_start := v_day::timestamp AT TIME ZONE v_tz;
    v_day_end   := (v_day + 1)::timestamp AT TIME ZONE v_tz;

    SELECT count(*) INTO v_on_day
      FROM crm_events e
     WHERE e.user_id = p_user_id
       AND e.status <> 'cancelled'
       AND e.booking_link_id IS NOT NULL
       AND (p_exclude_event_id IS NULL OR e.id <> p_exclude_event_id)
       AND e.starts_at >= v_day_start
       AND e.starts_at <  v_day_end;

    IF v_on_day >= p_max_per_day THEN
      RAISE EXCEPTION 'DAY_FULL' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_exclude_event_id IS NULL THEN
    INSERT INTO crm_events (
      user_id, title, type, starts_at, ends_at,
      contact_id, contact_name, contact_email,
      booking_link_id, booked_at, manage_token,
      invitee_message, invitee_timezone,
      event_type_id, location, status
    ) VALUES (
      p_user_id, p_title, 'meeting', p_starts_at, p_ends_at,
      p_contact_id, p_contact_name, p_contact_email,
      p_link_id, now(), p_manage_token,
      p_invitee_message, p_invitee_timezone,
      p_event_type_id, p_location, 'confirmed'
    ) RETURNING id INTO v_id;

    UPDATE booking_links SET bookings = bookings + 1 WHERE id = p_link_id;
  ELSE
    UPDATE crm_events
       SET rescheduled_from = starts_at,
           starts_at        = p_starts_at,
           ends_at          = p_ends_at,
           status           = 'confirmed',
           cancelled_at     = NULL,
           cancelled_by     = NULL,
           cancel_reason    = NULL,
           -- The calendar client needs to be told this outranks what it has.
           ics_sequence     = COALESCE(ics_sequence, 0) + 1,
           -- A moved meeting deserves a fresh reminder.
           reminder_sent_at = NULL
     WHERE id = p_exclude_event_id
       AND user_id = p_user_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'NO_SUCH_BOOKING' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Only the server may call either. Same treatment as 084 and 086.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_sig  text;
  v_role text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'booking_local_day(timestamptz, text, text)',
    'book_slot(uuid, uuid, timestamptz, timestamptz, integer, integer,'
      || ' text, uuid, text, text, text, text, text, uuid, text, uuid, text, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_sig, v_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
    END IF;
  END LOOP;
END;
$$;
