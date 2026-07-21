BEGIN;
CREATE TABLE IF NOT EXISTS job_audit_events (
  event_id bigserial PRIMARY KEY,
  idempotency_key text NOT NULL,
  queue text NOT NULL,
  state text NOT NULL,
  attempts integer NOT NULL,
  last_error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_audit_events_key_idx ON job_audit_events (idempotency_key, event_id);
CREATE INDEX IF NOT EXISTS job_audit_events_queue_idx ON job_audit_events (queue, event_id);
INSERT INTO schema_migrations(version) VALUES ('0003_job_audit_events') ON CONFLICT (version) DO NOTHING;
COMMIT;
