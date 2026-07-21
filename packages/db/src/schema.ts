import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const chainBlocks = pgTable(
  "chain_blocks",
  {
    chainId: integer("chain_id").notNull(),
    number: bigint("number", { mode: "bigint" }).notNull(),
    hash: text("hash").notNull(),
    parentHash: text("parent_hash").notNull(),
    timestamp: bigint("timestamp", { mode: "bigint" }).notNull(),
    canonical: boolean("canonical").notNull().default(true),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.number] }),
    uniqueIndex("chain_blocks_hash_uq").on(table.chainId, table.hash),
  ],
);

export const rawLogs = pgTable(
  "raw_logs",
  {
    chainId: integer("chain_id").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash").notNull(),
    transactionHash: text("transaction_hash").notNull(),
    transactionIndex: integer("transaction_index").notNull(),
    logIndex: integer("log_index").notNull(),
    address: text("address").notNull(),
    topics: jsonb("topics").$type<string[]>().notNull(),
    data: text("data").notNull(),
    removed: boolean("removed").notNull().default(false),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.chainId, table.transactionHash, table.logIndex],
    }),
    index("raw_logs_block_idx").on(table.chainId, table.blockNumber),
    index("raw_logs_address_idx").on(table.chainId, table.address),
  ],
);

export const launches = pgTable(
  "launches",
  {
    chainId: integer("chain_id").notNull(),
    launchId: bigint("launch_id", { mode: "bigint" }).notNull(),
    token: text("token").notNull(),
    vault: text("vault").notNull(),
    market: text("market").notNull(),
    creator: text("creator").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    assets: jsonb("assets").$type<string[]>().notNull(),
    weightsBps: jsonb("weights_bps").$type<number[]>().notNull(),
    createdBlock: bigint("created_block", { mode: "bigint" }).notNull(),
    updatedBlock: bigint("updated_block", { mode: "bigint" }).notNull(),
    formulaVersion: text("formula_version").notNull().default("native-v1"),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.token] }),
    uniqueIndex("launches_id_uq").on(table.chainId, table.launchId),
    index("launches_updated_idx").on(table.chainId, table.updatedBlock),
  ],
);

export const indexerCheckpoints = pgTable(
  "indexer_checkpoints",
  {
    service: text("service").notNull(),
    chainId: integer("chain_id").notNull(),
    lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
    lastHash: text("last_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.service, table.chainId] })],
);

export const jobAudit = pgTable(
  "job_audit",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    queue: text("queue").notNull(),
    state: text("state").notNull(),
    attempts: integer("attempts").notNull().default(0),
    payload: jsonb("payload").notNull(),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("job_audit_state_idx").on(table.queue, table.state)],
);
