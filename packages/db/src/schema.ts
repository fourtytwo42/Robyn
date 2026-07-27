import {
  bigint,
  bigserial,
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
    adapter: text("adapter"),
    locker: text("locker"),
    creator: text("creator").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    assets: jsonb("assets").$type<string[]>().notNull(),
    weightsBps: jsonb("weights_bps").$type<number[]>().notNull(),
    createdBlock: bigint("created_block", { mode: "bigint" }).notNull(),
    updatedBlock: bigint("updated_block", { mode: "bigint" }).notNull(),
    formulaVersion: text("formula_version").notNull().default("native-v1"),
    campaignId: text("campaign_id"),
    campaignReleaseSha: text("campaign_release_sha"),
    automatedTestLaunch: boolean("automated_test_launch")
      .notNull()
      .default(false),
    poolId: text("pool_id"),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.token] }),
    uniqueIndex("launches_id_uq").on(table.chainId, table.launchId),
    index("launches_updated_idx").on(table.chainId, table.updatedBlock),
  ],
);

export const launchTraders = pgTable(
  "launch_traders",
  {
    chainId: integer("chain_id").notNull(),
    token: text("token").notNull(),
    trader: text("trader").notNull(),
    firstSeenBlock: bigint("first_seen_block", { mode: "bigint" }).notNull(),
    firstSeenTransactionHash: text("first_seen_transaction_hash").notNull(),
    firstSeenLogIndex: integer("first_seen_log_index").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.token, table.trader] }),
    index("launch_traders_token_idx").on(
      table.chainId,
      table.token,
      table.firstSeenBlock,
    ),
  ],
);

export const kingOfForestProgress = pgTable(
  "king_of_forest_progress",
  {
    chainId: integer("chain_id").notNull(),
    token: text("token").notNull(),
    progressBps: integer("progress_bps").notNull().default(0),
    marketPhase: text("market_phase").notNull().default("bonding"),
    updatedBlock: bigint("updated_block", { mode: "bigint" }).notNull(),
    updatedTransactionHash: text("updated_transaction_hash").notNull(),
    updatedLogIndex: integer("updated_log_index").notNull(),
  },
  (table) => [primaryKey({ columns: [table.chainId, table.token] })],
);

export const kingOfForestAwards = pgTable(
  "king_of_forest_awards",
  {
    chainId: integer("chain_id").notNull(),
    token: text("token").notNull(),
    awardedBlock: bigint("awarded_block", { mode: "bigint" }).notNull(),
    awardedBlockHash: text("awarded_block_hash").notNull(),
    awardedTransactionHash: text("awarded_transaction_hash").notNull(),
    awardedTransactionIndex: integer("awarded_transaction_index").notNull(),
    awardedLogIndex: integer("awarded_log_index").notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull(),
    progressBps: integer("progress_bps").notNull(),
    uniqueTraders: integer("unique_traders").notNull(),
    marketPhase: text("market_phase").notNull(),
    policyVersion: text("policy_version").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.token] }),
    index("king_of_forest_awards_order_idx").on(
      table.chainId,
      table.awardedBlock,
      table.awardedTransactionIndex,
      table.awardedLogIndex,
      table.token,
    ),
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
    result: jsonb("result"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("job_audit_state_idx").on(table.queue, table.state)],
);

export const serviceHeartbeats = pgTable("service_heartbeats", {
  service: text("service").primaryKey(),
  status: text("status").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobAuditEvents = pgTable(
  "job_audit_events",
  {
    eventId: bigserial("event_id", { mode: "bigint" }).primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    queue: text("queue").notNull(),
    state: text("state").notNull(),
    attempts: integer("attempts").notNull(),
    lastError: text("last_error"),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("job_audit_events_key_idx").on(table.idempotencyKey, table.eventId),
    index("job_audit_events_queue_idx").on(table.queue, table.eventId),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    sha256: text("sha256").primaryKey(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    byteLength: bigint("byte_length", { mode: "bigint" }).notNull(),
    contentType: text("content_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("artifacts_object_key_uq").on(table.objectKey)],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    mediaId: text("media_id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    ownerAddress: text("owner_address").notNull(),
    artifactSha256: text("artifact_sha256").notNull(),
    canonicalPngSha256: text("canonical_png_sha256"),
    canonicalPngCid: text("canonical_png_cid"),
    optimizedWebpCid: text("optimized_webp_cid"),
    hasAlpha: boolean("has_alpha").notNull().default(false),
    purpose: text("purpose").notNull(),
    status: text("status").notNull().default("active"),
    width: integer("width").notNull().default(1024),
    height: integer("height").notNull().default(1024),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("media_assets_owner_idx").on(
      table.chainId,
      table.ownerAddress,
      table.createdAt,
    ),
  ],
);

export const creatorProfiles = pgTable(
  "creator_profiles",
  {
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    website: text("website"),
    xUrl: text("x_url"),
    telegramUrl: text("telegram_url"),
    discordUrl: text("discord_url"),
    avatarMediaId: text("avatar_media_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.chainId, table.address] })],
);

export const launchMetadataBindings = pgTable(
  "launch_metadata_bindings",
  {
    chainId: integer("chain_id").notNull(),
    token: text("token").notNull(),
    creatorAddress: text("creator_address").notNull(),
    mediaId: text("media_id").notNull(),
    preparationId: text("preparation_id"),
    metadataCid: text("metadata_cid"),
    metadataUri: text("metadata_uri"),
    verificationStatus: text("verification_status").notNull().default("legacy"),
    campaignId: text("campaign_id"),
    campaignReleaseSha: text("campaign_release_sha"),
    automatedTestLaunch: boolean("automated_test_launch")
      .notNull()
      .default(false),
    projectWebsite: text("project_website"),
    projectXUrl: text("project_x_url"),
    boundAt: timestamp("bound_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.token] }),
    uniqueIndex("launch_metadata_media_uq").on(table.mediaId),
  ],
);

export const ipfsPins = pgTable(
  "ipfs_pins",
  {
    cid: text("cid").primaryKey(),
    objectKind: text("object_kind").notNull(),
    artifactSha256: text("artifact_sha256").notNull(),
    localStatus: text("local_status").notNull().default("queued"),
    remoteStatus: text("remote_status").notNull().default("queued"),
    remoteRequestId: text("remote_request_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ipfs_pins_status_idx").on(
      table.localStatus,
      table.remoteStatus,
      table.updatedAt,
    ),
  ],
);

export const preparedTokenMetadata = pgTable(
  "prepared_token_metadata",
  {
    preparationId: text("preparation_id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    ownerAddress: text("owner_address").notNull(),
    mediaId: text("media_id").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    description: text("description").notNull().default(""),
    metadataArtifactSha256: text("metadata_artifact_sha256").notNull(),
    metadataCid: text("metadata_cid").notNull(),
    metadataUri: text("metadata_uri").notNull(),
    status: text("status").notNull().default("ready"),
    boundToken: text("bound_token"),
    campaignId: text("campaign_id"),
    campaignReleaseSha: text("campaign_release_sha"),
    automatedTestLaunch: boolean("automated_test_launch")
      .notNull()
      .default(false),
    projectWebsite: text("project_website"),
    projectXUrl: text("project_x_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true }),
  },
  (table) => [
    index("prepared_metadata_owner_idx").on(
      table.chainId,
      table.ownerAddress,
      table.createdAt,
    ),
  ],
);

export const mediaReports = pgTable(
  "media_reports",
  {
    reportId: bigserial("report_id", { mode: "bigint" }).primaryKey(),
    mediaId: text("media_id").notNull(),
    reporterAddress: text("reporter_address"),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("media_reports_media_idx").on(table.mediaId, table.createdAt),
  ],
);

export const mediaModerationAudit = pgTable(
  "media_moderation_audit",
  {
    auditId: bigserial("audit_id", { mode: "bigint" }).primaryKey(),
    mediaId: text("media_id").notNull(),
    operator: text("operator").notNull(),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("moderation_audit_media_idx").on(table.mediaId, table.createdAt),
  ],
);
