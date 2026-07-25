import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  type Address,
} from "viem";
import { createDatabase } from "@robyn/db";
import {
  boundedRangeEnd,
  checkpointDisposition,
  completeProjectionBatch,
  failureBackoffMs,
  ingestionCycleResult,
  projectionRequiresReset,
  projectionWindow,
  requiredBlockNumbers,
  uniqueLaunchIds,
} from "./pipeline.js";

type Manifest = {
  schemaVersion?: number;
  chainId: number;
  liquidityVenue?: "uniswap-v4" | "uniswap-v3";
  deploymentBlock: number;
  contracts: {
    [key: string]: Address | Address[] | undefined;
    factory: Address;
    marketFactory: Address;
    legacyMarketFactories?: Address[];
    atomicLaunchCoordinator?: Address;
    protocolFeeRouter?: Address;
  };
};
const manifest = JSON.parse(
  await readFile(
    process.env.ROBYN_MANIFEST ?? "/home/hendo420/Robyn/deployments/31337.json",
    "utf8",
  ),
) as Manifest;
const rpcUrl = process.env.ROBYN_OPERATOR_RPC_URL ?? "http://127.0.0.1:8545";
const client = createPublicClient({
  transport: http(rpcUrl, {
    retryCount: Number(process.env.ROBYN_RPC_RETRY_COUNT ?? "5"),
    retryDelay: Number(process.env.ROBYN_RPC_RETRY_DELAY_MS ?? "500"),
    timeout: Number(process.env.ROBYN_RPC_TIMEOUT_MS ?? "15000"),
  }),
});
const { sql } = createDatabase();
const role = process.env.ROBYN_INDEXER_ROLE ?? "combined";
if (!["ingester", "projector", "combined"].includes(role)) {
  throw new Error(`Unsupported indexer role: ${role}`);
}
const pollMs = Number(process.env.INDEXER_POLL_MS ?? "1000");
const projectorPollMs = Number(process.env.PROJECTOR_POLL_MS ?? "1000");
const blockRange = BigInt(process.env.INDEXER_BLOCK_RANGE ?? "250");
const blockReadConcurrency = Number(
  process.env.INDEXER_BLOCK_READ_CONCURRENCY ?? "6",
);
const maximumConsecutiveFailures = Number(
  process.env.INDEXER_MAXIMUM_CONSECUTIVE_FAILURES ?? "24",
);
let stopping = false;

const indexedAddresses = [
  ...new Set(
    Object.values(manifest.contracts)
      .filter((value): value is Address => typeof value === "string")
      .map((address) => address.toLowerCase() as Address),
  ),
];

async function loadBlocks(numbers: bigint[]) {
  const blocks = [];
  for (
    let offset = 0;
    offset < numbers.length;
    offset += blockReadConcurrency
  ) {
    blocks.push(
      ...(await Promise.all(
        numbers
          .slice(offset, offset + blockReadConcurrency)
          .map((number) => client.getBlock({ blockNumber: number })),
      )),
    );
  }
  return blocks;
}

const factoryAbi = [
  {
    type: "function",
    name: "launchCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "launchTokenById",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "vaultByToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "creatorByToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;
const marketFactoryAbi = [
  {
    type: "function",
    name: "marketByToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const atomicLaunchEvent = parseAbiItem(
  "event AtomicLaunchCreated(uint256 indexed launchId,address indexed creator,address indexed token,address vault,address market,address adapter,address pool,address locker,bytes32 configurationHash,bytes32 launchSaltHash,bytes32 metadataUriHash)",
);
const atomicV4LaunchEvent = parseAbiItem(
  "event AtomicV4LaunchCreated(uint256 indexed launchId,address indexed creator,address indexed token,(address vault,address market,address adapter,address poolManager,bytes32 poolId,address positionManager,address hook,address locker,uint24 poolFeePips,int24 tickSpacing,bytes32 configurationHash,bytes32 launchSaltHash,bytes32 metadataUriHash) receipt)",
);
const marketStateAbi = [
  {
    type: "function",
    name: "seeded",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;
const tokenStateAbi = [
  {
    type: "function",
    name: "exclusionsSealed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;
const feeRouterStateAbi = [
  {
    type: "function",
    name: "launchAccount",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "vault", type: "address" },
          { name: "market", type: "address" },
          { name: "locker", type: "address" },
          { name: "pendingCreatorBase", type: "uint256" },
          { name: "pendingDaoRewardBase", type: "uint256" },
          { name: "pendingTreasuryBase", type: "uint256" },
          { name: "cumulativeBaseFees", type: "uint256" },
          { name: "cumulativeLaunchFeesConverted", type: "uint256" },
          { name: "cumulativeNativeConverted", type: "uint256" },
          { name: "claimableCreatorNative", type: "uint256" },
          { name: "cumulativeCreatorNative", type: "uint256" },
          { name: "claimedCreatorNative", type: "uint256" },
          { name: "registered", type: "bool" },
        ],
      },
    ],
  },
] as const;
const nativeV4FeeRouterStateAbi = [
  {
    type: "function",
    name: "launchAccount",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "vault", type: "address" },
          { name: "market", type: "address" },
          { name: "locker", type: "address" },
          { name: "cumulativeNativeFees", type: "uint256" },
          { name: "cumulativeLaunchFeesConverted", type: "uint256" },
          { name: "claimableCreatorNative", type: "uint256" },
          { name: "cumulativeCreatorNative", type: "uint256" },
          { name: "claimedCreatorNative", type: "uint256" },
          { name: "registered", type: "bool" },
        ],
      },
    ],
  },
] as const;

async function loadAtomicLaunchesFromDatabase(
  fromBlock: bigint,
  asOfBlock: bigint,
) {
  const coordinator = manifest.contracts.atomicLaunchCoordinator;
  if (!coordinator)
    return new Map<
      string,
      { blockNumber: bigint; args: Record<string, unknown> }
    >();
  const v4 = manifest.liquidityVenue === "uniswap-v4";
  const event = v4 ? atomicV4LaunchEvent : atomicLaunchEvent;
  const logs = await sql.unsafe<
    {
      block_number: string;
      data: `0x${string}`;
      topics: `0x${string}`[];
    }[]
  >(
    "SELECT block_number::text,data,topics FROM raw_logs WHERE chain_id=$1 AND address=$2 AND block_number BETWEEN $3 AND $4 ORDER BY block_number,transaction_index,log_index",
    [
      manifest.chainId,
      coordinator.toLowerCase(),
      fromBlock.toString(),
      asOfBlock.toString(),
    ],
  );
  const launches = new Map<
    string,
    { blockNumber: bigint; args: Record<string, unknown> }
  >();
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: [event],
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
    } catch {
      continue;
    }
    const eventArgs = decoded.args as unknown as Record<string, unknown>;
    const receipt = eventArgs.receipt as Record<string, unknown> | undefined;
    launches.set(String(eventArgs.launchId), {
      blockNumber: BigInt(log.block_number),
      args: receipt ? { ...eventArgs, ...receipt } : eventArgs,
    });
  }
  return launches;
}

async function resolveMarket(token: Address) {
  const factories = [
    manifest.contracts.marketFactory,
    ...(manifest.contracts.legacyMarketFactories ?? []),
  ];
  for (const factory of factories) {
    const market = await client.readContract({
      address: factory,
      abi: marketFactoryAbi,
      functionName: "marketByToken",
      args: [token],
    });
    if (market.toLowerCase() !== zeroAddress) return market;
  }
  return zeroAddress as Address;
}
const tokenAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;
const vaultAbi = [
  {
    type: "function",
    name: "legCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "leg",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "asset", type: "address" },
          { name: "weightBps", type: "uint16" },
          { name: "pendingBase", type: "uint256" },
          { name: "consumedBase", type: "uint256" },
          { name: "rewardsDeposited", type: "uint256" },
          { name: "pendingSince", type: "uint256" },
        ],
      },
    ],
  },
] as const;

type AtomicLaunchProjection = {
  blockNumber: bigint;
  args: Record<string, unknown>;
};

async function projectLaunch(
  id: bigint,
  atomic: AtomicLaunchProjection | undefined,
) {
  const token = await client.readContract({
    address: manifest.contracts.factory,
    abi: factoryAbi,
    functionName: "launchTokenById",
    args: [id],
  });
  const [vault, creator, market, name, symbol] = await Promise.all([
    client.readContract({
      address: manifest.contracts.factory,
      abi: factoryAbi,
      functionName: "vaultByToken",
      args: [token],
    }),
    client.readContract({
      address: manifest.contracts.factory,
      abi: factoryAbi,
      functionName: "creatorByToken",
      args: [token],
    }),
    resolveMarket(token),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "name",
    }),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "symbol",
    }),
  ]);
  if (manifest.contracts.atomicLaunchCoordinator) {
    if (!atomic) throw new Error(`Coordinator event missing for launch ${id}`);
    const eventToken = String(atomic.args.token).toLowerCase();
    const eventVault = String(atomic.args.vault).toLowerCase();
    const eventMarket = String(atomic.args.market).toLowerCase();
    const eventCreator = String(atomic.args.creator).toLowerCase();
    if (
      eventToken !== token.toLowerCase() ||
      eventVault !== vault.toLowerCase() ||
      eventMarket !== market.toLowerCase() ||
      eventCreator !== creator.toLowerCase()
    )
      throw new Error(`Factory mappings differ for launch ${id}`);
    const [seeded, exclusionsSealed] = await Promise.all([
      client.readContract({
        address: market,
        abi: marketStateAbi,
        functionName: "seeded",
      }),
      client.readContract({
        address: token,
        abi: tokenStateAbi,
        functionName: "exclusionsSealed",
      }),
    ]);
    if (!seeded || !exclusionsSealed) {
      throw new Error(`Launch ${id} is not sealed and seeded`);
    }
    if (manifest.contracts.protocolFeeRouter) {
      const feeAccount = await client.readContract({
        address: manifest.contracts.protocolFeeRouter,
        abi:
          manifest.liquidityVenue === "uniswap-v4"
            ? nativeV4FeeRouterStateAbi
            : feeRouterStateAbi,
        functionName: "launchAccount",
        args: [token],
      });
      if (
        !feeAccount.registered ||
        feeAccount.creator.toLowerCase() !== creator.toLowerCase() ||
        feeAccount.vault.toLowerCase() !== vault.toLowerCase() ||
        feeAccount.market.toLowerCase() !== market.toLowerCase() ||
        feeAccount.locker.toLowerCase() !==
          String(atomic.args.locker).toLowerCase()
      )
        throw new Error(`Fee-router mappings differ for launch ${id}`);
    }
  }
  const countLegs = await client.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: "legCount",
  });
  const assets: string[] = [],
    weights: number[] = [];
  for (let i = 0n; i < countLegs; i++) {
    const leg = await client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "leg",
      args: [i],
    });
    assets.push(leg.asset.toLowerCase());
    weights.push(leg.weightBps);
  }
  const found = await sql.unsafe<{ block_number: string }[]>(
    "SELECT block_number::text FROM raw_logs WHERE chain_id=$1 AND address=$2 AND lower(topics->>3) LIKE $3 ORDER BY block_number LIMIT 1",
    [
      manifest.chainId,
      manifest.contracts.factory.toLowerCase(),
      "%" + token.slice(2).toLowerCase(),
    ],
  );
  const created =
    atomic?.blockNumber ??
    (found[0]
      ? BigInt(found[0].block_number)
      : BigInt(manifest.deploymentBlock));
  const [campaign] = await sql.unsafe<
    {
      campaign_id: string;
      campaign_release_sha: string;
      automated_test_launch: boolean;
    }[]
  >(
    "SELECT campaign_id,campaign_release_sha,automated_test_launch FROM launch_metadata_bindings WHERE chain_id=$1 AND token=$2 AND verification_status='robyn-sanitized' AND automated_test_launch=true",
    [manifest.chainId, token.toLowerCase()],
  );
  await sql.unsafe(
    "INSERT INTO launches (chain_id,launch_id,token,vault,market,creator,name,symbol,assets,weights_bps,created_block,updated_block,formula_version,campaign_id,campaign_release_sha,automated_test_launch) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16) ON CONFLICT (chain_id,token) DO UPDATE SET market=EXCLUDED.market,name=EXCLUDED.name,symbol=EXCLUDED.symbol,assets=EXCLUDED.assets,weights_bps=EXCLUDED.weights_bps,created_block=EXCLUDED.created_block,updated_block=EXCLUDED.updated_block,formula_version=EXCLUDED.formula_version,campaign_id=EXCLUDED.campaign_id,campaign_release_sha=EXCLUDED.campaign_release_sha,automated_test_launch=EXCLUDED.automated_test_launch",
    [
      manifest.chainId,
      id.toString(),
      token.toLowerCase(),
      vault.toLowerCase(),
      market.toLowerCase(),
      creator.toLowerCase(),
      name,
      symbol,
      JSON.stringify(assets),
      JSON.stringify(weights),
      created.toString(),
      created.toString(),
      atomic && manifest.contracts.protocolFeeRouter
        ? manifest.liquidityVenue === "uniswap-v4"
          ? "native-v4-dao-atomic"
          : "native-v3-dao-atomic"
        : atomic
          ? "native-v2-atomic"
          : "native-v1",
      campaign?.campaign_id ?? null,
      campaign?.campaign_release_sha ?? null,
      campaign?.automated_test_launch ?? false,
    ],
  );
}

async function resetCanonical() {
  await sql.begin(async (tx) => {
    await tx.unsafe(
      "DELETE FROM raw_logs WHERE chain_id=$1 AND block_number>=$2",
      [manifest.chainId, manifest.deploymentBlock],
    );
    await tx.unsafe(
      "DELETE FROM chain_blocks WHERE chain_id=$1 AND number>=$2",
      [manifest.chainId, manifest.deploymentBlock],
    );
    await tx.unsafe("DELETE FROM launches WHERE chain_id=$1", [
      manifest.chainId,
    ]);
    await tx.unsafe(
      "DELETE FROM indexer_checkpoints WHERE service IN ('chain-indexer','launch-projector') AND chain_id=$1",
      [manifest.chainId],
    );
    await tx.unsafe(
      "DELETE FROM service_heartbeats WHERE service IN ('chain-ingester','launch-projector')",
    );
  });
}

async function syncOnce() {
  const began = performance.now();
  if ((await client.getChainId()) !== manifest.chainId)
    throw new Error("Indexer chain mismatch");
  const head = await client.getBlockNumber();
  const rows = await sql.unsafe<{ last_block: string; last_hash: string }[]>(
    "SELECT last_block::text,last_hash FROM indexer_checkpoints WHERE service='chain-indexer' AND chain_id=$1",
    [manifest.chainId],
  );
  let start = BigInt(manifest.deploymentBlock);
  if (rows[0]) {
    const last = BigInt(rows[0].last_block);
    if (last > head) {
      throw new Error(`Public RPC head ${head} is behind checkpoint ${last}`);
    } else {
      const prior = await client.getBlock({ blockNumber: last });
      if (!prior.hash)
        throw new Error(`Checkpoint block ${last} is unavailable`);
      const disposition = checkpointDisposition(
        last,
        head,
        rows[0].last_hash,
        prior.hash,
      );
      if (disposition === "continue") start = last + 1n;
      else {
        await resetCanonical();
        start = BigInt(manifest.deploymentBlock);
      }
    }
  }
  let logCount = 0;
  let rangeCount = 0;
  for (let rangeStart = start; rangeStart <= head; rangeStart += blockRange) {
    const rangeEnd = boundedRangeEnd(rangeStart, head, blockRange);
    const logs = await client.getLogs({
      address: indexedAddresses,
      fromBlock: rangeStart,
      toBlock: rangeEnd,
    });
    const blocks = await loadBlocks(
      requiredBlockNumbers(
        logs.map((log) => log.blockNumber),
        rangeEnd,
      ),
    );
    const blocksByNumber = new Map(
      blocks.map((block) => [block.number, block]),
    );
    const checkpointBlock = blocksByNumber.get(rangeEnd);
    if (!checkpointBlock?.hash) {
      throw new Error(`Range-end block ${rangeEnd} is unavailable`);
    }
    await sql.begin(async (tx) => {
      for (const block of blocks) {
        if (!block.hash) throw new Error("Block hash unavailable");
        await tx.unsafe(
          "INSERT INTO chain_blocks (chain_id,number,hash,parent_hash,timestamp,canonical) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (chain_id,number) DO UPDATE SET hash=EXCLUDED.hash,parent_hash=EXCLUDED.parent_hash,timestamp=EXCLUDED.timestamp,canonical=true,observed_at=now()",
          [
            manifest.chainId,
            block.number.toString(),
            block.hash.toLowerCase(),
            block.parentHash.toLowerCase(),
            block.timestamp.toString(),
          ],
        );
      }
      for (const log of logs) {
        if (!blocksByNumber.has(log.blockNumber))
          throw new Error("Log block metadata unavailable");
        if (
          !log.blockHash ||
          !log.transactionHash ||
          log.logIndex === null ||
          log.transactionIndex === null
        )
          continue;
        await tx.unsafe(
          "INSERT INTO raw_logs (chain_id,block_number,block_hash,transaction_hash,transaction_index,log_index,address,topics,data,removed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,transaction_index=EXCLUDED.transaction_index,address=EXCLUDED.address,topics=EXCLUDED.topics,data=EXCLUDED.data,removed=EXCLUDED.removed",
          [
            manifest.chainId,
            log.blockNumber.toString(),
            log.blockHash.toLowerCase(),
            log.transactionHash.toLowerCase(),
            Number(log.transactionIndex),
            Number(log.logIndex),
            log.address.toLowerCase(),
            JSON.stringify(log.topics),
            log.data,
            log.removed,
          ],
        );
      }
      await tx.unsafe(
        "INSERT INTO indexer_checkpoints (service,chain_id,last_block,last_hash) VALUES ('chain-indexer',$1,$2,$3) ON CONFLICT (service,chain_id) DO UPDATE SET last_block=EXCLUDED.last_block,last_hash=EXCLUDED.last_hash,updated_at=now()",
        [
          manifest.chainId,
          rangeEnd.toString(),
          checkpointBlock.hash.toLowerCase(),
        ],
      );
    });
    logCount += logs.length;
    rangeCount += 1;
  }
  const checkpoint =
    start > head ? (rows[0]?.last_block ?? null) : head.toString();
  const cycleMs = Math.round((performance.now() - began) * 100) / 100;
  process.stdout.write(
    JSON.stringify({
      level: "info",
      event: "sync",
      head: head.toString(),
      checkpoint,
      rangeCount,
      logCount,
      cycleMs,
    }) + "\n",
  );
  return ingestionCycleResult(head, checkpoint, rangeCount, logCount, cycleMs);
}

async function reconcileMetadataBindings() {
  await sql.unsafe(
    "UPDATE launches l SET campaign_id=b.campaign_id,campaign_release_sha=b.campaign_release_sha,automated_test_launch=b.automated_test_launch FROM launch_metadata_bindings b WHERE l.chain_id=$1 AND b.chain_id=l.chain_id AND b.token=l.token AND b.verification_status='robyn-sanitized' AND (l.campaign_id IS DISTINCT FROM b.campaign_id OR l.campaign_release_sha IS DISTINCT FROM b.campaign_release_sha OR l.automated_test_launch IS DISTINCT FROM b.automated_test_launch)",
    [manifest.chainId],
  );
}

async function projectOnce() {
  const began = performance.now();
  const checkpoints = await sql.unsafe<
    { service: string; last_block: string; last_hash: string }[]
  >(
    "SELECT service,last_block::text,last_hash FROM indexer_checkpoints WHERE service IN ('chain-indexer','launch-projector') AND chain_id=$1",
    [manifest.chainId],
  );
  const ingested = checkpoints.find(
    (checkpoint) => checkpoint.service === "chain-indexer",
  );
  if (!ingested) throw new Error("Canonical ingestion checkpoint is missing");
  let projected = checkpoints.find(
    (checkpoint) => checkpoint.service === "launch-projector",
  );
  if (
    projectionRequiresReset(
      projected ? BigInt(projected.last_block) : undefined,
      BigInt(ingested.last_block),
    )
  ) {
    await sql.begin(async (tx) => {
      await tx.unsafe("DELETE FROM launches WHERE chain_id=$1", [
        manifest.chainId,
      ]);
      await tx.unsafe(
        "DELETE FROM indexer_checkpoints WHERE service='launch-projector' AND chain_id=$1",
        [manifest.chainId],
      );
    });
    projected = undefined;
  }
  const window = projectionWindow(
    BigInt(manifest.deploymentBlock),
    projected ? BigInt(projected.last_block) : undefined,
    BigInt(ingested.last_block),
  );
  let projectedLaunches = 0;
  if (window) {
    let ids: bigint[];
    let atomicLaunches: Map<string, AtomicLaunchProjection> | undefined;
    if (manifest.contracts.atomicLaunchCoordinator) {
      atomicLaunches = await loadAtomicLaunchesFromDatabase(
        window.fromBlock,
        window.toBlock,
      );
      ids = uniqueLaunchIds([...atomicLaunches.keys()].map((id) => BigInt(id)));
    } else {
      const count = await client.readContract({
        address: manifest.contracts.factory,
        abi: factoryAbi,
        functionName: "launchCount",
      });
      const existing = await sql.unsafe<{ last_id: string | null }[]>(
        "SELECT max(launch_id)::text last_id FROM launches WHERE chain_id=$1",
        [manifest.chainId],
      );
      const first = BigInt(existing[0]?.last_id ?? "0") + 1n;
      ids = [];
      for (let id = first; id <= count; id += 1n) ids.push(id);
    }
    projectedLaunches = await completeProjectionBatch(
      ids,
      async (id) => projectLaunch(id, atomicLaunches?.get(id.toString())),
      reconcileMetadataBindings,
      async () => {
        await sql.begin(async (tx) => {
          const advanced = await tx.unsafe<{ service: string }[]>(
            "INSERT INTO indexer_checkpoints (service,chain_id,last_block,last_hash) SELECT 'launch-projector',$1,$2,$3 WHERE EXISTS (SELECT 1 FROM indexer_checkpoints WHERE service='chain-indexer' AND chain_id=$1 AND last_block=$2 AND last_hash=$3) ON CONFLICT (service,chain_id) DO UPDATE SET last_block=EXCLUDED.last_block,last_hash=EXCLUDED.last_hash,updated_at=now() RETURNING service",
            [manifest.chainId, ingested.last_block, ingested.last_hash],
          );
          if (!advanced[0]) {
            await tx.unsafe("DELETE FROM launches WHERE chain_id=$1", [
              manifest.chainId,
            ]);
            await tx.unsafe(
              "DELETE FROM indexer_checkpoints WHERE service='launch-projector' AND chain_id=$1",
              [manifest.chainId],
            );
            throw new Error(
              "Canonical ingestion checkpoint changed during projection",
            );
          }
        });
      },
    );
  } else {
    await reconcileMetadataBindings();
  }
  const cycleMs = Math.round((performance.now() - began) * 100) / 100;
  process.stdout.write(
    JSON.stringify({
      level: "info",
      event: "projection",
      checkpoint: ingested.last_block,
      projectedLaunches,
      cycleMs,
    }) + "\n",
  );
  return {
    checkpoint: ingested.last_block,
    projectedLaunches,
    cycleMs,
  };
}

async function recordHeartbeat(
  service: "chain-ingester" | "launch-projector",
  status: "ok" | "degraded",
  metadata: Record<string, unknown>,
) {
  await sql.unsafe(
    "INSERT INTO service_heartbeats (service,status,metadata) VALUES ($1,$2,$3::jsonb) ON CONFLICT (service) DO UPDATE SET status=EXCLUDED.status,metadata=EXCLUDED.metadata,updated_at=now()",
    [service, status, JSON.stringify(metadata)],
  );
}

const sleep = (duration: number) =>
  new Promise((resolve) => setTimeout(resolve, duration));

async function runPipeline(
  service: "chain-ingester" | "launch-projector",
  intervalMs: number,
  execute: () => Promise<Record<string, unknown>>,
) {
  let failures = 0;
  let rpcRetryCount = 0;
  let lastRpcDegradationAt: string | null = null;
  while (!stopping) {
    try {
      const result = await execute();
      failures = 0;
      await recordHeartbeat(service, "ok", {
        ...result,
        rpcRetryCount,
        lastRpcDegradationAt,
      });
    } catch (error) {
      failures += 1;
      rpcRetryCount += 1;
      lastRpcDegradationAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      await recordHeartbeat(service, "degraded", {
        consecutiveFailures: failures,
        rpcRetryCount,
        lastRpcDegradationAt,
        error: message.slice(0, 1_000),
      }).catch(() => undefined);
      process.stderr.write(
        JSON.stringify({
          level: "error",
          event: `${service}_failed`,
          consecutiveFailures: failures,
          message,
        }) + "\n",
      );
      if (failures >= maximumConsecutiveFailures) {
        throw new Error(`${service} remained unhealthy for ${failures} polls`);
      }
    }
    if (!stopping) {
      await sleep(
        failures === 0
          ? intervalMs
          : failureBackoffMs(intervalMs, failures - 1),
      );
    }
  }
}

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

const pipelines: Promise<void>[] = [];
if (role === "ingester" || role === "combined") {
  pipelines.push(runPipeline("chain-ingester", pollMs, async () => syncOnce()));
}
if (role === "projector" || role === "combined") {
  pipelines.push(
    runPipeline("launch-projector", projectorPollMs, async () => projectOnce()),
  );
}
await Promise.all(pipelines);
await sql.end();
