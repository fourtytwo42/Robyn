BEGIN;

ALTER TABLE launches
  ADD COLUMN IF NOT EXISTS campaign_id text,
  ADD COLUMN IF NOT EXISTS campaign_release_sha text,
  ADD COLUMN IF NOT EXISTS automated_test_launch boolean NOT NULL DEFAULT false;

ALTER TABLE prepared_token_metadata
  ADD COLUMN IF NOT EXISTS campaign_id text,
  ADD COLUMN IF NOT EXISTS campaign_release_sha text,
  ADD COLUMN IF NOT EXISTS automated_test_launch boolean NOT NULL DEFAULT false;

ALTER TABLE launch_metadata_bindings
  ADD COLUMN IF NOT EXISTS campaign_id text,
  ADD COLUMN IF NOT EXISTS campaign_release_sha text,
  ADD COLUMN IF NOT EXISTS automated_test_launch boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS launches_campaign_idx
  ON launches (chain_id, campaign_id, launch_id);

CREATE INDEX IF NOT EXISTS prepared_metadata_campaign_idx
  ON prepared_token_metadata (chain_id, campaign_id, created_at);

CREATE INDEX IF NOT EXISTS launch_metadata_campaign_idx
  ON launch_metadata_bindings (chain_id, campaign_id, bound_at);

INSERT INTO schema_migrations(version)
VALUES ('0007_test_campaigns')
ON CONFLICT (version) DO NOTHING;

COMMIT;
