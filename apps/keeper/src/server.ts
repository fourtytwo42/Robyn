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
  failureAuditState,
  harvestJobId,
  isLegacyStreamJobId,
  isLegExecutable,
  isReusableStreamJobKind,
  protocolLaunchJobId,
  protocolNativeJobId,
  shouldSupersedeProtocolFailure,
} from "./eligibility.js";

type Manifest = {
  chainId: number;
  contracts: {
    factory: Address;
    baseAsset?: Address;
    wrappedNative?: Address;
    protocolFeeRouter?: Address;
    nativeFeeConverter?: Address;
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
  transport: http(rpcUrl),
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
  transport: http(rpcUrl),
});
const operator = isTestnet
  ? operatorAccount?.address
  : (await walletClient.getAddresses())[0];
if (!operator) throw new Error("Keeper operator account is unavailable");
if ((await publicClient.getChainId()) !== manifest.chainId) {
  throw new Error("Keeper RPC chain mismatch");
}

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || "6379"),
  maxRetriesPerRequest: null,
};
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
const routerAbi = [
  {
    type: "function",
    name: "rate",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
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
    lastError,
    JSON.stringify(result),
  ];
  await sql.begin(async (transaction) => {
    await transaction.unsafe(
      "INSERT INTO job_audit (idempotency_key,queue,state,attempts,payload,last_error,result,completed_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,CASE WHEN $3 IN ('completed','dead_letter') THEN now() ELSE NULL END) ON CONFLICT (idempotency_key) DO UPDATE SET state=EXCLUDED.state,attempts=EXCLUDED.attempts,payload=EXCLUDED.payload,last_error=EXCLUDED.last_error,result=EXCLUDED.result,completed_at=EXCLUDED.completed_at,updated_at=now()",
      values,
    );
    await transaction.unsafe(
      "INSERT INTO job_audit_events (idempotency_key,queue,state,attempts,last_error,result) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
      [key, queueName, state, attempts, lastError, JSON.stringify(result)],
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

async function readLeg(vault: Address, legIndex: bigint) {
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
    if (manifest.market?.type === "uniswap-v3-bonding-curve-v1") {
      await enqueueHarvest(launch);
    }
    if (
      manifest.contracts.protocolFeeRouter &&
      manifest.contracts.nativeFeeConverter
    ) {
      await enqueueProtocolConversions(launch);
    }
    const count = await publicClient.readContract({
      address: launch.vault,
      abi: vaultAbi,
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
      const key = conversionJobId(
        launch.vault,
        index,
        current.leg.pendingSince,
        current.leg.pendingBase,
      );
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
    account: operator,
  });
  return simulation.result;
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
      account: operator,
    });
    if (simulation.result[0] === 0n && simulation.result[1] === 0n) return;
  } catch (error) {
    if (isEmptyHarvest(error)) return;
    throw error;
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
  const rate = await publicClient.readContract({
    address: router,
    abi: routerAbi,
    functionName: "rate",
    args: [baseAsset, current.leg.asset],
  });
  const expected = (current.leg.pendingBase * rate) / 10n ** 18n;
  const minimumOutput = (expected * 9_950n) / 10_000n;
  if (rate === 0n || minimumOutput === 0n) {
    throw new Error("Conversion route is unavailable");
  }
  const deadline = current.timestamp + 300n;
  const simulation = await publicClient.simulateContract({
    address: job.data.vault,
    abi: vaultAbi,
    functionName: "convertLeg",
    args: [legIndex, current.leg.pendingBase, minimumOutput, deadline],
    account: operator,
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
  let simulation;
  try {
    simulation = await publicClient.simulateContract({
      address: job.data.locker,
      abi: positionLockerAbi,
      functionName: "harvest",
      account: operator,
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
      account: operator,
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
    account: operator,
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
  if (isReusableStreamJobKind(job.data.kind)) {
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
await runScan();
while (!stopping) {
  await new Promise((resolve) => setTimeout(resolve, scanMs));
  if (!stopping) await runScan();
}
await worker.close();
await queue.close();
await auditRedis.quit();
await sql.end();
