BEGIN;

CREATE TABLE IF NOT EXISTS keeper_scan_requests (
  chain_id bigint NOT NULL,
  token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed')),
  first_block bigint NOT NULL,
  highest_block bigint NOT NULL,
  last_transaction_hash text NOT NULL,
  last_log_index integer NOT NULL,
  trigger_count bigint NOT NULL DEFAULT 1,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  retry_after timestamptz NOT NULL DEFAULT now(),
  last_error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token)
);

CREATE INDEX IF NOT EXISTS keeper_scan_requests_pending_idx
  ON keeper_scan_requests (chain_id, retry_after, highest_block)
  WHERE status = 'pending';

INSERT INTO schema_migrations(version)
VALUES ('0011_keeper_scan_requests')
ON CONFLICT (version) DO NOTHING;

COMMIT;
