BEGIN;

CREATE TABLE IF NOT EXISTS media_assets (
  media_id text PRIMARY KEY,
  chain_id integer NOT NULL,
  owner_address text NOT NULL,
  artifact_sha256 text NOT NULL REFERENCES artifacts(sha256),
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  width integer NOT NULL DEFAULT 1024,
  height integer NOT NULL DEFAULT 1024,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_id_uuid_check CHECK (media_id ~ '^[0-9a-f-]{36}$'),
  CONSTRAINT media_owner_lower_check CHECK (owner_address = lower(owner_address) AND owner_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT media_purpose_check CHECK (purpose IN ('token', 'avatar')),
  CONSTRAINT media_status_check CHECK (status IN ('active', 'quarantined')),
  CONSTRAINT media_dimensions_check CHECK (width = 1024 AND height = 1024)
);
CREATE INDEX IF NOT EXISTS media_assets_owner_idx ON media_assets(chain_id, owner_address, created_at DESC);

CREATE TABLE IF NOT EXISTS creator_profiles (
  chain_id integer NOT NULL,
  address text NOT NULL,
  display_name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  website text,
  x_url text,
  telegram_url text,
  discord_url text,
  avatar_media_id text REFERENCES media_assets(media_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address),
  CONSTRAINT profile_address_lower_check CHECK (address = lower(address) AND address ~ '^0x[0-9a-f]{40}$')
);

CREATE TABLE IF NOT EXISTS launch_metadata_bindings (
  chain_id integer NOT NULL,
  token text NOT NULL,
  creator_address text NOT NULL,
  media_id text NOT NULL REFERENCES media_assets(media_id),
  bound_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token),
  CONSTRAINT binding_token_lower_check CHECK (token = lower(token) AND token ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT binding_creator_lower_check CHECK (creator_address = lower(creator_address) AND creator_address ~ '^0x[0-9a-f]{40}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS launch_metadata_media_uq ON launch_metadata_bindings(media_id);

CREATE TABLE IF NOT EXISTS media_reports (
  report_id bigserial PRIMARY KEY,
  media_id text NOT NULL REFERENCES media_assets(media_id),
  reporter_address text,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_address_lower_check CHECK (reporter_address IS NULL OR (reporter_address = lower(reporter_address) AND reporter_address ~ '^0x[0-9a-f]{40}$')),
  CONSTRAINT report_reason_length_check CHECK (char_length(reason) BETWEEN 10 AND 500)
);
CREATE INDEX IF NOT EXISTS media_reports_media_idx ON media_reports(media_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media_moderation_audit (
  audit_id bigserial PRIMARY KEY,
  media_id text NOT NULL REFERENCES media_assets(media_id),
  operator text NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_action_check CHECK (action IN ('quarantine', 'restore')),
  CONSTRAINT moderation_reason_length_check CHECK (char_length(reason) BETWEEN 3 AND 500)
);
CREATE INDEX IF NOT EXISTS moderation_audit_media_idx ON media_moderation_audit(media_id, created_at DESC);

INSERT INTO schema_migrations(version) VALUES ('0005_creator_identity') ON CONFLICT (version) DO NOTHING;
COMMIT;
