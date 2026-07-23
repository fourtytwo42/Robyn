BEGIN;

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS canonical_png_sha256 text REFERENCES artifacts(sha256),
  ADD COLUMN IF NOT EXISTS canonical_png_cid text,
  ADD COLUMN IF NOT EXISTS optimized_webp_cid text,
  ADD COLUMN IF NOT EXISTS has_alpha boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS ipfs_pins (
  cid text PRIMARY KEY,
  object_kind text NOT NULL,
  artifact_sha256 text NOT NULL REFERENCES artifacts(sha256),
  local_status text NOT NULL DEFAULT 'queued',
  remote_status text NOT NULL DEFAULT 'queued',
  remote_request_id text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ipfs_cid_v1_check CHECK (cid ~ '^b[a-z2-7]{20,120}$'),
  CONSTRAINT ipfs_object_kind_check CHECK (object_kind IN ('token-png','token-webp','token-metadata','token-list','fallback')),
  CONSTRAINT ipfs_local_status_check CHECK (local_status IN ('queued','pinning','pinned','failed')),
  CONSTRAINT ipfs_remote_status_check CHECK (remote_status IN ('queued','pinning','pinned','failed'))
);
CREATE INDEX IF NOT EXISTS ipfs_pins_status_idx
  ON ipfs_pins(local_status, remote_status, updated_at);

CREATE TABLE IF NOT EXISTS prepared_token_metadata (
  preparation_id text PRIMARY KEY,
  chain_id integer NOT NULL,
  owner_address text NOT NULL,
  media_id text NOT NULL REFERENCES media_assets(media_id),
  name text NOT NULL,
  symbol text NOT NULL,
  description text NOT NULL DEFAULT '',
  metadata_artifact_sha256 text NOT NULL REFERENCES artifacts(sha256),
  metadata_cid text NOT NULL REFERENCES ipfs_pins(cid),
  metadata_uri text NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  bound_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  bound_at timestamptz,
  CONSTRAINT prepared_id_uuid_check CHECK (preparation_id ~ '^[0-9a-f-]{36}$'),
  CONSTRAINT prepared_owner_check CHECK (owner_address = lower(owner_address) AND owner_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT prepared_description_check CHECK (char_length(description) <= 280),
  CONSTRAINT prepared_metadata_cid_check CHECK (metadata_cid ~ '^b[a-z2-7]{20,120}$'),
  CONSTRAINT prepared_metadata_uri_check CHECK (metadata_uri = 'ipfs://' || metadata_cid),
  CONSTRAINT prepared_status_check CHECK (status IN ('ready','bound','abandoned')),
  CONSTRAINT prepared_bound_token_check CHECK (bound_token IS NULL OR (bound_token = lower(bound_token) AND bound_token ~ '^0x[0-9a-f]{40}$'))
);
CREATE INDEX IF NOT EXISTS prepared_metadata_owner_idx
  ON prepared_token_metadata(chain_id, owner_address, created_at DESC);

ALTER TABLE launch_metadata_bindings
  ADD COLUMN IF NOT EXISTS preparation_id text REFERENCES prepared_token_metadata(preparation_id),
  ADD COLUMN IF NOT EXISTS metadata_cid text,
  ADD COLUMN IF NOT EXISTS metadata_uri text,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'legacy';

INSERT INTO schema_migrations(version)
VALUES ('0006_ipfs_metadata')
ON CONFLICT (version) DO NOTHING;

COMMIT;
