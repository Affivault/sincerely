-- 069: Let an account tell us its DKIM selector.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- The check was reporting "No DKIM record found" for domains that plainly
-- had DKIM, and the reason is worth writing down because it is not a bug
-- that can be fixed by trying harder.
--
-- A DKIM key lives at <selector>._domainkey.<domain>, and DNS offers no way
-- to ask which selectors exist. There is no listing, no wildcard, no
-- enumeration. You can only look up a name you already know. So the check
-- guessed from a list of common selectors - and then reported a guess that
-- missed as an absence, which is a claim it had not earned.
--
-- Plenty of real setups cannot be guessed even in principle:
--
--   Amazon SES   three CNAMEs at random 32-character tokens
--   HubSpot      hs1-<account id>, hs2-<account id>
--   Postmark     dated, like 20230601pm
--   Klaviyo      per-account selectors
--
-- So the account gets to say. One column: the selector they know they use,
-- checked first from then on and verified like any other. Guessing stays as
-- the fallback, because for Google and Microsoft it works and asking would
-- be rude.

ALTER TABLE sending_domains
  -- What the account told us, or what a successful guess found. Checked
  -- before the guess list on every subsequent run, so a domain only has to
  -- be identified once.
  ADD COLUMN IF NOT EXISTS dkim_selector text,
  -- Where it came from. 'manual' is a statement by a person and is never
  -- overwritten by a guess; 'detected' is this service's own finding and may
  -- be replaced by a better one.
  ADD COLUMN IF NOT EXISTS dkim_selector_source text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sending_domains_dkim_source_known') THEN
    ALTER TABLE sending_domains ADD CONSTRAINT sending_domains_dkim_source_known
      CHECK (dkim_selector_source IS NULL OR dkim_selector_source IN ('manual', 'detected'));
  END IF;

  -- A selector is a DNS label. Anything needing escaping cannot be one, and
  -- letting it through would build a lookup host that is not a host.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sending_domains_dkim_selector_shape') THEN
    ALTER TABLE sending_domains ADD CONSTRAINT sending_domains_dkim_selector_shape
      CHECK (
        dkim_selector IS NULL
        OR dkim_selector ~ '^[A-Za-z0-9]([A-Za-z0-9._-]{0,61}[A-Za-z0-9])?$'
      );
  END IF;
END;
$$;

-- Backfill what previous successful checks already discovered. The result of
-- the last check is kept as JSON, and the selector is in it - so a domain
-- that was working goes on working without anybody re-entering anything.
UPDATE sending_domains
   SET dkim_selector = last_dns_check -> 'dkim' ->> 'selector',
       dkim_selector_source = 'detected'
 WHERE dkim_selector IS NULL
   AND last_dns_check -> 'dkim' ->> 'selector' IS NOT NULL
   AND last_dns_check -> 'dkim' ->> 'selector' ~ '^[A-Za-z0-9]([A-Za-z0-9._-]{0,61}[A-Za-z0-9])?$';
