BEGIN;

ALTER TABLE keeper_scan_requests
  ADD COLUMN IF NOT EXISTS trigger_log_identities jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE keeper_scan_requests
SET trigger_log_identities = jsonb_build_array(
  jsonb_build_object(
    'blockNumber', highest_block::text,
    'transactionHash', last_transaction_hash,
    'logIndex', last_log_index
  )
)
WHERE trigger_log_identities = '[]'::jsonb;

INSERT INTO schema_migrations(version)
VALUES ('0012_keeper_trigger_log_identities')
ON CONFLICT (version) DO NOTHING;

COMMIT;
