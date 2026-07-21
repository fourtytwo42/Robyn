BEGIN;
ALTER TABLE job_audit ADD COLUMN IF NOT EXISTS result jsonb;
ALTER TABLE job_audit ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE job_audit ADD COLUMN IF NOT EXISTS completed_at timestamptz;
CREATE TABLE IF NOT EXISTS service_heartbeats (
  service text PRIMARY KEY,
  status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES ('0002_operations') ON CONFLICT (version) DO NOTHING;
COMMIT;
