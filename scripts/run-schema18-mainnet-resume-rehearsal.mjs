#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";
import { exactFinalBondingPurchase } from "./lib/schema18-canary-resume.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const sourcePath = path.resolve(required("ROBYN_SCHEMA18_GATE1_LIFECYCLE_MANIFEST"));
const gate1Path = path.resolve(required("ROBYN_SCHEMA18_GATE1_AUTHORIZED_MANIFEST"));
const output = path.resolve(required("ROBYN_SCHEMA18_MAINNET_RESUME_REHEARSAL"));
const gateway = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const anvilRpc = "http://127.0.0.1:28629";
const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const source = JSON.parse(await readFile(sourcePath, "utf8"));
const gate1 = JSON.parse(await readFile(gate1Path, "utf8"));
if (
  source.schemaVersion !== 18 ||
  source.chainId !== 4663 ||
  gate1.contractReleaseSha !== source.releaseSha
) {
  throw new Error("Gate 1 evidence mismatch");
}
const live = createPublicClient({ transport: http(gateway, { timeout: 30_000, retryCount: 0 }) });
if (
  (await live.getChainId()) !== 4663 ||
  (await live.request({ method: "eth_syncing", params: [] })) !== false
) {
  throw new Error("LAN gateway unavailable, wrong-chain, or syncing");
}
const health = await fetch(new URL("/health", gateway)).then(async (response) => {
  if (!response.ok) throw new Error(`gateway health ${response.status}`);
  return response.json();
});
if (
  health.status !== "ok" ||
  health.activeProvider !== "primary" ||
  health.providerSelection !== "operator" ||
  health.fallbackTrafficAuthorized !== false
) {
  throw new Error("LAN-only gateway policy failed");
}
const forkBlock = await live.getBlockNumber();
const forkBaseFeePerGas = (await live.getBlock({ blockNumber: forkBlock })).baseFeePerGas;
if (forkBaseFeePerGas === null) throw new Error("pinned fork block lacks EIP-1559 base fee");
await mkdir(output, { recursive: true, mode: 0o700 });
const toolingSha = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const runtimeIdentities = await Promise.all(
  gate1.runtimeIdentities.map(async (identity) => {
    const code = await live.getCode({ address: getAddress(identity.address) });
    if (!code || code === "0x") throw new Error(`missing live runtime ${identity.name}`);
    return {
      ...identity,
      qualifiedRuntimeCodeHash: identity.runtimeCodeHash,
      runtimeCodeHash: keccak256(code),
    };
  }),
);
const artifact = async (name, sourceName = `${name}.sol`) =>
  JSON.parse(
    await readFile(
      path.join(repoRoot, "packages/contracts/out", sourceName, `${name}.json`),
      "utf8",
    ),
  );
const governorAbi = parseAbi(["function unanimousNonce() view returns (uint256)"]);
const coordinatorAbi = parseAbi(["function launchMode() view returns (uint8)"]);
const assetAbi = parseAbi(["function conversionsPaused() view returns (bool)"]);
const feeAbi = parseAbi(["function paused() view returns (bool)"]);
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const launchFactoryAbi = (await artifact("RobynNativeLaunchFactoryV4")).abi;
const marketFactoryAbi = (await artifact("RobynV4MarketFactory")).abi;
const marketAbi = (await artifact("RobynV4BondingCurveMarket")).abi;
const c = source.contracts;
const read = (address, abi, functionName, args = []) =>
  live.readContract({ address: getAddress(address), abi, functionName, args });
if (
  Number(await read(c.atomicLaunchCoordinator, coordinatorAbi, "launchMode")) !== 0 ||
  !(await read(c.assetRouter, assetAbi, "conversionsPaused")) ||
  !(await read(c.protocolFeeRouter, feeAbi, "paused"))
) {
  throw new Error("Mainnet is not fully Paused before resume rehearsal");
}
const expectedUnanimousNonce = await read(c.governor, governorAbi, "unanimousNonce");
const priorStepOne = source.bootstrap.steps[0];
const token = getAddress(required("ROBYN_SCHEMA18_MAINNET_INCIDENT_TOKEN"));
const market = getAddress(required("ROBYN_SCHEMA18_MAINNET_INCIDENT_MARKET"));
const [mappedMarket, vault, graduated, nativeRaised, threshold, maximumPurchase, feeBps] =
  await Promise.all([
    read(c.marketFactory, marketFactoryAbi, "marketByToken", [token]),
    read(c.launchFactory, launchFactoryAbi, "vaultByToken", [token]),
    read(market, marketAbi, "graduated"),
    read(market, marketAbi, "nativeRaised"),
    read(market, marketAbi, "graduationThresholdNative"),
    read(market, marketAbi, "maximumCurvePurchase"),
    read(market, marketAbi, "feeBps"),
  ]);
if (getAddress(mappedMarket).toLowerCase() !== market.toLowerCase() || graduated) {
  throw new Error("incident launch mapping or bonding phase changed");
}
const exactFinalPurchaseWei = exactFinalBondingPurchase({
  nativeRaised,
  graduationThreshold: threshold,
  feeBps,
});
if (exactFinalPurchaseWei > maximumPurchase) {
  throw new Error("exact final purchase exceeds immutable purchase cap");
}
const incident = {
  token,
  vault: getAddress(vault),
  market,
  nativeRaisedWei: nativeRaised.toString(),
  graduationThresholdWei: threshold.toString(),
  maximumCurvePurchaseWei: maximumPurchase.toString(),
  feeBps: feeBps.toString(),
  projectTokenBalance: (await read(token, tokenAbi, "balanceOf", [source.deployer])).toString(),
  exactFinalPurchaseWei: exactFinalPurchaseWei.toString(),
};
const recovery = {
  expectedUnanimousNonce: expectedUnanimousNonce.toString(),
  sourceBootstrapStepOnePlanHash: priorStepOne.planHash,
  reactivation: {
    calls: priorStepOne.calls,
    targets: priorStepOne.targets,
    valuesWei: priorStepOne.valuesWei,
    payloads: priorStepOne.payloads,
    descriptionHash: keccak256(Buffer.from("SCHEMA18_GATE2_EXACT_STATE_RESUME")),
  },
};
const liveFees = await live.estimateFeesPerGas();
const rehearsalBaseMaxFeePerGasWei = liveFees.maxFeePerGas ?? liveFees.gasPrice;
const manifest = {
  schemaVersion: 18,
  chainId: 4663,
  authorizationEligible: true,
  contractReleaseSha: source.releaseSha,
  applicationReleaseSha: source.applicationReleaseSha,
  operationalToolingSha: toolingSha,
  deployer: source.deployer,
  guardianSafe: source.guardianSafe,
  contracts: source.contracts,
  bootstrap: source.bootstrap,
  recovery,
  incident,
  routes: source.routes,
  runtimeIdentities,
  gas: {
    phaseCeilings: Object.fromEntries(
      ["recovery", "graduate", "settle", "claims", "unwind", "post-settle", "shutdown"].map(
        (phase) => [phase, "30000000"],
      ),
    ),
    maxFeePerGasWei: "1000000000000",
    rehearsalBaseMaxFeePerGasWei: rehearsalBaseMaxFeePerGasWei.toString(),
  },
  authorization: {
    additionalBridgeAuthorized: false,
    bootstrapFinalizationAuthorized: false,
    unanimousRecoveryAuthorized: false,
    canaryTransactionsAuthorized: false,
    publicActivationAuthorized: false,
    applicationWritesAuthorized: false,
  },
};
const manifestPath = path.join(output, "rehearsal-input-manifest.json");
const raw = `${json(manifest)}\n`;
await writeFile(manifestPath, raw, { mode: 0o600 });
const env = {
  ...process.env,
  ROBYN_SCHEMA18_MAINNET_RESUME_LOCAL_REHEARSAL: "true",
  ROBYN_SCHEMA18_MAINNET_RESUME_MANIFEST: manifestPath,
  ROBYN_SCHEMA18_MAINNET_RESUME_MANIFEST_SHA256: sha256(raw),
  ROBYN_SCHEMA18_MAINNET_RESUME_EVIDENCE: output,
  ROBYN_MAINNET_GATEWAY_RPC_URL: anvilRpc,
};
const anvil = spawn(
  path.join(process.env.HOME ?? "/home/hendo420", ".foundry/bin/anvil"),
  [
    "--fork-url",
    gateway,
    "--fork-block-number",
    forkBlock.toString(),
    "--chain-id",
    "4663",
    "--port",
    "28629",
    "--base-fee",
    forkBaseFeePerGas.toString(),
    "--no-priority-fee",
    "--silent",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const rpc = async (method, params = []) => {
  const response = await fetch(anvilRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
};
const wait = async () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if (
        (await rpc("eth_chainId")) === "0x1237" &&
        BigInt(await rpc("eth_blockNumber")) === forkBlock
      ) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Anvil did not start at the exact pinned fork block");
};
const run = (stage) =>
  execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts/run-schema18-mainnet-resume-live.mjs"), stage],
    { cwd: repoRoot, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
try {
  await wait();
  await rpc("anvil_impersonateAccount", [source.deployer]);
  run("verify");
  run("schedule-resume");
  await rpc("evm_increaseTime", [3601]);
  await rpc("evm_mine");
  run("execute-resume");
  run("graduate");
  await rpc("evm_increaseTime", [301]);
  await rpc("evm_mine");
  run("settle");
  await rpc("evm_increaseTime", [3601]);
  await rpc("evm_mine");
  run("claims");
  run("unwind");
  await rpc("evm_increaseTime", [301]);
  await rpc("evm_mine");
  run("post-settle");
  run("shutdown");
  run("reconcile");
  const statePath = path.join(output, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.forkBlock = forkBlock.toString();
  await writeFile(statePath, `${json(state)}\n`, { mode: 0o600 });
  const journal = await readFile(path.join(output, "transactions.jsonl"), "utf8");
  const receipts = journal
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((record) => record.type === "receipt");
  const report = {
    schemaVersion: 18,
    status: "passed",
    executionMode: "local-fork-broadcast",
    forkBlock: forkBlock.toString(),
    contractReleaseSha: source.releaseSha,
    applicationReleaseSha: source.applicationReleaseSha,
    receiptCount: receipts.length,
    recoveryBps: state.recoveryBps,
    completedStages: state.completedStages,
    initialBalanceWei: state.initialBalanceWei,
    minimumBalanceWei: state.minimumBalanceWei,
    finalBalanceWei: state.finalBalanceWei,
    mainnetTransactionsBroadcast: 0,
  };
  const reportRaw = `${json(report)}\n`;
  await writeFile(path.join(output, "rehearsal-report.json"), reportRaw, { mode: 0o600 });
  const sums = [
    ["rehearsal-input-manifest.json", sha256(raw)],
    ["state.json", sha256(await readFile(statePath))],
    ["transactions.jsonl", sha256(journal)],
    ["rehearsal-report.json", sha256(reportRaw)],
  ];
  await writeFile(
    path.join(output, "SHA256SUMS"),
    `${sums.map(([file, hash]) => `${hash}  ${file}`).join("\n")}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(`${json(report)}\n`);
} finally {
  anvil.kill("SIGTERM");
}
