BEGIN;
CREATE TABLE IF NOT EXISTS artifacts (
  sha256 text PRIMARY KEY,
  bucket text NOT NULL,
  object_key text NOT NULL UNIQUE,
  byte_length bigint NOT NULL,
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT artifacts_length_check CHECK (byte_length >= 0)
);
INSERT INTO schema_migrations(version) VALUES ('0004_artifacts') ON CONFLICT (version) DO NOTHING;
COMMIT;
