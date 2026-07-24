import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { Redis } from "ioredis";
import { readFile } from "node:fs/promises";
import { createDatabase } from "@robyn/db";
import { createPublicClient, http, type Address } from "viem";
import {
  encodeDiscoveryCursor,
  parseDiscoveryQuery,
  type DiscoveryQuery,
} from "./discovery-query.js";
import {
  demoMarketChangeBps,
  isDemoMarketChangeEnabled,
} from "./demo-market-change.js";
import {
  analyticsLogAddresses,
  collectTokenAccounts,
  deriveLaunchAnalytics,
  type AnalyticsLog,
} from "./launch-analytics.js";
import { registerCreatorRoutes } from "./creator-routes.js";
import { registerDaoRoutes } from "./dao-routes.js";
import { SingleFlightTtlCache } from "./single-flight-cache.js";
import {
  AssetCatalogService,
  type AssetCatalogManifest,
} from "./asset-catalog.js";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 2 * 1024 * 1024,
});
await app.register(cookie);
app.addContentTypeParser(
  ["image/jpeg", "image/png", "image/webp"],
  { parseAs: "buffer", bodyLimit: 2 * 1024 * 1024 },
  (_request, body, done) => done(null, body),
);
const { sql } = createDatabase();
const chainId = Number(process.env.CHAIN_ID ?? "31337");
const demoMarketChangesEnabled = isDemoMarketChangeEnabled(
  chainId,
  process.env.ROBYN_DEMO_MARKET_CHANGES,
);
const queueName = process.env.ROBYN_QUEUE_NAME ?? "robyn-conversions";
const port = Number(process.env.PORT ?? "3100");
const host = process.env.HOST ?? "0.0.0.0";
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
const allowedOrigins = new Set(
  (process.env.ROBYN_AUTH_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
if (allowedOrigins.size === 0)
  throw new Error("ROBYN_AUTH_ORIGINS is required");
const artifactServiceUrl =
  process.env.ROBYN_ARTIFACT_SERVICE_URL ?? "http://127.0.0.1:3200";
const ipfsApiUrl = process.env.ROBYN_IPFS_API_URL ?? "http://127.0.0.1:5001";
const rpcClient = createPublicClient({
  transport: http(
    process.env.ROBYN_OPERATOR_RPC_URL ?? "http://127.0.0.1:8545",
  ),
});
const deployment = JSON.parse(
  await readFile(
    process.env.ROBYN_MANIFEST ?? "/home/hendo420/Robyn/deployments/31337.json",
    "utf8",
  ),
) as {
  deploymentBlock: number;
  contracts: {
    baseAsset: Address;
    conversionRouter?: Address;
    routeRegistry?: Address;
    marketFactory: Address;
    legacyMarketFactories?: Address[];
    daoToken: Address;
    governor: Address;
    timelock: Address;
    guardian: Address;
    protocolFeeRouter: Address;
    nativeFeeConverter: Address;
  };
  ipfsMetadata?: {
    tokenListCid?: string | null;
    tokenListUri?: string | null;
    tokenListStablePath?: string;
  };
  assetCatalog?: AssetCatalogManifest;
};
const assetCatalog = new AssetCatalogService(
  rpcClient,
  chainId,
  deployment.contracts.baseAsset,
  deployment.contracts.routeRegistry ?? deployment.contracts.conversionRouter,
  deployment.assetCatalog,
);
const zeroAddress = "0x0000000000000000000000000000000000000000";
const erc20ViewAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
const marketViewAbi = [
  {
    type: "function",
    name: "baseAsset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "basePerToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "feeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "graduated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "graduatedPool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "positionLocker",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "graduationAdapter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "graduationProgressBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "graduationThresholdBase",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "baseRaised",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "realCurveTokenReserve",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
const graduationAdapterViewAbi = [
  {
    type: "function",
    name: "positionTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "poolFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint24" }],
  },
] as const;
const marketFactoryViewAbi = [
  {
    type: "function",
    name: "marketByToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;

type LaunchRow = {
  launch_id: string;
  token: string;
  vault: string;
  market: string;
  creator: string;
  name: string;
  symbol: string;
  assets: string[];
  weights_bps: number[];
  created_block: string;
  updated_block: string;
  formula_version: string;
};

type DiscoveryMetricLog = AnalyticsLog & { launch_token: string };

const analyticsEventTopics = [
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  "0xedba86fd2b22962d534e70ad9b0ff8730de46f636146f2bab6a72cbb1ebbcc53",
  "0xe029f26dbcf8c42dd2f352c10214a7fc26773dc62482c6240334a0402ac09a80",
  "0x8e35909329327a37503200dfcee9d7ab5d6bfa455eeda068210182468f9d4b59",
  "0xcb64f2436060c9575db20c5dcf9cdc11657017ee5b0301949f531b3dd7da6b19",
  "0x8d0453dc55ff49f0c8c7ca816943faff3ced84a6a1a9b3831f8bcf12b4d700c3",
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
] as const;

async function resolveLaunchMarket(token: string, storedMarket: string) {
  if (storedMarket.toLowerCase() !== zeroAddress) return storedMarket;
  for (const factory of [
    deployment.contracts.marketFactory,
    ...(deployment.contracts.legacyMarketFactories ?? []),
  ]) {
    const market = await rpcClient.readContract({
      address: factory,
      abi: marketFactoryViewAbi,
      functionName: "marketByToken",
      args: [token as Address],
    });
    if (market.toLowerCase() !== zeroAddress) return market.toLowerCase();
  }
  return storedMarket;
}

async function hydrateMarkets<T extends { token: string; market: string }>(
  rows: T[],
) {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      market: await resolveLaunchMarket(row.token, row.market),
    })),
  );
}

async function launchMetadataMap(tokens: string[]) {
  if (tokens.length === 0) return new Map<string, Record<string, unknown>>();
  const rows = await sql.unsafe<
    Array<{
      token: string;
      media_id: string;
      media_status: string;
      display_name: string | null;
      bio: string | null;
      website: string | null;
      x_url: string | null;
      telegram_url: string | null;
      discord_url: string | null;
      avatar_media_id: string | null;
    }>
  >(
    "SELECT b.token,b.media_id,b.metadata_cid,b.metadata_uri,b.verification_status,m.status media_status,m.canonical_png_cid,m.optimized_webp_cid,p.display_name,p.bio,p.website,p.x_url,p.telegram_url,p.discord_url,p.avatar_media_id FROM launch_metadata_bindings b JOIN media_assets m ON m.media_id=b.media_id LEFT JOIN creator_profiles p ON p.chain_id=b.chain_id AND p.address=b.creator_address WHERE b.chain_id=$1 AND b.token=ANY($2::text[])",
    [chainId, tokens],
  );
  return new Map(rows.map((row) => [row.token.toLowerCase(), row]));
}

type MarketConfiguration = {
  basePerToken: bigint;
  feeBps: number;
  marketPhase: "legacy_fixed" | "bonding" | "graduated";
  graduationProgressBps: number;
  graduationThresholdBase: bigint;
  baseRaised: bigint;
  remainingCurveTokens: bigint;
  graduatedPool: Address | null;
  liquidityVenue: "uniswap-v3" | "devnet-locked-pool" | null;
  positionLocker: Address | null;
  positionTokenId: bigint | null;
  poolFeePips: number | null;
};
const tokenSupply = new Map<string, Promise<bigint>>();

async function getMarketConfiguration(
  market: Address,
): Promise<MarketConfiguration> {
  const [basePerToken, feeBps] = await Promise.all([
    rpcClient.readContract({
      address: market,
      abi: marketViewAbi,
      functionName: "basePerToken",
    }),
    rpcClient.readContract({
      address: market,
      abi: marketViewAbi,
      functionName: "feeBps",
    }),
  ]);
  try {
    const [graduated, graduatedPool, progress, threshold, raised, remaining] =
      await Promise.all([
        rpcClient.readContract({
          address: market,
          abi: marketViewAbi,
          functionName: "graduated",
        }),
        rpcClient.readContract({
          address: market,
          abi: marketViewAbi,
          functionName: "graduatedPool",
        }),
        rpcClient.readContract({
          address: market,
          abi: marketViewAbi,
          functionName: "graduationProgressBps",
        }),
        rpcClient.readContract({
          address: market,
          abi: marketViewAbi,
          functionName: "graduationThresholdBase",
        }),
        rpcClient.readContract({
          address: market,
          abi: marketViewAbi,
          functionName: "baseRaised",
        }),
        rpcClient.readContract({
          address: market,
          abi: marketViewAbi,
          functionName: "realCurveTokenReserve",
        }),
      ]);
    let liquidityVenue: MarketConfiguration["liquidityVenue"] =
      "devnet-locked-pool";
    let positionLocker: Address | null = null;
    let positionTokenId: bigint | null = null;
    let poolFeePips: number | null = null;
    try {
      const [locker, adapter] = await Promise.all([
        rpcClient.readContract({
          address: market,
          abi: marketViewAbi,
          functionName: "positionLocker",
        }),
        rpcClient.readContract({
          address: market,
          abi: marketViewAbi,
          functionName: "graduationAdapter",
        }),
      ]);
      const [tokenId, fee] = await Promise.all([
        rpcClient.readContract({
          address: adapter,
          abi: graduationAdapterViewAbi,
          functionName: "positionTokenId",
        }),
        rpcClient.readContract({
          address: adapter,
          abi: graduationAdapterViewAbi,
          functionName: "poolFee",
        }),
      ]);
      liquidityVenue = "uniswap-v3";
      positionLocker = locker;
      positionTokenId = tokenId === 0n ? null : tokenId;
      poolFeePips = Number(fee);
    } catch {
      // Older controlled-devnet markets intentionally expose only their local pool.
    }
    return {
      basePerToken,
      feeBps: Number(feeBps),
      marketPhase: graduated ? "graduated" : "bonding",
      graduationProgressBps: Number(progress),
      graduationThresholdBase: threshold,
      baseRaised: raised,
      remainingCurveTokens: remaining,
      graduatedPool,
      liquidityVenue,
      positionLocker,
      positionTokenId,
      poolFeePips,
    };
  } catch {
    return {
      basePerToken,
      feeBps: Number(feeBps),
      marketPhase: "legacy_fixed",
      graduationProgressBps: 10_000,
      graduationThresholdBase: 0n,
      baseRaised: 0n,
      remainingCurveTokens: 0n,
      graduatedPool: null,
      liquidityVenue: null,
      positionLocker: null,
      positionTokenId: null,
      poolFeePips: null,
    };
  }
}

function getTokenSupply(token: Address) {
  const key = token.toLowerCase();
  const existing = tokenSupply.get(key);
  if (existing) return existing;
  const pending = rpcClient.readContract({
    address: token,
    abi: erc20ViewAbi,
    functionName: "totalSupply",
  });
  tokenSupply.set(key, pending);
  void pending.catch(() => tokenSupply.delete(key));
  return pending;
}

async function discoveryMetrics(rows: LaunchRow[]) {
  const metrics = new Map<string, ReturnType<typeof deriveLaunchAnalytics>>();
  if (rows.length === 0) return metrics;
  const configurations = new Map(
    await Promise.all(
      rows.map(
        async (row) =>
          [
            row.token.toLowerCase(),
            await getMarketConfiguration(row.market as Address),
          ] as const,
      ),
    ),
  );
  const logs = await sql.unsafe<DiscoveryMetricLog[]>(
    "WITH targets(launch_token,market,pool) AS (SELECT * FROM unnest($2::text[],$3::text[],$4::text[])), ranked AS (SELECT t.launch_token,l.block_number::text,l.transaction_hash,l.log_index,l.address,l.topics,l.data,b.timestamp::text,row_number() OVER (PARTITION BY t.launch_token ORDER BY l.block_number,l.transaction_index,l.log_index) AS event_number FROM targets t JOIN raw_logs l ON l.chain_id=$1 AND (l.address=t.launch_token OR l.address=t.market OR l.address=t.pool) AND l.topics->>0=ANY($5::text[]) LEFT JOIN chain_blocks b ON b.chain_id=l.chain_id AND b.number=l.block_number) SELECT launch_token,block_number,transaction_hash,log_index,address,topics,data,timestamp FROM ranked WHERE event_number<=10001 ORDER BY launch_token,block_number::bigint,log_index",
    [
      chainId,
      rows.map((row) => row.token.toLowerCase()),
      rows.map((row) => row.market.toLowerCase()),
      rows.map(
        (row) =>
          configurations
            .get(row.token.toLowerCase())
            ?.graduatedPool?.toLowerCase() ?? zeroAddress,
      ),
      analyticsEventTopics,
    ],
  );
  const byToken = new Map<string, AnalyticsLog[]>();
  for (const log of logs) {
    const key = log.launch_token.toLowerCase();
    const tokenLogs = byToken.get(key) ?? [];
    tokenLogs.push(log);
    byToken.set(key, tokenLogs);
  }
  await Promise.all(
    rows.map(async (row) => {
      const key = row.token.toLowerCase();
      const tokenLogs = byToken.get(key) ?? [];
      if (tokenLogs.length > 10_000) return;
      const config = configurations.get(key);
      if (!config) return;
      const activeLiquidityAddress =
        config.marketPhase === "graduated" && config.graduatedPool
          ? config.graduatedPool
          : (row.market as Address);
      const baseAssetAddress = await rpcClient.readContract({
        address: row.market as Address,
        abi: marketViewAbi,
        functionName: "baseAsset",
      });
      const [tokenReserve, baseReserve] = await Promise.all([
        rpcClient.readContract({
          address: row.token as Address,
          abi: erc20ViewAbi,
          functionName: "balanceOf",
          args: [activeLiquidityAddress],
        }),
        rpcClient.readContract({
          address: baseAssetAddress,
          abi: erc20ViewAbi,
          functionName: "balanceOf",
          args: [activeLiquidityAddress],
        }),
      ]);
      const input = {
        launch: {
          token: row.token as Address,
          market: row.market as Address,
          creator: row.creator as Address,
          baseAsset: baseAssetAddress,
          ...(config.graduatedPool
            ? { liquidityPool: config.graduatedPool }
            : {}),
        },
        logs: tokenLogs,
        createdTimestamp: null,
        basePerToken: config.basePerToken,
        feeBps: config.feeBps,
        reserveSnapshot: { tokenReserve, baseReserve },
      };
      let metric = deriveLaunchAnalytics({ ...input, lifecycle: config });
      if (metric.totalSupply === "0") {
        metric = deriveLaunchAnalytics({
          ...input,
          initialSupply: await getTokenSupply(row.token as Address),
          lifecycle: config,
        });
      }
      metrics.set(key, metric);
    }),
  );
  return metrics;
}

const discoveryMetricsCache = new SingleFlightTtlCache<
  Map<string, ReturnType<typeof deriveLaunchAnalytics>>
>(3_000, 4);

function cachedDiscoveryMetrics(rows: LaunchRow[]) {
  const key = rows
    .map((row) => `${row.token.toLowerCase()}:${row.market.toLowerCase()}`)
    .join(",");
  return discoveryMetricsCache.get(key, () => discoveryMetrics(rows));
}

app.addHook("onSend", async (_request, reply, payload) => {
  reply.header("cache-control", "no-store");
  reply.header("x-content-type-options", "nosniff");
  reply.header(
    "access-control-allow-origin",
    process.env.API_CORS_ORIGIN ?? "*",
  );
  return payload;
});

async function freshness() {
  const rows = await sql.unsafe<{ last_block: string; updated_at: string }[]>(
    "SELECT last_block::text,updated_at::text FROM indexer_checkpoints WHERE service='chain-indexer' AND chain_id=$1",
    [chainId],
  );
  return {
    asOfBlock: rows[0]?.last_block ?? null,
    indexedAt: rows[0]?.updated_at ?? null,
  };
}

async function keeperState() {
  const rows = await sql.unsafe<
    { status: string; updated_at: string; fresh: boolean }[]
  >(
    "SELECT status,updated_at::text,(updated_at > now() - interval '30 seconds') fresh FROM service_heartbeats WHERE service='conversion-keeper'",
  );
  return {
    keeperStatus: rows[0]?.status === "ok" && rows[0].fresh ? "ok" : "degraded",
    keeperUpdatedAt: rows[0]?.updated_at ?? null,
  };
}

async function artifactState() {
  const rows = await sql.unsafe<
    { status: string; updated_at: string; fresh: boolean }[]
  >(
    "SELECT status,updated_at::text,(updated_at > now() - interval '30 seconds') fresh FROM service_heartbeats WHERE service='artifact-store'",
  );
  return {
    artifactStatus:
      rows[0]?.status === "ok" && rows[0].fresh ? "ok" : "degraded",
    artifactUpdatedAt: rows[0]?.updated_at ?? null,
  };
}

app.get("/health", async (_request, reply) => {
  const [database, state, keeper, artifact] = await Promise.all([
    sql.unsafe<{ ok: number }[]>("SELECT 1 AS ok"),
    freshness(),
    keeperState(),
    artifactState(),
  ]);
  const healthy =
    database[0]?.ok === 1 &&
    state.asOfBlock !== null &&
    keeper.keeperStatus === "ok" &&
    artifact.artifactStatus === "ok";
  return reply.code(healthy ? 200 : 503).send({
    service: "robyn-api",
    status: healthy ? "ok" : "degraded",
    chainId,
    ...state,
    ...keeper,
    ...artifact,
  });
});

app.get("/status", async () => {
  const [state, counts, keeper, artifact] = await Promise.all([
    freshness(),
    sql.unsafe<{ launches: string; logs: string }[]>(
      "SELECT (SELECT count(*)::text FROM launches WHERE chain_id=$1) launches,(SELECT count(*)::text FROM raw_logs WHERE chain_id=$1) logs",
      [chainId],
    ),
    keeperState(),
    artifactState(),
  ]);
  return {
    service: "robyn-api",
    chainId,
    ...state,
    launchCount: counts[0]?.launches ?? "0",
    rawLogCount: counts[0]?.logs ?? "0",
    formulaVersion: "native-v1",
    ...keeper,
    ...artifact,
  };
});

app.get("/operations", async () => {
  const [keeper, counts, oldestPending, jobs, events] = await Promise.all([
    keeperState(),
    sql.unsafe<{ state: string; count: string }[]>(
      "SELECT state,count(*)::text count FROM job_audit WHERE queue=$1 GROUP BY state ORDER BY state",
      [queueName],
    ),
    sql.unsafe<{ oldest_pending_created_at: string | null }[]>(
      "SELECT min(created_at)::text oldest_pending_created_at FROM job_audit WHERE queue=$1 AND state IN ('queued','active','retrying')",
      [queueName],
    ),
    sql.unsafe(
      "SELECT idempotency_key,state,attempts,last_error,result,created_at::text,updated_at::text,completed_at::text FROM job_audit WHERE queue=$1 ORDER BY updated_at DESC LIMIT 25",
      [queueName],
    ),
    sql.unsafe(
      "SELECT event_id::text,idempotency_key,state,attempts,last_error,result,created_at::text FROM job_audit_events WHERE queue=$1 ORDER BY event_id DESC LIMIT 50",
      [queueName],
    ),
  ]);
  return {
    service: "robyn-api",
    queue: queueName,
    ...keeper,
    counts: Object.fromEntries(counts.map((row) => [row.state, row.count])),
    oldestPendingCreatedAt: oldestPending[0]?.oldest_pending_created_at ?? null,
    recent: jobs,
    recentEvents: events,
  };
});

app.get<{
  Querystring: DiscoveryQuery;
}>("/launches", async (request, reply) => {
  const {
    limit,
    before,
    cursor,
    query,
    asset,
    basketSize,
    creator,
    invalidCreator,
    invalidCursor,
    invalidCanonicalAddress,
    sort,
    window,
    phase,
  } = parseDiscoveryQuery(request.query);
  if (invalidCursor) {
    return reply.code(400).send({ error: "invalid_cursor" });
  }
  if (invalidCreator) {
    return reply.code(400).send({ error: "invalid_creator" });
  }
  const state = await freshness();
  if (invalidCanonicalAddress) {
    return {
      data: [],
      nextCursor: null,
      queryStatus: "invalid_address",
      filters: { q: query, asset, basketSize, creator, sort, window, phase },
      ...state,
    };
  }
  const rankedRequest =
    cursor !== null ||
    request.query.sort !== undefined ||
    request.query.window !== undefined ||
    request.query.phase !== undefined;
  const candidateLimit = rankedRequest ? 1001 : limit;
  const storedRows = await sql.unsafe<LaunchRow[]>(
    "SELECT launch_id::text,token,vault,market,creator,name,symbol,assets,weights_bps,created_block::text,updated_block::text,formula_version FROM launches WHERE chain_id=$1 AND ($2::bigint IS NULL OR launch_id::bigint<$2::bigint) AND ($4::text IS NULL OR token=$4 OR strpos(lower(name),$4)>0 OR strpos(lower(symbol),$4)>0) AND ($5::text IS NULL OR assets ? $5) AND ($6::integer IS NULL OR jsonb_array_length(assets)=$6) AND ($7::text IS NULL OR creator=$7) ORDER BY CASE WHEN token=$4 THEN 0 ELSE 1 END,launch_id::bigint DESC LIMIT $3",
    [
      chainId,
      rankedRequest ? null : before,
      candidateLimit,
      query,
      asset,
      basketSize,
      creator,
    ],
  );
  if (rankedRequest && storedRows.length === candidateLimit) {
    return reply
      .code(503)
      .send({ error: "ranked_projection_capacity_exceeded" });
  }
  const rows = await hydrateMarkets(storedRows);
  const [marketMetrics, metadata] = await Promise.all([
    cachedDiscoveryMetrics(rows).catch((error) => {
      request.log.warn({ error }, "discovery metrics unavailable");
      return new Map<string, ReturnType<typeof deriveLaunchAnalytics>>();
    }),
    launchMetadataMap(rows.map((row) => row.token)),
  ]);
  const data = rows.map((row) => {
    const metric = marketMetrics.get(row.token.toLowerCase());
    const priceChangeBps = demoMarketChangesEnabled
      ? demoMarketChangeBps(row.token as Address)
      : metric?.priceChangeBps;
    return {
      ...row,
      metadata: metadata.get(row.token.toLowerCase()) ?? null,
      metrics: metric
        ? {
            marketCapBase: metric.marketCapBase,
            priceChangeBps,
            priceChangeSource: demoMarketChangesEnabled ? "demo" : "indexed",
            change24hBps: metric.change24hBps,
            change7dBps: metric.change7dBps,
            liquidityBase: metric.liquidityBase,
            totalVolumeBase: metric.totalVolumeBase,
            volume24hBase: metric.volume24hBase,
            volume7dBase: metric.volume7dBase,
            buyVolume24hBase: metric.buyVolume24hBase,
            sellVolume24hBase: metric.sellVolume24hBase,
            tradeCount24h: metric.tradeCount24h,
            uniqueTraders24h: metric.uniqueTraders24h,
            holderCount: metric.holderCount,
            tradeCount: metric.tradeCount,
            baseSymbol: metric.baseSymbol,
            marketPhase: metric.marketPhase,
            graduationProgressBps: metric.graduationProgressBps,
            graduationThresholdBase: metric.graduationThresholdBase,
            baseRaised: metric.baseRaised,
            remainingCurveTokens: metric.remainingCurveTokens,
            graduatedPool: metric.graduatedPool,
            liquidityVenue: metric.liquidityVenue,
            positionLocker: metric.positionLocker,
            positionTokenId: metric.positionTokenId,
            poolFeePips: metric.poolFeePips,
          }
        : null,
    };
  });
  const visible = data.filter((row) => {
    if (!row.metrics) return phase === "all";
    if (sort === "near_graduation")
      return row.metrics.marketPhase === "bonding";
    if (sort === "graduated") return row.metrics.marketPhase === "graduated";
    return phase === "all" || row.metrics.marketPhase === phase;
  });
  const amountForWindow = (row: (typeof visible)[number]) => {
    if (!row.metrics) return 0n;
    if (window === "24h") return BigInt(row.metrics.volume24hBase);
    if (window === "7d") return BigInt(row.metrics.volume7dBase);
    return BigInt(row.metrics.totalVolumeBase);
  };
  const compareBigInt = (left: bigint, right: bigint) =>
    left === right ? 0 : left > right ? -1 : 1;
  visible.sort((left, right) => {
    if (sort === "new")
      return Number(BigInt(right.launch_id) - BigInt(left.launch_id));
    if (sort === "near_graduation") {
      const progress =
        (right.metrics?.graduationProgressBps ?? 0) -
        (left.metrics?.graduationProgressBps ?? 0);
      if (progress !== 0) return progress;
    } else if (sort === "market_cap") {
      const marketCap = compareBigInt(
        BigInt(left.metrics?.marketCapBase ?? "0"),
        BigInt(right.metrics?.marketCapBase ?? "0"),
      );
      if (marketCap !== 0) return marketCap;
    } else {
      const volume = compareBigInt(
        sort === "trending"
          ? BigInt(left.metrics?.volume24hBase ?? "0")
          : amountForWindow(left),
        sort === "trending"
          ? BigInt(right.metrics?.volume24hBase ?? "0")
          : amountForWindow(right),
      );
      if (volume !== 0) return volume;
      if (sort === "trending") {
        const traders =
          (right.metrics?.uniqueTraders24h ?? 0) -
          (left.metrics?.uniqueTraders24h ?? 0);
        if (traders !== 0) return traders;
        const trades =
          (right.metrics?.tradeCount24h ?? 0) -
          (left.metrics?.tradeCount24h ?? 0);
        if (trades !== 0) return trades;
      }
    }
    return Number(BigInt(right.launch_id) - BigInt(left.launch_id));
  });
  const cursorIndex = cursor
    ? visible.findIndex((row) => row.launch_id === cursor.launchId)
    : -1;
  if (cursor && cursorIndex < 0) {
    return reply.code(400).send({ error: "stale_cursor" });
  }
  const pageStart = cursorIndex + 1;
  const page = rankedRequest
    ? visible.slice(pageStart, pageStart + limit)
    : visible;
  const hasMore = rankedRequest
    ? visible.length > pageStart + page.length
    : rows.length === limit;
  const lastRow = page.at(-1);
  return {
    data: page,
    nextCursor:
      hasMore && lastRow
        ? rankedRequest
          ? encodeDiscoveryCursor({
              launchId: lastRow.launch_id,
              sort,
              window,
              phase,
            })
          : lastRow.launch_id
        : null,
    queryStatus: "ok",
    filters: { q: query, asset, basketSize, creator, sort, window, phase },
    ...state,
  };
});

app.get<{ Params: { token: string } }>(
  "/launches/:token",
  async (request, reply) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(request.params.token))
      return reply.code(400).send({ error: "invalid_token" });
    const storedRows = await sql.unsafe<LaunchRow[]>(
      "SELECT launch_id::text,token,vault,market,creator,name,symbol,assets,weights_bps,created_block::text,updated_block::text,formula_version FROM launches WHERE chain_id=$1 AND token=$2",
      [chainId, request.params.token.toLowerCase()],
    );
    const rows = await hydrateMarkets(storedRows);
    if (!rows[0]) return reply.code(404).send({ error: "launch_not_found" });
    const metadata = await launchMetadataMap([rows[0].token]);
    return {
      data: {
        ...rows[0],
        metadata: metadata.get(rows[0].token.toLowerCase()) ?? null,
      },
      ...(await freshness()),
    };
  },
);

app.get<{ Params: { token: string }; Querystring: { limit?: string } }>(
  "/launches/:token/activity",
  async (request, reply) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(request.params.token))
      return reply.code(400).send({ error: "invalid_token" });
    const storedLaunch = await sql.unsafe<
      { token: string; vault: string; market: string }[]
    >(
      "SELECT token,vault,market FROM launches WHERE chain_id=$1 AND token=$2",
      [chainId, request.params.token.toLowerCase()],
    );
    const launch = await hydrateMarkets(storedLaunch);
    if (!launch[0]) return reply.code(404).send({ error: "launch_not_found" });
    const config = await getMarketConfiguration(launch[0].market as Address);
    const limit = Math.min(
      Math.max(Number(request.query.limit ?? "50"), 1),
      200,
    );
    const rows = await sql.unsafe(
      "SELECT block_number::text,block_hash,transaction_hash,transaction_index,log_index,address,topics,data FROM raw_logs WHERE chain_id=$1 AND address=ANY($2::text[]) ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT $3",
      [
        chainId,
        [
          launch[0].token,
          launch[0].vault,
          launch[0].market,
          ...(config.graduatedPool ? [config.graduatedPool] : []),
          ...(config.positionLocker ? [config.positionLocker] : []),
        ],
        limit,
      ],
    );
    return { data: rows, ...(await freshness()) };
  },
);

app.get<{ Params: { token: string } }>(
  "/launches/:token/analytics",
  async (request, reply) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(request.params.token))
      return reply.code(400).send({ error: "invalid_token" });
    const storedLaunches = await sql.unsafe<
      {
        token: string;
        market: string;
        creator: string;
        created_block: string;
      }[]
    >(
      "SELECT token,market,creator,created_block::text FROM launches WHERE chain_id=$1 AND token=$2",
      [chainId, request.params.token.toLowerCase()],
    );
    const launches = await hydrateMarkets(storedLaunches);
    const launch = launches[0];
    if (!launch) return reply.code(404).send({ error: "launch_not_found" });
    const tokenAddress = launch.token as Address;
    const marketAddress = launch.market as Address;
    const [baseAsset, config, totalSupply] = await Promise.all([
      rpcClient.readContract({
        address: marketAddress,
        abi: marketViewAbi,
        functionName: "baseAsset",
      }),
      getMarketConfiguration(marketAddress),
      rpcClient.readContract({
        address: tokenAddress,
        abi: erc20ViewAbi,
        functionName: "totalSupply",
      }),
    ]);
    const logs = await sql.unsafe<AnalyticsLog[]>(
      "SELECT l.block_number::text,l.transaction_hash,l.log_index,l.address,l.topics,l.data,b.timestamp::text FROM raw_logs l LEFT JOIN chain_blocks b ON b.chain_id=l.chain_id AND b.number=l.block_number WHERE l.chain_id=$1 AND l.address=ANY($2::text[]) AND l.topics->>0=ANY($3::text[]) ORDER BY l.block_number,l.transaction_index,l.log_index LIMIT 10001",
      [
        chainId,
        analyticsLogAddresses({
          token: launch.token as Address,
          market: launch.market as Address,
          ...(config.graduatedPool
            ? { liquidityPool: config.graduatedPool }
            : {}),
        }),
        analyticsEventTopics,
      ],
    );
    if (logs.length > 10_000) {
      return reply.code(503).send({ error: "analytics_projection_required" });
    }
    const created = await sql.unsafe<{ timestamp: string }[]>(
      "SELECT timestamp::text FROM chain_blocks WHERE chain_id=$1 AND number=$2",
      [chainId, launch.created_block],
    );
    const accounts = collectTokenAccounts(logs, tokenAddress);
    accounts.add(launch.creator.toLowerCase());
    accounts.add(launch.market.toLowerCase());
    if (config.graduatedPool) accounts.add(config.graduatedPool.toLowerCase());
    if (config.positionLocker)
      accounts.add(config.positionLocker.toLowerCase());
    const accountList = [...accounts] as Address[];
    const activeLiquidityAddress =
      config.marketPhase === "graduated" && config.graduatedPool
        ? config.graduatedPool
        : marketAddress;
    const [balanceValues, baseReserve] = await Promise.all([
      Promise.all(
        accountList.map((address) =>
          rpcClient.readContract({
            address: tokenAddress,
            abi: erc20ViewAbi,
            functionName: "balanceOf",
            args: [address],
          }),
        ),
      ),
      rpcClient.readContract({
        address: baseAsset,
        abi: erc20ViewAbi,
        functionName: "balanceOf",
        args: [activeLiquidityAddress],
      }),
    ]);
    const balances = new Map(
      accountList.map((address, index) => [
        address.toLowerCase(),
        balanceValues[index] ?? 0n,
      ]),
    );
    const analytics = deriveLaunchAnalytics({
      launch: {
        token: launch.token as Address,
        market: launch.market as Address,
        creator: launch.creator as Address,
        baseAsset,
        ...(config.graduatedPool
          ? { liquidityPool: config.graduatedPool }
          : {}),
      },
      logs,
      createdTimestamp: created[0]?.timestamp ?? null,
      basePerToken: config.basePerToken,
      feeBps: config.feeBps,
      lifecycle: config,
      snapshot: {
        totalSupply,
        tokenReserve: balances.get(activeLiquidityAddress.toLowerCase()) ?? 0n,
        baseReserve,
        balances,
      },
    });
    return { data: analytics, ...(await freshness()) };
  },
);

app.get<{ Params: { sha256: string } }>(
  "/artifacts/:sha256/metadata",
  async (request, reply) => {
    if (!/^[0-9a-f]{64}$/.test(request.params.sha256)) {
      return reply.code(400).send({ error: "invalid_sha256" });
    }
    const rows = await sql.unsafe(
      "SELECT sha256,bucket,object_key,byte_length::text,content_type,created_at::text FROM artifacts WHERE sha256=$1",
      [request.params.sha256],
    );
    if (!rows[0]) return reply.code(404).send({ error: "artifact_not_found" });
    return { data: rows[0] };
  },
);

const assetCategories = new Set([
  "all",
  "stock",
  "etf-commodity",
  "crypto",
  "custom",
]);
const assetPageSize = 24;

function assetCursor(address: string) {
  return Buffer.from(
    JSON.stringify({ version: 1, address: address.toLowerCase() }),
  ).toString("base64url");
}

function decodeAssetCursor(value: string | undefined) {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error("invalid_cursor");
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { version?: unknown; address?: unknown };
    if (
      decoded.version !== 1 ||
      typeof decoded.address !== "string" ||
      !/^0x[0-9a-f]{40}$/.test(decoded.address)
    ) {
      throw new Error("invalid_cursor");
    }
    return decoded.address;
  } catch {
    throw new Error("invalid_cursor");
  }
}

app.get<{
  Querystring: { query?: string; category?: string; cursor?: string };
}>("/assets", async (request, reply) => {
  if (
    (request.query.query?.length ?? 0) > 96 ||
    (request.query.category && !assetCategories.has(request.query.category))
  ) {
    return reply.code(400).send({ error: "invalid_asset_query" });
  }
  let afterAddress: string | null;
  try {
    afterAddress = decodeAssetCursor(request.query.cursor);
  } catch {
    return reply.code(400).send({ error: "invalid_cursor" });
  }
  let data = await assetCatalog.list(
    request.query.query,
    request.query.category,
  );
  if (!deployment.assetCatalog) {
    const rows = await sql.unsafe<{ address: string }[]>(
      "SELECT DISTINCT jsonb_array_elements_text(assets) address FROM launches WHERE chain_id=$1 ORDER BY address",
      [chainId],
    );
    data = (
      await Promise.all(rows.map((row) => assetCatalog.resolve(row.address)))
    ).filter((asset): asset is NonNullable<typeof asset> => asset !== null);
  }
  const start = afterAddress
    ? data.findIndex((asset) => asset.address.toLowerCase() === afterAddress) +
      1
    : 0;
  if (afterAddress && start === 0) {
    return reply.code(400).send({ error: "invalid_cursor" });
  }
  const page = data.slice(start, start + assetPageSize);
  const nextCursor =
    start + assetPageSize < data.length && page.length
      ? assetCursor(page.at(-1)!.address)
      : null;
  return {
    data: page,
    catalog: {
      schemaVersion: deployment.assetCatalog?.schemaVersion ?? null,
      snapshotAt: deployment.assetCatalog?.snapshotAt ?? null,
      disclosure: deployment.assetCatalog?.disclosure ?? null,
    },
    nextCursor,
    ...(await freshness()),
  };
});

app.get<{ Params: { address: string } }>(
  "/assets/:address",
  async (request, reply) => {
    const asset = await assetCatalog.resolve(request.params.address);
    if (!asset) return reply.code(404).send({ error: "asset_not_found" });
    return { data: asset, ...(await freshness()) };
  },
);

app.get<{
  Params: { address: string };
  Querystring: { amount?: string };
}>("/assets/:address/quote", async (request, reply) => {
  if (!/^[1-9][0-9]{0,77}$/.test(request.query.amount ?? "")) {
    return reply.code(400).send({ error: "invalid_amount" });
  }
  const asset = await assetCatalog.resolve(request.params.address);
  if (!asset) return reply.code(404).send({ error: "asset_not_found" });
  if (!asset.route.ready) {
    return reply.code(409).send({ error: "route_unavailable", data: asset });
  }
  const output = await assetCatalog.quote(
    asset.address,
    BigInt(request.query.amount!),
  );
  return {
    data: {
      inputAmount: request.query.amount,
      outputAmount: output?.toString(),
    },
    ...(await freshness()),
  };
});

app.get("/assets/catalog-manifest", async () => ({
  data: deployment.assetCatalog ?? null,
  ...(await freshness()),
}));

app.get("/token-list", async () => {
  const rows = await sql.unsafe<
    {
      token: string;
      name: string;
      symbol: string;
      canonical_png_cid: string;
    }[]
  >(
    "SELECT l.token,l.name,l.symbol,m.canonical_png_cid FROM launches l JOIN launch_metadata_bindings b ON b.chain_id=l.chain_id AND b.token=l.token JOIN media_assets m ON m.media_id=b.media_id WHERE l.chain_id=$1 AND m.status='active' AND b.verification_status='robyn-sanitized' AND m.canonical_png_cid IS NOT NULL ORDER BY l.launch_id",
    [chainId],
  );
  const [version] = await sql.unsafe<{ timestamp: string }[]>(
    "SELECT coalesce(max(b.bound_at),to_timestamp(0))::text AS timestamp FROM launch_metadata_bindings b WHERE b.chain_id=$1 AND b.verification_status='robyn-sanitized'",
    [chainId],
  );
  return {
    name: "Robyn verified tokens",
    timestamp: new Date(version?.timestamp ?? 0).toISOString(),
    version: { major: 1, minor: 0, patch: rows.length },
    keywords: ["robyn", "reward-basket", "erc1046"],
    tokens: rows.map((row) => ({
      chainId,
      address: row.token,
      name: row.name,
      symbol: row.symbol,
      decimals: 18,
      logoURI: `ipfs://${row.canonical_png_cid}`,
    })),
  };
});

app.get("/token-list/status", async () => ({
  data: {
    cid: deployment.ipfsMetadata?.tokenListCid ?? null,
    uri: deployment.ipfsMetadata?.tokenListUri ?? null,
    stablePath:
      deployment.ipfsMetadata?.tokenListStablePath ?? "/api/token-list",
  },
}));

await registerCreatorRoutes(app, {
  chainId,
  sql,
  redis,
  rpcClient,
  allowedOrigins,
  artifactServiceUrl,
  ipfsApiUrl,
  ...(process.env.ROBYN_REMOTE_PIN_URL
    ? { remotePinUrl: process.env.ROBYN_REMOTE_PIN_URL }
    : {}),
  ...(process.env.ROBYN_REMOTE_PIN_TOKEN
    ? { remotePinToken: process.env.ROBYN_REMOTE_PIN_TOKEN }
    : {}),
});
registerDaoRoutes(app, rpcClient, deployment);

const close = async () => {
  await app.close();
  redis.disconnect();
  await sql.end();
};
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
await app.listen({ port, host });
