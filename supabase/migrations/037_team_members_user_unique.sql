-- ============================================================
-- Migration 037: Enforce one organisation per user
-- ============================================================
-- team.service.ts's getOrCreateOrg()/getOrg()/acceptInvite() all assume a
-- user belongs to at most one org. The only existing constraint was
-- UNIQUE(org_id, user_id), which doesn't stop the same user_id appearing
-- under two different orgs — the exact case that let two concurrent
-- getOrCreateOrg() calls each insert a personal org for the same brand-new
-- user. Backfill-safe: keep the membership row per user with the earliest
-- created_at and drop the rest before adding the constraint, so this can
-- run against data that already has duplicates.
DELETE FROM team_members a USING team_members b
WHERE a.user_id IS NOT NULL
  AND a.user_id = b.user_id
  AND a.created_at > b.created_at;

DELETE FROM team_members a USING team_members b
WHERE a.user_id IS NOT NULL
  AND a.user_id = b.user_id
  AND a.created_at = b.created_at
  AND a.id > b.id;

ALTER TABLE team_members ADD CONSTRAINT team_members_user_id_unique UNIQUE (user_id);
