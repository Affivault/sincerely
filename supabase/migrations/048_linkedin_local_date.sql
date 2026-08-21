-- record_linkedin_action rolled the day over using CURRENT_DATE, which is the
-- database server's (UTC) day. LinkedIn automation counters are meant to
-- track the user's own working day: a user in America/Los_Angeles would have
-- their daily connect/message/visit counters silently reset at 4pm local
-- time (UTC midnight) instead of local midnight, letting the agent send
-- roughly double the configured daily allowance. The app now computes the
-- caller's local date and passes it in explicitly.

DROP FUNCTION IF EXISTS record_linkedin_action(uuid, text);

CREATE OR REPLACE FUNCTION record_linkedin_action(uid uuid, action text, local_date date DEFAULT CURRENT_DATE)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO linkedin_settings (user_id) VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE linkedin_settings
     SET counters_date  = local_date,
         connects_today = CASE WHEN counters_date < local_date THEN 0 ELSE connects_today END
                          + CASE WHEN action = 'linkedin_connect' THEN 1 ELSE 0 END,
         messages_today = CASE WHEN counters_date < local_date THEN 0 ELSE messages_today END
                          + CASE WHEN action = 'linkedin_message' THEN 1 ELSE 0 END,
         visits_today   = CASE WHEN counters_date < local_date THEN 0 ELSE visits_today END
                          + CASE WHEN action = 'linkedin_visit' THEN 1 ELSE 0 END
   WHERE user_id = uid;
END;
$$;
