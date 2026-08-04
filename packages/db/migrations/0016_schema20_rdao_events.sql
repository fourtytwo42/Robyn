CREATE TABLE IF NOT EXISTS schema20_rdao_events (
  chain_id integer NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  block_hash text NOT NULL,
  address text NOT NULL,
  source text NOT NULL,
  event_name text NOT NULL,
  account text,
  amount numeric(78,0),
  payload jsonb NOT NULL,
  PRIMARY KEY (chain_id, transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS schema20_rdao_events_block_idx
  ON schema20_rdao_events (chain_id, block_number);
CREATE INDEX IF NOT EXISTS schema20_rdao_events_account_idx
  ON schema20_rdao_events (chain_id, account);
CREATE INDEX IF NOT EXISTS schema20_rdao_events_source_idx
  ON schema20_rdao_events (chain_id, source, event_name);
