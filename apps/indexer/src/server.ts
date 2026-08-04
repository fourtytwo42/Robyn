import { readFile, statfs } from "node:fs/promises";
import {
  createPublicClient,
  decodeEventLog,
  http,
  numberToHex,
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
  mergeIndexedAddresses,
  projectionRequiresReset,
  projectionWindow,
  requiredBlockNumbers,
  uniqueLaunchIds,
} from "./pipeline.js";
import {
  backfillAllowed,
  chunkValues,
  uniqueLogs,
  validateIndexingPolicy,
  type IndexingPolicy,
} from "./indexing-policy.js";
import {
  qualifiesForKingOfForest,
  shouldCountKingTrader,
  validateKingOfForestPolicy,
  type KingOfForestPolicy,
} from "./king-of-forest.js";
import {
  createDebouncedWake,
  FilteredLogWakeClient,
  observedLagRequiresSync,
  WakeCoordinator,
} from "./wake.js";

type Manifest = {
  schemaVersion?: number;
  chainId: number;
  liquidityVenue?: "uniswap-v4" | "uniswap-v3";
  deploymentBlock: number;
  kingOfForestPolicy?: KingOfForestPolicy;
  indexingPolicy?: IndexingPolicy;
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
if (
  (manifest.schemaVersion === 19 || manifest.schemaVersion === 20) &&
  manifest.liquidityVenue !== "uniswap-v4"
) {
  throw new Error(
    "Schema-19/20 manifest must declare the Uniswap v4 liquidity venue",
  );
}
const usesUniswapV4 = manifest.liquidityVenue === "uniswap-v4";
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
const reconciliationMs = Number(
  process.env.INDEXER_RECONCILIATION_MS ??
    process.env.INDEXER_POLL_MS ??
    "900000",
);
const ingesterHeartbeatMs = Number(process.env.INDEXER_HEARTBEAT_MS ?? "10000");
const maximumObservedLagBlocks = BigInt(
  process.env.INDEXER_MAXIMUM_OBSERVED_LAG_BLOCKS ?? "40",
);
const wakeDebounceMs = Number(process.env.INDEXER_WS_DEBOUNCE_MS ?? "500");
const wakeRpcUrl = process.env.ROBYN_OPERATOR_WS_RPC_URL?.trim() || null;
const projectorPollMs = Number(process.env.PROJECTOR_POLL_MS ?? "1000");
const blockRange = BigInt(process.env.INDEXER_BLOCK_RANGE ?? "250");
const blockReadConcurrency = Number(
  process.env.INDEXER_BLOCK_READ_CONCURRENCY ?? "6",
);
const maximumConsecutiveFailures = Number(
  process.env.INDEXER_MAXIMUM_CONSECUTIVE_FAILURES ?? "24",
);
const storagePath = process.env.ROBYN_STORAGE_PATH ?? "/var/lib/postgresql";
const diskBackfillDisablePercent = 85;
let stopping = false;
let databaseSizeObservation: { bytes: number; at: number } | null = null;
const ingesterWake = new WakeCoordinator();
const debouncedIngesterWake = createDebouncedWake(
  () => ingesterWake.trigger(),
  wakeDebounceMs,
);
let filteredLogWakeClient: FilteredLogWakeClient | undefined;

const indexingPolicy = validateIndexingPolicy(manifest);

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
  {
    type: "function",
    name: "graduationProfileByToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "version", type: "uint64" },
          { name: "targetGraduationNative", type: "uint256" },
          { name: "actualGraduationNative", type: "uint256" },
          { name: "maximumCurvePurchase", type: "uint256" },
          { name: "initialVirtualNativeReserve", type: "uint256" },
          { name: "terminalNativePerTokenX18", type: "uint256" },
          { name: "terminalSqrtPriceX96", type: "uint160" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "graduationProfileHashByToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const atomicLaunchEvent = parseAbiItem(
  "event AtomicLaunchCreated(uint256 indexed launchId,address indexed creator,address indexed token,address vault,address market,address adapter,address pool,address locker,bytes32 configurationHash,bytes32 launchSaltHash,bytes32 metadataUriHash)",
);
const atomicV4LaunchEvent = parseAbiItem(
  "event AtomicV4LaunchCreated(uint256 indexed launchId,address indexed creator,address indexed token,(address vault,address market,address adapter,address poolManager,bytes32 poolId,address positionManager,address hook,address locker,uint24 poolFeePips,int24 tickSpacing,bytes32 configurationHash,bytes32 launchSaltHash,bytes32 metadataUriHash,(uint64 version,uint256 targetGraduationNative,uint256 actualGraduationNative,uint256 maximumCurvePurchase,uint256 initialVirtualNativeReserve,uint256 terminalNativePerTokenX18,uint160 terminalSqrtPriceX96) graduationProfile,bytes32 graduationProfileHash) receipt)",
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

const rewardStreamEventDefinitions = [
  {
    category: "holder",
    event: parseAbiItem(
      "event RewardReceived(uint256 indexed assetIndex,address indexed asset,uint256 received,uint256 distributed,uint256 pendingWithoutSupply)",
    ),
  },
  {
    category: "holder",
    event: parseAbiItem(
      "event RewardStreamUpdated(uint256 indexed assetIndex,uint256 rewardRate,uint256 periodFinish,uint256 queuedRewards,uint256 eligibleSupply)",
    ),
  },
  {
    category: "holder",
    event: parseAbiItem(
      "event RewardStreamPaused(uint256 indexed assetIndex,uint256 queuedRewards)",
    ),
  },
  {
    category: "holder",
    event: parseAbiItem(
      "event RewardClaimed(address indexed account,uint256 indexed assetIndex,address indexed asset,uint256 amount)",
    ),
  },
  {
    category: "dao",
    event: parseAbiItem(
      "event RewardsDeposited(uint256 amount,uint256 eligibleSupply,uint256 cumulativeDeposited)",
    ),
  },
  {
    category: "dao",
    event: parseAbiItem(
      "event RewardStreamUpdated(uint256 rewardRate,uint256 periodFinish,uint256 queuedRewards,uint256 eligibleSupply)",
    ),
  },
  {
    category: "dao",
    event: parseAbiItem("event RewardStreamPaused(uint256 queuedRewards)"),
  },
  {
    category: "dao",
    event: parseAbiItem(
      "event RewardsClaimed(address indexed account,address indexed recipient,uint256 amount)",
    ),
  },
  {
    category: "creator",
    event: parseAbiItem(
      "event CreatorFeesAssigned(address indexed token,address indexed recipient,uint256 amount)",
    ),
  },
  {
    category: "creator",
    event: parseAbiItem(
      "event CreatorRewardStreamUpdated(address indexed token,address indexed recipient,uint256 rewardRate,uint256 periodFinish,uint256 claimable,uint256 unvested)",
    ),
  },
  {
    category: "creator",
    event: parseAbiItem(
      "event CreatorFeesClaimed(address indexed token,address indexed claimant,address indexed recipient,uint256 amount)",
    ),
  },
  {
    category: "creator",
    event: parseAbiItem(
      "event CreatorFeeSplitConfigured(address indexed token,address indexed creator,address[] recipients,uint16[] sharesBps,bool locked)",
    ),
  },
] as const;
const rewardStreamEventByTopic = new Map(
  rewardStreamEventDefinitions.map((definition) => [
    toEventSelector(definition.event).toLowerCase(),
    definition,
  ]),
);
const rewardStreamEventTopics = [...rewardStreamEventByTopic.keys()];
const schema18GovernanceEventDefinitions = [
  {
    source: "bootstrap-timelock",
    event: parseAbiItem(
      "event BootstrapStepExecuted(uint8 indexed step,bytes32 indexed planHash,address indexed caller)",
    ),
  },
  {
    source: "bootstrap-timelock",
    event: parseAbiItem(
      "event BootstrapFinalized(bytes32 indexed reason,address indexed caller,uint8 completedSteps)",
    ),
  },
  {
    source: "governor",
    event: parseAbiItem(
      "event UnanimousOperationScheduled(bytes32 indexed operationId,address indexed owner,uint48 indexed snapshot,uint256 nonce,bytes32 descriptionHash,bytes32 salt,uint256 delay)",
    ),
  },
] as const;
const schema18GovernanceEventByTopic = new Map(
  schema18GovernanceEventDefinitions.map((definition) => [
    toEventSelector(definition.event).toLowerCase(),
    definition,
  ]),
);
const schema18GovernanceEventTopics = [
  ...schema18GovernanceEventByTopic.keys(),
];

async function currentIndexedScope() {
  const launches = await sql.unsafe<
    {
      token: string;
      vault: string;
      market: string;
      adapter: string | null;
      locker: string | null;
      pool_id: string | null;
    }[]
  >(
    "SELECT token,vault,market,adapter,locker,pool_id FROM launches WHERE chain_id=$1",
    [manifest.chainId],
  );
  const coordinator = manifest.contracts.atomicLaunchCoordinator?.toLowerCase();
  const coordinatorLogs = coordinator
    ? await sql.unsafe<
        {
          block_number: string;
          data: Hex;
          topics: Hex[];
        }[]
      >(
        "SELECT block_number::text,data,topics FROM raw_logs WHERE chain_id=$1 AND address=$2 ORDER BY block_number,transaction_index,log_index",
        [manifest.chainId, coordinator],
      )
    : [];
  const discovered = newlyCreatedLaunchArtifacts(
    coordinatorLogs.map((log) => ({
      address: coordinator as Address,
      blockNumber: BigInt(log.block_number),
      data: log.data,
      topics: log.topics as [] | [Hex, ...Hex[]],
    })),
  );
  return {
    addresses: mergeIndexedAddresses(
      indexingPolicy.protocolRoots,
      launches.flatMap(({ token, vault, market, adapter, locker }) =>
        [token, vault, market, adapter, locker].filter(
          (value): value is string => Boolean(value),
        ),
      ),
      discovered.addresses.keys(),
    ) as Address[],
    poolIds: [
      ...new Set([
        ...launches
          .map(({ pool_id }) => pool_id?.toLowerCase())
          .filter((value): value is Hex => Boolean(value)),
        ...discovered.poolIds.keys(),
      ]),
    ].sort() as Hex[],
  };
}

function newlyCreatedLaunchArtifacts(
  logs: {
    address: Address;
    blockNumber: bigint | null;
    data: Hex;
    topics: [] | [Hex, ...Hex[]];
  }[],
) {
  const coordinator = manifest.contracts.atomicLaunchCoordinator?.toLowerCase();
  if (!coordinator) {
    return {
      addresses: new Map<Address, bigint>(),
      poolIds: new Map<Hex, bigint>(),
    };
  }
  const event = usesUniswapV4 ? atomicV4LaunchEvent : atomicLaunchEvent;
  const addresses = new Map<Address, bigint>();
  const poolIds = new Map<Hex, bigint>();
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
      const poolId = receipt?.poolId;
      if (typeof poolId === "string" && /^0x[0-9a-fA-F]{64}$/.test(poolId)) {
        const normalized = poolId.toLowerCase() as Hex;
        const previous = poolIds.get(normalized);
        if (previous === undefined || log.blockNumber < previous) {
          poolIds.set(normalized, log.blockNumber);
        }
      }
    } catch {
      continue;
    }
  }
  return { addresses, poolIds };
}

type RpcLog = {
  address: Address;
  blockHash: Hex | null;
  blockNumber: Hex | null;
  data: Hex;
  logIndex: Hex | null;
  removed: boolean;
  topics: [] | [Hex, ...Hex[]];
  transactionHash: Hex | null;
  transactionIndex: Hex | null;
};

async function scopedAddressLogs(
  addresses: Address[],
  fromBlock: bigint,
  toBlock: bigint,
) {
  let queryCount = 0;
  const logs = [];
  for (const addressBatch of chunkValues(
    addresses,
    indexingPolicy.addressBatchSize,
  )) {
    logs.push(
      ...(await client.getLogs({
        address: addressBatch,
        fromBlock,
        toBlock,
      })),
    );
    queryCount += 1;
  }
  return { logs, queryCount };
}

async function scopedPoolLogs(
  poolIds: Hex[],
  fromBlock: bigint,
  toBlock: bigint,
) {
  let queryCount = 0;
  const logs = [];
  for (const poolBatch of chunkValues(
    poolIds,
    indexingPolicy.poolIdBatchSize,
  )) {
    const response = (await client.request({
      method: "eth_getLogs",
      params: [
        {
          address: indexingPolicy.poolManager,
          topics: [indexingPolicy.poolEventTopics, poolBatch],
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(toBlock),
        },
      ],
    })) as RpcLog[];
    queryCount += 1;
    logs.push(
      ...response.map((log) => ({
        address: log.address,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber === null ? null : BigInt(log.blockNumber),
        data: log.data,
        logIndex: log.logIndex === null ? null : Number(log.logIndex),
        removed: log.removed,
        topics: log.topics,
        transactionHash: log.transactionHash,
        transactionIndex:
          log.transactionIndex === null ? null : Number(log.transactionIndex),
      })),
    );
  }
  return { logs, queryCount };
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
  const v4 = usesUniswapV4;
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
    if (usesUniswapV4) {
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
      if (typeof atomic.args.graduationProfileHash === "string") {
        const [onchainProfile, onchainProfileHash] = await Promise.all([
          client.readContract({
            address: manifest.contracts.marketFactory,
            abi: marketFactoryAbi,
            functionName: "graduationProfileByToken",
            args: [token],
          }),
          client.readContract({
            address: manifest.contracts.marketFactory,
            abi: marketFactoryAbi,
            functionName: "graduationProfileHashByToken",
            args: [token],
          }),
        ]);
        const eventProfile = atomic.args.graduationProfile as
          Record<string, unknown> | undefined;
        const profileFields = [
          "version",
          "targetGraduationNative",
          "actualGraduationNative",
          "maximumCurvePurchase",
          "initialVirtualNativeReserve",
          "terminalNativePerTokenX18",
          "terminalSqrtPriceX96",
        ] as const;
        if (
          !eventProfile ||
          onchainProfileHash.toLowerCase() !==
            atomic.args.graduationProfileHash.toLowerCase() ||
          profileFields.some(
            (field) =>
              String(onchainProfile[field]) !== String(eventProfile[field]),
          )
        ) {
          throw new Error(`Launch ${id} graduation profile differs`);
        }
      }
    }
    if (manifest.contracts.protocolFeeRouter) {
      const feeAccount = await client.readContract({
        address: manifest.contracts.protocolFeeRouter,
        abi: usesUniswapV4 ? nativeV4FeeRouterStateAbi : feeRouterStateAbi,
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
        (usesUniswapV4 &&
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
  const graduationProfile =
    atomic?.args.graduationProfile &&
    typeof atomic.args.graduationProfile === "object"
      ? (atomic.args.graduationProfile as Record<string, unknown>)
      : undefined;
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
    "INSERT INTO launches (chain_id,launch_id,token,vault,market,adapter,locker,creator,name,symbol,assets,weights_bps,created_block,updated_block,formula_version,campaign_id,campaign_release_sha,automated_test_launch,pool_id,graduation_profile_version,target_graduation_native,actual_graduation_native,maximum_curve_purchase,initial_virtual_native_reserve,terminal_native_per_token_x18,terminal_sqrt_price_x96,graduation_profile_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) ON CONFLICT (chain_id,token) DO UPDATE SET vault=EXCLUDED.vault,market=EXCLUDED.market,adapter=EXCLUDED.adapter,locker=EXCLUDED.locker,name=EXCLUDED.name,symbol=EXCLUDED.symbol,assets=EXCLUDED.assets,weights_bps=EXCLUDED.weights_bps,created_block=EXCLUDED.created_block,updated_block=EXCLUDED.updated_block,formula_version=EXCLUDED.formula_version,campaign_id=EXCLUDED.campaign_id,campaign_release_sha=EXCLUDED.campaign_release_sha,automated_test_launch=EXCLUDED.automated_test_launch,pool_id=EXCLUDED.pool_id,graduation_profile_version=EXCLUDED.graduation_profile_version,target_graduation_native=EXCLUDED.target_graduation_native,actual_graduation_native=EXCLUDED.actual_graduation_native,maximum_curve_purchase=EXCLUDED.maximum_curve_purchase,initial_virtual_native_reserve=EXCLUDED.initial_virtual_native_reserve,terminal_native_per_token_x18=EXCLUDED.terminal_native_per_token_x18,terminal_sqrt_price_x96=EXCLUDED.terminal_sqrt_price_x96,graduation_profile_hash=EXCLUDED.graduation_profile_hash",
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
        ? usesUniswapV4
          ? graduationProfile
            ? "native-v4-schema13-governed"
            : "native-v4-dao-atomic"
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
      graduationProfile ? String(graduationProfile.version) : null,
      graduationProfile
        ? String(graduationProfile.targetGraduationNative)
        : null,
      graduationProfile
        ? String(graduationProfile.actualGraduationNative)
        : null,
      graduationProfile ? String(graduationProfile.maximumCurvePurchase) : null,
      graduationProfile
        ? String(graduationProfile.initialVirtualNativeReserve)
        : null,
      graduationProfile
        ? String(graduationProfile.terminalNativePerTokenX18)
        : null,
      graduationProfile ? String(graduationProfile.terminalSqrtPriceX96) : null,
      atomic && typeof atomic.args.graduationProfileHash === "string"
        ? atomic.args.graduationProfileHash.toLowerCase()
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
  if (usesUniswapV4) {
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

type RewardProjectionLog = {
  token: string | null;
  block_number: string;
  block_hash: string;
  transaction_hash: Hex;
  log_index: number;
  address: Address;
  topics: Hex[];
  data: Hex;
};

function rewardPayload(value: unknown) {
  return JSON.stringify(value, (_key, nested) =>
    typeof nested === "bigint" ? nested.toString() : nested,
  );
}

async function projectRewardStreams(asOfBlock: bigint) {
  const daoAddress =
    typeof manifest.contracts.daoToken === "string"
      ? manifest.contracts.daoToken.toLowerCase()
      : null;
  const [checkpoint] = await sql.unsafe<
    { last_block: string; last_hash: string }[]
  >(
    "SELECT last_block::text,last_hash FROM indexer_checkpoints WHERE service='reward-stream-projector' AND chain_id=$1",
    [manifest.chainId],
  );
  const fromBlock = checkpoint
    ? BigInt(checkpoint.last_block) + 1n
    : BigInt(manifest.deploymentBlock);
  if (fromBlock > asOfBlock) return 0;
  const logs = await sql.unsafe<RewardProjectionLog[]>(
    "SELECT x.token,l.block_number::text,l.block_hash,l.transaction_hash,l.log_index,l.address,l.topics,l.data FROM raw_logs l JOIN chain_blocks b ON b.chain_id=l.chain_id AND b.number=l.block_number AND b.hash=l.block_hash AND b.canonical=true LEFT JOIN launches x ON x.chain_id=l.chain_id AND x.token=l.address WHERE l.chain_id=$1 AND l.block_number BETWEEN $2 AND $3 AND l.topics->>0=ANY($4::text[]) ORDER BY l.block_number,l.transaction_index,l.log_index",
    [
      manifest.chainId,
      fromBlock.toString(),
      asOfBlock.toString(),
      rewardStreamEventTopics,
    ],
  );
  await sql.begin(async (tx) => {
    for (const log of logs) {
      const definition = rewardStreamEventByTopic.get(
        log.topics[0]!.toLowerCase(),
      );
      if (!definition) continue;
      if (definition.category === "holder" && !log.token) continue;
      if (
        definition.category === "dao" &&
        log.address.toLowerCase() !== daoAddress
      )
        continue;
      if (
        definition.category === "creator" &&
        log.address.toLowerCase() !==
          manifest.contracts.protocolFeeRouter?.toLowerCase()
      )
        continue;
      const decoded = decodeEventLog({
        abi: [definition.event],
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as Record<string, unknown>;
      const token =
        definition.category === "holder"
          ? log.token
          : typeof args.token === "string"
            ? args.token.toLowerCase()
            : null;
      const recipient =
        typeof args.recipient === "string"
          ? args.recipient.toLowerCase()
          : typeof args.account === "string"
            ? args.account.toLowerCase()
            : null;
      const assetIndex =
        typeof args.assetIndex === "bigint" ? Number(args.assetIndex) : null;
      await tx.unsafe(
        "INSERT INTO reward_stream_events (chain_id,transaction_hash,log_index,block_number,block_hash,address,category,token,recipient,event_name,asset_index,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT (chain_id,transaction_hash,log_index) DO NOTHING",
        [
          manifest.chainId,
          log.transaction_hash.toLowerCase(),
          log.log_index,
          log.block_number,
          log.block_hash.toLowerCase(),
          log.address.toLowerCase(),
          definition.category,
          token,
          recipient,
          decoded.eventName,
          assetIndex,
          rewardPayload(args),
        ],
      );
    }
    const [captured] = await tx.unsafe<{ hash: string }[]>(
      "SELECT hash FROM chain_blocks WHERE chain_id=$1 AND number=$2 AND canonical=true",
      [manifest.chainId, asOfBlock.toString()],
    );
    if (!captured)
      throw new Error("Reward projection target block is not canonical");
    await tx.unsafe(
      "INSERT INTO indexer_checkpoints (service,chain_id,last_block,last_hash) VALUES ('reward-stream-projector',$1,$2,$3) ON CONFLICT (service,chain_id) DO UPDATE SET last_block=EXCLUDED.last_block,last_hash=EXCLUDED.last_hash,updated_at=now()",
      [manifest.chainId, asOfBlock.toString(), captured.hash.toLowerCase()],
    );
  });
  return logs.length;
}

async function projectSchema19Governance(asOfBlock: bigint) {
  if ((manifest.schemaVersion ?? 0) !== 19) return 0;
  const timelock = manifest.contracts.timelock;
  const governor = manifest.contracts.governor;
  if (typeof timelock !== "string" || typeof governor !== "string") {
    throw new Error("Schema-19 manifest is missing Timelock or Governor");
  }
  const [checkpoint] = await sql.unsafe<
    { last_block: string; last_hash: string }[]
  >(
    "SELECT last_block::text,last_hash FROM indexer_checkpoints WHERE service='schema19-governance-projector' AND chain_id=$1",
    [manifest.chainId],
  );
  const fromBlock = checkpoint
    ? BigInt(checkpoint.last_block) + 1n
    : BigInt(manifest.deploymentBlock);
  if (fromBlock > asOfBlock) return 0;
  const logs = await sql.unsafe<RewardProjectionLog[]>(
    "SELECT null::text token,l.block_number::text,l.block_hash,l.transaction_hash,l.log_index,l.address,l.topics,l.data FROM raw_logs l JOIN chain_blocks b ON b.chain_id=l.chain_id AND b.number=l.block_number AND b.hash=l.block_hash AND b.canonical=true WHERE l.chain_id=$1 AND l.block_number BETWEEN $2 AND $3 AND lower(l.address)=ANY($4::text[]) AND l.topics->>0=ANY($5::text[]) ORDER BY l.block_number,l.transaction_index,l.log_index",
    [
      manifest.chainId,
      fromBlock.toString(),
      asOfBlock.toString(),
      [timelock.toLowerCase(), governor.toLowerCase()],
      schema18GovernanceEventTopics,
    ],
  );
  await sql.begin(async (tx) => {
    for (const log of logs) {
      const definition = schema18GovernanceEventByTopic.get(
        log.topics[0]!.toLowerCase(),
      );
      if (!definition) continue;
      const expectedAddress =
        definition.source === "bootstrap-timelock" ? timelock : governor;
      if (log.address.toLowerCase() !== expectedAddress.toLowerCase()) continue;
      const decoded = decodeEventLog({
        abi: [definition.event],
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      await tx.unsafe(
        "INSERT INTO governance_control_events (chain_id,transaction_hash,log_index,block_number,block_hash,address,source,event_name,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (chain_id,transaction_hash,log_index) DO NOTHING",
        [
          manifest.chainId,
          log.transaction_hash.toLowerCase(),
          log.log_index,
          log.block_number,
          log.block_hash.toLowerCase(),
          log.address.toLowerCase(),
          definition.source,
          decoded.eventName,
          rewardPayload(decoded.args),
        ],
      );
    }
    const [captured] = await tx.unsafe<{ hash: string }[]>(
      "SELECT hash FROM chain_blocks WHERE chain_id=$1 AND number=$2 AND canonical=true",
      [manifest.chainId, asOfBlock.toString()],
    );
    if (!captured)
      throw new Error(
        "Schema-19 governance projection target is not canonical",
      );
    await tx.unsafe(
      "INSERT INTO indexer_checkpoints (service,chain_id,last_block,last_hash) VALUES ('schema19-governance-projector',$1,$2,$3) ON CONFLICT (service,chain_id) DO UPDATE SET last_block=EXCLUDED.last_block,last_hash=EXCLUDED.last_hash,updated_at=now()",
      [manifest.chainId, asOfBlock.toString(), captured.hash.toLowerCase()],
    );
  });
  return logs.length;
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
    await tx.unsafe("DELETE FROM keeper_scan_requests WHERE chain_id=$1", [
      manifest.chainId,
    ]);
    await tx.unsafe("DELETE FROM reward_stream_events WHERE chain_id=$1", [
      manifest.chainId,
    ]);
    await tx.unsafe("DELETE FROM governance_control_events WHERE chain_id=$1", [
      manifest.chainId,
    ]);
    await tx.unsafe(
      "DELETE FROM indexer_checkpoints WHERE service IN ('chain-indexer','launch-projector','king-of-forest-projector','reward-stream-projector','schema18-governance-projector') AND chain_id=$1",
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
  const storage = await statfs(storagePath);
  const diskTotalBytes = Number(storage.blocks) * Number(storage.bsize);
  const diskAvailableBytes = Number(storage.bavail) * Number(storage.bsize);
  const diskUtilizationPercent =
    diskTotalBytes === 0
      ? 100
      : ((diskTotalBytes - diskAvailableBytes) / diskTotalBytes) * 100;
  if (
    !backfillAllowed(
      start,
      head,
      diskUtilizationPercent,
      maximumObservedLagBlocks,
    )
  ) {
    throw new Error(
      "Scoped backfill disabled at " +
        diskUtilizationPercent.toFixed(2) +
        "% disk utilization",
    );
  }
  let logCount = 0;
  let rangeCount = 0;
  let addressQueryCount = 0;
  let poolQueryCount = 0;
  for (let rangeStart = start; rangeStart <= head; rangeStart += blockRange) {
    const rangeEnd = boundedRangeEnd(rangeStart, head, blockRange);
    const knownScope = await currentIndexedScope();
    const primary = await scopedAddressLogs(
      knownScope.addresses,
      rangeStart,
      rangeEnd,
    );
    addressQueryCount += primary.queryCount;
    const discovered = newlyCreatedLaunchArtifacts(primary.logs);
    const supplementalAddresses = [...discovered.addresses.keys()].filter(
      (address) => !knownScope.addresses.includes(address),
    );
    const supplemental =
      supplementalAddresses.length === 0
        ? { logs: [], queryCount: 0 }
        : await scopedAddressLogs(
            supplementalAddresses,
            [...discovered.addresses.values()].reduce(
              (minimum, block) => (block < minimum ? block : minimum),
              rangeEnd,
            ),
            rangeEnd,
          );
    addressQueryCount += supplemental.queryCount;
    const poolIds = [
      ...new Set([...knownScope.poolIds, ...discovered.poolIds.keys()]),
    ].sort() as Hex[];
    const pool = await scopedPoolLogs(poolIds, rangeStart, rangeEnd);
    poolQueryCount += pool.queryCount;
    const logs = uniqueLogs([
      ...primary.logs,
      ...supplemental.logs,
      ...pool.logs,
    ])
      .filter(
        (log): log is typeof log & { blockNumber: bigint } =>
          log.blockNumber !== null,
      )
      .sort(
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
  const scope = await currentIndexedScope();
  const [databaseStats] = await sql.unsafe<
    {
      database_size_bytes: string;
      retained_logs: string;
      tracked_launches: string;
    }[]
  >(
    "SELECT pg_database_size(current_database())::text database_size_bytes,(SELECT count(*)::text FROM raw_logs WHERE chain_id=$1) retained_logs,(SELECT count(*)::text FROM launches WHERE chain_id=$1) tracked_launches",
    [manifest.chainId],
  );
  const databaseSizeBytes = Number(databaseStats?.database_size_bytes ?? "0");
  const now = Date.now();
  const dailyGrowthBytes = databaseSizeObservation
    ? Math.max(
        0,
        Math.round(
          ((databaseSizeBytes - databaseSizeObservation.bytes) * 86_400_000) /
            Math.max(1, now - databaseSizeObservation.at),
        ),
      )
    : 0;
  databaseSizeObservation = { bytes: databaseSizeBytes, at: now };
  const cycleMs = Math.round((performance.now() - began) * 100) / 100;
  process.stdout.write(
    JSON.stringify({
      level: "info",
      event: "sync",
      head: head.toString(),
      checkpoint,
      rangeCount,
      logCount,
      addressQueryCount,
      poolQueryCount,
      cycleMs,
    }) + "\n",
  );
  return {
    ...ingestionCycleResult(head, checkpoint, rangeCount, logCount, cycleMs),
    indexingScopeVersion: indexingPolicy.version,
    indexingScopeHash: indexingPolicy.policyHash,
    trackedLaunches: Number(databaseStats?.tracked_launches ?? "0"),
    trackedAddresses: scope.addresses.length,
    trackedPoolIds: scope.poolIds.length,
    retainedLogs: Number(databaseStats?.retained_logs ?? "0"),
    excludedGlobalSources: [
      "WETH",
      "Permit2",
      "PositionManager",
      "UniversalRouter",
      "stockTokens",
      "unfilteredPoolManager",
    ],
    addressQueryCount,
    poolQueryCount,
    databaseSizeBytes,
    dailyGrowthBytes,
    estimatedDiskRunwayDays:
      dailyGrowthBytes > 0
        ? Math.floor(diskAvailableBytes / dailyGrowthBytes)
        : null,
    diskTotalBytes,
    diskAvailableBytes,
    diskUtilizationPercent: Math.round(diskUtilizationPercent * 100) / 100,
    diskAlertThresholdsPercent: [60, 75, diskBackfillDisablePercent],
    backfillsEnabled: diskUtilizationPercent < diskBackfillDisablePercent,
  };
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
      await tx.unsafe("DELETE FROM keeper_scan_requests WHERE chain_id=$1", [
        manifest.chainId,
      ]);
      await tx.unsafe("DELETE FROM reward_stream_events WHERE chain_id=$1", [
        manifest.chainId,
      ]);
      await tx.unsafe(
        "DELETE FROM governance_control_events WHERE chain_id=$1",
        [manifest.chainId],
      );
      await tx.unsafe(
        "DELETE FROM indexer_checkpoints WHERE service IN ('launch-projector','king-of-forest-projector','reward-stream-projector','schema18-governance-projector') AND chain_id=$1",
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
  let projectedRewardEvents = 0;
  let projectedGovernanceEvents = 0;
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
        projectedRewardEvents = await projectRewardStreams(
          BigInt(ingested.last_block),
        );
        projectedGovernanceEvents = await projectSchema19Governance(
          BigInt(ingested.last_block),
        );
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
          await tx.unsafe(
            `WITH relevant_events AS (
              SELECT
                x.token,
                l.block_number,
                l.transaction_hash,
                l.transaction_index,
                l.log_index,
                CASE
                  WHEN lower(l.address) IN (
                    lower(x.token),
                    lower(x.vault),
                    lower(x.market),
                    lower(coalesce(x.adapter, '')),
                    lower(coalesce(x.locker, ''))
                  ) THEN 'launch-address'
                  WHEN x.pool_id IS NOT NULL
                    AND lower(l.topics->>1) = lower(x.pool_id) THEN 'pool-event'
                  ELSE 'indexed-token'
                END reason
              FROM raw_logs l
              JOIN launches x ON x.chain_id = l.chain_id
              WHERE l.chain_id = $1
                AND l.block_number BETWEEN $2 AND $3
                AND (
                  lower(l.address) IN (
                    lower(x.token),
                    lower(x.vault),
                    lower(x.market),
                    lower(coalesce(x.adapter, '')),
                    lower(coalesce(x.locker, ''))
                  )
                  OR (
                    x.pool_id IS NOT NULL
                    AND lower(l.topics->>1) = lower(x.pool_id)
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(l.topics) topic(value)
                    WHERE lower(topic.value) =
                      lower('0x' || repeat('0', 24) || substr(x.token, 3))
                  )
                )
            ),
            latest AS (
              SELECT DISTINCT ON (token)
                token,
                block_number,
                transaction_hash,
                log_index
              FROM relevant_events
              ORDER BY
                token,
                block_number DESC,
                transaction_index DESC,
                log_index DESC
            ),
            aggregated AS (
              SELECT
                token,
                count(*)::bigint trigger_count,
                to_jsonb(array_agg(DISTINCT reason)) reasons,
                jsonb_agg(
                  jsonb_build_object(
                    'blockNumber', block_number::text,
                    'transactionHash', transaction_hash,
                    'logIndex', log_index
                  )
                  ORDER BY block_number, transaction_index, log_index
                ) trigger_log_identities
              FROM relevant_events
              GROUP BY token
            )
            INSERT INTO keeper_scan_requests (
              chain_id,
              token,
              status,
              first_block,
              highest_block,
              last_transaction_hash,
              last_log_index,
              trigger_count,
              reasons,
              trigger_log_identities
            )
            SELECT
              $1,
              latest.token,
              'pending',
              latest.block_number,
              latest.block_number,
              latest.transaction_hash,
              latest.log_index,
              aggregated.trigger_count,
              aggregated.reasons,
              aggregated.trigger_log_identities
            FROM latest
            JOIN aggregated USING (token)
            ON CONFLICT (chain_id, token) DO UPDATE SET
              status = 'pending',
              first_block = least(
                keeper_scan_requests.first_block,
                EXCLUDED.first_block
              ),
              highest_block = greatest(
                keeper_scan_requests.highest_block,
                EXCLUDED.highest_block
              ),
              last_transaction_hash = CASE
                WHEN EXCLUDED.highest_block >
                  keeper_scan_requests.highest_block
                  OR (
                    EXCLUDED.highest_block =
                      keeper_scan_requests.highest_block
                    AND EXCLUDED.last_log_index >=
                      keeper_scan_requests.last_log_index
                  )
                  THEN EXCLUDED.last_transaction_hash
                ELSE keeper_scan_requests.last_transaction_hash
              END,
              last_log_index = CASE
                WHEN EXCLUDED.highest_block >
                  keeper_scan_requests.highest_block
                  OR (
                    EXCLUDED.highest_block =
                      keeper_scan_requests.highest_block
                    AND EXCLUDED.last_log_index >=
                      keeper_scan_requests.last_log_index
                  )
                  THEN EXCLUDED.last_log_index
                ELSE keeper_scan_requests.last_log_index
              END,
              trigger_count =
                keeper_scan_requests.trigger_count + EXCLUDED.trigger_count,
              reasons = (
                SELECT coalesce(jsonb_agg(DISTINCT value), '[]'::jsonb)
                FROM jsonb_array_elements(
                  keeper_scan_requests.reasons || EXCLUDED.reasons
                ) reason(value)
              ),
              trigger_log_identities = (
                SELECT coalesce(jsonb_agg(value ORDER BY ord), '[]'::jsonb)
                FROM (
                  SELECT value, max(ord) ord
                  FROM jsonb_array_elements(
                    keeper_scan_requests.trigger_log_identities ||
                      EXCLUDED.trigger_log_identities
                  ) WITH ORDINALITY identity(value, ord)
                  GROUP BY value
                  ORDER BY max(ord) DESC
                  LIMIT 64
                ) bounded
              ),
              retry_after = now(),
              last_error = NULL,
              completed_at = NULL,
              updated_at = now()`,
            [
              manifest.chainId,
              window.fromBlock.toString(),
              window.toBlock.toString(),
            ],
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
              "DELETE FROM keeper_scan_requests WHERE chain_id=$1",
              [manifest.chainId],
            );
            await tx.unsafe(
              "DELETE FROM reward_stream_events WHERE chain_id=$1",
              [manifest.chainId],
            );
            await tx.unsafe(
              "DELETE FROM governance_control_events WHERE chain_id=$1",
              [manifest.chainId],
            );
            await tx.unsafe(
              "DELETE FROM indexer_checkpoints WHERE service IN ('launch-projector','king-of-forest-projector','reward-stream-projector','schema18-governance-projector') AND chain_id=$1",
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
    projectedRewardEvents = await projectRewardStreams(
      BigInt(ingested.last_block),
    );
    projectedGovernanceEvents = await projectSchema19Governance(
      BigInt(ingested.last_block),
    );
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
      projectedRewardEvents,
      projectedGovernanceEvents,
      cycleMs,
    }) + "\n",
  );
  return {
    checkpoint: ingested.last_block,
    projectedLaunches,
    projectedRewardEvents,
    projectedGovernanceEvents,
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

async function runIngesterPipeline() {
  let fullSyncEstimatedComputeUnits = 0;
  let idleReconciliationEstimatedComputeUnits = 0;
  let headObservationCount = 0;
  let completedSyncCycles = 0;
  let failures = 0;
  let rpcRetryCount = 0;
  let lastRpcDegradationAt: string | null = null;
  if (
    !Number.isSafeInteger(ingesterHeartbeatMs) ||
    ingesterHeartbeatMs <= 0 ||
    ingesterHeartbeatMs > reconciliationMs ||
    maximumObservedLagBlocks <= 0n
  ) {
    throw new Error("Indexer heartbeat and observed-lag policy are invalid");
  }
  if (wakeRpcUrl) {
    filteredLogWakeClient = new FilteredLogWakeClient({
      url: wakeRpcUrl,
      addresses: (await currentIndexedScope()).addresses,
      onNotification: () => debouncedIngesterWake.notify(),
    });
    filteredLogWakeClient.start();
  }
  while (!stopping) {
    try {
      const result = await syncOnce();
      fullSyncEstimatedComputeUnits +=
        40 + result.rangeCount * 80 + result.logCount * 20;
      idleReconciliationEstimatedComputeUnits += 40 + result.rangeCount * 80;
      completedSyncCycles += 1;
      failures = 0;
      if (filteredLogWakeClient) {
        filteredLogWakeClient.updateAddresses(
          (await currentIndexedScope()).addresses,
        );
      }
      const heartbeatMetadata = {
        ...result,
        rpcRetryCount,
        lastRpcDegradationAt,
        wakeMode: filteredLogWakeClient
          ? "filtered-logs-websocket"
          : "reconciliation-only",
        reconciliationMs,
        rpcRequestsByMethod: {
          eth_blockNumber:
            Math.ceil(fullSyncEstimatedComputeUnits / 120) +
            headObservationCount,
          eth_getBlockByNumber: Math.ceil(fullSyncEstimatedComputeUnits / 120),
          eth_getLogs: Math.ceil(fullSyncEstimatedComputeUnits / 120),
        },
        estimatedCu: fullSyncEstimatedComputeUnits + headObservationCount * 10,
        projectedDailyCu: Math.round(
          (idleReconciliationEstimatedComputeUnits / completedSyncCycles) *
            (86_400_000 / reconciliationMs) +
            10 * (86_400_000 / ingesterHeartbeatMs),
        ),
        webSocket: filteredLogWakeClient?.snapshot() ?? null,
        heartbeatOnly: false,
      };
      await recordHeartbeat("chain-ingester", "ok", heartbeatMetadata);
      if (!stopping) {
        const reconciliationDeadline = performance.now() + reconciliationMs;
        while (!stopping) {
          const remainingMs = Math.ceil(
            reconciliationDeadline - performance.now(),
          );
          if (remainingMs <= 0) break;
          const wakeReason = await ingesterWake.wait(
            Math.min(remainingMs, ingesterHeartbeatMs),
          );
          if (wakeReason === "event") break;
          if (performance.now() >= reconciliationDeadline) break;
          const observedHead = await client.getBlockNumber();
          headObservationCount += 1;
          await recordHeartbeat("chain-ingester", "ok", {
            ...heartbeatMetadata,
            observedHead: observedHead.toString(),
            observedAt: new Date().toISOString(),
            rpcRequestsByMethod: {
              ...heartbeatMetadata.rpcRequestsByMethod,
              eth_blockNumber:
                heartbeatMetadata.rpcRequestsByMethod.eth_blockNumber +
                headObservationCount,
            },
            estimatedCu:
              fullSyncEstimatedComputeUnits + headObservationCount * 10,
            projectedDailyCu: Math.round(
              (idleReconciliationEstimatedComputeUnits / completedSyncCycles) *
                (86_400_000 / reconciliationMs) +
                10 * (86_400_000 / ingesterHeartbeatMs),
            ),
            webSocket: filteredLogWakeClient?.snapshot() ?? null,
            heartbeatOnly: true,
          });
          if (
            result.checkpoint === null ||
            observedLagRequiresSync(
              observedHead,
              BigInt(result.checkpoint),
              maximumObservedLagBlocks,
            )
          )
            break;
        }
      }
    } catch (error) {
      failures += 1;
      rpcRetryCount += 1;
      lastRpcDegradationAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      await recordHeartbeat("chain-ingester", "degraded", {
        consecutiveFailures: failures,
        rpcRetryCount,
        lastRpcDegradationAt,
        error: message.slice(0, 1_000),
        wakeMode: filteredLogWakeClient
          ? "filtered-logs-websocket"
          : "reconciliation-only",
        reconciliationMs,
        webSocket: filteredLogWakeClient?.snapshot() ?? null,
      }).catch(() => undefined);
      process.stderr.write(
        JSON.stringify({
          level: "error",
          event: "chain-ingester_failed",
          consecutiveFailures: failures,
          message,
        }) + "\n",
      );
      if (failures >= maximumConsecutiveFailures) {
        throw new Error(
          `chain-ingester remained unhealthy for ${failures} polls`,
        );
      }
    }
    if (stopping) break;
    if (failures > 0) {
      await sleep(failureBackoffMs(reconciliationMs, failures - 1));
    }
  }
  filteredLogWakeClient?.stop();
}

process.on("SIGTERM", () => {
  stopping = true;
  debouncedIngesterWake.cancel();
  filteredLogWakeClient?.stop();
  ingesterWake.trigger();
});
process.on("SIGINT", () => {
  stopping = true;
  debouncedIngesterWake.cancel();
  filteredLogWakeClient?.stop();
  ingesterWake.trigger();
});

const pipelines: Promise<void>[] = [];
if (role === "ingester" || role === "combined") {
  pipelines.push(runIngesterPipeline());
}
if (role === "projector" || role === "combined") {
  pipelines.push(
    runPipeline("launch-projector", projectorPollMs, async () => projectOnce()),
  );
}
await Promise.all(pipelines);
await sql.end();
