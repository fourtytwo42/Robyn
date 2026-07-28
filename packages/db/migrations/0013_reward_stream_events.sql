BEGIN;

CREATE TABLE reward_stream_events (
  chain_id integer NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  block_number numeric(78,0) NOT NULL,
  block_hash text NOT NULL,
  address text NOT NULL,
  category text NOT NULL CHECK (category IN ('holder', 'dao', 'creator')),
  token text,
  recipient text,
  event_name text NOT NULL,
  asset_index integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (chain_id, transaction_hash, log_index)
);

CREATE INDEX reward_stream_events_token_idx
  ON reward_stream_events(chain_id, token, block_number, log_index);
CREATE INDEX reward_stream_events_recipient_idx
  ON reward_stream_events(chain_id, recipient, block_number, log_index);
CREATE INDEX reward_stream_events_category_idx
  ON reward_stream_events(chain_id, category, event_name, block_number);

INSERT INTO schema_migrations(version)
VALUES ('0013_reward_stream_events')
ON CONFLICT (version) DO NOTHING;

COMMIT;
