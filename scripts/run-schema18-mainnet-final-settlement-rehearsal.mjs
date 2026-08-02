#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_SHA = "5ea50ed836d81416a7a6a32c8078a864fca28d0b";
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const sourcePath = path.resolve(required("ROBYN_SCHEMA18_GATE1_LIFECYCLE_MANIFEST"));
const gate1Path = path.resolve(required("ROBYN_SCHEMA18_GATE1_AUTHORIZED_MANIFEST"));
const sourcePostgradRoot = path.resolve(required("ROBYN_SCHEMA18_CONSUMED_GATE2_EVIDENCE"));
const output = path.resolve(required("ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_REHEARSAL"));
const gateway = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const anvilRpc = "http://127.0.0.1:28640";
const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const source = JSON.parse(await readFile(sourcePath, "utf8"));
const gate1 = JSON.parse(await readFile(gate1Path, "utf8"));
const sourcePostgradStatePath = path.join(sourcePostgradRoot, "state.json");
const sourcePostgradJournalPath = path.join(sourcePostgradRoot, "transactions.jsonl");
const sourcePostgradStateRaw = await readFile(sourcePostgradStatePath, "utf8");
const sourcePostgradJournalRaw = await readFile(sourcePostgradJournalPath, "utf8");
const sourcePostgradSumsPath = path.join(sourcePostgradRoot, "SHA256SUMS");
const sourcePostgradSummaryPath = path.join(sourcePostgradRoot, "final-summary.json");
const sourcePostgradSumsRaw = await readFile(sourcePostgradSumsPath, "utf8");
const sourcePostgradSummaryRaw = await readFile(sourcePostgradSummaryPath, "utf8");
const sourcePostgradState = JSON.parse(sourcePostgradStateRaw);
const sourcePostgradRecords = sourcePostgradJournalRaw.trim().split("\n").map(JSON.parse);
const sourcePostgradIntents = sourcePostgradRecords.filter((record) => record.type === "intent");
const sourcePostgradReceipts = sourcePostgradRecords.filter((record) => record.type === "receipt");
const sourceKeys = new Set();
const sourceHashes = new Set();
if (
  sourcePostgradState.failedRun !== true ||
  sourcePostgradState.failedStage !== "post-settle" ||
  !sourcePostgradState.completedStages?.includes("claims") ||
  !sourcePostgradState.completedStages?.includes("unwind") ||
  !sourcePostgradState.completedStages?.includes("shutdown") ||
  sourcePostgradIntents.length === 0 ||
  sourcePostgradIntents.length !== sourcePostgradReceipts.length
) {
  throw new Error("consumed post-unwind evidence is not the sealed post-graduation shutdown state");
}
for (const receipt of sourcePostgradReceipts) {
  if (
    receipt.status !== "success" ||
    sourceKeys.has(receipt.idempotencyKey) ||
    sourceHashes.has(receipt.transactionHash)
  ) {
    throw new Error("consumed post-unwind receipt ledger is failed, duplicate, or ambiguous");
  }
  sourceKeys.add(receipt.idempotencyKey);
  sourceHashes.add(receipt.transactionHash);
}
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
const token = getAddress(sourcePostgradState.token);
const market = getAddress(sourcePostgradState.market);
const adapter = getAddress(sourcePostgradState.adapter);
const locker = getAddress(sourcePostgradState.locker);
const adapterAbi = (await artifact("RobynV4GraduationAdapter")).abi;
const lockerAbi = (await artifact("RobynV4FeePositionLocker")).abi;
const [mappedMarket, vault, graduated, nativeRaised, threshold, maximumPurchase, mappedAdapter] =
  await Promise.all([
    read(c.marketFactory, marketFactoryAbi, "marketByToken", [token]),
    read(c.launchFactory, launchFactoryAbi, "vaultByToken", [token]),
    read(market, marketAbi, "graduated"),
    read(market, marketAbi, "nativeRaised"),
    read(market, marketAbi, "graduationThresholdNative"),
    read(market, marketAbi, "maximumCurvePurchase"),
    read(market, marketAbi, "graduationAdapter"),
  ]);
const [mappedLocker, lockedPrincipal, profile, projectTokenBalance] = await Promise.all([
  read(adapter, adapterAbi, "locker"),
  read(locker, lockerAbi, "principalLiquidity"),
  read(c.marketFactory, marketFactoryAbi, "graduationProfileByToken", [token]),
  read(token, tokenAbi, "balanceOf", [source.deployer]),
]);
if (
  getAddress(mappedMarket).toLowerCase() !== market.toLowerCase() ||
  getAddress(vault).toLowerCase() !== sourcePostgradState.vault.toLowerCase() ||
  getAddress(mappedAdapter).toLowerCase() !== adapter.toLowerCase() ||
  getAddress(mappedLocker).toLowerCase() !== locker.toLowerCase() ||
  !graduated ||
  nativeRaised !== threshold ||
  lockedPrincipal !== BigInt(sourcePostgradState.lockedPrincipal) ||
  projectTokenBalance !== 0n ||
  BigInt(sourcePostgradState.recoveryBps) < 7_500n ||
  profile.targetGraduationNative !== BigInt(sourcePostgradState.canaryTargetWei) ||
  profile.actualGraduationNative !== BigInt(sourcePostgradState.canaryPrincipalWei)
) {
  throw new Error("live graduated Canary differs from consumed post-unwind evidence");
}
const canary = {
  token,
  vault: getAddress(vault),
  market,
  adapter,
  locker,
  graduated: true,
  nativeRaisedWei: nativeRaised.toString(),
  graduationThresholdWei: threshold.toString(),
  maximumCurvePurchaseWei: maximumPurchase.toString(),
  projectTokenBalance: projectTokenBalance.toString(),
  lockedPrincipal: lockedPrincipal.toString(),
  profileVersion: profile.version.toString(),
  targetGraduationNativeWei: profile.targetGraduationNative.toString(),
  actualGraduationNativeWei: profile.actualGraduationNative.toString(),
  roundTripRecoveredWei: sourcePostgradState.roundTripRecoveredWei,
  unwindRecoveredWei: sourcePostgradState.unwindRecoveredWei,
  recoveredWei: sourcePostgradState.recoveredWei,
  recoveryBps: sourcePostgradState.recoveryBps,
  graduatedAt: sourcePostgradState.graduatedAt,
};
const recovery = {
  expectedUnanimousNonce: expectedUnanimousNonce.toString(),
  sourceBootstrapStepOnePlanHash: priorStepOne.planHash,
  reactivation: {
    calls: priorStepOne.calls,
    targets: priorStepOne.targets,
    valuesWei: priorStepOne.valuesWei,
    payloads: priorStepOne.payloads,
    descriptionHash: keccak256(Buffer.from("SCHEMA18_GATE2_FINAL_SETTLEMENT_REACTIVATION")),
  },
};
const liveFees = await live.estimateFeesPerGas();
const rehearsalBaseMaxFeePerGasWei = liveFees.maxFeePerGas ?? liveFees.gasPrice;
const manifest = {
  schemaVersion: 18,
  chainId: 4663,
  authorizationEligible: true,
  contractReleaseSha: source.releaseSha,
  applicationReleaseSha: APP_SHA,
  operationalToolingSha: toolingSha,
  deployer: source.deployer,
  guardianSafe: source.guardianSafe,
  contracts: source.contracts,
  bootstrap: source.bootstrap,
  recovery,
  canary,
  routes: source.routes,
  runtimeIdentities,
  sourcePostgrad: {
    evidenceRoot: sourcePostgradRoot,
    statePath: sourcePostgradStatePath,
    journalPath: sourcePostgradJournalPath,
    stateSha256: sha256(sourcePostgradStateRaw),
    journalSha256: sha256(sourcePostgradJournalRaw),
    receiptCount: sourcePostgradReceipts.length,
    sumsPath: sourcePostgradSumsPath,
    sumsSha256: sha256(sourcePostgradSumsRaw),
    finalSummaryPath: sourcePostgradSummaryPath,
    finalSummarySha256: sha256(sourcePostgradSummaryRaw),
  },
  gas: {
    phaseCeilings: Object.fromEntries(
      ["recovery", "oracle-refresh", "final-settlement", "shutdown"].map(
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
  funding: {
    remainingGasAllowanceWei: "0",
  },
  constraints: {
    oracleRefreshNativeInputWei: "100000000000",
    minimumOutputBps: 9900,
    deadlineSeconds: 120,
    oracleWindowSeconds: 300,
  },
};
const manifestPath = path.join(output, "rehearsal-input-manifest.json");
const raw = `${json(manifest)}\n`;
await writeFile(manifestPath, raw, { mode: 0o600 });
const env = {
  ...process.env,
  ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_LOCAL_REHEARSAL: "true",
  ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_MANIFEST: manifestPath,
  ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_MANIFEST_SHA256: sha256(raw),
  ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_EVIDENCE: output,
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
    "28640",
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
    [path.join(repoRoot, "scripts/run-schema18-mainnet-final-settlement-live.mjs"), stage],
    { cwd: repoRoot, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
const journalCount = async () => {
  try {
    const rawJournal = await readFile(path.join(output, "transactions.jsonl"), "utf8");
    return rawJournal.trim() ? rawJournal.trim().split("\n").length : 0;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
};
try {
  await wait();
  await rpc("anvil_impersonateAccount", [source.deployer]);
  run("verify");
  run("schedule-reactivation");
  const beforeEarlyExecution = await journalCount();
  const earlyExecution = JSON.parse(run("execute-reactivation"));
  if (earlyExecution.status !== "not-ready" || (await journalCount()) !== beforeEarlyExecution) {
    throw new Error("early Timelock execution was not a journal-free readiness result");
  }
  await rpc("evm_increaseTime", [3601]);
  await rpc("evm_mine");
  run("execute-reactivation");
  const beforeStaleProbe = await journalCount();
  const staleProbe = JSON.parse(run("oracle-readiness"));
  if (staleProbe.oracle.ready || (await journalCount()) !== beforeStaleProbe) {
    throw new Error("stale oracle probe was not a journal-free readiness result");
  }
  run("refresh-start");
  const beforeEarlyOracle = await journalCount();
  const earlyOracle = JSON.parse(run("oracle-readiness"));
  if (
    earlyOracle.oracle.ready ||
    earlyOracle.oracle.reason !== "twap-window-incomplete" ||
    (await journalCount()) !== beforeEarlyOracle
  ) {
    throw new Error("early oracle probe was not a journal-free readiness result");
  }
  await rpc("evm_increaseTime", [301]);
  await rpc("evm_mine");
  const readyOracle = JSON.parse(run("oracle-readiness"));
  if (!readyOracle.oracle.ready) {
    throw new Error(`oracle remained unready after the full window: ${readyOracle.oracle.reason}`);
  }
  run("refresh-finish");
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
    applicationReleaseSha: APP_SHA,
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
