BEGIN;

ALTER TABLE launches
  ADD COLUMN IF NOT EXISTS graduation_profile_version bigint,
  ADD COLUMN IF NOT EXISTS target_graduation_native numeric(78, 0),
  ADD COLUMN IF NOT EXISTS actual_graduation_native numeric(78, 0),
  ADD COLUMN IF NOT EXISTS maximum_curve_purchase numeric(78, 0),
  ADD COLUMN IF NOT EXISTS initial_virtual_native_reserve numeric(78, 0),
  ADD COLUMN IF NOT EXISTS terminal_native_per_token_x18 numeric(78, 0),
  ADD COLUMN IF NOT EXISTS terminal_sqrt_price_x96 numeric(78, 0),
  ADD COLUMN IF NOT EXISTS graduation_profile_hash text;

CREATE INDEX IF NOT EXISTS launches_graduation_profile_idx
  ON launches (chain_id, graduation_profile_version);

INSERT INTO schema_migrations(version)
VALUES ('0014_schema13_graduation_profiles')
ON CONFLICT (version) DO NOTHING;

COMMIT;
