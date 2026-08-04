import { createHash } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { Redis } from "ioredis";
import { readFile } from "node:fs/promises";
import { createDatabase } from "@robyn/db";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
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
import { registerCampaignRoutes } from "./campaign-routes.js";
import {
  KeyedStaleWhileRevalidateCache,
  SingleFlightTtlCache,
} from "./single-flight-cache.js";
import {
  AssetCatalogService,
  type AssetCatalogManifest,
} from "./asset-catalog.js";
import { rewardStreamConservation } from "./reward-conservation.js";
import { projectionCheckpointsHealthy } from "./projection-health.js";
import {
  keeperExpectedFromEnvironment,
  keeperExpectedForSchema,
  keeperHealthSatisfied,
  keeperStatusForHealth,
} from "./service-health.js";

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
const configuredKeeperExpected = keeperExpectedFromEnvironment(
  process.env.ROBYN_KEEPER_EXPECTED,
);
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
const rpcFailoverStatusFile =
  process.env.ROBYN_RPC_FAILOVER_STATUS_FILE?.trim() || null;
const rpcClient = createPublicClient({
  transport: http(
    process.env.ROBYN_OPERATOR_RPC_URL ?? "http://127.0.0.1:8545",
    {
      retryCount: Number(process.env.ROBYN_RPC_RETRY_COUNT ?? "2"),
      retryDelay: Number(process.env.ROBYN_RPC_RETRY_DELAY_MS ?? "500"),
      timeout: Number(process.env.ROBYN_RPC_TIMEOUT_MS ?? "5000"),
    },
  ),
});
const zeroAddress = "0x0000000000000000000000000000000000000000";
const deployment = JSON.parse(
  await readFile(
    process.env.ROBYN_MANIFEST ?? "/home/hendo420/Robyn/deployments/31337.json",
    "utf8",
  ),
) as {
  schemaVersion?: number;
  liquidityVenue?: "uniswap-v4" | "uniswap-v3";
  venueProvenance?: string;
  venueManifestSha256?: string;
  rewardStreams?: {
    launchTokenDurationSeconds?: number;
    daoDurationSeconds?: number;
    creatorDurationSeconds?: number;
    release?: string;
  };
  assetRoutes?: Array<{
    symbol: string;
    address: Address;
    poolId: `0x${string}`;
    fee: number;
    tickSpacing: number;
    hook: Address;
  }>;
  deploymentBlock: number;
  kingOfForestPolicy?: {
    version: string;
    activationBlock: number;
    progressThresholdBps: number;
    minimumUniqueTraders: number;
  };
  maintenancePolicy?: {
    tasksPerUserAction: 1;
    taskGasLimit: string;
    failureObservationSpacingSeconds: number;
    fallbackDelaySeconds: number;
    fallbackAsset: Address;
  };
  contracts: {
    baseAsset?: Address;
    conversionRouter?: Address;
    routeRegistry?: Address;
    marketFactory: Address;
    atomicLaunchCoordinator?: Address;
    legacyMarketFactories?: Address[];
    daoToken: Address;
    governor: Address;
    timelock: Address;
    guardian: Address;
    protocolFeeRouter: Address;
    nativeFeeConverter: Address;
    poolManager?: Address;
    positionManager?: Address;
    quoter?: Address;
    stateView?: Address;
    oracleHook?: Address;
    assetRouter?: Address;
    maintenanceCoordinator?: Address;
    claimsRouter?: Address;
    tradeRouter?: Address;
    daoRewardDistributor?: Address;
    tokenSink?: Address;
  };
  ipfsMetadata?: {
    tokenListCid?: string | null;
    tokenListUri?: string | null;
    tokenListStablePath?: string;
  };
  assetCatalog?: AssetCatalogManifest;
};
const keeperExpected = keeperExpectedForSchema(
  deployment.schemaVersion,
  configuredKeeperExpected,
);
const multicall3Address =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const multicall3RuntimeSha256 =
  "2756d7c52baee85cacb504f6ee1df7aad6809ac8d94a4a111d76991f90d36d6e";
const multicall3Abi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)",
  "function getEthBalance(address address_) view returns (uint256 balance)",
]);
const multicall3Code = await rpcClient.getCode({ address: multicall3Address });
const multicall3Verified = Boolean(
  multicall3Code &&
  createHash("sha256")
    .update(Buffer.from(multicall3Code.slice(2), "hex"))
    .digest("hex") === multicall3RuntimeSha256,
);
if ((chainId === 46630 || chainId === 4663) && !multicall3Verified) {
  throw new Error("API Multicall3 runtime verification failed");
}
let protocolAuditEstimatedCu = 0;
let protocolAuditCompletedRuns = 0;
let protocolAuditMulticallFallbacks = 0;

type BatchRead = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

async function verifiedBatchRead(calls: BatchRead[], blockNumber: bigint) {
  const encoded = calls.map((call) => ({
    target: call.address,
    allowFailure: false,
    callData: encodeFunctionData(call as never),
  }));
  let returnData: readonly Hex[];
  try {
    if (!multicall3Verified) throw new Error("Multicall3 is unavailable");
    const callData = encodeFunctionData({
      abi: multicall3Abi,
      functionName: "aggregate3",
      args: [encoded],
    });
    const response = await rpcClient.call({
      to: multicall3Address,
      data: callData,
      blockNumber,
    });
    if (!response.data) throw new Error("Multicall3 returned no audit data");
    const result = decodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      data: response.data,
    }) as readonly { success: boolean; returnData: Hex }[];
    protocolAuditEstimatedCu += 26;
    if (result.some((entry) => !entry.success)) {
      throw new Error("Verified Multicall3 returned a failed audit read");
    }
    returnData = result.map((entry) => entry.returnData);
  } catch (error) {
    if (calls.length > 64) throw error;
    protocolAuditMulticallFallbacks += 1;
    returnData = await Promise.all(
      encoded.map(async (call) => {
        const response = await rpcClient.call({
          to: call.target,
          data: call.callData,
          blockNumber,
        });
        if (!response.data)
          throw new Error("Fallback audit read returned no data");
        return response.data;
      }),
    );
    protocolAuditEstimatedCu += calls.length * 26;
  }
  return returnData.map((data, index) => {
    const call = calls[index]!;
    return decodeFunctionResult({
      abi: call.abi,
      functionName: call.functionName,
      data,
    } as never);
  });
}

const remediationRouterAbi = parseAbi([
  "function totalNativeLiabilities() view returns (uint256)",
  "function totalCreatorNativeLiability() view returns (uint256)",
  "function unattributedNative() view returns (uint256)",
  "function creatorRewardStream(address token,address recipient) view returns ((uint256 claimable,uint256 unvested,uint256 assigned,uint256 vested,uint256 claimed,uint256 ratePerSecond,uint256 lastUpdateTime,uint256 streamEnd))",
]);
const remediationDaoAbi = parseAbi([
  "function totalRewardsDeposited() view returns (uint256)",
  "function totalRewardsClaimed() view returns (uint256)",
  "function totalRewardsVested() view returns (uint256)",
  "function queuedRewards() view returns (uint256)",
  "function streamingRewards() view returns (uint256)",
  "function rewardAccountingState() view returns (uint256 deposited,uint256 vested,uint256 unvested,uint256 claimed,uint256 queued,uint256 roundingCarry,uint256 available,uint256 outstanding,uint256 surplus,uint256 deficit)",
]);
const remediationMarketAbi = parseAbi([
  "function graduated() view returns (bool)",
]);
const remediationHookAbi = parseAbi([
  "function poolPhase(bytes32) view returns (uint8)",
]);
const remediationLockerAbi = parseAbi([
  "function principalNativeResidual() view returns (uint256)",
  "function principalTokenResidual() view returns (uint256)",
  "function pendingCollectedNativeFees() view returns (uint256)",
  "function pendingCollectedTokenFees() view returns (uint256)",
  "function unattributedNative() view returns (uint256)",
  "function unattributedLaunchTokens() view returns (uint256)",
]);
const balanceOfAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);
const remediationLaunchTokenAbi = parseAbi([
  "function rewardAssetCount() view returns (uint256)",
  "function pendingWithoutSupply(uint256) view returns (uint256)",
  "function totalRewardsReceived(uint256) view returns (uint256)",
  "function streamingRewards(uint256) view returns (uint256)",
  "function totalRewardsVested(uint256) view returns (uint256)",
]);
const schema19VaultAbi = parseAbi([
  "function legCount() view returns (uint256)",
  "function leg(uint256) view returns ((address asset,uint16 weightBps,uint256 pendingNative,uint256 consumedNative,uint256 rewardsDeposited,uint256 pendingSince,uint256 fallbackNativeConsumed,uint256 fallbackRewardsDeposited,uint8 failureObservations,uint64 firstFailureAt,uint64 lastFailureAt,bytes32 lastFailureReason))",
  "function fallbackAsset() view returns (address)",
  "function fallbackRewardIndex() view returns (uint8)",
  "function failureObservationSpacing() view returns (uint256)",
  "function fallbackDelay() view returns (uint256)",
  "function nextLegCursor() view returns (uint8)",
  "function totalFeesReceived() view returns (uint256)",
  "function totalNativeConsumed() view returns (uint256)",
  "function totalPendingNative() view returns (uint256)",
]);
const schema19MaintenanceAbi = parseAbi([
  "function nextTask(address token) view returns (uint8)",
  "function attemptCount(address token) view returns (uint256)",
  "function successCount(address token) view returns (uint256)",
]);

const assetCatalog = new AssetCatalogService(
  rpcClient,
  chainId,
  deployment.contracts.baseAsset ?? (zeroAddress as Address),
  deployment.contracts.assetRouter ??
    deployment.contracts.routeRegistry ??
    deployment.contracts.conversionRouter,
  deployment.assetCatalog,
);
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
    name: "nativePerToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
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
    name: "graduationThresholdNative",
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
    name: "nativeRaised",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "poolId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "realCurveTokenReserve",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
const v4LockerViewAbi = [
  {
    type: "function",
    name: "positionTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "principalLiquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
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
  {
    type: "function",
    name: "currentGraduationProfile",
    stateMutability: "view",
    inputs: [],
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
] as const;
const launchCoordinatorViewAbi = [
  {
    type: "function",
    name: "launchMode",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "canaryLauncher",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;
const schema17TimelockViewAbi = [
  {
    type: "function",
    name: "getMinDelay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "bootstrapActive",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "bootstrapDeadline",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint48" }],
  },
  {
    type: "function",
    name: "nextBootstrapStep",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "bootstrapFinalized",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "bootstrapFinalizationReason",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "bootstrapPlanHash",
    stateMutability: "view",
    inputs: [{ type: "uint8" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;
const schema17GovernorViewAbi = [
  {
    type: "function",
    name: "votingDelay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "votingPeriod",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "proposalThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quorumNumerator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "unanimousNonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
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
  graduation_profile_version: string | null;
  target_graduation_native: string | null;
  actual_graduation_native: string | null;
  maximum_curve_purchase: string | null;
  initial_virtual_native_reserve: string | null;
  terminal_native_per_token_x18: string | null;
  terminal_sqrt_price_x96: string | null;
  graduation_profile_hash: string | null;
  campaign_id: string | null;
  campaign_release_sha: string | null;
  automated_test_launch: boolean;
  pool_id: string | null;
};

type DiscoveryMetricLog = AnalyticsLog & { launch_token: string };

const analyticsEventTopics = [
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  "0xedba86fd2b22962d534e70ad9b0ff8730de46f636146f2bab6a72cbb1ebbcc53",
  "0xe029f26dbcf8c42dd2f352c10214a7fc26773dc62482c6241334a0402ac09a80",
  "0x8e35909329327a37503200dfcee9d7ab5d6bfa455eeda068210182468f9d4b59",
  "0xcb64f2436060c9575db20c5dcf9cdc11657017ee5b0301949f531b3dd7da6b19",
  "0x8d0453dc55ff49f0c8c7ca816943faff3ced84a6a1a9b3831f8bcf12b4d700c3",
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
  "0xa5c83464d6124f18b54a3ee18b226e2fd57959f9b2b5e862f8142d6332b74493",
  "0x4867cbb119af3e45df01db401a69825a79a97a50984b1ddaca56f25b51c17d85",
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

type KingStateRow = {
  token: string;
  progress_bps: number | null;
  market_phase: "bonding" | "graduated" | null;
  unique_traders: string;
  awarded_block: string | null;
  awarded_transaction_hash: string | null;
  awarded_transaction_index: number | null;
  awarded_log_index: number | null;
  awarded_at: string | null;
  awarded_progress_bps: number | null;
  awarded_unique_traders: number | null;
  awarded_market_phase: "bonding" | "graduated" | null;
  policy_version: string | null;
  is_current: boolean;
};

async function kingStateMap(tokens: string[]) {
  if (tokens.length === 0) return new Map<string, KingStateRow>();
  const rows = await sql.unsafe<KingStateRow[]>(
    "WITH current_king AS (SELECT token FROM king_of_forest_awards WHERE chain_id=$1 ORDER BY awarded_block DESC,awarded_transaction_index DESC,awarded_log_index DESC,token DESC LIMIT 1), trader_counts AS (SELECT token,count(*)::text unique_traders FROM launch_traders WHERE chain_id=$1 AND token=ANY($2::text[]) GROUP BY token) SELECT requested.token,p.progress_bps,p.market_phase,coalesce(tc.unique_traders,'0') unique_traders,a.awarded_block::text,a.awarded_transaction_hash,a.awarded_transaction_index,a.awarded_log_index,a.awarded_at::text,a.progress_bps awarded_progress_bps,a.unique_traders awarded_unique_traders,a.market_phase awarded_market_phase,a.policy_version,(ck.token IS NOT NULL) is_current FROM unnest($2::text[]) requested(token) LEFT JOIN king_of_forest_progress p ON p.chain_id=$1 AND p.token=requested.token LEFT JOIN trader_counts tc ON tc.token=requested.token LEFT JOIN king_of_forest_awards a ON a.chain_id=$1 AND a.token=requested.token LEFT JOIN current_king ck ON ck.token=requested.token",
    [chainId, tokens.map((token) => token.toLowerCase())],
  );
  return new Map(rows.map((row) => [row.token.toLowerCase(), row]));
}

function kingOfForestView(row: KingStateRow | undefined) {
  const policy = deployment.kingOfForestPolicy ?? null;
  return {
    awarded: row?.awarded_block !== null && row?.awarded_block !== undefined,
    isCurrent: row?.is_current ?? false,
    awardedAt: row?.awarded_at ?? null,
    awardedBlock: row?.awarded_block ?? null,
    qualifyingTransactionHash: row?.awarded_transaction_hash ?? null,
    qualifyingTransactionIndex: row?.awarded_transaction_index ?? null,
    qualifyingLogIndex: row?.awarded_log_index ?? null,
    progressBps: row?.progress_bps ?? 0,
    uniqueTraders: Number(row?.unique_traders ?? "0"),
    progressBpsAtAward: row?.awarded_progress_bps ?? null,
    uniqueTradersAtAward: row?.awarded_unique_traders ?? null,
    marketPhaseAtAward: row?.awarded_market_phase ?? null,
    policyVersion: row?.policy_version ?? policy?.version ?? null,
  };
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
      project_website: string | null;
      project_x_url: string | null;
    }>
  >(
    "SELECT b.token,b.media_id,b.metadata_cid,b.metadata_uri,b.verification_status,b.project_website,b.project_x_url,m.status media_status,m.canonical_png_cid,m.optimized_webp_cid,p.display_name,p.bio,p.website,p.x_url,p.telegram_url,p.discord_url,p.avatar_media_id FROM launch_metadata_bindings b JOIN media_assets m ON m.media_id=b.media_id LEFT JOIN creator_profiles p ON p.chain_id=b.chain_id AND p.address=b.creator_address WHERE b.chain_id=$1 AND b.token=ANY($2::text[])",
    [chainId, tokens],
  );
  return new Map(rows.map((row) => [row.token.toLowerCase(), row]));
}

type MarketConfiguration = {
  basePerToken: bigint;
  feeBps: number;
  protocolFeeBps: number;
  lpFeeBps: number;
  marketPhase: "legacy_fixed" | "bonding" | "graduated";
  graduationProgressBps: number;
  graduationThresholdBase: bigint;
  baseRaised: bigint;
  remainingCurveTokens: bigint;
  graduatedPool: Address | null;
  liquidityVenue: "uniswap-v4" | "uniswap-v3" | "devnet-locked-pool" | null;
  poolManager: Address | null;
  poolId: `0x${string}` | null;
  hook: Address | null;
  positionLocker: Address | null;
  positionTokenId: bigint | null;
  poolFeePips: number | null;
};
const tokenSupply = new Map<string, Promise<bigint>>();

async function getMarketConfiguration(
  market: Address,
): Promise<MarketConfiguration> {
  if (deployment.liquidityVenue === "uniswap-v4") {
    const [
      nativePerToken,
      feeBps,
      graduated,
      progress,
      threshold,
      raised,
      remaining,
      poolId,
      locker,
    ] = await Promise.all([
      rpcClient.readContract({
        address: market,
        abi: marketViewAbi,
        functionName: "nativePerToken",
      }),
      rpcClient.readContract({
        address: market,
        abi: marketViewAbi,
        functionName: "feeBps",
      }),
      rpcClient.readContract({
        address: market,
        abi: marketViewAbi,
        functionName: "graduated",
      }),
      rpcClient.readContract({
        address: market,
        abi: marketViewAbi,
        functionName: "graduationProgressBps",
      }),
      rpcClient.readContract({
        address: market,
        abi: marketViewAbi,
        functionName: "graduationThresholdNative",
      }),
      rpcClient.readContract({
        address: market,
        abi: marketViewAbi,
        functionName: "nativeRaised",
      }),
      rpcClient.readContract({
        address: market,
        abi: marketViewAbi,
        functionName: "realCurveTokenReserve",
      }),
      rpcClient.readContract({
        address: market,
        abi: marketViewAbi,
        functionName: "poolId",
      }),
      rpcClient.readContract({
        address: market,
        abi: marketViewAbi,
        functionName: "positionLocker",
      }),
    ]);
    const positionTokenId = await rpcClient.readContract({
      address: locker,
      abi: v4LockerViewAbi,
      functionName: "positionTokenId",
    });
    return {
      basePerToken: nativePerToken,
      feeBps: Number(feeBps),
      protocolFeeBps: 100,
      lpFeeBps: graduated ? 100 : 0,
      marketPhase: graduated ? "graduated" : "bonding",
      graduationProgressBps: Number(progress),
      graduationThresholdBase: threshold,
      baseRaised: raised,
      remainingCurveTokens: remaining,
      graduatedPool: null,
      liquidityVenue: "uniswap-v4",
      poolManager: deployment.contracts.poolManager ?? null,
      poolId,
      hook: deployment.contracts.oracleHook ?? null,
      positionLocker: locker,
      positionTokenId: positionTokenId === 0n ? null : positionTokenId,
      poolFeePips: 10_000,
    };
  }
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
      protocolFeeBps: Number(feeBps),
      lpFeeBps: 0,
      marketPhase: graduated ? "graduated" : "bonding",
      graduationProgressBps: Number(progress),
      graduationThresholdBase: threshold,
      baseRaised: raised,
      remainingCurveTokens: remaining,
      graduatedPool,
      liquidityVenue,
      poolManager: null,
      poolId: null,
      hook: null,
      positionLocker,
      positionTokenId,
      poolFeePips,
    };
  } catch {
    return {
      basePerToken,
      feeBps: Number(feeBps),
      protocolFeeBps: Number(feeBps),
      lpFeeBps: 0,
      marketPhase: "legacy_fixed",
      graduationProgressBps: 10_000,
      graduationThresholdBase: 0n,
      baseRaised: 0n,
      remainingCurveTokens: 0n,
      graduatedPool: null,
      liquidityVenue: null,
      poolManager: null,
      poolId: null,
      hook: null,
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
            ?.poolManager?.toLowerCase() ??
          configurations
            .get(row.token.toLowerCase())
            ?.graduatedPool?.toLowerCase() ??
          zeroAddress,
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
      const baseAssetAddress =
        config.liquidityVenue === "uniswap-v4"
          ? (zeroAddress as Address)
          : await rpcClient.readContract({
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
        config.liquidityVenue === "uniswap-v4"
          ? rpcClient.getBalance({ address: activeLiquidityAddress })
          : rpcClient.readContract({
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
          ...(config.poolManager && config.poolId
            ? { poolManager: config.poolManager, poolId: config.poolId }
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

const discoveryMetricsCache = new KeyedStaleWhileRevalidateCache<
  string,
  Map<string, ReturnType<typeof deriveLaunchAnalytics>>
>(60_000, 600_000, 4);

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
  const [checkpoints, heartbeats] = await Promise.all([
    sql.unsafe<{ service: string; last_block: string; updated_at: string }[]>(
      "SELECT service,last_block::text,updated_at::text FROM indexer_checkpoints WHERE service IN ('chain-indexer','launch-projector','king-of-forest-projector','reward-stream-projector') AND chain_id=$1",
      [chainId],
    ),
    sql.unsafe<
      {
        service: string;
        status: string;
        metadata: Record<string, unknown>;
        fresh: boolean;
      }[]
    >(
      "SELECT service,status,metadata,(updated_at > now() - interval '30 seconds') fresh FROM service_heartbeats WHERE service IN ('chain-ingester','launch-projector')",
    ),
  ]);
  const ingestion = checkpoints.find(
    (checkpoint) => checkpoint.service === "chain-indexer",
  );
  const projection = checkpoints.find(
    (checkpoint) => checkpoint.service === "launch-projector",
  );
  const kingProjection = checkpoints.find(
    (checkpoint) => checkpoint.service === "king-of-forest-projector",
  );
  const rewardProjection = checkpoints.find(
    (checkpoint) => checkpoint.service === "reward-stream-projector",
  );
  const ingestionHeartbeat = heartbeats.find(
    (heartbeat) => heartbeat.service === "chain-ingester",
  );
  const projectionHeartbeat = heartbeats.find(
    (heartbeat) => heartbeat.service === "launch-projector",
  );
  const observedHead = String(
    ingestionHeartbeat?.metadata.observedHead ??
      ingestionHeartbeat?.metadata.head ??
      ingestionHeartbeat?.metadata.checkpoint ??
      ingestion?.last_block ??
      "0",
  );
  const ingestionBlock = BigInt(ingestion?.last_block ?? "0");
  const projectionBlock = BigInt(projection?.last_block ?? "0");
  const headBlock = BigInt(observedHead);
  const projectionCheckpointsOk = projectionCheckpointsHealthy({
    ingestionBlock,
    launchBlock: projection ? BigInt(projection.last_block) : undefined,
    kingBlock: kingProjection ? BigInt(kingProjection.last_block) : undefined,
    rewardBlock: rewardProjection
      ? BigInt(rewardProjection.last_block)
      : undefined,
    requireKing: Boolean(deployment.kingOfForestPolicy),
  });
  const lastDegradations = [
    ingestionHeartbeat?.metadata.lastRpcDegradationAt,
    projectionHeartbeat?.metadata.lastRpcDegradationAt,
  ]
    .filter((value): value is string => typeof value === "string")
    .sort();
  return {
    asOfBlock: ingestion?.last_block ?? null,
    observedHeadBlock: observedHead,
    indexedAt: ingestion?.updated_at ?? null,
    projectionAsOfBlock: projection?.last_block ?? null,
    kingProjectionAsOfBlock: kingProjection?.last_block ?? null,
    rewardProjectionAsOfBlock: rewardProjection?.last_block ?? null,
    kingProjectionLagBlocks: (ingestionBlock >
    BigInt(kingProjection?.last_block ?? "0")
      ? ingestionBlock - BigInt(kingProjection?.last_block ?? "0")
      : 0n
    ).toString(),
    rewardProjectionLagBlocks: (ingestionBlock >
    BigInt(rewardProjection?.last_block ?? "0")
      ? ingestionBlock - BigInt(rewardProjection?.last_block ?? "0")
      : 0n
    ).toString(),
    ingestionLagBlocks: (headBlock > ingestionBlock
      ? headBlock - ingestionBlock
      : 0n
    ).toString(),
    projectionLagBlocks: (ingestionBlock > projectionBlock
      ? ingestionBlock - projectionBlock
      : 0n
    ).toString(),
    ingestionCycleMs: Number(ingestionHeartbeat?.metadata.cycleMs ?? 0),
    projectionCycleMs: Number(projectionHeartbeat?.metadata.cycleMs ?? 0),
    indexerRpcRequestsByMethod:
      ingestionHeartbeat?.metadata.rpcRequestsByMethod ?? null,
    indexerEstimatedCu: Number(ingestionHeartbeat?.metadata.estimatedCu ?? 0),
    indexerProjectedDailyCu: Number(
      ingestionHeartbeat?.metadata.projectedDailyCu ?? 0,
    ),
    indexingScopeVersion: Number(
      ingestionHeartbeat?.metadata.indexingScopeVersion ?? 0,
    ),
    indexingScopeHash:
      typeof ingestionHeartbeat?.metadata.indexingScopeHash === "string"
        ? ingestionHeartbeat.metadata.indexingScopeHash
        : null,
    trackedLaunches: Number(ingestionHeartbeat?.metadata.trackedLaunches ?? 0),
    trackedAddresses: Number(
      ingestionHeartbeat?.metadata.trackedAddresses ?? 0,
    ),
    trackedPoolIds: Number(ingestionHeartbeat?.metadata.trackedPoolIds ?? 0),
    indexerAddressQueryCount: Number(
      ingestionHeartbeat?.metadata.addressQueryCount ?? 0,
    ),
    indexerPoolQueryCount: Number(
      ingestionHeartbeat?.metadata.poolQueryCount ?? 0,
    ),
    retainedLogs: Number(ingestionHeartbeat?.metadata.retainedLogs ?? 0),
    excludedGlobalSources:
      ingestionHeartbeat?.metadata.excludedGlobalSources ?? null,
    indexerDatabaseSizeBytes: Number(
      ingestionHeartbeat?.metadata.databaseSizeBytes ?? 0,
    ),
    indexerDailyGrowthBytes: Number(
      ingestionHeartbeat?.metadata.dailyGrowthBytes ?? 0,
    ),
    indexerEstimatedDiskRunwayDays:
      ingestionHeartbeat?.metadata.estimatedDiskRunwayDays ?? null,
    diskUtilizationPercent: Number(
      ingestionHeartbeat?.metadata.diskUtilizationPercent ?? 0,
    ),
    indexerBackfillsEnabled:
      ingestionHeartbeat?.metadata.backfillsEnabled === true,
    rpcRetryCount:
      Number(ingestionHeartbeat?.metadata.rpcRetryCount ?? 0) +
      Number(projectionHeartbeat?.metadata.rpcRetryCount ?? 0),
    lastRpcDegradationAt: lastDegradations.at(-1) ?? null,
    webSocketWake: ingestionHeartbeat?.metadata.webSocket ?? null,
    ingestionStatus:
      ingestionHeartbeat?.status === "ok" && ingestionHeartbeat.fresh
        ? "ok"
        : "degraded",
    projectionStatus:
      projectionHeartbeat?.status === "ok" &&
      projectionHeartbeat.fresh &&
      projectionCheckpointsOk
        ? "ok"
        : "degraded",
  };
}

async function keeperState() {
  const rows = await sql.unsafe<
    {
      status: string;
      updated_at: string;
      fresh: boolean;
      metadata: {
        queueCounts?: Record<string, number>;
        scanRequestCounts?: Record<string, number>;
        operatorBalanceWei?: string;
        minimumOperatorBalanceWei?: string;
        rpcRequestsByMethod?: Record<string, number>;
        estimatedCu?: number;
        fullScanCount?: number;
        eventScanCount?: number;
        tokensScanned?: number;
        lastFullReconciliationAt?: string | null;
        lastEventScanAt?: string | null;
        projectedDailyIdleCu?: number | null;
        projectedMonthlyCu?: number | null;
      } | null;
    }[]
  >(
    "SELECT status,updated_at::text,(updated_at > now() - interval '30 seconds') fresh,metadata FROM service_heartbeats WHERE service='conversion-keeper'",
  );
  const metadata = rows[0]?.metadata;
  return {
    keeperStatus:
      rows[0]?.status === "ok" && rows[0].fresh
        ? ("ok" as const)
        : ("degraded" as const),
    keeperUpdatedAt: rows[0]?.updated_at ?? null,
    keeperQueueCounts: metadata?.queueCounts ?? null,
    keeperScanRequestCounts: metadata?.scanRequestCounts ?? null,
    keeperRpcRequestsByMethod: metadata?.rpcRequestsByMethod ?? null,
    keeperEstimatedCu: metadata?.estimatedCu ?? null,
    keeperFullScanCount: metadata?.fullScanCount ?? null,
    keeperEventScanCount: metadata?.eventScanCount ?? null,
    keeperTokensScanned: metadata?.tokensScanned ?? null,
    keeperLastFullReconciliationAt: metadata?.lastFullReconciliationAt ?? null,
    keeperLastEventScanAt: metadata?.lastEventScanAt ?? null,
    keeperProjectedDailyIdleCu: metadata?.projectedDailyIdleCu ?? null,
    keeperProjectedMonthlyCu: metadata?.projectedMonthlyCu ?? null,
    keeperOperatorBalanceWei: metadata?.operatorBalanceWei ?? null,
    keeperMinimumOperatorBalanceWei:
      metadata?.minimumOperatorBalanceWei ?? null,
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
    state.projectionAsOfBlock !== null &&
    state.ingestionStatus === "ok" &&
    state.projectionStatus === "ok" &&
    keeperHealthSatisfied(keeperExpected, keeper.keeperStatus) &&
    artifact.artifactStatus === "ok";
  return reply.code(healthy ? 200 : 503).send({
    service: "robyn-api",
    status: healthy ? "ok" : "degraded",
    chainId,
    ...state,
    ...keeper,
    keeperExpected,
    keeperStatus: keeperStatusForHealth(keeperExpected, keeper.keeperStatus),
    ...artifact,
  });
});

async function remediationProtocolState() {
  if (
    (deployment.schemaVersion ?? 0) < 10 ||
    !deployment.contracts.oracleHook ||
    !deployment.contracts.tokenSink
  ) {
    return null;
  }
  const began = performance.now();
  const router = deployment.contracts.protocolFeeRouter;
  const daoToken = deployment.contracts.daoToken;
  const blockNumber = await rpcClient.getBlockNumber();
  protocolAuditEstimatedCu += 20;
  const launches = await sql.unsafe<
    {
      token: Address;
      market: Address;
      locker: Address;
      pool_id: Hex | null;
      reward_count: number;
    }[]
  >(
    "SELECT token,market,locker,pool_id,jsonb_array_length(assets)::integer reward_count FROM launches WHERE chain_id=$1 ORDER BY launch_id",
    [chainId],
  );
  const global = await verifiedBatchRead(
    [
      {
        address: router,
        abi: remediationRouterAbi,
        functionName: "totalNativeLiabilities",
      },
      {
        address: router,
        abi: remediationRouterAbi,
        functionName: "unattributedNative",
      },
      {
        address: router,
        abi: remediationRouterAbi,
        functionName: "totalCreatorNativeLiability",
      },
      {
        address: multicall3Address,
        abi: multicall3Abi,
        functionName: "getEthBalance",
        args: [router],
      },
      ...[
        "totalRewardsDeposited",
        "totalRewardsClaimed",
        "totalRewardsVested",
        "queuedRewards",
        "streamingRewards",
      ].map((functionName) => ({
        address: daoToken,
        abi: remediationDaoAbi,
        functionName,
      })),
      ...((deployment.schemaVersion ?? 0) >= 18
        ? [
            {
              address: daoToken,
              abi: remediationDaoAbi,
              functionName: "rewardAccountingState",
            } as BatchRead,
          ]
        : []),
    ],
    blockNumber,
  );
  const liabilities = global[0] as bigint;
  const unattributedNative = global[1] as bigint;
  const creatorLiability = global[2] as bigint;
  const routerBalance = global[3] as bigint;
  const daoDeposited = global[4] as bigint;
  const daoClaimed = global[5] as bigint;
  const daoVested = global[6] as bigint;
  const daoQueued = global[7] as bigint;
  const daoStreaming = global[8] as bigint;
  const daoAccounting =
    (deployment.schemaVersion ?? 0) >= 18
      ? (global[9] as readonly bigint[])
      : null;
  let launchControl: null | {
    mode: "Paused" | "Canary" | "Public";
    canaryLauncher: Address;
    currentProfile: {
      version: string;
      targetGraduationNative: string;
      actualGraduationNative: string;
      maximumCurvePurchase: string;
      initialVirtualNativeReserve: string;
      terminalNativePerTokenX18: string;
      terminalSqrtPriceX96: string;
    };
  } = null;
  if (
    (deployment.schemaVersion ?? 0) >= 13 &&
    deployment.contracts.atomicLaunchCoordinator
  ) {
    const control = await verifiedBatchRead(
      [
        {
          address: deployment.contracts.atomicLaunchCoordinator,
          abi: launchCoordinatorViewAbi,
          functionName: "launchMode",
        },
        {
          address: deployment.contracts.atomicLaunchCoordinator,
          abi: launchCoordinatorViewAbi,
          functionName: "canaryLauncher",
        },
        {
          address: deployment.contracts.marketFactory,
          abi: marketFactoryViewAbi,
          functionName: "currentGraduationProfile",
        },
      ],
      blockNumber,
    );
    const profile = control[2] as {
      version: bigint;
      targetGraduationNative: bigint;
      actualGraduationNative: bigint;
      maximumCurvePurchase: bigint;
      initialVirtualNativeReserve: bigint;
      terminalNativePerTokenX18: bigint;
      terminalSqrtPriceX96: bigint;
    };
    const mode = Number(control[0]);
    if (mode < 0 || mode > 2) throw new Error("invalid_launch_mode");
    launchControl = {
      mode: (["Paused", "Canary", "Public"] as const)[mode]!,
      canaryLauncher: control[1] as Address,
      currentProfile: {
        version: profile.version.toString(),
        targetGraduationNative: profile.targetGraduationNative.toString(),
        actualGraduationNative: profile.actualGraduationNative.toString(),
        maximumCurvePurchase: profile.maximumCurvePurchase.toString(),
        initialVirtualNativeReserve:
          profile.initialVirtualNativeReserve.toString(),
        terminalNativePerTokenX18: profile.terminalNativePerTokenX18.toString(),
        terminalSqrtPriceX96: profile.terminalSqrtPriceX96.toString(),
      },
    };
  }
  let bootstrapControl: null | {
    active: boolean;
    deadline: string;
    nextStep: number;
    finalized: boolean;
    finalizationReason: Hex;
    planHashes: [Hex, Hex];
    unanimousNonce: string;
    timelockDelaySeconds: string;
    votingDelaySeconds: string;
    votingPeriodSeconds: string;
    proposalThreshold: string;
    quorumNumerator: string;
  } = null;
  if ((deployment.schemaVersion ?? 0) >= 17) {
    const bootstrap = await verifiedBatchRead(
      [
        {
          address: deployment.contracts.timelock,
          abi: schema17TimelockViewAbi,
          functionName: "bootstrapActive",
        },
        {
          address: deployment.contracts.timelock,
          abi: schema17TimelockViewAbi,
          functionName: "bootstrapDeadline",
        },
        {
          address: deployment.contracts.timelock,
          abi: schema17TimelockViewAbi,
          functionName: "nextBootstrapStep",
        },
        {
          address: deployment.contracts.timelock,
          abi: schema17TimelockViewAbi,
          functionName: "bootstrapFinalized",
        },
        {
          address: deployment.contracts.timelock,
          abi: schema17TimelockViewAbi,
          functionName: "bootstrapFinalizationReason",
        },
        {
          address: deployment.contracts.timelock,
          abi: schema17TimelockViewAbi,
          functionName: "bootstrapPlanHash",
          args: [0],
        },
        {
          address: deployment.contracts.timelock,
          abi: schema17TimelockViewAbi,
          functionName: "bootstrapPlanHash",
          args: [1],
        },
        {
          address: deployment.contracts.timelock,
          abi: schema17TimelockViewAbi,
          functionName: "getMinDelay",
        },
        ...[
          "unanimousNonce",
          "votingDelay",
          "votingPeriod",
          "proposalThreshold",
          "quorumNumerator",
        ].map((functionName) => ({
          address: deployment.contracts.governor,
          abi: schema17GovernorViewAbi,
          functionName,
        })),
      ],
      blockNumber,
    );
    bootstrapControl = {
      active: bootstrap[0] as boolean,
      deadline: (bootstrap[1] as bigint).toString(),
      nextStep: Number(bootstrap[2]),
      finalized: bootstrap[3] as boolean,
      finalizationReason: bootstrap[4] as Hex,
      planHashes: [bootstrap[5] as Hex, bootstrap[6] as Hex],
      timelockDelaySeconds: (bootstrap[7] as bigint).toString(),
      unanimousNonce: (bootstrap[8] as bigint).toString(),
      votingDelaySeconds: (bootstrap[9] as bigint).toString(),
      votingPeriodSeconds: (bootstrap[10] as bigint).toString(),
      proposalThreshold: (bootstrap[11] as bigint).toString(),
      quorumNumerator: (bootstrap[12] as bigint).toString(),
    };
  }
  const creatorRecipients = await sql.unsafe<
    { token: Address; recipient: Address }[]
  >(
    "SELECT DISTINCT token,recipient FROM reward_stream_events WHERE chain_id=$1 AND category='creator' AND event_name='CreatorFeesAssigned' AND token IS NOT NULL AND recipient IS NOT NULL",
    [chainId],
  );
  const creatorStreams = creatorRecipients.length
    ? await verifiedBatchRead(
        creatorRecipients.map(({ token, recipient }) => ({
          address: router,
          abi: remediationRouterAbi,
          functionName: "creatorRewardStream",
          args: [token, recipient],
        })),
        blockNumber,
      )
    : [];
  let creatorAssigned = 0n;
  let creatorVested = 0n;
  let creatorClaimed = 0n;
  let creatorClaimable = 0n;
  let creatorUnvested = 0n;
  for (const raw of creatorStreams) {
    const stream = raw as {
      claimable: bigint;
      unvested: bigint;
      assigned: bigint;
      vested: bigint;
      claimed: bigint;
    };
    creatorAssigned += stream.assigned;
    creatorVested += stream.vested;
    creatorClaimed += stream.claimed;
    creatorClaimable += stream.claimable;
    creatorUnvested += stream.unvested;
  }
  let phaseMismatchCount = 0;
  let lockerMismatchCount = 0;
  let rewardStreamMismatchCount = 0;
  let rewardStreamRoundingDust = 0n;
  let bondingPools = 0;
  let tradingPools = 0;
  const launchAuditPlans: {
    launch: (typeof launches)[number];
    calls: BatchRead[];
  }[] = [];
  for (const launch of launches) {
    if (!launch.pool_id) {
      phaseMismatchCount += 1;
      continue;
    }
    const calls: BatchRead[] = [
      {
        address: launch.market,
        abi: remediationMarketAbi,
        functionName: "graduated",
      },
      {
        address: deployment.contracts.oracleHook,
        abi: remediationHookAbi,
        functionName: "poolPhase",
        args: [launch.pool_id],
      },
      ...[
        "principalNativeResidual",
        "principalTokenResidual",
        "pendingCollectedNativeFees",
        "pendingCollectedTokenFees",
        "unattributedNative",
        "unattributedLaunchTokens",
      ].map((functionName) => ({
        address: launch.locker,
        abi: remediationLockerAbi,
        functionName,
      })),
      {
        address: multicall3Address,
        abi: multicall3Abi,
        functionName: "getEthBalance",
        args: [launch.locker],
      },
      {
        address: launch.token,
        abi: balanceOfAbi,
        functionName: "balanceOf",
        args: [launch.locker],
      },
    ];
    for (let index = 0; index < launch.reward_count; index += 1) {
      for (const functionName of [
        "totalRewardsReceived",
        "pendingWithoutSupply",
        "streamingRewards",
        "totalRewardsVested",
      ]) {
        calls.push({
          address: launch.token,
          abi: remediationLaunchTokenAbi,
          functionName,
          args: [BigInt(index)],
        });
      }
    }
    launchAuditPlans.push({ launch, calls });
  }
  const launchAuditValues = launchAuditPlans.length
    ? await verifiedBatchRead(
        launchAuditPlans.flatMap(({ calls }) => calls),
        blockNumber,
      )
    : [];
  let launchAuditOffset = 0;
  for (const { launch, calls } of launchAuditPlans) {
    const values = launchAuditValues.slice(
      launchAuditOffset,
      launchAuditOffset + calls.length,
    );
    launchAuditOffset += calls.length;
    const graduated = values[0] as boolean;
    const phase = Number(values[1]);
    if (phase === 1) bondingPools += 1;
    if (phase === 3) tradingPools += 1;
    if ((graduated && phase !== 3) || (!graduated && phase !== 1)) {
      phaseMismatchCount += 1;
    }
    const principalNativeResidual = values[2] as bigint;
    const principalTokenResidual = values[3] as bigint;
    const pendingNativeFees = values[4] as bigint;
    const pendingTokenFees = values[5] as bigint;
    const lockerUnattributedNative = values[6] as bigint;
    const lockerUnattributedToken = values[7] as bigint;
    const lockerNative = values[8] as bigint;
    const lockerToken = values[9] as bigint;
    if (
      lockerNative !==
        principalNativeResidual +
          pendingNativeFees +
          lockerUnattributedNative ||
      lockerToken !==
        principalTokenResidual + pendingTokenFees + lockerUnattributedToken
    ) {
      lockerMismatchCount += 1;
    }
    let offset = 10;
    for (let index = 0; index < launch.reward_count; index += 1) {
      const received = values[offset] as bigint;
      const queued = values[offset + 1] as bigint;
      const streaming = values[offset + 2] as bigint;
      const vested = values[offset + 3] as bigint;
      const conservation = rewardStreamConservation(
        received,
        queued,
        streaming,
        vested,
      );
      if (!conservation.conserved) {
        rewardStreamMismatchCount += 1;
      } else {
        rewardStreamRoundingDust += conservation.uncheckpointedRoundingDust;
      }
      offset += 4;
    }
  }
  const routerSolvent = routerBalance >= liabilities;
  const daoConservation = rewardStreamConservation(
    daoDeposited,
    daoQueued,
    daoStreaming,
    daoVested,
  );
  const daoStreamConserved =
    daoConservation.conserved &&
    daoClaimed <= daoVested &&
    (!daoAccounting ||
      (daoAccounting[9] === 0n && daoAccounting[6]! >= daoAccounting[7]!));
  const creatorStreamConserved =
    creatorAssigned === creatorVested + creatorUnvested &&
    creatorVested === creatorClaimed + creatorClaimable &&
    creatorLiability === creatorClaimable + creatorUnvested;
  protocolAuditCompletedRuns += 1;
  const projectedDailyCu = Math.round(
    (protocolAuditEstimatedCu / protocolAuditCompletedRuns) *
      (86_400_000 / protocolAuditIntervalMs),
  );
  return {
    status:
      routerSolvent &&
      daoStreamConserved &&
      creatorStreamConserved &&
      phaseMismatchCount === 0 &&
      lockerMismatchCount === 0 &&
      rewardStreamMismatchCount === 0
        ? "ok"
        : "degraded",
    asOfBlock: blockNumber.toString(),
    durationMs: Math.round((performance.now() - began) * 100) / 100,
    estimatedCu: protocolAuditEstimatedCu,
    projectedDailyCu,
    projectedMonthlyCu: projectedDailyCu * 30,
    multicallFallbackCount: protocolAuditMulticallFallbacks,
    routerSolvent,
    routerBalance: routerBalance.toString(),
    liabilities: liabilities.toString(),
    unattributedNative: unattributedNative.toString(),
    daoStreamConserved,
    daoQueued: daoQueued.toString(),
    daoStreaming: daoStreaming.toString(),
    daoVested: daoVested.toString(),
    daoClaimed: daoClaimed.toString(),
    daoUncheckpointedRoundingDust:
      daoConservation.uncheckpointedRoundingDust.toString(),
    daoRoundingCarry: daoAccounting?.[5]?.toString() ?? "0",
    daoBackingBalance: daoAccounting?.[6]?.toString() ?? null,
    daoOutstanding: daoAccounting?.[7]?.toString() ?? null,
    daoBackingSurplus: daoAccounting?.[8]?.toString() ?? null,
    daoBackingDeficit: daoAccounting?.[9]?.toString() ?? null,
    creatorStreamConserved,
    creatorAssigned: creatorAssigned.toString(),
    creatorVested: creatorVested.toString(),
    creatorClaimed: creatorClaimed.toString(),
    creatorClaimable: creatorClaimable.toString(),
    creatorUnvested: creatorUnvested.toString(),
    phaseMismatchCount,
    lockerMismatchCount,
    rewardStreamMismatchCount,
    rewardStreamRoundingDust: rewardStreamRoundingDust.toString(),
    bondingPools,
    tradingPools,
    launchControl,
    bootstrapControl,
    tokenSink: deployment.contracts.tokenSink,
  };
}

const protocolAuditIntervalMs = Number(
  process.env.ROBYN_PROTOCOL_AUDIT_INTERVAL_MS ?? "900000",
);
let protocolAuditInFlight: Promise<void> | null = null;
let protocolAuditTimer: NodeJS.Timeout | null = null;

function runProtocolAudit() {
  if (protocolAuditInFlight) return protocolAuditInFlight;
  protocolAuditInFlight = (async () => {
    try {
      const snapshot = await remediationProtocolState();
      await sql.unsafe(
        "INSERT INTO service_heartbeats (service,status,metadata) VALUES ('protocol-auditor',$1,$2::jsonb) ON CONFLICT (service) DO UPDATE SET status=EXCLUDED.status,metadata=EXCLUDED.metadata,updated_at=now()",
        [
          snapshot?.status ?? "ok",
          JSON.stringify({
            snapshot,
            provider: "alchemy",
            intervalMs: protocolAuditIntervalMs,
            completedAt: new Date().toISOString(),
          }),
        ],
      );
    } catch (error) {
      await sql.unsafe(
        "INSERT INTO service_heartbeats (service,status,metadata) VALUES ('protocol-auditor','degraded',$1::jsonb) ON CONFLICT (service) DO UPDATE SET status='degraded',metadata=coalesce(service_heartbeats.metadata,'{}'::jsonb)||EXCLUDED.metadata,updated_at=now()",
        [
          JSON.stringify({
            lastError: error instanceof Error ? error.message : String(error),
            failedAt: new Date().toISOString(),
          }),
        ],
      );
    } finally {
      protocolAuditInFlight = null;
    }
  })();
  return protocolAuditInFlight;
}

async function persistedProtocolState() {
  const rows = await sql.unsafe<
    {
      status: string;
      updated_at: string;
      fresh: boolean;
      metadata: {
        snapshot?: Awaited<ReturnType<typeof remediationProtocolState>>;
        completedAt?: string;
        failedAt?: string;
        lastError?: string;
        intervalMs?: number;
      } | null;
    }[]
  >(
    "SELECT status,updated_at::text,(updated_at > now() - interval '30 minutes') fresh,metadata FROM service_heartbeats WHERE service='protocol-auditor'",
  );
  const row = rows[0];
  return {
    ...(row?.metadata?.snapshot ?? null),
    auditStatus: row && row.status === "ok" && row.fresh ? "ok" : "degraded",
    auditUpdatedAt: row?.updated_at ?? null,
    auditCompletedAt: row?.metadata?.completedAt ?? null,
    auditFailedAt: row?.metadata?.failedAt ?? null,
    auditLastError: row?.metadata?.lastError ?? null,
    auditIntervalMs: row?.metadata?.intervalMs ?? protocolAuditIntervalMs,
  };
}

async function rpcFailoverState() {
  if (!rpcFailoverStatusFile) return null;
  try {
    const snapshot = JSON.parse(
      await readFile(rpcFailoverStatusFile, "utf8"),
    ) as {
      expectedChainId?: number;
      activeProvider?: "primary" | "fallback";
      status?: "ok" | "degraded" | "unavailable";
      headLagBlocks?: string | null;
      paidActualCu?: number;
      paidProbeCu?: number;
      paidFallbackCu?: number;
      paidProjectedDailyCu?: number;
      paidProjectedMonthlyCu?: number;
      updatedAt?: string;
      primary?: { healthy?: boolean; head?: string | null };
      fallback?: { healthy?: boolean; head?: string | null };
    };
    const updatedAtMs = Date.parse(snapshot.updatedAt ?? "");
    const fresh =
      Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= 120_000;
    return {
      ...snapshot,
      fresh,
      status:
        fresh && snapshot.expectedChainId === chainId
          ? snapshot.status
          : "unavailable",
    };
  } catch {
    return {
      expectedChainId: chainId,
      activeProvider: null,
      status: "unavailable",
      fresh: false,
      headLagBlocks: null,
      paidActualCu: null,
      paidProbeCu: null,
      paidFallbackCu: null,
      paidProjectedDailyCu: null,
      paidProjectedMonthlyCu: null,
      updatedAt: null,
      primary: { healthy: false, head: null },
      fallback: { healthy: false, head: null },
    };
  }
}

app.get("/status", async () => {
  const [state, counts, keeper, artifact, protocol, rpcGateway] =
    await Promise.all([
      freshness(),
      sql.unsafe<
        {
          launches: string;
          logs: string;
          king_awards: string;
          current_king: string | null;
        }[]
      >(
        "SELECT (SELECT count(*)::text FROM launches WHERE chain_id=$1) launches,(SELECT count(*)::text FROM raw_logs WHERE chain_id=$1) logs,(SELECT count(*)::text FROM king_of_forest_awards WHERE chain_id=$1) king_awards,(SELECT token FROM king_of_forest_awards WHERE chain_id=$1 ORDER BY awarded_block DESC,awarded_transaction_index DESC,awarded_log_index DESC,token DESC LIMIT 1) current_king",
        [chainId],
      ),
      keeperState(),
      artifactState(),
      persistedProtocolState(),
      rpcFailoverState(),
    ]);
  return {
    service: "robyn-api",
    chainId,
    ...state,
    launchCount: counts[0]?.launches ?? "0",
    rawLogCount: counts[0]?.logs ?? "0",
    kingOfForestAwardCount: counts[0]?.king_awards ?? "0",
    currentKingOfForest: counts[0]?.current_king ?? null,
    formulaVersion: "native-v1",
    rpcGateway,
    protocol,
    ...keeper,
    keeperExpected,
    keeperStatus: keeperStatusForHealth(keeperExpected, keeper.keeperStatus),
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
    "SELECT launch_id::text,token,vault,market,creator,name,symbol,assets,weights_bps,created_block::text,updated_block::text,formula_version,graduation_profile_version::text,target_graduation_native::text,actual_graduation_native::text,maximum_curve_purchase::text,initial_virtual_native_reserve::text,terminal_native_per_token_x18::text,terminal_sqrt_price_x96::text,graduation_profile_hash,campaign_id,campaign_release_sha,automated_test_launch,pool_id FROM launches WHERE chain_id=$1 AND ($2::bigint IS NULL OR launch_id::bigint<$2::bigint) AND ($4::text IS NULL OR token=$4 OR strpos(lower(name),$4)>0 OR strpos(lower(symbol),$4)>0) AND ($5::text IS NULL OR assets ? $5) AND ($6::integer IS NULL OR jsonb_array_length(assets)=$6) AND ($7::text IS NULL OR creator=$7) ORDER BY CASE WHEN token=$4 THEN 0 ELSE 1 END,launch_id::bigint DESC LIMIT $3",
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
  const [marketMetrics, metadata, kingState] = await Promise.all([
    cachedDiscoveryMetrics(rows).catch((error) => {
      request.log.warn({ error }, "discovery metrics unavailable");
      return new Map<string, ReturnType<typeof deriveLaunchAnalytics>>();
    }),
    launchMetadataMap(rows.map((row) => row.token)),
    kingStateMap(rows.map((row) => row.token)),
  ]);
  const data = rows.map((row) => {
    const metric = marketMetrics.get(row.token.toLowerCase());
    const priceChangeBps = demoMarketChangesEnabled
      ? demoMarketChangeBps(row.token as Address)
      : metric?.priceChangeBps;
    return {
      ...row,
      metadata: metadata.get(row.token.toLowerCase()) ?? null,
      kingOfForest: kingOfForestView(kingState.get(row.token.toLowerCase())),
      metrics: metric
        ? {
            marketCapBase: metric.marketCapBase,
            priceChangeBps,
            priceChangeSource: demoMarketChangesEnabled ? "demo" : "indexed",
            change5mBps: metric.change5mBps,
            change1hBps: metric.change1hBps,
            change6hBps: metric.change6hBps,
            change24hBps: metric.change24hBps,
            change7dBps: metric.change7dBps,
            liquidityBase: metric.liquidityBase,
            totalVolumeBase: metric.totalVolumeBase,
            volume5mBase: metric.volume5mBase,
            volume1hBase: metric.volume1hBase,
            volume6hBase: metric.volume6hBase,
            volume24hBase: metric.volume24hBase,
            volume7dBase: metric.volume7dBase,
            buyVolume24hBase: metric.buyVolume24hBase,
            sellVolume24hBase: metric.sellVolume24hBase,
            tradeCount5m: metric.tradeCount5m,
            tradeCount1h: metric.tradeCount1h,
            tradeCount6h: metric.tradeCount6h,
            tradeCount24h: metric.tradeCount24h,
            tradeCount7d: metric.tradeCount7d,
            uniqueTraders5m: metric.uniqueTraders5m,
            uniqueTraders1h: metric.uniqueTraders1h,
            uniqueTraders6h: metric.uniqueTraders6h,
            uniqueTraders24h: metric.uniqueTraders24h,
            uniqueTraders7d: metric.uniqueTraders7d,
            uniqueTraderCount: metric.uniqueTraderCount,
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
            poolManager: metric.poolManager,
            poolId: metric.poolId,
            hook: metric.hook,
            positionLocker: metric.positionLocker,
            positionTokenId: metric.positionTokenId,
            poolFeePips: metric.poolFeePips,
          }
        : null,
    };
  });
  const visible = data.filter((row) => {
    if (sort === "king_of_forest") return row.kingOfForest.awarded;
    if (!row.metrics) return phase === "all";
    if (sort === "near_graduation")
      return row.metrics.marketPhase === "bonding";
    if (sort === "graduated") return row.metrics.marketPhase === "graduated";
    return phase === "all" || row.metrics.marketPhase === phase;
  });
  const amountForWindow = (row: (typeof visible)[number]) => {
    if (!row.metrics) return 0n;
    if (window === "1h") return BigInt(row.metrics.volume1hBase);
    if (window === "6h") return BigInt(row.metrics.volume6hBase);
    if (window === "24h") return BigInt(row.metrics.volume24hBase);
    if (window === "7d") return BigInt(row.metrics.volume7dBase);
    return BigInt(row.metrics.totalVolumeBase);
  };
  const compareBigInt = (left: bigint, right: bigint) =>
    left === right ? 0 : left > right ? -1 : 1;
  visible.sort((left, right) => {
    if (sort === "king_of_forest") {
      const leftAward = kingState.get(left.token.toLowerCase());
      const rightAward = kingState.get(right.token.toLowerCase());
      const block =
        BigInt(rightAward?.awarded_block ?? "0") -
        BigInt(leftAward?.awarded_block ?? "0");
      if (block !== 0n) return block > 0n ? 1 : -1;
      const logIndex =
        (rightAward?.awarded_log_index ?? 0) -
        (leftAward?.awarded_log_index ?? 0);
      if (logIndex !== 0) return logIndex;
    }
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
        amountForWindow(left),
        amountForWindow(right),
      );
      if (volume !== 0) return volume;
      if (sort === "trending") {
        const tradersForWindow = (row: (typeof visible)[number]) => {
          if (window === "1h") return row.metrics?.uniqueTraders1h ?? 0;
          if (window === "6h") return row.metrics?.uniqueTraders6h ?? 0;
          if (window === "24h") return row.metrics?.uniqueTraders24h ?? 0;
          if (window === "7d") return row.metrics?.uniqueTraders7d ?? 0;
          return row.metrics?.uniqueTraderCount ?? 0;
        };
        const tradesForWindow = (row: (typeof visible)[number]) => {
          if (window === "1h") return row.metrics?.tradeCount1h ?? 0;
          if (window === "6h") return row.metrics?.tradeCount6h ?? 0;
          if (window === "24h") return row.metrics?.tradeCount24h ?? 0;
          if (window === "7d") return row.metrics?.tradeCount7d ?? 0;
          return row.metrics?.tradeCount ?? 0;
        };
        const traders = tradersForWindow(right) - tradersForWindow(left);
        if (traders !== 0) return traders;
        const trades = tradesForWindow(right) - tradesForWindow(left);
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

async function schema19MaintenanceState(token: Address, vault: Address) {
  if ((deployment.schemaVersion ?? 0) !== 19) return null;
  const maintenance = deployment.contracts.maintenanceCoordinator;
  const policy = deployment.maintenancePolicy;
  if (!maintenance || !policy) {
    throw new Error("Schema-19 manifest is missing maintenance identity");
  }
  const [
    legCount,
    fallbackAsset,
    fallbackRewardIndex,
    observationSpacing,
    fallbackDelay,
    nextLegCursor,
    totalFeesReceived,
    totalNativeConsumed,
    totalPendingNative,
    nextTask,
    attempts,
    successes,
  ] = await Promise.all([
    rpcClient.readContract({
      address: vault,
      abi: schema19VaultAbi,
      functionName: "legCount",
    }),
    rpcClient.readContract({
      address: vault,
      abi: schema19VaultAbi,
      functionName: "fallbackAsset",
    }),
    rpcClient.readContract({
      address: vault,
      abi: schema19VaultAbi,
      functionName: "fallbackRewardIndex",
    }),
    rpcClient.readContract({
      address: vault,
      abi: schema19VaultAbi,
      functionName: "failureObservationSpacing",
    }),
    rpcClient.readContract({
      address: vault,
      abi: schema19VaultAbi,
      functionName: "fallbackDelay",
    }),
    rpcClient.readContract({
      address: vault,
      abi: schema19VaultAbi,
      functionName: "nextLegCursor",
    }),
    rpcClient.readContract({
      address: vault,
      abi: schema19VaultAbi,
      functionName: "totalFeesReceived",
    }),
    rpcClient.readContract({
      address: vault,
      abi: schema19VaultAbi,
      functionName: "totalNativeConsumed",
    }),
    rpcClient.readContract({
      address: vault,
      abi: schema19VaultAbi,
      functionName: "totalPendingNative",
    }),
    rpcClient.readContract({
      address: maintenance,
      abi: schema19MaintenanceAbi,
      functionName: "nextTask",
      args: [token],
    }),
    rpcClient.readContract({
      address: maintenance,
      abi: schema19MaintenanceAbi,
      functionName: "attemptCount",
      args: [token],
    }),
    rpcClient.readContract({
      address: maintenance,
      abi: schema19MaintenanceAbi,
      functionName: "successCount",
      args: [token],
    }),
  ]);
  const legs = await Promise.all(
    Array.from({ length: Number(legCount) }, async (_, index) => {
      const leg = await rpcClient.readContract({
        address: vault,
        abi: schema19VaultAbi,
        functionName: "leg",
        args: [BigInt(index)],
      });
      const eligibleAt =
        leg.failureObservations === 3
          ? BigInt(leg.firstFailureAt) + fallbackDelay
          : null;
      return {
        index,
        primaryAsset: leg.asset,
        fallbackAsset,
        weightBps: leg.weightBps,
        pendingNative: leg.pendingNative.toString(),
        pendingSince: leg.pendingSince.toString(),
        primaryNativeConsumed: leg.consumedNative.toString(),
        primaryRewardsDeposited: leg.rewardsDeposited.toString(),
        fallbackNativeConsumed: leg.fallbackNativeConsumed.toString(),
        fallbackRewardsDeposited: leg.fallbackRewardsDeposited.toString(),
        failureObservations: leg.failureObservations,
        firstFailureAt: leg.firstFailureAt.toString(),
        lastFailureAt: leg.lastFailureAt.toString(),
        lastFailureReason: leg.lastFailureReason,
        fallbackEligibleAt: eligibleAt?.toString() ?? null,
      };
    }),
  );
  return {
    policy,
    fallbackAsset,
    fallbackRewardIndex,
    observationSpacingSeconds: observationSpacing.toString(),
    fallbackDelaySeconds: fallbackDelay.toString(),
    nextLegCursor,
    nextTask,
    attempts: attempts.toString(),
    successes: successes.toString(),
    totalFeesReceived: totalFeesReceived.toString(),
    totalNativeConsumed: totalNativeConsumed.toString(),
    totalPendingNative: totalPendingNative.toString(),
    legs,
  };
}

app.get("/king-of-forest", async () => {
  const storedRows = await sql.unsafe<LaunchRow[]>(
    "SELECT l.launch_id::text,l.token,l.vault,l.market,l.creator,l.name,l.symbol,l.assets,l.weights_bps,l.created_block::text,l.updated_block::text,l.formula_version,l.graduation_profile_version::text,l.target_graduation_native::text,l.actual_graduation_native::text,l.maximum_curve_purchase::text,l.initial_virtual_native_reserve::text,l.terminal_native_per_token_x18::text,l.terminal_sqrt_price_x96::text,l.graduation_profile_hash,l.campaign_id,l.campaign_release_sha,l.automated_test_launch,l.pool_id FROM king_of_forest_awards a JOIN launches l ON l.chain_id=a.chain_id AND l.token=a.token WHERE a.chain_id=$1 ORDER BY a.awarded_block DESC,a.awarded_transaction_index DESC,a.awarded_log_index DESC,a.token DESC LIMIT 100",
    [chainId],
  );
  const rows = await hydrateMarkets(storedRows);
  const [metadata, metrics, kingState, state] = await Promise.all([
    launchMetadataMap(rows.map((row) => row.token)),
    cachedDiscoveryMetrics(rows).catch(() => new Map()),
    kingStateMap(rows.map((row) => row.token)),
    freshness(),
  ]);
  const history = rows.map((row) => ({
    ...row,
    metadata: metadata.get(row.token.toLowerCase()) ?? null,
    metrics: metrics.get(row.token.toLowerCase()) ?? null,
    kingOfForest: kingOfForestView(kingState.get(row.token.toLowerCase())),
  }));
  return {
    policy: deployment.kingOfForestPolicy ?? null,
    current: history[0] ?? null,
    history,
    ...state,
  };
});

app.get<{ Params: { token: string } }>(
  "/launches/:token",
  async (request, reply) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(request.params.token))
      return reply.code(400).send({ error: "invalid_token" });
    const storedRows = await sql.unsafe<LaunchRow[]>(
      "SELECT launch_id::text,token,vault,market,creator,name,symbol,assets,weights_bps,created_block::text,updated_block::text,formula_version,graduation_profile_version::text,target_graduation_native::text,actual_graduation_native::text,maximum_curve_purchase::text,initial_virtual_native_reserve::text,terminal_native_per_token_x18::text,terminal_sqrt_price_x96::text,graduation_profile_hash,campaign_id,campaign_release_sha,automated_test_launch,pool_id FROM launches WHERE chain_id=$1 AND token=$2",
      [chainId, request.params.token.toLowerCase()],
    );
    const rows = await hydrateMarkets(storedRows);
    if (!rows[0]) return reply.code(404).send({ error: "launch_not_found" });
    const [metadata, kingState, maintenance] = await Promise.all([
      launchMetadataMap([rows[0].token]),
      kingStateMap([rows[0].token]),
      schema19MaintenanceState(
        rows[0].token as Address,
        rows[0].vault as Address,
      ),
    ]);
    return {
      data: {
        ...rows[0],
        metadata: metadata.get(rows[0].token.toLowerCase()) ?? null,
        kingOfForest: kingOfForestView(
          kingState.get(rows[0].token.toLowerCase()),
        ),
        maintenance,
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
    const config = await getMarketConfiguration(marketAddress);
    const [baseAsset, totalSupply] = await Promise.all([
      config.liquidityVenue === "uniswap-v4"
        ? Promise.resolve(zeroAddress as Address)
        : rpcClient.readContract({
            address: marketAddress,
            abi: marketViewAbi,
            functionName: "baseAsset",
          }),
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
          ...(config.poolManager ? { poolManager: config.poolManager } : {}),
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
      config.liquidityVenue === "uniswap-v4"
        ? rpcClient.getBalance({ address: activeLiquidityAddress })
        : rpcClient.readContract({
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
        ...(config.poolManager && config.poolId
          ? { poolManager: config.poolManager, poolId: config.poolId }
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

app.get("/dex/venue", async () => ({
  data: {
    liquidityVenue: deployment.liquidityVenue ?? "uniswap-v3",
    provenance: deployment.venueProvenance ?? null,
    manifestSha256: deployment.venueManifestSha256 ?? null,
    verificationStatus:
      deployment.liquidityVenue === "uniswap-v4"
        ? "frozen-manifest-verified"
        : "legacy-deployment",
    unlistedTestnet:
      deployment.venueProvenance ===
      "shared-unlisted-robinhood-testnet-uniswap-v4-mirror",
    disclosure:
      deployment.liquidityVenue === "uniswap-v4"
        ? "This shared chain-46630 Uniswap v4 mirror is not listed in Uniswap's official deployment registry. Robyn independently freezes and verifies its runtime hashes and wiring."
        : null,
    contracts: {
      poolManager: deployment.contracts.poolManager ?? null,
      positionManager: deployment.contracts.positionManager ?? null,
      stateView: deployment.contracts.stateView ?? null,
      quoter: deployment.contracts.quoter ?? null,
      hook: deployment.contracts.oracleHook ?? null,
    },
    missingOptionalComponents:
      deployment.liquidityVenue === "uniswap-v4"
        ? ["canonical-state-view", "position-descriptor", "reserves-lens"]
        : [],
    routes: deployment.assetRoutes ?? [],
  },
}));
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
      policyVersion: deployment.assetCatalog?.policyVersion ?? null,
      policyHash: deployment.assetCatalog?.policyHash ?? null,
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
    const asset = await assetCatalog.resolveWithLivePrice(
      request.params.address,
    );
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
  const asset = await assetCatalog.resolveWithLivePrice(request.params.address);
  if (!asset) return reply.code(404).send({ error: "asset_not_found" });
  if (!(asset.route.selectable ?? asset.route.ready)) {
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
  ...(process.env.ROBYN_CAMPAIGN_OPERATOR_TOKEN
    ? { campaignOperatorToken: process.env.ROBYN_CAMPAIGN_OPERATOR_TOKEN }
    : {}),
  fallbackArtworkPath:
    process.env.ROBYN_FALLBACK_ARTWORK_PATH ??
    `${process.cwd()}/apps/web/public/assets/launchpad/token-fallback.webp`,
});
registerCampaignRoutes(app, {
  sql,
  chainId,
  ...(process.env.ROBYN_CAMPAIGN_OPERATOR_TOKEN
    ? { operatorToken: process.env.ROBYN_CAMPAIGN_OPERATOR_TOKEN }
    : {}),
  releaseSha: process.env.ROBYN_RELEASE_SHA ?? "unknown",
  ...(process.env.ROBYN_ENDURANCE_STATUS_FILE
    ? { enduranceStatusFile: process.env.ROBYN_ENDURANCE_STATUS_FILE }
    : {}),
});
registerDaoRoutes(app, rpcClient, deployment);

void runProtocolAudit();
protocolAuditTimer = setInterval(
  () => void runProtocolAudit(),
  protocolAuditIntervalMs,
);
protocolAuditTimer.unref();

const close = async () => {
  if (protocolAuditTimer) clearInterval(protocolAuditTimer);
  await app.close();
  redis.disconnect();
  await sql.end();
};
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
await app.listen({ port, host });
