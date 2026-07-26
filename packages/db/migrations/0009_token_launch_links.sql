BEGIN;

ALTER TABLE prepared_token_metadata
  ADD COLUMN IF NOT EXISTS project_website text,
  ADD COLUMN IF NOT EXISTS project_x_url text;

ALTER TABLE launch_metadata_bindings
  ADD COLUMN IF NOT EXISTS project_website text,
  ADD COLUMN IF NOT EXISTS project_x_url text;

INSERT INTO schema_migrations(version)
VALUES ('0009_token_launch_links')
ON CONFLICT (version) DO NOTHING;

COMMIT;
