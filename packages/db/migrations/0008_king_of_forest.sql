ALTER TABLE launches
  ADD COLUMN IF NOT EXISTS pool_id text;

CREATE TABLE IF NOT EXISTS launch_traders (
  chain_id integer NOT NULL,
  token text NOT NULL,
  trader text NOT NULL,
  first_seen_block bigint NOT NULL,
  first_seen_transaction_hash text NOT NULL,
  first_seen_log_index integer NOT NULL,
  PRIMARY KEY (chain_id, token, trader)
);

CREATE INDEX IF NOT EXISTS launch_traders_token_idx
  ON launch_traders (chain_id, token, first_seen_block);

CREATE TABLE IF NOT EXISTS king_of_forest_progress (
  chain_id integer NOT NULL,
  token text NOT NULL,
  progress_bps integer NOT NULL DEFAULT 0,
  market_phase text NOT NULL DEFAULT 'bonding',
  updated_block bigint NOT NULL,
  updated_transaction_hash text NOT NULL,
  updated_log_index integer NOT NULL,
  PRIMARY KEY (chain_id, token),
  CHECK (progress_bps >= 0 AND progress_bps <= 10000),
  CHECK (market_phase IN ('bonding', 'graduated'))
);

CREATE TABLE IF NOT EXISTS king_of_forest_awards (
  chain_id integer NOT NULL,
  token text NOT NULL,
  awarded_block bigint NOT NULL,
  awarded_block_hash text NOT NULL,
  awarded_transaction_hash text NOT NULL,
  awarded_transaction_index integer NOT NULL,
  awarded_log_index integer NOT NULL,
  awarded_at timestamptz NOT NULL,
  progress_bps integer NOT NULL,
  unique_traders integer NOT NULL,
  market_phase text NOT NULL,
  policy_version text NOT NULL,
  PRIMARY KEY (chain_id, token),
  CHECK (progress_bps >= 0 AND progress_bps <= 10000),
  CHECK (unique_traders >= 0),
  CHECK (market_phase IN ('bonding', 'graduated'))
);

CREATE INDEX IF NOT EXISTS king_of_forest_awards_order_idx
  ON king_of_forest_awards (
    chain_id,
    awarded_block DESC,
    awarded_transaction_index DESC,
    awarded_log_index DESC,
    token DESC
  );

INSERT INTO schema_migrations(version)
VALUES ('0008_king_of_forest')
ON CONFLICT (version) DO NOTHING;
