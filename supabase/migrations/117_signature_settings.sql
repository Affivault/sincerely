-- ============================================================================
-- 117 - Email signatures: when they are added, and somewhere to keep images.
--
-- 1. smtp_accounts.signature_use: which emails get the inbox's signature on
--    their own, as in Gmail. 'all' (new emails, replies and forwards), 'new'
--    (new emails only), 'replies' (replies and forwards only) or 'none'
--    (inserted by hand from the composer). Existing inboxes keep what they
--    had: signature_auto on becomes 'all', off becomes 'none'.
--
-- 2. signature_images: logos and headshots uploaded from the signature
--    editor. Gmail and Outlook drop images pasted into the HTML, so the app
--    serves them at a public address (/api/sig/<id>). Up to 400 KB each,
--    checked by the server. Only the server reads or writes the table.
--
-- Depends on: smtp_accounts (023 added signature_html and signature_auto).
-- Safe to run more than once.
-- ============================================================================

ALTER TABLE smtp_accounts
  ADD COLUMN IF NOT EXISTS signature_use text;

UPDATE smtp_accounts
   SET signature_use = CASE WHEN signature_auto THEN 'all' ELSE 'none' END
 WHERE signature_use IS NULL;

ALTER TABLE smtp_accounts
  ALTER COLUMN signature_use SET DEFAULT 'none',
  ALTER COLUMN signature_use SET NOT NULL;

ALTER TABLE smtp_accounts
  DROP CONSTRAINT IF EXISTS smtp_accounts_signature_use_check;
ALTER TABLE smtp_accounts
  ADD CONSTRAINT smtp_accounts_signature_use_check
  CHECK (signature_use IN ('all', 'new', 'replies', 'none'));

COMMENT ON COLUMN smtp_accounts.signature_use IS 'Which emails get the signature on their own: all, new, replies (and forwards) or none.';

CREATE TABLE IF NOT EXISTS signature_images (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mime         text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 409600),
  data_base64  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signature_images_user ON signature_images(user_id);
ALTER TABLE signature_images ENABLE ROW LEVEL SECURITY;
-- No policy: only the server (service role) reads or writes it.

NOTIFY pgrst, 'reload schema';
