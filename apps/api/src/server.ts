import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { createDatabase } from "@robyn/db";
import { createPublicClient, http, type Address } from "viem";
import { parseDiscoveryQuery, type DiscoveryQuery } from "./discovery-query.js";
import {
  demoMarketChangeBps,
  isDemoMarketChangeEnabled,
} from "./demo-market-change.js";
import {
  collectTokenAccounts,
  deriveLaunchAnalytics,
  type AnalyticsLog,
} from "./launch-analytics.js";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 64 * 1024,
});
const { sql } = createDatabase();
const chainId = Number(process.env.CHAIN_ID ?? "31337");
const demoMarketChangesEnabled = isDemoMarketChangeEnabled(
  chainId,
  process.env.ROBYN_DEMO_MARKET_CHANGES,
);
const queueName = process.env.ROBYN_QUEUE_NAME ?? "robyn-conversions";
const port = Number(process.env.PORT ?? "3100");
const host = process.env.HOST ?? "0.0.0.0";
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
  contracts: {
    marketFactory: Address;
    legacyMarketFactories?: Address[];
  };
};
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

type MarketConfiguration = {
  basePerToken: bigint;
  feeBps: number;
  marketPhase: "legacy_fixed" | "bonding" | "graduated";
  graduationProgressBps: number;
  graduationThresholdBase: bigint;
  baseRaised: bigint;
  remainingCurveTokens: bigint;
  graduatedPool: Address | null;
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
    return {
      basePerToken,
      feeBps: Number(feeBps),
      marketPhase: graduated ? "graduated" : "bonding",
      graduationProgressBps: Number(progress),
      graduationThresholdBase: threshold,
      baseRaised: raised,
      remainingCurveTokens: remaining,
      graduatedPool,
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
  const logs = await sql.unsafe<DiscoveryMetricLog[]>(
    "WITH targets(launch_token,market) AS (SELECT * FROM unnest($2::text[],$3::text[])), ranked AS (SELECT t.launch_token,l.block_number::text,l.transaction_hash,l.log_index,l.address,l.topics,l.data,b.timestamp::text,row_number() OVER (PARTITION BY t.launch_token ORDER BY l.block_number,l.transaction_index,l.log_index) AS event_number FROM targets t JOIN raw_logs l ON l.chain_id=$1 AND (l.address=t.launch_token OR l.address=t.market) LEFT JOIN chain_blocks b ON b.chain_id=l.chain_id AND b.number=l.block_number) SELECT launch_token,block_number,transaction_hash,log_index,address,topics,data,timestamp FROM ranked WHERE event_number<=10001 ORDER BY launch_token,block_number::bigint,log_index",
    [
      chainId,
      rows.map((row) => row.token.toLowerCase()),
      rows.map((row) => row.market.toLowerCase()),
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
      const config = await getMarketConfiguration(row.market as Address);
      const input = {
        launch: {
          token: row.token as Address,
          market: row.market as Address,
          creator: row.creator as Address,
        },
        logs: tokenLogs,
        createdTimestamp: null,
        basePerToken: config.basePerToken,
        feeBps: config.feeBps,
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
  const [keeper, counts, jobs, events] = await Promise.all([
    keeperState(),
    sql.unsafe<{ state: string; count: string }[]>(
      "SELECT state,count(*)::text count FROM job_audit WHERE queue=$1 GROUP BY state ORDER BY state",
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
    query,
    asset,
    basketSize,
    invalidCursor,
    invalidCanonicalAddress,
  } = parseDiscoveryQuery(request.query);
  if (invalidCursor) {
    return reply.code(400).send({ error: "invalid_cursor" });
  }
  const state = await freshness();
  if (invalidCanonicalAddress) {
    return {
      data: [],
      nextCursor: null,
      queryStatus: "invalid_address",
      filters: { q: query, asset, basketSize },
      ...state,
    };
  }
  const storedRows = await sql.unsafe<LaunchRow[]>(
    "SELECT launch_id::text,token,vault,market,creator,name,symbol,assets,weights_bps,created_block::text,updated_block::text,formula_version FROM launches WHERE chain_id=$1 AND ($2::bigint IS NULL OR launch_id::bigint<$2::bigint) AND ($4::text IS NULL OR token=$4 OR strpos(lower(name),$4)>0 OR strpos(lower(symbol),$4)>0) AND ($5::text IS NULL OR assets ? $5) AND ($6::integer IS NULL OR jsonb_array_length(assets)=$6) ORDER BY CASE WHEN token=$4 THEN 0 ELSE 1 END,launch_id::bigint DESC LIMIT $3",
    [chainId, before, limit, query, asset, basketSize],
  );
  const rows = await hydrateMarkets(storedRows);
  const marketMetrics = await discoveryMetrics(rows).catch((error) => {
    request.log.warn({ error }, "discovery metrics unavailable");
    return new Map<string, ReturnType<typeof deriveLaunchAnalytics>>();
  });
  return {
    data: rows.map((row) => {
      const metric = marketMetrics.get(row.token.toLowerCase());
      const priceChangeBps = demoMarketChangesEnabled
        ? demoMarketChangeBps(row.token as Address)
        : metric?.priceChangeBps;
      return {
        ...row,
        metrics: metric
          ? {
              marketCapBase: metric.marketCapBase,
              priceChangeBps,
              priceChangeSource: demoMarketChangesEnabled ? "demo" : "indexed",
              liquidityBase: metric.liquidityBase,
              totalVolumeBase: metric.totalVolumeBase,
              holderCount: metric.holderCount,
              tradeCount: metric.tradeCount,
              baseSymbol: metric.baseSymbol,
              marketPhase: metric.marketPhase,
              graduationProgressBps: metric.graduationProgressBps,
              graduationThresholdBase: metric.graduationThresholdBase,
              baseRaised: metric.baseRaised,
              remainingCurveTokens: metric.remainingCurveTokens,
              graduatedPool: metric.graduatedPool,
            }
          : null,
      };
    }),
    nextCursor:
      rows.length === limit
        ? (rows.at(-1) as { launch_id: string }).launch_id
        : null,
    queryStatus: "ok",
    filters: { q: query, asset, basketSize },
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
    return { data: rows[0], ...(await freshness()) };
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
    const limit = Math.min(
      Math.max(Number(request.query.limit ?? "50"), 1),
      200,
    );
    const rows = await sql.unsafe(
      "SELECT block_number::text,block_hash,transaction_hash,transaction_index,log_index,address,topics,data FROM raw_logs WHERE chain_id=$1 AND address=ANY($2::text[]) ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT $3",
      [chainId, [launch[0].token, launch[0].vault, launch[0].market], limit],
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
    const logs = await sql.unsafe<AnalyticsLog[]>(
      "SELECT l.block_number::text,l.transaction_hash,l.log_index,l.address,l.topics,l.data,b.timestamp::text FROM raw_logs l LEFT JOIN chain_blocks b ON b.chain_id=l.chain_id AND b.number=l.block_number WHERE l.chain_id=$1 AND l.address=ANY($2::text[]) ORDER BY l.block_number,l.transaction_index,l.log_index LIMIT 10001",
      [chainId, [launch.token, launch.market]],
    );
    if (logs.length > 10_000) {
      return reply.code(503).send({ error: "analytics_projection_required" });
    }
    const created = await sql.unsafe<{ timestamp: string }[]>(
      "SELECT timestamp::text FROM chain_blocks WHERE chain_id=$1 AND number=$2",
      [chainId, launch.created_block],
    );
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
    const accounts = collectTokenAccounts(logs, tokenAddress);
    accounts.add(launch.creator.toLowerCase());
    accounts.add(launch.market.toLowerCase());
    if (config.graduatedPool) accounts.add(config.graduatedPool.toLowerCase());
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

app.get("/assets", async () => {
  const rows = await sql.unsafe<{ address: string }[]>(
    "SELECT DISTINCT jsonb_array_elements_text(assets) address FROM launches WHERE chain_id=$1 ORDER BY address",
    [chainId],
  );
  return {
    data: rows.map((row) => ({
      address: row.address,
      environment: "robyn-devnet",
      status: "mock-active",
    })),
    ...(await freshness()),
  };
});

const close = async () => {
  await app.close();
  await sql.end();
};
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
await app.listen({ port, host });
