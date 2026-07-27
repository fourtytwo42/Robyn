import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  toEventSelector,
  type Address,
  type Hex,
} from "viem";
import { createDatabase } from "@robyn/db";
import {
  boundedRangeEnd,
  capturedProjectionBlockMatches,
  checkpointDisposition,
  completeProjectionBatch,
  failureBackoffMs,
  ingestionCycleResult,
  projectionRequiresReset,
  projectionWindow,
  requiredBlockNumbers,
  uniqueLaunchIds,
} from "./pipeline.js";
import {
  qualifiesForKingOfForest,
  shouldCountKingTrader,
  validateKingOfForestPolicy,
  type KingOfForestPolicy,
} from "./king-of-forest.js";

type Manifest = {
  schemaVersion?: number;
  chainId: number;
  liquidityVenue?: "uniswap-v4" | "uniswap-v3";
  deploymentBlock: number;
  kingOfForestPolicy?: KingOfForestPolicy;
  contracts: {
    [key: string]: Address | Address[] | undefined;
    factory: Address;
    marketFactory: Address;
    legacyMarketFactories?: Address[];
    atomicLaunchCoordinator?: Address;
    protocolFeeRouter?: Address;
    oracleHook?: Address;
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
const kingMarketEvents = [
  parseAbiItem(
    "event Bought(address indexed buyer,uint256 nativeInput,uint256 feeAmount,uint256 tokenOutput)",
  ),
  parseAbiItem(
    "event Sold(address indexed seller,uint256 tokenInput,uint256 feeAmount,uint256 nativeOutput)",
  ),
  parseAbiItem(
    "event CurveState(uint256 virtualTokenReserve,uint256 virtualNativeReserve,uint256 realCurveTokenReserve,uint256 progressBps)",
  ),
  parseAbiItem(
    "event Graduated(bytes32 indexed poolId,address indexed locker,uint256 indexed positionTokenId,uint256 tokenLiquidity,uint256 nativeLiquidity,uint256 finalCurvePrice)",
  ),
] as const;
const kingV4SwapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
);
const kingMarketPoolAbi = [
  {
    type: "function",
    name: "poolId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
] as const;
const kingEventTopics = [
  ...kingMarketEvents.map((event) => toEventSelector(event)),
  toEventSelector(kingV4SwapEvent),
];
const kingPolicy = manifest.kingOfForestPolicy
  ? validateKingOfForestPolicy(manifest.kingOfForestPolicy)
  : null;

async function currentIndexedAddresses() {
  const launches = await sql.unsafe<
    {
      token: string;
      vault: string;
      market: string;
      adapter: string | null;
      locker: string | null;
    }[]
  >(
    "SELECT token,vault,market,adapter,locker FROM launches WHERE chain_id=$1",
    [manifest.chainId],
  );
  return [
    ...new Set([
      ...indexedAddresses,
      ...launches.flatMap(({ token, vault, market, adapter, locker }) =>
        [token, vault, market, adapter, locker]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase() as Address),
      ),
    ]),
  ];
}

function newlyCreatedLaunchAddresses(
  logs: Awaited<ReturnType<typeof client.getLogs>>,
) {
  const coordinator = manifest.contracts.atomicLaunchCoordinator?.toLowerCase();
  if (!coordinator) return new Map<Address, bigint>();
  const event =
    manifest.liquidityVenue === "uniswap-v4"
      ? atomicV4LaunchEvent
      : atomicLaunchEvent;
  const addresses = new Map<Address, bigint>();
  for (const log of logs) {
    if (log.address.toLowerCase() !== coordinator) continue;
    if (log.blockNumber === null) continue;
    try {
      const decoded = decodeEventLog({
        abi: [event],
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as Record<string, unknown>;
      const receipt = args.receipt as Record<string, unknown> | undefined;
      for (const value of [
        args.token,
        receipt?.vault ?? args.vault,
        receipt?.market ?? args.market,
        receipt?.adapter ?? args.adapter,
        receipt?.locker ?? args.locker,
      ]) {
        if (typeof value !== "string") continue;
        const address = value.toLowerCase() as Address;
        const previous = addresses.get(address);
        if (previous === undefined || log.blockNumber < previous) {
          addresses.set(address, log.blockNumber);
        }
      }
    } catch {
      continue;
    }
  }
  return addresses;
}
const marketStateAbi = [
  {
    type: "function",
    name: "seeded",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "graduated",
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
          { name: "pendingBasketNative", type: "uint256" },
          { name: "cumulativeBasketNativeSettled", type: "uint256" },
          { name: "registered", type: "bool" },
        ],
      },
    ],
  },
] as const;
const phaseHookStateAbi = [
  {
    type: "function",
    name: "poolPhase",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint8" }],
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
          { name: "hook", type: "address" },
          { name: "cumulativeNativeFees", type: "uint256" },
          { name: "cumulativeLaunchFeesConverted", type: "uint256" },
          { name: "cumulativeBondingNativeFees", type: "uint256" },
          { name: "cumulativeLockedLpNativeFees", type: "uint256" },
          { name: "cumulativeHookNativeFees", type: "uint256" },
          { name: "cumulativeLockedLaunchFeesConverted", type: "uint256" },
          { name: "cumulativeHookLaunchFeesConverted", type: "uint256" },
          { name: "claimableCreatorNative", type: "uint256" },
          { name: "cumulativeCreatorNative", type: "uint256" },
          { name: "claimedCreatorNative", type: "uint256" },
          { name: "pendingBasketNative", type: "uint256" },
          { name: "cumulativeBasketNativeSettled", type: "uint256" },
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
    const [seeded, graduated, exclusionsSealed] = await Promise.all([
      client.readContract({
        address: market,
        abi: marketStateAbi,
        functionName: "seeded",
      }),
      client.readContract({
        address: market,
        abi: marketStateAbi,
        functionName: "graduated",
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
    if (manifest.liquidityVenue === "uniswap-v4") {
      if (!manifest.contracts.oracleHook) {
        throw new Error(`Launch ${id} has no canonical phase hook`);
      }
      const phase = await client.readContract({
        address: manifest.contracts.oracleHook,
        abi: phaseHookStateAbi,
        functionName: "poolPhase",
        args: [String(atomic.args.poolId) as Hex],
      });
      if ((graduated && phase !== 3) || (!graduated && phase !== 1)) {
        throw new Error(`Launch ${id} market and pool phases differ`);
      }
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
          String(atomic.args.locker).toLowerCase() ||
        (manifest.liquidityVenue === "uniswap-v4" &&
          (!("hook" in feeAccount) ||
            feeAccount.hook.toLowerCase() !==
              String(manifest.contracts.oracleHook).toLowerCase()))
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
    "INSERT INTO launches (chain_id,launch_id,token,vault,market,adapter,locker,creator,name,symbol,assets,weights_bps,created_block,updated_block,formula_version,campaign_id,campaign_release_sha,automated_test_launch,pool_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (chain_id,token) DO UPDATE SET vault=EXCLUDED.vault,market=EXCLUDED.market,adapter=EXCLUDED.adapter,locker=EXCLUDED.locker,name=EXCLUDED.name,symbol=EXCLUDED.symbol,assets=EXCLUDED.assets,weights_bps=EXCLUDED.weights_bps,created_block=EXCLUDED.created_block,updated_block=EXCLUDED.updated_block,formula_version=EXCLUDED.formula_version,campaign_id=EXCLUDED.campaign_id,campaign_release_sha=EXCLUDED.campaign_release_sha,automated_test_launch=EXCLUDED.automated_test_launch,pool_id=EXCLUDED.pool_id",
    [
      manifest.chainId,
      id.toString(),
      token.toLowerCase(),
      vault.toLowerCase(),
      market.toLowerCase(),
      atomic && typeof atomic.args.adapter === "string"
        ? atomic.args.adapter.toLowerCase()
        : null,
      atomic && typeof atomic.args.locker === "string"
        ? atomic.args.locker.toLowerCase()
        : null,
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
      atomic && typeof atomic.args.poolId === "string"
        ? atomic.args.poolId.toLowerCase()
        : null,
    ],
  );
}

type KingProjectionLog = {
  token: string;
  source: "market" | "pool";
  block_number: string;
  block_hash: string;
  block_timestamp: string;
  transaction_hash: Hex;
  transaction_index: number;
  log_index: number;
  address: Address;
  topics: Hex[];
  data: Hex;
};

async function projectKingOfForest(asOfBlock: bigint) {
  if (!kingPolicy) return { processedLogs: 0, awarded: 0 };
  if (manifest.liquidityVenue === "uniswap-v4") {
    const missingPools = await sql.unsafe<{ token: string; market: Address }[]>(
      "SELECT token,market FROM launches WHERE chain_id=$1 AND pool_id IS NULL",
      [manifest.chainId],
    );
    for (const launch of missingPools) {
      const poolId = await client.readContract({
        address: launch.market,
        abi: kingMarketPoolAbi,
        functionName: "poolId",
      });
      await sql.unsafe(
        "UPDATE launches SET pool_id=$3 WHERE chain_id=$1 AND token=$2 AND pool_id IS NULL",
        [manifest.chainId, launch.token.toLowerCase(), poolId.toLowerCase()],
      );
    }
  }
  const [checkpoint] = await sql.unsafe<
    { last_block: string; last_hash: string }[]
  >(
    "SELECT last_block::text,last_hash FROM indexer_checkpoints WHERE service='king-of-forest-projector' AND chain_id=$1",
    [manifest.chainId],
  );
  if (checkpoint && BigInt(checkpoint.last_block) > asOfBlock) {
    await sql.begin(async (tx) => {
      await tx.unsafe("DELETE FROM launch_traders WHERE chain_id=$1", [
        manifest.chainId,
      ]);
      await tx.unsafe("DELETE FROM king_of_forest_progress WHERE chain_id=$1", [
        manifest.chainId,
      ]);
      await tx.unsafe("DELETE FROM king_of_forest_awards WHERE chain_id=$1", [
        manifest.chainId,
      ]);
      await tx.unsafe(
        "DELETE FROM indexer_checkpoints WHERE service='king-of-forest-projector' AND chain_id=$1",
        [manifest.chainId],
      );
    });
  }
  const [freshCheckpoint] = await sql.unsafe<{ last_block: string }[]>(
    "SELECT last_block::text FROM indexer_checkpoints WHERE service='king-of-forest-projector' AND chain_id=$1",
    [manifest.chainId],
  );
  const fromBlock = freshCheckpoint
    ? BigInt(freshCheckpoint.last_block) + 1n
    : BigInt(manifest.deploymentBlock);
  if (fromBlock > asOfBlock) return { processedLogs: 0, awarded: 0 };
  const logs = await sql.unsafe<KingProjectionLog[]>(
    "WITH relevant AS (SELECT x.token,'market'::text source,l.block_number,l.block_hash,l.transaction_hash,l.transaction_index,l.log_index,l.address,l.topics,l.data FROM raw_logs l JOIN launches x ON x.chain_id=l.chain_id AND x.market=l.address WHERE l.chain_id=$1 AND l.block_number BETWEEN $2 AND $3 AND l.topics->>0=ANY($4::text[]) UNION ALL SELECT x.token,'pool'::text source,l.block_number,l.block_hash,l.transaction_hash,l.transaction_index,l.log_index,l.address,l.topics,l.data FROM raw_logs l JOIN launches x ON x.chain_id=l.chain_id AND x.pool_id IS NOT NULL AND lower(x.pool_id)=lower(l.topics->>1) WHERE l.chain_id=$1 AND l.address=$5 AND l.block_number BETWEEN $2 AND $3 AND l.topics->>0=$6) SELECT r.token,r.source,r.block_number::text,r.block_hash,b.timestamp::text block_timestamp,r.transaction_hash,r.transaction_index,r.log_index,r.address,r.topics,r.data FROM relevant r JOIN chain_blocks b ON b.chain_id=$1 AND b.number=r.block_number AND b.canonical=true ORDER BY r.block_number,r.transaction_index,r.log_index,r.token",
    [
      manifest.chainId,
      fromBlock.toString(),
      asOfBlock.toString(),
      kingEventTopics.slice(0, 4),
      (typeof manifest.contracts.poolManager === "string"
        ? manifest.contracts.poolManager
        : zeroAddress
      ).toLowerCase(),
      kingEventTopics[4]!,
    ],
  );
  const groups = new Map<string, KingProjectionLog[]>();
  for (const log of logs) {
    const key = `${log.transaction_hash.toLowerCase()}:${log.token.toLowerCase()}`;
    const group = groups.get(key) ?? [];
    group.push(log);
    groups.set(key, group);
  }
  const directSwapSenders = new Map<string, Address>();
  for (const [key, group] of groups) {
    const hasMarketTrade = group.some((log) => {
      if (log.source !== "market") return false;
      try {
        const decoded = decodeEventLog({
          abi: kingMarketEvents,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        return decoded.eventName === "Bought" || decoded.eventName === "Sold";
      } catch {
        return false;
      }
    });
    if (hasMarketTrade || !group.some((log) => log.source === "pool")) continue;
    const transaction = await client.getTransaction({
      hash: group[0]!.transaction_hash,
    });
    directSwapSenders.set(key, transaction.from);
  }
  const systemAccounts = new Set(
    Object.values(manifest.contracts)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value): value is Address => typeof value === "string")
      .map((value) => value.toLowerCase()),
  );
  let awarded = 0;
  await sql.begin(async (tx) => {
    for (const [key, group] of groups) {
      const token = group[0]!.token.toLowerCase();
      const [progressRow] = await tx.unsafe<
        { progress_bps: number; market_phase: "bonding" | "graduated" }[]
      >(
        "SELECT progress_bps,market_phase FROM king_of_forest_progress WHERE chain_id=$1 AND token=$2",
        [manifest.chainId, token],
      );
      let progressBps = progressRow?.progress_bps ?? 0;
      let marketPhase: "bonding" | "graduated" =
        progressRow?.market_phase ?? "bonding";
      let qualifyingTrade: KingProjectionLog | null = null;
      const hasMarketTrade = group.some(
        (log) =>
          log.source === "market" &&
          [kingEventTopics[0], kingEventTopics[1]].includes(log.topics[0]!),
      );
      for (const log of group) {
        try {
          if (log.source === "pool") {
            if (hasMarketTrade) continue;
            const decoded = decodeEventLog({
              abi: [kingV4SwapEvent],
              data: log.data,
              topics: log.topics as [Hex, ...Hex[]],
            });
            if (decoded.eventName !== "Swap") continue;
            const trader = directSwapSenders.get(key);
            if (trader && shouldCountKingTrader(trader, systemAccounts)) {
              await tx.unsafe(
                "INSERT INTO launch_traders (chain_id,token,trader,first_seen_block,first_seen_transaction_hash,first_seen_log_index) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (chain_id,token,trader) DO NOTHING",
                [
                  manifest.chainId,
                  token,
                  trader.toLowerCase(),
                  log.block_number,
                  log.transaction_hash.toLowerCase(),
                  log.log_index,
                ],
              );
              qualifyingTrade = log;
            }
            continue;
          }
          const decoded = decodeEventLog({
            abi: kingMarketEvents,
            data: log.data,
            topics: log.topics as [Hex, ...Hex[]],
          });
          if (decoded.eventName === "Bought" || decoded.eventName === "Sold") {
            const args = decoded.args as { buyer?: Address; seller?: Address };
            const trader = args.buyer ?? args.seller;
            if (trader && shouldCountKingTrader(trader, systemAccounts)) {
              await tx.unsafe(
                "INSERT INTO launch_traders (chain_id,token,trader,first_seen_block,first_seen_transaction_hash,first_seen_log_index) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (chain_id,token,trader) DO NOTHING",
                [
                  manifest.chainId,
                  token,
                  trader.toLowerCase(),
                  log.block_number,
                  log.transaction_hash.toLowerCase(),
                  log.log_index,
                ],
              );
              qualifyingTrade = log;
            }
          } else if (decoded.eventName === "CurveState") {
            progressBps = Math.min(10_000, Number(decoded.args.progressBps));
          } else if (decoded.eventName === "Graduated") {
            progressBps = 10_000;
            marketPhase = "graduated";
          }
        } catch {
          continue;
        }
      }
      const last = group.at(-1)!;
      await tx.unsafe(
        "INSERT INTO king_of_forest_progress (chain_id,token,progress_bps,market_phase,updated_block,updated_transaction_hash,updated_log_index) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (chain_id,token) DO UPDATE SET progress_bps=EXCLUDED.progress_bps,market_phase=EXCLUDED.market_phase,updated_block=EXCLUDED.updated_block,updated_transaction_hash=EXCLUDED.updated_transaction_hash,updated_log_index=EXCLUDED.updated_log_index",
        [
          manifest.chainId,
          token,
          progressBps,
          marketPhase,
          last.block_number,
          last.transaction_hash.toLowerCase(),
          last.log_index,
        ],
      );
      if (!qualifyingTrade) continue;
      const [counts, existing] = await Promise.all([
        tx.unsafe<{ count: string }[]>(
          "SELECT count(*)::text count FROM launch_traders WHERE chain_id=$1 AND token=$2",
          [manifest.chainId, token],
        ),
        tx.unsafe<{ token: string }[]>(
          "SELECT token FROM king_of_forest_awards WHERE chain_id=$1 AND token=$2",
          [manifest.chainId, token],
        ),
      ]);
      const uniqueTraders = Number(counts[0]?.count ?? "0");
      if (
        !qualifiesForKingOfForest(kingPolicy, {
          blockNumber: BigInt(qualifyingTrade.block_number),
          progressBps,
          uniqueTraders,
          alreadyAwarded: Boolean(existing[0]),
          hasQualifyingTrade: true,
        })
      )
        continue;
      const inserted = await tx.unsafe<{ token: string }[]>(
        "INSERT INTO king_of_forest_awards (chain_id,token,awarded_block,awarded_block_hash,awarded_transaction_hash,awarded_transaction_index,awarded_log_index,awarded_at,progress_bps,unique_traders,market_phase,policy_version) VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8::bigint),$9,$10,$11,$12) ON CONFLICT (chain_id,token) DO NOTHING RETURNING token",
        [
          manifest.chainId,
          token,
          qualifyingTrade.block_number,
          qualifyingTrade.block_hash.toLowerCase(),
          qualifyingTrade.transaction_hash.toLowerCase(),
          qualifyingTrade.transaction_index,
          qualifyingTrade.log_index,
          qualifyingTrade.block_timestamp,
          progressBps,
          uniqueTraders,
          marketPhase,
          kingPolicy.version,
        ],
      );
      awarded += inserted.length;
    }
    const [captured] = await tx.unsafe<{ hash: string }[]>(
      "SELECT hash FROM chain_blocks WHERE chain_id=$1 AND number=$2 AND canonical=true",
      [manifest.chainId, asOfBlock.toString()],
    );
    if (!captured)
      throw new Error("King projection target block is not canonical");
    await tx.unsafe(
      "INSERT INTO indexer_checkpoints (service,chain_id,last_block,last_hash) VALUES ('king-of-forest-projector',$1,$2,$3) ON CONFLICT (service,chain_id) DO UPDATE SET last_block=EXCLUDED.last_block,last_hash=EXCLUDED.last_hash,updated_at=now()",
      [manifest.chainId, asOfBlock.toString(), captured.hash.toLowerCase()],
    );
  });
  return { processedLogs: logs.length, awarded };
}

async function resetCanonical() {
  await sql.begin(async (tx) => {
    await tx.unsafe("DELETE FROM launch_traders WHERE chain_id=$1", [
      manifest.chainId,
    ]);
    await tx.unsafe("DELETE FROM king_of_forest_progress WHERE chain_id=$1", [
      manifest.chainId,
    ]);
    await tx.unsafe("DELETE FROM king_of_forest_awards WHERE chain_id=$1", [
      manifest.chainId,
    ]);
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
      "DELETE FROM indexer_checkpoints WHERE service IN ('chain-indexer','launch-projector','king-of-forest-projector') AND chain_id=$1",
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
    const knownAddresses = await currentIndexedAddresses();
    const primaryLogs = await client.getLogs({
      address: knownAddresses,
      fromBlock: rangeStart,
      toBlock: rangeEnd,
    });
    const newAddresses = newlyCreatedLaunchAddresses(primaryLogs);
    const supplementalAddresses = [...newAddresses.keys()].filter(
      (address) => !knownAddresses.includes(address),
    );
    const supplementalLogs =
      supplementalAddresses.length === 0
        ? []
        : await client.getLogs({
            address: supplementalAddresses,
            fromBlock: [...newAddresses.values()].reduce(
              (minimum, block) => (block < minimum ? block : minimum),
              rangeEnd,
            ),
            toBlock: rangeEnd,
          });
    const logs = [
      ...new Map(
        [...primaryLogs, ...supplementalLogs].map((log) => [
          `${log.transactionHash}:${log.logIndex}`,
          log,
        ]),
      ).values(),
    ].sort(
      (left, right) =>
        Number(left.blockNumber - right.blockNumber) ||
        Number((left.logIndex ?? 0) - (right.logIndex ?? 0)),
    );
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
      await tx.unsafe("DELETE FROM launch_traders WHERE chain_id=$1", [
        manifest.chainId,
      ]);
      await tx.unsafe("DELETE FROM king_of_forest_progress WHERE chain_id=$1", [
        manifest.chainId,
      ]);
      await tx.unsafe("DELETE FROM king_of_forest_awards WHERE chain_id=$1", [
        manifest.chainId,
      ]);
      await tx.unsafe("DELETE FROM launches WHERE chain_id=$1", [
        manifest.chainId,
      ]);
      await tx.unsafe(
        "DELETE FROM indexer_checkpoints WHERE service IN ('launch-projector','king-of-forest-projector') AND chain_id=$1",
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
  let kingProjection = { processedLogs: 0, awarded: 0 };
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
      async () => {
        await reconcileMetadataBindings();
        kingProjection = await projectKingOfForest(BigInt(ingested.last_block));
      },
      async () => {
        const advanced = await sql.begin(async (tx) => {
          const captured = await tx.unsafe<
            { number: string; hash: string; canonical: boolean }[]
          >(
            "SELECT number::text,hash,canonical FROM chain_blocks WHERE chain_id=$1 AND number=$2 AND lower(hash)=lower($3) AND canonical=true FOR SHARE",
            [manifest.chainId, ingested.last_block, ingested.last_hash],
          );
          if (
            !capturedProjectionBlockMatches(
              BigInt(ingested.last_block),
              ingested.last_hash,
              captured[0],
            )
          ) {
            return false;
          }
          await tx.unsafe(
            "INSERT INTO indexer_checkpoints (service,chain_id,last_block,last_hash) VALUES ('launch-projector',$1,$2,$3) ON CONFLICT (service,chain_id) DO UPDATE SET last_block=EXCLUDED.last_block,last_hash=EXCLUDED.last_hash,updated_at=now()",
            [manifest.chainId, ingested.last_block, ingested.last_hash],
          );
          return true;
        });
        if (!advanced) {
          await sql.begin(async (tx) => {
            await tx.unsafe(
              "DELETE FROM king_of_forest_awards WHERE chain_id=$1",
              [manifest.chainId],
            );
            await tx.unsafe(
              "DELETE FROM king_of_forest_progress WHERE chain_id=$1",
              [manifest.chainId],
            );
            await tx.unsafe("DELETE FROM launch_traders WHERE chain_id=$1", [
              manifest.chainId,
            ]);
            await tx.unsafe("DELETE FROM launches WHERE chain_id=$1", [
              manifest.chainId,
            ]);
            await tx.unsafe(
              "DELETE FROM indexer_checkpoints WHERE service IN ('launch-projector','king-of-forest-projector') AND chain_id=$1",
              [manifest.chainId],
            );
          });
          throw new Error(
            "Captured canonical projection block changed during projection",
          );
        }
      },
    );
  } else {
    await reconcileMetadataBindings();
    kingProjection = await projectKingOfForest(BigInt(ingested.last_block));
  }
  const cycleMs = Math.round((performance.now() - began) * 100) / 100;
  process.stdout.write(
    JSON.stringify({
      level: "info",
      event: "projection",
      checkpoint: ingested.last_block,
      projectedLaunches,
      kingProcessedLogs: kingProjection.processedLogs,
      kingAwards: kingProjection.awarded,
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
