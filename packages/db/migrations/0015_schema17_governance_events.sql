BEGIN;

CREATE TABLE governance_control_events (
  chain_id integer NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  block_number numeric(78,0) NOT NULL,
  block_hash text NOT NULL,
  address text NOT NULL,
  source text NOT NULL CHECK (source IN ('bootstrap-timelock', 'governor')),
  event_name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (chain_id, transaction_hash, log_index)
);

CREATE INDEX governance_control_events_block_idx
  ON governance_control_events(chain_id, block_number, log_index);
CREATE INDEX governance_control_events_name_idx
  ON governance_control_events(chain_id, source, event_name, block_number);

INSERT INTO schema_migrations(version)
VALUES ('0015_schema17_governance_events')
ON CONFLICT (version) DO NOTHING;

COMMIT;
