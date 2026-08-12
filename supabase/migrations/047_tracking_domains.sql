-- ============================================================================
-- 047: Give each account its own tracking domain.
--
-- Every customer's open pixels, click links and unsubscribe links point at one
-- shared TRACKING_BASE_URL. Spam filters do not only judge the sending domain
-- -- they judge the domains that appear *inside* the message, and a link
-- domain that has been reported is a strong signal on its own.
--
-- That makes deliverability a shared fate. One account on the platform sending
-- something that gets the shared domain listed degrades everyone's mail at
-- once, and none of the affected accounts can do anything about it, because
-- the problem is not theirs and not visible to them. Every competitor offers a
-- per-account CNAME for exactly this reason.
--
-- Safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The domain, and whether it is actually working.
--
-- `verified` is deliberately not a synonym for "the CNAME resolves". A CNAME
-- pointing at us proves DNS is right and proves nothing about TLS -- and
-- switching an account's links to a host that cannot serve HTTPS would break
-- every link in every email they send, permanently, because a sent email
-- cannot be edited. So it is only set once the domain has answered a real
-- HTTPS request. See tracking-domain.service.ts.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracking_domains (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  domain       text NOT NULL,
  -- Only a domain that has served a real HTTPS request is ever used.
  verified     boolean NOT NULL DEFAULT false,
  verified_at  timestamptz,
  -- Why the last check failed, so the page can say something useful.
  last_error   text,
  last_checked_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One account cannot claim the same domain twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_domains_user_domain
  ON tracking_domains (user_id, lower(domain));

-- Nor can two accounts claim the same domain: the CNAME can only point one
-- place, and letting two accounts believe they own it would mean one of them
-- silently sending links that resolve to the other's verification.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_domains_domain
  ON tracking_domains (lower(domain));

-- The send path asks "does this account have a working tracking domain" on
-- every email, so that lookup gets its own partial index.
CREATE INDEX IF NOT EXISTS idx_tracking_domains_verified
  ON tracking_domains (user_id)
  WHERE verified;

ALTER TABLE tracking_domains ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tracking_domains' AND policyname = 'Users manage their own tracking domains'
  ) THEN
    CREATE POLICY "Users manage their own tracking domains"
      ON tracking_domains FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS tracking_domains_updated_at ON tracking_domains;
CREATE TRIGGER tracking_domains_updated_at
  BEFORE UPDATE ON tracking_domains
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
