-- 018: Sub-folders for campaign folders. A folder may belong to a parent
-- folder, so campaigns can be organised as Company → sub-folder → campaigns.
-- Deleting a parent removes its sub-folders (campaigns inside fall back to
-- "Uncategorised" via the existing campaigns.folder_id ON DELETE SET NULL).

ALTER TABLE campaign_folders
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES campaign_folders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_campaign_folders_parent ON campaign_folders(parent_id);
