import { readFile, stat } from "node:fs/promises";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createDatabase } from "@robyn/db";
import {
  boundedProtocolInput,
  conversionJobId,
  isFailedJobRetryDue,
  failureAuditState,
  harvestJobId,
  isLegacyConversionJobId,
  isLegacyStreamJobId,
  isLegExecutable,
  isReusableStreamJobKind,
  protocolLaunchJobId,
  protocolNativeJobId,
  shouldSupersedeProtocolFailure,
} from "./eligibility.js";
import {
  databaseText,
  redisConnectionOptions,
  transactionAccount,
} from "./runtime-config.js";

type Manifest = {
  chainId: number;
  liquidityVenue?: "uniswap-v4" | "uniswap-v3";
  contracts: {
    factory: Address;
    baseAsset?: Address;
    wrappedNative?: Address;
    daoToken?: Address;
    protocolFeeRouter?: Address;
    oracleHook?: Address;
    nativeFeeConverter?: Address;
    assetRouter?: Address;
  };
  market?: { type?: string; poolFeePips?: number };
};
type ConvertJob = {
  kind?: "convert";
  idempotencyKey: string;
  token: Address;
  vault: Address;
  legIndex: string;
  observedPending: string;
  observedPendingSince: string;
};
type HarvestJob = {
  kind: "harvest";
  idempotencyKey: string;
  token: Address;
  vault: Address;
  market: Address;
  locker: Address;
  observedBlock: string;
};
type ProtocolConversionJob = {
  kind: "protocol-native" | "protocol-launch";
  idempotencyKey: string;
  token: Address;
  locker: Address;
  observedAmount: string;
};
type KeeperJob = ConvertJob | HarvestJob | ProtocolConversionJob;
type KeeperResult = {
  operation: "convert" | "harvest" | "protocol-native" | "protocol-launch";
  transactionHash: Hash;
  inputAmount: string;
  launchTokenFees?: string;
};

const environment = process.env.ROBYN_ENV ?? "";
if (environment !== "robyn-devnet" && environment !== "robinhood-testnet") {
  throw new Error(
    "Keeper environment must be robyn-devnet or robinhood-testnet",
  );
}
const isTestnet = environment === "robinhood-testnet";
const expectedChainId = isTestnet ? 46630 : 31337;
const manifest = JSON.parse(
  await readFile(
    process.env.ROBYN_MANIFEST ?? "/home/hendo420/Robyn/deployments/31337.json",
    "utf8",
  ),
) as Manifest;
if (manifest.chainId !== expectedChainId) {
  throw new Error(
    `Keeper manifest chain ${manifest.chainId} does not match ${expectedChainId}`,
  );
}
const isNativeV4 = manifest.liquidityVenue === "uniswap-v4";

const rpcUrl =
  process.env.ROBYN_OPERATOR_RPC_URL ??
  (isTestnet
    ? "https://rpc.testnet.chain.robinhood.com"
    : "http://127.0.0.1:8545");
const selectedChain = defineChain({
  id: expectedChainId,
  name: isTestnet ? "Robinhood Chain Testnet" : "Robyn Devnet",
  nativeCurrency: isTestnet
    ? { name: "Ether", symbol: "ETH", decimals: 18 }
    : { name: "Dev Ether", symbol: "DEV", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: true,
});
const publicClient = createPublicClient({
  chain: selectedChain,
  transport: http(rpcUrl, {
    batch: { batchSize: 20, wait: 20 },
    retryCount: Number(process.env.ROBYN_RPC_RETRY_COUNT ?? "5"),
    retryDelay: Number(process.env.ROBYN_RPC_RETRY_DELAY_MS ?? "500"),
    timeout: Number(process.env.ROBYN_RPC_TIMEOUT_MS ?? "15000"),
  }),
});
let operatorAccount;
if (isTestnet) {
  const keyFile = process.env.ROBYN_OPERATOR_KEY_FILE;
  if (!keyFile)
    throw new Error("Testnet keeper requires ROBYN_OPERATOR_KEY_FILE");
  const keyStat = await stat(keyFile);
  if ((keyStat.mode & 0o077) !== 0) {
    throw new Error(
      "Testnet operator key file must not be group/world accessible",
    );
  }
  const key = (await readFile(keyFile, "utf8")).trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Testnet operator key file is not a private-key hex value");
  }
  operatorAccount = privateKeyToAccount(key as Hex);
}
const walletClient = createWalletClient({
  account: operatorAccount,
  chain: selectedChain,
  // Writes are never transport-retried. The keeper journals and reconciles a
  // submitted hash before deciding whether another transaction is necessary.
  transport: http(rpcUrl, { retryCount: 0, timeout: 15_000 }),
});
const operator = isTestnet
  ? operatorAccount?.address
  : (await walletClient.getAddresses())[0];
if (!operator) throw new Error("Keeper operator account is unavailable");
const writeAccount = transactionAccount(isTestnet, operatorAccount, operator);
if ((await publicClient.getChainId()) !== manifest.chainId) {
  throw new Error("Keeper RPC chain mismatch");
}

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const connection = redisConnectionOptions(redisUrl.toString());
const auditRedis = new Redis(redisUrl.toString(), {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
});
await auditRedis.ping();
const queueName = process.env.ROBYN_QUEUE_NAME ?? "robyn-conversions";
const queue = new Queue<KeeperJob, KeeperResult>(queueName, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 1_000 },
  },
});
const { sql } = createDatabase();
const scanMs = Number(process.env.KEEPER_SCAN_MS ?? "5000");
const minimumProtocolBase = BigInt(
  process.env.KEEPER_MINIMUM_PROTOCOL_BASE ?? "10000000000000000",
);
const maximumProtocolBase = BigInt(
  process.env.KEEPER_MAXIMUM_PROTOCOL_BASE ?? "100000000000000000",
);
const minimumLaunchFees = BigInt(
  process.env.KEEPER_MINIMUM_LAUNCH_FEES ?? "1000000000000",
);
let stopping = false;

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
    name: "minimumConversionBase",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maximumPendingDelay",
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
    name: "conversionRouter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
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
  {
    type: "function",
    name: "convertLeg",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
const nativeVaultAbi = [
  {
    type: "function",
    name: "legCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "minimumConversionNative",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maximumPendingDelay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "assetRouter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
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
          { name: "pendingNative", type: "uint256" },
          { name: "consumedNative", type: "uint256" },
          { name: "rewardsDeposited", type: "uint256" },
          { name: "pendingSince", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "convertLeg",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
const routerAbi = [
  {
    type: "function",
    name: "rate",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
const v4AssetRouterAbi = [
  {
    type: "function",
    name: "route",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
          { name: "minimumLiquidity", type: "uint128" },
          { name: "maximumNativeInput", type: "uint128" },
          { name: "referenceTick", type: "int24" },
          { name: "maximumReferenceTickDeviation", type: "uint24" },
          { name: "enforceReferencePrice", type: "bool" },
          { name: "verificationClass", type: "bytes32" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "quoteNativeToAsset",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint128" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteAssetToNative",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint128" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
] as const;
const uniswapMarketAbi = [
  {
    type: "function",
    name: "graduated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "positionLocker",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;
const positionLockerAbi = [
  { type: "error", name: "EmptyHarvest", inputs: [] },
  {
    type: "function",
    name: "pendingLaunchTokenFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "convertLaunchFees",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "positionBound",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "harvest",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
] as const;
const v4PositionLockerAbi = [
  {
    type: "function",
    name: "pendingCollectedNativeFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingCollectedTokenFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maximumNativeSaleOutput",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "initialized",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "collectFees",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint128" }, { type: "uint128" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
  {
    type: "function",
    name: "routeCollectedNative",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "convertCollectedToken",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint128" }, { type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
const v4ProtocolHookAbi = [
  {
    type: "function",
    name: "pendingNativeFees",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingTokenFees",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "settleNativeFees",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "convertTokenFees",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "uint128" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
const nativeProtocolFeeRouterAbi = [
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
  {
    type: "function",
    name: "totalDaoNativeLiability",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalTreasuryNativeLiability",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "settleBasketFees",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settleDaoFees",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settleTreasuryFees",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [],
  },
] as const;
const streamedDaoAbi = [
  {
    type: "function",
    name: "eligibleRewardSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
const protocolFeeRouterAbi = [
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
  {
    type: "function",
    name: "convertPendingToNative",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
const nativeConverterAbi = [
  {
    type: "function",
    name: "minimumSafeOutput",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "address" },
      { type: "uint24" },
      { type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

function isEmptyHarvest(error: unknown) {
  return error instanceof Error && error.message.includes("EmptyHarvest");
}

async function audit(
  key: string,
  state: string,
  attempts: number,
  payload: unknown,
  lastError: string | null = null,
  result: unknown = null,
) {
  const values = [
    key,
    queueName,
    state,
    attempts,
    JSON.stringify(payload),
    databaseText(lastError),
    JSON.stringify(result),
  ];
  await sql.begin(async (transaction) => {
    await transaction.unsafe(
      "INSERT INTO job_audit (idempotency_key,queue,state,attempts,payload,last_error,result,completed_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,CASE WHEN $3 IN ('completed','dead_letter') THEN now() ELSE NULL END) ON CONFLICT (idempotency_key) DO UPDATE SET state=EXCLUDED.state,attempts=EXCLUDED.attempts,payload=EXCLUDED.payload,last_error=EXCLUDED.last_error,result=EXCLUDED.result,created_at=CASE WHEN EXCLUDED.state='queued' AND job_audit.state IN ('completed','superseded') THEN now() ELSE job_audit.created_at END,completed_at=EXCLUDED.completed_at,updated_at=now()",
      values,
    );
    await transaction.unsafe(
      "INSERT INTO job_audit_events (idempotency_key,queue,state,attempts,last_error,result) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
      [
        key,
        queueName,
        state,
        attempts,
        databaseText(lastError),
        JSON.stringify(result),
      ],
    );
  });
}

async function heartbeat() {
  await sql.unsafe(
    "INSERT INTO service_heartbeats (service,status,metadata) VALUES ('conversion-keeper','ok',$1::jsonb) ON CONFLICT (service) DO UPDATE SET status='ok',metadata=EXCLUDED.metadata,updated_at=now()",
    [JSON.stringify({ queue: queueName, chainId: manifest.chainId })],
  );
}

async function supersedeStaleProtocolDeadLetters(
  token: Address,
  kind: ProtocolConversionJob["kind"],
  authoritativeAmount: bigint,
) {
  const rows = await sql.unsafe<
    {
      idempotency_key: string;
      attempts: number;
      payload: ProtocolConversionJob;
      state: string;
    }[]
  >(
    "SELECT idempotency_key,attempts,payload,state FROM job_audit WHERE queue=$1 AND state='dead_letter' AND payload->>'kind'=$2 AND lower(payload->>'token')=$3",
    [queueName, kind, token.toLowerCase()],
  );
  for (const row of rows) {
    if (
      !shouldSupersedeProtocolFailure(
        row.state,
        row.payload.observedAmount,
        authoritativeAmount,
      )
    ) {
      continue;
    }
    await audit(
      row.idempotency_key,
      "superseded",
      row.attempts,
      row.payload,
      "Authoritative onchain pending amount changed; failure retained in job_audit_events",
      {
        authoritativeAmount: authoritativeAmount.toString(),
        observedAmount: row.payload.observedAmount,
      },
    );
    const staleQueueJob = await queue.getJob(row.idempotency_key);
    if (staleQueueJob && (await staleQueueJob.isFailed())) {
      await staleQueueJob.remove();
      await audit(
        row.idempotency_key,
        "superseded",
        row.attempts,
        row.payload,
        "Stale failed queue entry removed after authoritative onchain reconciliation",
      );
    }
  }
}

async function reconcileLegacyStreamJobs() {
  const active = await queue.getJobs(["active"], 0, -1);
  const activeLegacy = active.filter((job) =>
    isLegacyStreamJobId(job.data.kind, job.id ?? ""),
  );
  if (activeLegacy.length > 0) {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        event: "active_legacy_stream_jobs_deferred",
        count: activeLegacy.length,
      }) + "\n",
    );
  }
  const legacyJobs = (
    await queue.getJobs(
      ["wait", "delayed", "failed", "paused", "prioritized"],
      0,
      -1,
    )
  ).filter((job) => isLegacyStreamJobId(job.data.kind, job.id ?? ""));
  for (const job of legacyJobs) {
    const key = job.data.idempotencyKey;
    const attempts = job.attemptsMade;
    const payload = job.data;
    let replacementJobId: string;
    if (payload.kind === "protocol-native") {
      replacementJobId = protocolNativeJobId(payload.token);
    } else if (payload.kind === "protocol-launch") {
      replacementJobId = protocolLaunchJobId(payload.locker);
    } else if (payload.kind === "harvest") {
      replacementJobId = harvestJobId(payload.locker);
    } else {
      throw new Error(`Unexpected legacy stream job kind for ${key}`);
    }
    await job.remove();
    await audit(
      key,
      "superseded",
      attempts,
      payload,
      "Legacy amount-stamped stream job removed during stable-stream reconciliation",
      {
        replacementJobId,
      },
    );
  }
  if (legacyJobs.length > 0) {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        event: "legacy_stream_jobs_reconciled",
        count: legacyJobs.length,
      }) + "\n",
    );
  }
}

async function reconcileLegacyConversionJobs() {
  const active = await queue.getJobs(["active"], 0, -1);
  const activeLegacy = active.filter((job) =>
    isLegacyConversionJobId(job.data.kind, job.id ?? ""),
  );
  if (activeLegacy.length > 0) {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        event: "active_legacy_conversion_jobs_deferred",
        count: activeLegacy.length,
      }) + "\n",
    );
  }
  const legacyJobs = (
    await queue.getJobs(
      ["wait", "delayed", "failed", "paused", "prioritized"],
      0,
      -1,
    )
  ).filter((job) => isLegacyConversionJobId(job.data.kind, job.id ?? ""));
  for (const job of legacyJobs) {
    const key = job.data.idempotencyKey;
    const attempts = job.attemptsMade;
    const payload = job.data;
    if (payload.kind !== "convert") {
      throw new Error(`Unexpected legacy conversion job kind for ${key}`);
    }
    const replacementJobId = conversionJobId(
      payload.vault,
      BigInt(payload.legIndex),
    );
    await job.remove();
    await audit(
      key,
      "superseded",
      attempts,
      payload,
      "Legacy observation-stamped conversion job removed during stable-leg reconciliation",
      {
        replacementJobId,
      },
    );
  }
  if (legacyJobs.length > 0) {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        event: "legacy_conversion_jobs_reconciled",
        count: legacyJobs.length,
      }) + "\n",
    );
  }
}

async function readLeg(vault: Address, legIndex: bigint) {
  if (isNativeV4) {
    const [minimum, delay, leg, block] = await Promise.all([
      publicClient.readContract({
        address: vault,
        abi: nativeVaultAbi,
        functionName: "minimumConversionNative",
      }),
      publicClient.readContract({
        address: vault,
        abi: nativeVaultAbi,
        functionName: "maximumPendingDelay",
      }),
      publicClient.readContract({
        address: vault,
        abi: nativeVaultAbi,
        functionName: "leg",
        args: [legIndex],
      }),
      publicClient.getBlock(),
    ]);
    return {
      minimum,
      delay,
      leg: {
        asset: leg.asset,
        weightBps: leg.weightBps,
        pendingBase: leg.pendingNative,
        consumedBase: leg.consumedNative,
        rewardsDeposited: leg.rewardsDeposited,
        pendingSince: leg.pendingSince,
      },
      timestamp: block.timestamp,
    };
  }
  const [minimum, delay, leg, block] = await Promise.all([
    publicClient.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "minimumConversionBase",
    }),
    publicClient.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "maximumPendingDelay",
    }),
    publicClient.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "leg",
      args: [legIndex],
    }),
    publicClient.getBlock(),
  ]);
  return { minimum, delay, leg, timestamp: block.timestamp };
}

async function scan() {
  await auditRedis.ping();
  const launches = await sql.unsafe<
    { token: Address; vault: Address; market: Address }[]
  >(
    "SELECT token,vault,market FROM launches WHERE chain_id=$1 ORDER BY launch_id",
    [manifest.chainId],
  );
  for (const launch of launches) {
    if (isNativeV4 || manifest.market?.type === "uniswap-v3-bonding-curve-v1") {
      await enqueueHarvest(launch);
    }
    if (isNativeV4 && manifest.contracts.protocolFeeRouter) {
      await enqueueV4LaunchFeeConversion(launch);
      await enqueueV4ProtocolSettlement(launch);
    } else if (
      manifest.contracts.protocolFeeRouter &&
      manifest.contracts.nativeFeeConverter
    ) {
      await enqueueProtocolConversions(launch);
    }
    const count = await publicClient.readContract({
      address: launch.vault,
      abi: isNativeV4 ? nativeVaultAbi : vaultAbi,
      functionName: "legCount",
    });
    for (let index = 0n; index < count; index++) {
      const current = await readLeg(launch.vault, index);
      if (
        !isLegExecutable({
          pendingBase: current.leg.pendingBase,
          pendingSince: current.leg.pendingSince,
          minimumConversionBase: current.minimum,
          maximumPendingDelay: current.delay,
          chainTimestamp: current.timestamp,
        })
      )
        continue;
      const key = conversionJobId(launch.vault, index);
      const payload: ConvertJob = {
        kind: "convert",
        idempotencyKey: key,
        token: launch.token,
        vault: launch.vault,
        legIndex: index.toString(),
        observedPending: current.leg.pendingBase.toString(),
        observedPendingSince: current.leg.pendingSince.toString(),
      };
      const existing = await queue.getJob(key);
      if (!existing) {
        await audit(key, "queued", 0, payload);
        await queue.add("convert-leg", payload, {
          jobId: key,
          priority: 4,
        });
      } else if (
        (await existing.isFailed()) &&
        isFailedJobRetryDue(
          existing.attemptsMade,
          existing.finishedOn,
          Date.now(),
        )
      ) {
        await audit(key, "queued", existing.attemptsMade, payload);
        await existing.retry();
      }
    }
  }
  await heartbeat();
}

async function safeMinimum(
  tokenIn: Address,
  tokenOut: Address,
  amount: bigint,
) {
  const converter = manifest.contracts.nativeFeeConverter;
  const fee = manifest.market?.poolFeePips;
  if (!converter || !fee)
    throw new Error("Protocol converter configuration is missing");
  const simulation = await publicClient.simulateContract({
    address: converter,
    abi: nativeConverterAbi,
    functionName: "minimumSafeOutput",
    args: [tokenIn, tokenOut, fee, amount],
    account: writeAccount,
  });
  return simulation.result;
}

async function v4LaunchFeePlan(
  token: Address,
  locker: Address,
  pending: bigint,
) {
  const assetRouter = manifest.contracts.assetRouter;
  if (!assetRouter) throw new Error("V4 asset router is missing");
  let input = pending > 2n ** 128n - 1n ? 2n ** 128n - 1n : pending;
  let quotedNative = (
    await publicClient.simulateContract({
      address: assetRouter,
      abi: v4AssetRouterAbi,
      functionName: "quoteAssetToNative",
      args: [token, input],
      account: writeAccount,
    })
  ).result[0];
  const maximumNative = await publicClient.readContract({
    address: locker,
    abi: v4PositionLockerAbi,
    functionName: "maximumNativeSaleOutput",
  });
  if (quotedNative > maximumNative) {
    input = (input * maximumNative * 9_900n) / quotedNative / 10_000n;
    if (input < minimumLaunchFees) {
      throw new Error("Safe v4 launch-fee sale batch is below minimum");
    }
    quotedNative = (
      await publicClient.simulateContract({
        address: assetRouter,
        abi: v4AssetRouterAbi,
        functionName: "quoteAssetToNative",
        args: [token, input],
        account: writeAccount,
      })
    ).result[0];
  }
  const minimumNative = (quotedNative * 9_950n) / 10_000n;
  if (minimumNative === 0n) {
    throw new Error("V4 launch-fee quote returned zero");
  }
  const block = await publicClient.getBlock();
  return { input, minimumNative, deadline: block.timestamp + 300n };
}

async function enqueueV4LaunchFeeConversion(launch: {
  token: Address;
  vault: Address;
  market: Address;
}) {
  const router = manifest.contracts.protocolFeeRouter;
  const hook = manifest.contracts.oracleHook;
  if (!router || !hook) return;
  const account = await publicClient.readContract({
    address: router,
    abi: nativeProtocolFeeRouterAbi,
    functionName: "launchAccount",
    args: [launch.token],
  });
  if (!account.registered || account.hook.toLowerCase() !== hook.toLowerCase())
    return;
  const [pendingLocked, pendingHook] = await Promise.all([
    publicClient.readContract({
      address: account.locker,
      abi: v4PositionLockerAbi,
      functionName: "pendingCollectedTokenFees",
    }),
    publicClient.readContract({
      address: hook,
      abi: v4ProtocolHookAbi,
      functionName: "pendingTokenFees",
      args: [launch.token],
    }),
  ]);
  const pendingLaunch = pendingLocked + pendingHook;
  await supersedeStaleProtocolDeadLetters(
    launch.token,
    "protocol-launch",
    pendingLaunch,
  );
  if (pendingLocked < minimumLaunchFees && pendingHook < minimumLaunchFees)
    return;
  try {
    if (pendingLocked >= minimumLaunchFees) {
      const plan = await v4LaunchFeePlan(
        launch.token,
        account.locker,
        pendingLocked,
      );
      await publicClient.simulateContract({
        address: account.locker,
        abi: v4PositionLockerAbi,
        functionName: "convertCollectedToken",
        args: [plan.input, plan.minimumNative, plan.deadline],
        account: writeAccount,
      });
    }
    if (pendingHook >= minimumLaunchFees) {
      const plan = await v4LaunchFeePlan(
        launch.token,
        account.locker,
        pendingHook,
      );
      await publicClient.simulateContract({
        address: hook,
        abi: v4ProtocolHookAbi,
        functionName: "convertTokenFees",
        args: [launch.token, plan.input, plan.minimumNative, plan.deadline],
        account: writeAccount,
      });
    }
  } catch {
    // Unsafe oracle, impact, liquidity, or dust state remains queued onchain.
    return;
  }
  const key = protocolLaunchJobId(account.locker);
  const payload: ProtocolConversionJob = {
    kind: "protocol-launch",
    idempotencyKey: key,
    token: launch.token,
    locker: account.locker,
    observedAmount: pendingLaunch.toString(),
  };
  const existing = await queue.getJob(key);
  if (!existing) {
    await audit(key, "queued", 0, payload);
    await queue.add("convert-v4-launch-fees", payload, {
      jobId: key,
      priority: 2,
      removeOnComplete: false,
    });
  } else if (await existing.isFailed()) {
    await audit(key, "queued", existing.attemptsMade, payload);
    await existing.retry();
  }
}

async function enqueueV4ProtocolSettlement(launch: {
  token: Address;
  vault: Address;
  market: Address;
}) {
  const router = manifest.contracts.protocolFeeRouter;
  if (!router) return;
  const [account, daoPending, treasuryPending] = await Promise.all([
    publicClient.readContract({
      address: router,
      abi: nativeProtocolFeeRouterAbi,
      functionName: "launchAccount",
      args: [launch.token],
    }),
    publicClient.readContract({
      address: router,
      abi: nativeProtocolFeeRouterAbi,
      functionName: "totalDaoNativeLiability",
    }),
    publicClient.readContract({
      address: router,
      abi: nativeProtocolFeeRouterAbi,
      functionName: "totalTreasuryNativeLiability",
    }),
  ]);
  if (!account.registered) return;
  const pending = account.pendingBasketNative + daoPending + treasuryPending;
  await supersedeStaleProtocolDeadLetters(
    launch.token,
    "protocol-native",
    pending,
  );
  if (pending === 0n) return;
  const key = protocolNativeJobId(launch.token);
  const payload: ProtocolConversionJob = {
    kind: "protocol-native",
    idempotencyKey: key,
    token: launch.token,
    locker: account.locker,
    observedAmount: pending.toString(),
  };
  const existing = await queue.getJob(key);
  if (!existing) {
    await audit(key, "queued", 0, payload);
    await queue.add("settle-v4-native-liabilities", payload, {
      jobId: key,
      priority: 1,
      removeOnComplete: false,
    });
  } else if (await existing.isFailed()) {
    await audit(key, "queued", existing.attemptsMade, payload);
    await existing.retry();
  }
}

async function enqueueProtocolConversions(launch: {
  token: Address;
  vault: Address;
  market: Address;
}) {
  const router = manifest.contracts.protocolFeeRouter;
  const base = manifest.contracts.baseAsset;
  const wrappedNative = manifest.contracts.wrappedNative;
  if (!router || !base || !wrappedNative) return;
  const account = await publicClient.readContract({
    address: router,
    abi: protocolFeeRouterAbi,
    functionName: "launchAccount",
    args: [launch.token],
  });
  if (!account.registered) return;
  const nativePending =
    account.pendingCreatorBase +
    account.pendingDaoRewardBase +
    account.pendingTreasuryBase;
  await supersedeStaleProtocolDeadLetters(
    launch.token,
    "protocol-native",
    nativePending,
  );
  if (nativePending >= minimumProtocolBase) {
    try {
      await safeMinimum(
        base,
        wrappedNative,
        boundedProtocolInput(nativePending, maximumProtocolBase),
      );
      const key = protocolNativeJobId(launch.token);
      const payload: ProtocolConversionJob = {
        kind: "protocol-native",
        idempotencyKey: key,
        token: launch.token,
        locker: account.locker,
        observedAmount: nativePending.toString(),
      };
      const existing = await queue.getJob(key);
      if (!existing) {
        await audit(key, "queued", 0, payload);
        await queue.add("convert-protocol-native", payload, {
          jobId: key,
          priority: 1,
          removeOnComplete: false,
        });
      } else if (await existing.isFailed()) {
        await audit(key, "queued", existing.attemptsMade, payload);
        await existing.retry();
      }
    } catch {
      // A fresh or unsafe TWAP remains queued onchain for the next scan.
    }
  }
  const pendingLaunch = await publicClient.readContract({
    address: account.locker,
    abi: positionLockerAbi,
    functionName: "pendingLaunchTokenFees",
  });
  await supersedeStaleProtocolDeadLetters(
    launch.token,
    "protocol-launch",
    pendingLaunch,
  );
  if (pendingLaunch >= minimumLaunchFees) {
    try {
      await safeMinimum(launch.token, base, pendingLaunch);
      const key = protocolLaunchJobId(account.locker);
      const payload: ProtocolConversionJob = {
        kind: "protocol-launch",
        idempotencyKey: key,
        token: launch.token,
        locker: account.locker,
        observedAmount: pendingLaunch.toString(),
      };
      const existing = await queue.getJob(key);
      if (!existing) {
        await audit(key, "queued", 0, payload);
        await queue.add("convert-launch-fees", payload, {
          jobId: key,
          priority: 2,
          removeOnComplete: false,
        });
      } else if (await existing.isFailed()) {
        await audit(key, "queued", existing.attemptsMade, payload);
        await existing.retry();
      }
    } catch {
      // Unsafe liquidity or TWAP data deliberately leaves fees for retry.
    }
  }
}

async function enqueueHarvest(launch: {
  token: Address;
  vault: Address;
  market: Address;
}) {
  const graduated = await publicClient.readContract({
    address: launch.market,
    abi: uniswapMarketAbi,
    functionName: "graduated",
  });
  if (!graduated) return;
  const locker = await publicClient.readContract({
    address: launch.market,
    abi: uniswapMarketAbi,
    functionName: "positionLocker",
  });
  if (isNativeV4) {
    const initialized = await publicClient.readContract({
      address: locker,
      abi: v4PositionLockerAbi,
      functionName: "initialized",
    });
    if (!initialized) return;
    const hook = manifest.contracts.oracleHook;
    if (!hook) return;
    const [nativeBalance, tokenBalance, hookNativeBalance] = await Promise.all([
      publicClient.readContract({
        address: locker,
        abi: v4PositionLockerAbi,
        functionName: "pendingCollectedNativeFees",
      }),
      publicClient.readContract({
        address: locker,
        abi: v4PositionLockerAbi,
        functionName: "pendingCollectedTokenFees",
      }),
      publicClient.readContract({
        address: hook,
        abi: v4ProtocolHookAbi,
        functionName: "pendingNativeFees",
        args: [launch.token],
      }),
    ]);
    let simulation;
    try {
      simulation = await publicClient.simulateContract({
        address: locker,
        abi: v4PositionLockerAbi,
        functionName: "collectFees",
        args: [0n, 0n],
        account: writeAccount,
      });
    } catch (error) {
      if (
        nativeBalance === 0n &&
        tokenBalance === 0n &&
        hookNativeBalance === 0n
      ) {
        const key = harvestJobId(locker);
        const staleJob = await queue.getJob(key);
        if (staleJob && (await staleJob.isFailed())) {
          const payload = staleJob.data;
          const attempts = staleJob.attemptsMade;
          await staleJob.remove();
          await audit(
            key,
            "superseded",
            attempts,
            payload,
            "Harvest was consumed by a concurrent collector before execution",
          );
        }
        return;
      }
      process.stdout.write(
        JSON.stringify({
          level: "info",
          event: "v4_harvest_collection_already_consumed",
          locker,
          message: error instanceof Error ? error.message : String(error),
        }) + "\n",
      );
    }
    if (
      nativeBalance === 0n &&
      tokenBalance === 0n &&
      hookNativeBalance === 0n &&
      simulation &&
      simulation.result[0] === 0n &&
      simulation.result[1] === 0n
    ) {
      return;
    }
  } else {
    const positionBound = await publicClient.readContract({
      address: locker,
      abi: positionLockerAbi,
      functionName: "positionBound",
    });
    if (!positionBound) return;
    try {
      const simulation = await publicClient.simulateContract({
        address: locker,
        abi: positionLockerAbi,
        functionName: "harvest",
        account: writeAccount,
      });
      if (simulation.result[0] === 0n && simulation.result[1] === 0n) return;
    } catch (error) {
      if (isEmptyHarvest(error)) return;
      throw error;
    }
  }
  const observedBlock = await publicClient.getBlockNumber();
  const key = harvestJobId(locker);
  const payload: HarvestJob = {
    kind: "harvest",
    idempotencyKey: key,
    token: launch.token,
    vault: launch.vault,
    market: launch.market,
    locker,
    observedBlock: observedBlock.toString(),
  };
  const existing = await queue.getJob(key);
  if (!existing) {
    await audit(key, "queued", 0, payload);
    await queue.add("harvest-uniswap-fees", payload, {
      jobId: key,
      priority: 3,
      removeOnComplete: false,
    });
  } else if (
    (await existing.isFailed()) &&
    isFailedJobRetryDue(existing.attemptsMade, existing.finishedOn, Date.now())
  ) {
    await audit(key, "queued", existing.attemptsMade, payload);
    await existing.retry();
  }
}

async function processConversion(
  job: Job<ConvertJob, KeeperResult>,
): Promise<KeeperResult> {
  await audit(
    job.data.idempotencyKey,
    "active",
    job.attemptsMade + 1,
    job.data,
  );
  const legIndex = BigInt(job.data.legIndex);
  const current = await readLeg(job.data.vault, legIndex);
  if (
    !isLegExecutable({
      pendingBase: current.leg.pendingBase,
      pendingSince: current.leg.pendingSince,
      minimumConversionBase: current.minimum,
      maximumPendingDelay: current.delay,
      chainTimestamp: current.timestamp,
    })
  ) {
    return {
      operation: "convert",
      transactionHash: ("0x" + "0".repeat(64)) as Hash,
      inputAmount: "0",
    };
  }
  if (isNativeV4) {
    if (current.leg.pendingBase > 2n ** 128n - 1n) {
      throw new Error("Pending native conversion exceeds uint128");
    }
    const assetRouter = await publicClient.readContract({
      address: job.data.vault,
      abi: nativeVaultAbi,
      functionName: "assetRouter",
    });
    const [route] = await Promise.all([
      publicClient.readContract({
        address: assetRouter,
        abi: v4AssetRouterAbi,
        functionName: "route",
        args: [current.leg.asset],
      }),
    ]);
    let conversionInput =
      current.leg.pendingBase > route.maximumNativeInput
        ? route.maximumNativeInput
        : current.leg.pendingBase;
    if (conversionInput === 0n) {
      throw new Error("Native conversion route has a zero input limit");
    }
    const deadline = current.timestamp + 300n;
    const simulateBatch = async (input: bigint) => {
      const quote = await publicClient.simulateContract({
        address: assetRouter,
        abi: v4AssetRouterAbi,
        functionName: "quoteNativeToAsset",
        args: [current.leg.asset, input],
        account: writeAccount,
      });
      const expected = quote.result[0];
      const minimumOutput = (expected * 9_950n) / 10_000n;
      if (expected === 0n || minimumOutput === 0n) {
        throw new Error("Native conversion route is unavailable");
      }
      return publicClient.simulateContract({
        address: job.data.vault,
        abi: nativeVaultAbi,
        functionName: "convertLeg",
        args: [legIndex, input, minimumOutput, deadline],
        account: writeAccount,
      });
    };
    let simulation;
    let lastPlanningError;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      try {
        simulation = await simulateBatch(conversionInput);
        break;
      } catch (error) {
        lastPlanningError = error;
        if (conversionInput <= 1n || attempt === 15) break;
        conversionInput /= 2n;
      }
    }
    if (!simulation) {
      throw lastPlanningError instanceof Error
        ? lastPlanningError
        : new Error("No safe native conversion batch is available");
    }
    const transactionHash = await walletClient.writeContract(
      simulation.request,
    );
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash,
      timeout: 30_000,
    });
    if (receipt.status !== "success") {
      throw new Error("Native basket conversion transaction reverted");
    }
    return {
      operation: "convert",
      transactionHash,
      inputAmount: conversionInput.toString(),
    };
  }
  const [baseAsset, router] = await Promise.all([
    publicClient.readContract({
      address: job.data.vault,
      abi: vaultAbi,
      functionName: "baseAsset",
    }),
    publicClient.readContract({
      address: job.data.vault,
      abi: vaultAbi,
      functionName: "conversionRouter",
    }),
  ]);
  let expected: bigint;
  if (isTestnet) {
    expected = await publicClient.readContract({
      address: router,
      abi: routerAbi,
      functionName: "quoteExactInput",
      args: [baseAsset, current.leg.asset, current.leg.pendingBase],
    });
  } else {
    const rate = await publicClient.readContract({
      address: router,
      abi: routerAbi,
      functionName: "rate",
      args: [baseAsset, current.leg.asset],
    });
    expected = (current.leg.pendingBase * rate) / 10n ** 18n;
  }
  const minimumOutput = (expected * 9_950n) / 10_000n;
  if (expected === 0n || minimumOutput === 0n) {
    throw new Error("Conversion route is unavailable");
  }
  const deadline = current.timestamp + 300n;
  const simulation = await publicClient.simulateContract({
    address: job.data.vault,
    abi: vaultAbi,
    functionName: "convertLeg",
    args: [legIndex, current.leg.pendingBase, minimumOutput, deadline],
    account: writeAccount,
  });
  const transactionHash = await walletClient.writeContract(simulation.request);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    timeout: 30_000,
  });
  if (receipt.status !== "success") {
    throw new Error("Conversion transaction reverted");
  }
  return {
    operation: "convert",
    transactionHash,
    inputAmount: current.leg.pendingBase.toString(),
  };
}

async function processHarvest(
  job: Job<HarvestJob, KeeperResult>,
): Promise<KeeperResult> {
  await audit(
    job.data.idempotencyKey,
    "active",
    job.attemptsMade + 1,
    job.data,
  );
  if (isNativeV4) {
    let transactionHash = ("0x" + "0".repeat(64)) as Hash;
    const hook = manifest.contracts.oracleHook;
    if (!hook) throw new Error("V4 protocol hook is missing");
    const [nativeBefore, tokenBefore, hookNativeBefore] = await Promise.all([
      publicClient.readContract({
        address: job.data.locker,
        abi: v4PositionLockerAbi,
        functionName: "pendingCollectedNativeFees",
      }),
      publicClient.readContract({
        address: job.data.locker,
        abi: v4PositionLockerAbi,
        functionName: "pendingCollectedTokenFees",
      }),
      publicClient.readContract({
        address: hook,
        abi: v4ProtocolHookAbi,
        functionName: "pendingNativeFees",
        args: [job.data.token],
      }),
    ]);
    let collection;
    try {
      collection = await publicClient.simulateContract({
        address: job.data.locker,
        abi: v4PositionLockerAbi,
        functionName: "collectFees",
        args: [0n, 0n],
        account: writeAccount,
      });
    } catch (error) {
      if (
        nativeBefore === 0n &&
        tokenBefore === 0n &&
        hookNativeBefore === 0n
      ) {
        return { operation: "harvest", transactionHash, inputAmount: "0" };
      }
      process.stdout.write(
        JSON.stringify({
          level: "info",
          event: "v4_harvest_collection_already_consumed",
          locker: job.data.locker,
          message: error instanceof Error ? error.message : String(error),
        }) + "\n",
      );
    }
    if (
      collection &&
      (collection.result[0] > 0n || collection.result[1] > 0n)
    ) {
      transactionHash = await walletClient.writeContract(collection.request);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: 30_000,
      });
      if (receipt.status !== "success") {
        throw new Error("Uniswap v4 fee collection reverted");
      }
    }
    const nativeBalance = await publicClient.readContract({
      address: job.data.locker,
      abi: v4PositionLockerAbi,
      functionName: "pendingCollectedNativeFees",
    });
    if (nativeBalance > 0n) {
      const routing = await publicClient.simulateContract({
        address: job.data.locker,
        abi: v4PositionLockerAbi,
        functionName: "routeCollectedNative",
        args: [nativeBalance],
        account: writeAccount,
      });
      transactionHash = await walletClient.writeContract(routing.request);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: 30_000,
      });
      if (receipt.status !== "success") {
        throw new Error("Collected native fee routing reverted");
      }
    }
    const hookNative = await publicClient.readContract({
      address: hook,
      abi: v4ProtocolHookAbi,
      functionName: "pendingNativeFees",
      args: [job.data.token],
    });
    if (hookNative > 0n) {
      const settlement = await publicClient.simulateContract({
        address: hook,
        abi: v4ProtocolHookAbi,
        functionName: "settleNativeFees",
        args: [job.data.token, hookNative],
        account: writeAccount,
      });
      transactionHash = await walletClient.writeContract(settlement.request);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: 30_000,
      });
      if (receipt.status !== "success")
        throw new Error("V4 hook native-fee settlement reverted");
    }
    return {
      operation: "harvest",
      transactionHash,
      inputAmount: (nativeBalance + hookNative).toString(),
      launchTokenFees: (collection?.result[1] ?? tokenBefore).toString(),
    };
  }
  let simulation;
  try {
    simulation = await publicClient.simulateContract({
      address: job.data.locker,
      abi: positionLockerAbi,
      functionName: "harvest",
      account: writeAccount,
    });
  } catch (error) {
    if (!isEmptyHarvest(error)) throw error;
    return {
      operation: "harvest",
      transactionHash: ("0x" + "0".repeat(64)) as Hash,
      inputAmount: "0",
      launchTokenFees: "0",
    };
  }
  const transactionHash = await walletClient.writeContract(simulation.request);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    timeout: 30_000,
  });
  if (receipt.status !== "success") {
    throw new Error("Uniswap fee harvest transaction reverted");
  }
  return {
    operation: "harvest",
    transactionHash,
    inputAmount: simulation.result[0].toString(),
    launchTokenFees: simulation.result[1].toString(),
  };
}

async function processProtocolConversion(
  job: Job<ProtocolConversionJob, KeeperResult>,
): Promise<KeeperResult> {
  await audit(
    job.data.idempotencyKey,
    "active",
    job.attemptsMade + 1,
    job.data,
  );
  if (isNativeV4) {
    const router = manifest.contracts.protocolFeeRouter;
    if (!router) throw new Error("V4 protocol fee router is missing");
    if (job.data.kind === "protocol-native") {
      const daoToken = manifest.contracts.daoToken;
      if (!daoToken) throw new Error("V4 DAO token is missing");
      let transactionHash = ("0x" + "0".repeat(64)) as Hash;
      let settled = 0n;
      const account = await publicClient.readContract({
        address: router,
        abi: nativeProtocolFeeRouterAbi,
        functionName: "launchAccount",
        args: [job.data.token],
      });
      if (account.pendingBasketNative > 0n) {
        const simulation = await publicClient.simulateContract({
          address: router,
          abi: nativeProtocolFeeRouterAbi,
          functionName: "settleBasketFees",
          args: [job.data.token, account.pendingBasketNative],
          account: writeAccount,
        });
        transactionHash = await walletClient.writeContract(simulation.request);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: transactionHash,
          timeout: 30_000,
        });
        if (receipt.status !== "success")
          throw new Error("V4 basket settlement reverted");
        settled += account.pendingBasketNative;
      }
      const [daoPending, eligibleSupply] = await Promise.all([
        publicClient.readContract({
          address: router,
          abi: nativeProtocolFeeRouterAbi,
          functionName: "totalDaoNativeLiability",
        }),
        publicClient.readContract({
          address: daoToken,
          abi: streamedDaoAbi,
          functionName: "eligibleRewardSupply",
        }),
      ]);
      if (daoPending > 0n && eligibleSupply > 0n) {
        const simulation = await publicClient.simulateContract({
          address: router,
          abi: nativeProtocolFeeRouterAbi,
          functionName: "settleDaoFees",
          args: [daoPending],
          account: writeAccount,
        });
        transactionHash = await walletClient.writeContract(simulation.request);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: transactionHash,
          timeout: 30_000,
        });
        if (receipt.status !== "success")
          throw new Error("V4 DAO settlement reverted");
        settled += daoPending;
      }
      const treasuryPending = await publicClient.readContract({
        address: router,
        abi: nativeProtocolFeeRouterAbi,
        functionName: "totalTreasuryNativeLiability",
      });
      if (treasuryPending > 0n) {
        const simulation = await publicClient.simulateContract({
          address: router,
          abi: nativeProtocolFeeRouterAbi,
          functionName: "settleTreasuryFees",
          args: [treasuryPending],
          account: writeAccount,
        });
        transactionHash = await walletClient.writeContract(simulation.request);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: transactionHash,
          timeout: 30_000,
        });
        if (receipt.status !== "success")
          throw new Error("V4 treasury settlement reverted");
        settled += treasuryPending;
      }
      return {
        operation: "protocol-native",
        transactionHash,
        inputAmount: settled.toString(),
      };
    }
    const hook = manifest.contracts.oracleHook;
    if (!hook) throw new Error("V4 protocol hook is missing");
    const [pendingLocked, pendingHook] = await Promise.all([
      publicClient.readContract({
        address: job.data.locker,
        abi: v4PositionLockerAbi,
        functionName: "pendingCollectedTokenFees",
      }),
      publicClient.readContract({
        address: hook,
        abi: v4ProtocolHookAbi,
        functionName: "pendingTokenFees",
        args: [job.data.token],
      }),
    ]);
    if (pendingLocked < minimumLaunchFees && pendingHook < minimumLaunchFees) {
      return {
        operation: "protocol-launch",
        transactionHash: ("0x" + "0".repeat(64)) as Hash,
        inputAmount: "0",
      };
    }
    let transactionHash = ("0x" + "0".repeat(64)) as Hash;
    let converted = 0n;
    if (pendingLocked >= minimumLaunchFees) {
      const plan = await v4LaunchFeePlan(
        job.data.token,
        job.data.locker,
        pendingLocked,
      );
      const simulation = await publicClient.simulateContract({
        address: job.data.locker,
        abi: v4PositionLockerAbi,
        functionName: "convertCollectedToken",
        args: [plan.input, plan.minimumNative, plan.deadline],
        account: writeAccount,
      });
      transactionHash = await walletClient.writeContract(simulation.request);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: 30_000,
      });
      if (receipt.status !== "success")
        throw new Error("V4 locked launch-fee conversion reverted");
      converted += plan.input;
    }
    if (pendingHook >= minimumLaunchFees) {
      const plan = await v4LaunchFeePlan(
        job.data.token,
        job.data.locker,
        pendingHook,
      );
      const simulation = await publicClient.simulateContract({
        address: hook,
        abi: v4ProtocolHookAbi,
        functionName: "convertTokenFees",
        args: [job.data.token, plan.input, plan.minimumNative, plan.deadline],
        account: writeAccount,
      });
      transactionHash = await walletClient.writeContract(simulation.request);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: 30_000,
      });
      if (receipt.status !== "success")
        throw new Error("V4 hook-fee conversion reverted");
      converted += plan.input;
    }
    return {
      operation: "protocol-launch",
      transactionHash,
      inputAmount: converted.toString(),
    };
  }

  const router = manifest.contracts.protocolFeeRouter;
  const base = manifest.contracts.baseAsset;
  const wrappedNative = manifest.contracts.wrappedNative;
  if (!router || !base || !wrappedNative)
    throw new Error("Protocol conversion configuration is missing");
  const block = await publicClient.getBlock();
  const deadline = block.timestamp + 300n;
  if (job.data.kind === "protocol-launch") {
    const pending = await publicClient.readContract({
      address: job.data.locker,
      abi: positionLockerAbi,
      functionName: "pendingLaunchTokenFees",
    });
    if (pending < minimumLaunchFees)
      return {
        operation: "protocol-launch",
        transactionHash: ("0x" + "0".repeat(64)) as Hash,
        inputAmount: "0",
      };
    const minimum = await safeMinimum(job.data.token, base, pending);
    const simulation = await publicClient.simulateContract({
      address: job.data.locker,
      abi: positionLockerAbi,
      functionName: "convertLaunchFees",
      args: [pending, minimum, deadline],
      account: writeAccount,
    });
    const transactionHash = await walletClient.writeContract(
      simulation.request,
    );
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash,
      timeout: 30_000,
    });
    if (receipt.status !== "success")
      throw new Error("Launch fee conversion reverted");
    return {
      operation: "protocol-launch",
      transactionHash,
      inputAmount: pending.toString(),
    };
  }
  const feeAccount = await publicClient.readContract({
    address: router,
    abi: protocolFeeRouterAbi,
    functionName: "launchAccount",
    args: [job.data.token],
  });
  const pending =
    feeAccount.pendingCreatorBase +
    feeAccount.pendingDaoRewardBase +
    feeAccount.pendingTreasuryBase;
  if (pending < minimumProtocolBase)
    return {
      operation: "protocol-native",
      transactionHash: ("0x" + "0".repeat(64)) as Hash,
      inputAmount: "0",
    };
  const input = boundedProtocolInput(pending, maximumProtocolBase);
  const minimum = await safeMinimum(base, wrappedNative, input);
  const simulation = await publicClient.simulateContract({
    address: router,
    abi: protocolFeeRouterAbi,
    functionName: "convertPendingToNative",
    args: [job.data.token, input, minimum, deadline],
    account: writeAccount,
  });
  const transactionHash = await walletClient.writeContract(simulation.request);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    timeout: 30_000,
  });
  if (receipt.status !== "success")
    throw new Error("Protocol native conversion reverted");
  return {
    operation: "protocol-native",
    transactionHash,
    inputAmount: input.toString(),
  };
}

async function processKeeperJob(
  job: Job<KeeperJob, KeeperResult>,
): Promise<KeeperResult> {
  if (job.data.kind === "harvest") {
    return processHarvest(job as Job<HarvestJob, KeeperResult>);
  }
  if (
    job.data.kind === "protocol-native" ||
    job.data.kind === "protocol-launch"
  ) {
    return processProtocolConversion(
      job as Job<ProtocolConversionJob, KeeperResult>,
    );
  }
  return processConversion(job as Job<ConvertJob, KeeperResult>);
}

const worker = new Worker<KeeperJob, KeeperResult>(
  queueName,
  processKeeperJob,
  { connection, concurrency: 1 },
);
async function finalizeCompletedJob(
  job: Job<KeeperJob, KeeperResult>,
  result: KeeperResult,
) {
  await audit(
    job.data.idempotencyKey,
    "completed",
    job.attemptsMade,
    job.data,
    null,
    result,
  );
  if (
    isReusableStreamJobKind(job.data.kind) ||
    job.data.kind === "convert" ||
    job.data.kind === undefined
  ) {
    await job.remove();
  }
}
worker.on("completed", (job, result) => {
  void finalizeCompletedJob(job, result).catch((error: unknown) => {
    process.stderr.write(
      JSON.stringify({
        level: "error",
        event: "completed_job_finalize_failed",
        jobId: job.id,
        message: error instanceof Error ? error.message : String(error),
      }) + "\n",
    );
  });
});
worker.on("failed", (job, error) => {
  if (!job) return;
  const attempts = Number(job.opts.attempts ?? 1);
  const terminal = job.attemptsMade >= attempts;
  void audit(
    job.data.idempotencyKey,
    failureAuditState(job.data.kind, terminal),
    job.attemptsMade,
    job.data,
    error.message,
  );
});
worker.on("error", (error) => {
  process.stderr.write(
    JSON.stringify({
      level: "error",
      event: "worker_error",
      message: error.message,
    }) + "\n",
  );
});

async function runScan() {
  try {
    await scan();
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        level: "error",
        event: "scan_failed",
        message: error instanceof Error ? error.message : String(error),
      }) + "\n",
    );
  }
}

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
await reconcileLegacyStreamJobs();
await reconcileLegacyConversionJobs();
await runScan();
while (!stopping) {
  await new Promise((resolve) => setTimeout(resolve, scanMs));
  if (!stopping) await runScan();
}
await worker.close();
await queue.close();
await auditRedis.quit();
await sql.end();
