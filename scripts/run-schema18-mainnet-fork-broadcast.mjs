#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  toHex,
} from "viem";
import { validateMainnetReceiptLedger } from "./lib/mainnet-receipt-ledger.mjs";
const CHAIN_ID = 4663;
const SCHEMA18_CONTRACT_SHA =
  "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const SCHEMA18_APPLICATION_SHA =
  "8327b250122cd9050a7da6a44e12859e3cf521aa";
const EXISTING_SAFE = getAddress(
  "0xE6CD65E3039fCbb7fD8fb992E5388247d9627549",
);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const upstreamRpc =
  process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const anvilPort = Number(process.env.ROBYN_MAINNET_ANVIL_PORT ?? "28548");
const localRpc = `http://127.0.0.1:${anvilPort}`;
const deployer = getAddress(process.env.ROBYN_MAINNET_DEPLOYER_ADDRESS ?? "");
const outputRoot = path.resolve(
  process.env.ROBYN_SCHEMA18_MAINNET_BROADCAST_EVIDENCE ??
    `/home/hendo420/robyn-evidence/schema18-mainnet-go/fork/${SCHEMA18_CONTRACT_SHA.slice(0, 8)}-${new Date().toISOString().replace(/[-:.]/g, "")}`,
);
const foundryBin = path.join(
  process.env.HOME ?? "/home/hendo420",
  ".foundry",
  "bin",
);
const commandEnv = {
  ...process.env,
  PATH: `${foundryBin}:${process.env.PATH}`,
};
const command = (name, args, options = {}) => {
  const output = execFileSync(name, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? commandEnv,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  return typeof output === "string" ? output.trim() : "";
};
const git = (...args) => command("git", ["-C", repoRoot, ...args]);
const json = (value) =>
  JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(upstreamRpc)) {
  throw new Error("Schema-18 Mainnet fork must use the protected loopback gateway");
}
if (git("status", "--porcelain") !== "") {
  throw new Error("Schema-18 Mainnet rehearsal requires a clean worktree");
}
if (git("rev-parse", "HEAD") !== git("rev-parse", "@{upstream}")) {
  throw new Error("Schema-18 Mainnet rehearsal requires exact pushed tooling");
}
try {
  command("git", [
    "-C",
    repoRoot,
    "diff",
    "--quiet",
    SCHEMA18_CONTRACT_SHA,
    "--",
    "packages/contracts/src",
    "packages/contracts/script/DeploySchema18.s.sol",
  ]);
} catch {
  throw new Error("qualified Schema-18 contract sources changed after Testnet");
}
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const metadata = {
  schemaVersion: 18,
  contractReleaseSha: SCHEMA18_CONTRACT_SHA,
  applicationReleaseSha: SCHEMA18_APPLICATION_SHA,
  toolingSha: git("rev-parse", "HEAD"),
  startedAt: new Date().toISOString(),
  upstream: "protected-loopback-lan-mainnet-gateway",
  alchemyPolicy: "probe-only-no-fallback",
  executionMode: "local-fork-broadcast",
  mainnetBroadcastAuthorized: false,
};
await writeFile(
  path.join(outputRoot, "run-metadata.json"),
  `${json(metadata)}\n`,
  { mode: 0o600, flag: "wx" },
);

const upstream = createPublicClient({
  transport: http(upstreamRpc, { timeout: 60_000, retryCount: 0 }),
});
if (
  (await upstream.getChainId()) !== CHAIN_ID ||
  (await upstream.request({ method: "eth_syncing", params: [] })) !== false
) {
  throw new Error("LAN Mainnet gateway is wrong-chain or syncing");
}
const gatewayHealth = await fetch(new URL("/health", upstreamRpc)).then(
  async (response) => {
    if (!response.ok) throw new Error(`gateway health ${response.status}`);
    return response.json();
  },
);
if (
  gatewayHealth.status !== "ok" ||
  gatewayHealth.activeProvider !== "primary" ||
  gatewayHealth.providerSelection !== "operator" ||
  gatewayHealth.fallbackTrafficAuthorized !== false
) {
  throw new Error("Mainnet gateway is not LAN-only with fallback disabled");
}
const upstreamHead = await upstream.getBlockNumber();
const forkBlock = upstreamHead > 3n ? upstreamHead - 3n : upstreamHead;

try {
  const occupied = createPublicClient({
    transport: http(localRpc, { timeout: 2_000, retryCount: 0 }),
  });
  await occupied.getChainId();
  throw new Error(`refusing to reuse occupied Anvil port ${anvilPort}`);
} catch (error) {
  if (String(error?.message).includes("refusing to reuse")) throw error;
}
const anvilLog = createWriteStream(path.join(outputRoot, "anvil.log"), {
  flags: "wx",
  mode: 0o600,
});
const anvil = spawn(
  path.join(foundryBin, "anvil"),
  [
    "--host",
    "127.0.0.1",
    "--port",
    String(anvilPort),
    "--chain-id",
    String(CHAIN_ID),
    "--fork-url",
    upstreamRpc,
    "--fork-block-number",
    forkBlock.toString(),
    "--gas-limit",
    "100000000",
    "--auto-impersonate",
    "--silent",
  ],
  { env: commandEnv, stdio: ["ignore", "pipe", "pipe"] },
);
anvil.stdout.pipe(anvilLog);
anvil.stderr.pipe(anvilLog);
const stopAnvil = async () => {
  if (!anvil.killed) anvil.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3_000);
    anvil.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  anvilLog.end();
};
const local = createPublicClient({
  transport: http(localRpc, { timeout: 60_000, retryCount: 0 }),
});
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    if ((await local.getChainId()) === CHAIN_ID) break;
  } catch {
    if (attempt === 99) throw new Error("Anvil did not become ready");
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
await local.request({ method: "anvil_setBalance", params: [deployer, toHex(100n * 10n ** 18n)] });
await local.request({ method: "anvil_impersonateAccount", params: [deployer] });

const prepareRoot = path.join(outputRoot, "prepared");
const lifecycleRoot = path.join(outputRoot, "lifecycle");
const foundryInput = path.join(
  repoRoot,
  "packages/contracts/tmp/schema18-mainnet-deployment-input.json",
);
const env = {
  ...commandEnv,
  ROBYN_MAINNET_DEPLOYER_ADDRESS: deployer,
  ROBYN_SCHEMA18_MAINNET_PREPARE_OUTPUT: prepareRoot,
  ROBYN_SCHEMA18_MAINNET_RPC_URL: localRpc,
  ROBYN_SCHEMA18_NETWORK: "mainnet-fork",
  ROBYN_SCHEMA18_MAINNET_RELEASE_SHA: SCHEMA18_CONTRACT_SHA,
  ROBYN_SCHEMA18_MAINNET_EVIDENCE: lifecycleRoot,
};
let summary;
try {
  command(process.execPath, ["scripts/prepare-schema18-mainnet-rehearsal.mjs"], { env, stdio: "inherit" });
  const prepared = JSON.parse(
    await readFile(path.join(prepareRoot, "deployment-prepared.json"), "utf8"),
  );
  await mkdir(path.dirname(foundryInput), { recursive: true, mode: 0o700 });
  await copyFile(path.join(prepareRoot, "deployment-prepared.json"), foundryInput);
  env.ROBYN_SCHEMA18_MAINNET_MANIFEST = path.join(prepareRoot, "lifecycle-manifest.json");
  env.SCHEMA18_DEPLOYMENT_INPUT = foundryInput;

  command("forge", ["build", "--root", "packages/contracts"], { env });
  command(
    "forge",
    [
      "script",
      "script/DeploySchema18.s.sol:DeploySchema18",
      "--root",
      "packages/contracts",
      "--rpc-url",
      localRpc,
      "--broadcast",
      "--unlocked",
      "--sender",
      deployer,
      "--slow",
      "--gas-estimate-multiplier",
      "150",
    ],
    { env, stdio: "inherit" },
  );
  const broadcastPath = path.join(
    repoRoot,
    "packages/contracts/broadcast/DeploySchema18.s.sol/4663/run-latest.json",
  );
  await access(broadcastPath);
  const broadcastRaw = await readFile(broadcastPath, "utf8");
  await writeFile(path.join(outputRoot, "deployment-broadcast.json"), broadcastRaw, {
    mode: 0o600,
    flag: "wx",
  });

  const lifecycleScript = "scripts/run-schema18-testnet-lifecycle.mjs";
  const lifecycle = (stage) =>
    command(process.execPath, [lifecycleScript, stage], { env, stdio: "inherit" });
  lifecycle("verify");
  lifecycle("bootstrap1");
  lifecycle("routes");
  lifecycle("launch");
  await local.request({ method: "evm_increaseTime", params: [toHex(301n)] });
  await local.request({ method: "evm_mine", params: [] });
  lifecycle("settle");
  await local.request({ method: "evm_increaseTime", params: [toHex(3_601n)] });
  await local.request({ method: "evm_mine", params: [] });
  lifecycle("claims");
  lifecycle("unwind");
  await local.request({ method: "evm_increaseTime", params: [toHex(301n)] });
  await local.request({ method: "evm_mine", params: [] });
  lifecycle("post-settle");
  lifecycle("bootstrap2");
  lifecycle("shutdown");
  lifecycle("reconcile");

  const lifecycleState = JSON.parse(
    await readFile(path.join(lifecycleRoot, "state.json"), "utf8"),
  );
  const journal = (await readFile(path.join(lifecycleRoot, "transactions.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const broadcast = JSON.parse(broadcastRaw);
  const receiptsByHash = new Map(
    broadcast.receipts.map((receipt) => [receipt.transactionHash.toLowerCase(), receipt]),
  );
  const transactions = [];
  let sequence = 0;
  for (const transaction of broadcast.transactions) {
    const receipt = receiptsByHash.get(transaction.hash?.toLowerCase());
    if (!receipt || receipt.status !== "0x1") {
      throw new Error("deployment broadcast contains a failed or missing receipt");
    }
    const tx = await local.getTransaction({ hash: transaction.hash });
    const phase = ["CREATE", "CREATE2"].includes(transaction.transactionType)
      ? "deployment"
      : "bindings";
    transactions.push({
      idempotencyKey: `schema18:${phase}:${String(++sequence).padStart(3, "0")}`,
      phase,
      category: "deployment",
      label: transaction.contractName ?? transaction.function ?? transaction.transactionType,
      expectedEffect: transaction.function ?? transaction.transactionType,
      transactionHash: transaction.hash,
      blockNumber: BigInt(receipt.blockNumber).toString(),
      receiptStatus: "success",
      gasUsed: BigInt(receipt.gasUsed).toString(),
      effectiveGasPriceWei: BigInt(receipt.effectiveGasPrice).toString(),
      valueWei: tx.value.toString(),
      to: tx.to ?? null,
      data: tx.input,
      nonce: tx.nonce.toString(),
      calldataHash: keccak256(tx.input),
      normalizedReceipt: {
        transactionHash: transaction.hash,
        blockNumber: BigInt(receipt.blockNumber).toString(),
        status: "success",
        gasUsed: BigInt(receipt.gasUsed).toString(),
        effectiveGasPriceWei: BigInt(receipt.effectiveGasPrice).toString(),
        contractAddress: receipt.contractAddress ?? null,
        logCount: receipt.logs?.length ?? 0,
      },
    });
  }
  const phaseFor = (record) => {
    if (record.phase === "bootstrap") {
      return record.label === "bootstrap1" ? "canary-activation" : "profile-governance";
    }
    if (record.phase === "routes") return "post-graduation-trades";
    if (record.phase === "launch") {
      if (record.label === "create-canary-launch") return "canary-launch";
      if (record.label.startsWith("bonding-buy")) return "bonding-graduation";
      return "post-graduation-trades";
    }
    if (record.phase === "settle") return "fee-settlement";
    if (record.phase === "claims") return "reward-claims";
    if (record.phase === "unwind") return "canary-unwind";
    if (record.phase === "post-settle" || record.phase === "shutdown") {
      return "post-unwind-settlement";
    }
    throw new Error(`unmapped lifecycle phase ${record.phase}`);
  };
  const intents = new Map(
    journal.filter((item) => item.type === "intent").map((item) => [item.idempotencyKey, item]),
  );
  for (const receipt of journal.filter((item) => item.type === "receipt")) {
    const intent = intents.get(receipt.idempotencyKey);
    if (!intent) throw new Error(`receipt ${receipt.idempotencyKey} has no intent`);
    const tx = await local.getTransaction({ hash: receipt.transactionHash });
    const phase = phaseFor(receipt);
    transactions.push({
      idempotencyKey: receipt.idempotencyKey,
      phase,
      category: "canary",
      label: receipt.label,
      expectedEffect: receipt.label,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      receiptStatus: receipt.status,
      gasUsed: receipt.gasUsed,
      effectiveGasPriceWei: receipt.effectiveGasPriceWei,
      valueWei: tx.value.toString(),
      to: tx.to,
      data: tx.input,
      nonce: tx.nonce.toString(),
      calldataHash: intent.calldataHash,
      normalizedReceipt: {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        gasUsed: receipt.gasUsed,
        effectiveGasPriceWei: receipt.effectiveGasPriceWei,
        contractAddress: null,
        logCount: (await local.getTransactionReceipt({ hash: receipt.transactionHash })).logs.length,
      },
    });
  }

  const runtimeAddresses = Object.entries({
    existingSafe: EXISTING_SAFE,
    ...prepared.deployment.contracts,
    ...prepared.external,
  });
  const runtimeIdentities = [];
  for (const [name, address] of runtimeAddresses) {
    const code = await local.getCode({ address: getAddress(address) });
    if (!code || code === "0x") throw new Error(`runtime missing for ${name}`);
    runtimeIdentities.push({
      name,
      address: getAddress(address),
      runtimeCodeHash: keccak256(code),
    });
  }
  const preparationRaw = await readFile(path.join(prepareRoot, "preparation-report.json"), "utf8");
  const preparation = JSON.parse(preparationRaw);
  const ledger = {
    schemaVersion: 18,
    generatedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    executionMode: "local-fork-broadcast",
    forkBlock: forkBlock.toString(),
    releaseSha: SCHEMA18_CONTRACT_SHA,
    applicationReleaseSha: SCHEMA18_APPLICATION_SHA,
    toolingSha: metadata.toolingSha,
    productionConfigHash: `0x${sha256(preparationRaw)}`,
    deploymentManifestHash: `0x${preparation.lifecycleManifestSha256}`,
    runtimeIdentities,
    transactions,
    mainnetBroadcastAuthorized: false,
  };
  const validation = validateMainnetReceiptLedger(ledger, {
    releaseSha: SCHEMA18_CONTRACT_SHA,
    productionConfigHash: ledger.productionConfigHash,
  });
  await writeFile(path.join(outputRoot, "gas-evidence.json"), `${json(ledger)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  const recoveryBps = BigInt(lifecycleState.recoveryBps);
  const capital = {
    schemaVersion: 18,
    forkBlock: forkBlock.toString(),
    canaryPrincipalWei: lifecycleState.canaryPrincipalWei,
    roundTripRecoveredWei: lifecycleState.roundTripRecoveredWei,
    unwindRecoveredWei: lifecycleState.unwindRecoveredWei,
    totalRecoveredWei: lifecycleState.recoveredWei,
    recoveryBps: recoveryBps.toString(),
    lockedPrincipal: lifecycleState.lockedPrincipal,
    passed: recoveryBps >= 7_500n,
  };
  await writeFile(path.join(outputRoot, "capital-ledger.json"), `${json(capital)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  const localDeployment = {
    schemaVersion: 18,
    chainId: CHAIN_ID,
    forkBlock: forkBlock.toString(),
    releaseSha: SCHEMA18_CONTRACT_SHA,
    applicationReleaseSha: SCHEMA18_APPLICATION_SHA,
    productionConfigHash: ledger.productionConfigHash,
    existingSafe: EXISTING_SAFE,
    contracts: prepared.deployment.contracts,
    routes: JSON.parse(
      await readFile(path.join(prepareRoot, "lifecycle-manifest.json"), "utf8"),
    ).routeSnapshots.map((route) => ({ ...route, executedBothDirections: true })).concat([
      {
        symbol: "WETH",
        asset: prepared.external.wrappedNative,
        routeKind: "wrapped-native",
        executedBothDirections: true,
      },
    ]),
    canary: {
      token: lifecycleState.token,
      vault: lifecycleState.vault,
      market: lifecycleState.market,
      adapter: lifecycleState.adapter,
      locker: lifecycleState.locker,
    },
    validation,
    mainnetBroadcastAuthorized: false,
  };
  await writeFile(path.join(outputRoot, "local-deployment.json"), `${json(localDeployment)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  summary = {
    passed: true,
    schemaVersion: 18,
    outputRoot,
    forkBlock: forkBlock.toString(),
    transactionCount: transactions.length,
    recoveryBps: recoveryBps.toString(),
    mainnetBroadcastAuthorized: false,
  };
  await writeFile(path.join(outputRoot, "summary.json"), `${json(summary)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`${json(summary)}\n`);
} catch (error) {
  await writeFile(
    path.join(outputRoot, "failure.json"),
    `${json({
      passed: false,
      failedAt: new Date().toISOString(),
      error: error.stack ?? error.message,
      mainnetBroadcastAuthorized: false,
    })}\n`,
    { mode: 0o600 },
  ).catch(() => {});
  throw error;
} finally {
  await stopAnvil();
  await rm(foundryInput, { force: true });
  await rm(path.join(outputRoot, "anvil.pid"), { force: true });
}
