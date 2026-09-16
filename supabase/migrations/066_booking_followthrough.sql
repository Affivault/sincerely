-- 066: What happens after somebody books.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- 064 made a booking possible. This makes it land: an email that proves it
-- happened, a deal so the meeting counts for something, and the bookkeeping
-- needed to never send the same message twice.
--
-- The gap this closes is embarrassing when you look at it plainly. Somebody
-- books a meeting, sees a confirmation screen, closes the tab, and has
-- nothing - no invite, no record, no way back to the page that would let
-- them cancel. And the account finds out it has a meeting by looking at its
-- calendar. Every scheduler worth using sends an email; this one did not.

-- ---------------------------------------------------------------------------
-- 1. What each link does once a booking lands
-- ---------------------------------------------------------------------------

ALTER TABLE booking_links
  -- A booked meeting is the most meaningful thing that happens in a cold
  -- outreach cycle, so by default it opens a deal. Off for the links where
  -- that is wrong - a support call, an internal chat.
  ADD COLUMN IF NOT EXISTS create_deal      boolean NOT NULL DEFAULT true,
  -- Which stage a deal opens in. Null means the pipeline's first.
  ADD COLUMN IF NOT EXISTS deal_stage       text,
  -- Tell the account a booking happened. Separate from the invitee's
  -- confirmation, because somebody running twenty links does not want
  -- twenty emails a day and should be able to say so per link.
  ADD COLUMN IF NOT EXISTS notify_organiser boolean NOT NULL DEFAULT true,
  -- Appended to the confirmation email. Dial-in details, what to prepare,
  -- where to park. Plain text; it is not a newsletter.
  ADD COLUMN IF NOT EXISTS confirmation_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_links_deal_stage_known') THEN
    ALTER TABLE booking_links ADD CONSTRAINT booking_links_deal_stage_known
      CHECK (deal_stage IS NULL OR deal_stage IN ('lead', 'qualified', 'proposal', 'won', 'lost'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_links_confirmation_note_sane') THEN
    ALTER TABLE booking_links ADD CONSTRAINT booking_links_confirmation_note_sane
      CHECK (confirmation_note IS NULL OR length(confirmation_note) <= 2000);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. What a meeting remembers about what it has already sent
--
-- These exist so nothing sends twice. An email that arrives twice is worse
-- than one that arrives late: the second one reads as a second meeting, and
-- somebody turns up on the wrong day because of it.
-- ---------------------------------------------------------------------------

ALTER TABLE crm_events
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_sent_at     timestamptz,
  -- Counts up every time the meeting moves. It is the ics SEQUENCE number,
  -- and a calendar client ignores an update that does not outrank what it
  -- already has - so a rescheduled meeting silently stays put without it.
  ADD COLUMN IF NOT EXISTS ics_sequence         integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_events_ics_sequence_sane') THEN
    ALTER TABLE crm_events ADD CONSTRAINT crm_events_ics_sequence_sane
      CHECK (ics_sequence >= 0);
  END IF;
END;
$$;

-- Finding the meetings a reminder is due for, without reading the whole
-- diary. Partial, because only booked meetings get reminders and they are a
-- small slice of everything on a calendar.
CREATE INDEX IF NOT EXISTS idx_crm_events_reminder_due
  ON crm_events (starts_at)
  WHERE booking_link_id IS NOT NULL
    AND reminder_sent_at IS NULL
    AND status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 3. Moving a booking bumps its sequence
--
-- In the function rather than the application because a reschedule can
-- happen down two different paths - the invitee's manage page and, later,
-- the account dragging it on the calendar - and a number that only some
-- writers remember to increment is a number that cannot be trusted.
--
-- Same signature as 064, so this REPLACEs it rather than adding an overload.
-- ---------------------------------------------------------------------------

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
  p_exclude_event_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guard_start timestamptz;
  v_guard_end   timestamptz;
  v_clash       integer;
  v_id          uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  v_guard_start := p_starts_at - make_interval(mins => COALESCE(p_buffer_before, 0));
  v_guard_end   := p_ends_at   + make_interval(mins => COALESCE(p_buffer_after, 0));

  SELECT count(*) INTO v_clash
    FROM crm_events e
   WHERE e.user_id = p_user_id
     AND e.status <> 'cancelled'
     AND (p_exclude_event_id IS NULL OR e.id <> p_exclude_event_id)
     AND (
       CASE WHEN e.all_day
            THEN tstzrange(date_trunc('day', e.starts_at),
                           date_trunc('day', e.starts_at) + interval '1 day', '[)')
            ELSE tstzrange(e.starts_at,
                           COALESCE(e.ends_at, e.starts_at + interval '1 hour'), '[)')
       END
     ) && tstzrange(v_guard_start, v_guard_end, '[)');

  IF v_clash > 0 THEN
    RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'unique_violation';
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

DO $$
DECLARE
  v_sig text := 'book_slot(uuid, uuid, timestamptz, timestamptz, integer, integer,'
             || ' text, uuid, text, text, text, text, text, uuid, text, uuid)';
  v_role text;
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_sig, v_role);
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Claiming a reminder
--
-- A worker that reads "due" and then sends has a window between the two in
-- which a second worker reads the same row. This claims the rows and hands
-- them back in one statement, so a meeting can only ever be claimed once
-- however many workers are running.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claim_booking_reminders(
  p_within_minutes integer,
  p_limit          integer DEFAULT 100
) RETURNS SETOF crm_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE crm_events
     SET reminder_sent_at = now()
   WHERE id IN (
     SELECT e.id
       FROM crm_events e
      WHERE e.booking_link_id IS NOT NULL
        AND e.reminder_sent_at IS NULL
        AND e.status <> 'cancelled'
        AND e.starts_at > now()
        AND e.starts_at <= now() + make_interval(mins => p_within_minutes)
      ORDER BY e.starts_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
$$;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION claim_booking_reminders(integer, integer) FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION claim_booking_reminders(integer, integer) FROM anon';
  END IF;
END;
$$;
