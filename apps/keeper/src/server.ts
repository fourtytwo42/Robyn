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
import { conversionJobId, isLegExecutable } from "./eligibility.js";

type Manifest = {
  chainId: number;
  contracts: { factory: Address };
  market?: { type?: string };
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
type KeeperJob = ConvertJob | HarvestJob;
type KeeperResult = {
  operation: "convert" | "harvest";
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
        await queue.add("convert-leg", payload, { jobId: key });
      }
    }
  }
  await heartbeat();
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
  const key = `harvest-${locker.toLowerCase()}-${observedBlock}`;
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
    await queue.add("harvest-uniswap-fees", payload, { jobId: key });
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

async function processKeeperJob(
  job: Job<KeeperJob, KeeperResult>,
): Promise<KeeperResult> {
  if (job.data.kind === "harvest") {
    return processHarvest(job as Job<HarvestJob, KeeperResult>);
  }
  return processConversion(job as Job<ConvertJob, KeeperResult>);
}

const worker = new Worker<KeeperJob, KeeperResult>(
  queueName,
  processKeeperJob,
  { connection, concurrency: 1 },
);
worker.on("completed", (job, result) => {
  void audit(
    job.data.idempotencyKey,
    "completed",
    job.attemptsMade,
    job.data,
    null,
    result,
  );
});
worker.on("failed", (job, error) => {
  if (!job) return;
  const attempts = Number(job.opts.attempts ?? 1);
  const terminal = job.attemptsMade >= attempts;
  void audit(
    job.data.idempotencyKey,
    terminal ? "dead_letter" : "retrying",
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
await runScan();
while (!stopping) {
  await new Promise((resolve) => setTimeout(resolve, scanMs));
  if (!stopping) await runScan();
}
await worker.close();
await queue.close();
await auditRedis.quit();
await sql.end();
