BEGIN;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS adapter text;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS locker text;
CREATE INDEX IF NOT EXISTS launches_adapter_idx ON launches (chain_id, adapter);
CREATE INDEX IF NOT EXISTS launches_locker_idx ON launches (chain_id, locker);
INSERT INTO schema_migrations(version) VALUES ('0010_security_remediation_projection') ON CONFLICT (version) DO NOTHING;
COMMIT;
