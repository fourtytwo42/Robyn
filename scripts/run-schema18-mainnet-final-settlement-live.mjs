#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  maxUint160,
  maxUint256,
  pad,
  parseAbi,
  stringToHex,
  zeroAddress,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseCastDecryptedPrivateKey } from "./lib/campaign-keystore.mjs";
import { classifyCanaryJournal } from "./lib/mainnet-canary-journal.mjs";
import { encodeUniversalV4SingleSwap } from "./lib/v4-universal-router.mjs";

const CHAIN_ID = 4663;
const CONTRACT_RELEASE_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const APPLICATION_RELEASE_SHA = "5ea50ed836d81416a7a6a32c8078a864fca28d0b";
const RESERVE = 20_000_000_000_000_000n;
const L1_FEE_RESERVE = 25_000_000_000_000n;
const localRehearsal = process.env.ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_LOCAL_REHEARSAL === "true";
const stages = new Set([
  "verify",
  "schedule-reactivation",
  "execute-reactivation",
  "refresh-start",
  "oracle-readiness",
  "refresh-finish",
  "post-settle",
  "shutdown",
  "reconcile",
  "status",
]);
const stage = process.argv[2];
if (!stages.has(stage)) {
  throw new Error(`usage: ${path.basename(process.argv[1])} ${[...stages].join("|")}`);
}
const readOnly = new Set(["verify", "oracle-readiness", "status"]);
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseSha = CONTRACT_RELEASE_SHA;
const manifestPath = path.resolve(required("ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_MANIFEST"));
const expectedManifestSha = required("ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_MANIFEST_SHA256").toLowerCase();
const evidenceRoot = path.resolve(required("ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_EVIDENCE"));
const rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? (localRehearsal ? "http://127.0.0.1:28549" : "http://127.0.0.1:18549");
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpc)) {
  throw new Error("Schema-18 Mainnet resume requires a loopback LAN gateway");
}
const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const command = (name, args, options = {}) =>
  execFileSync(name, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const git = (...args) => command("git", ["-C", repoRoot, ...args]);
const toolingSha = git("rev-parse", "HEAD");
if (!localRehearsal && (git("status", "--porcelain") !== "" || git("rev-parse", "@{upstream}") !== toolingSha)) {
  throw new Error("Schema-18 Mainnet resume requires exact clean pushed tooling");
}

const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);
const manifestSha = sha256(manifestRaw);
if (manifestSha !== expectedManifestSha) throw new Error("sealed resume manifest SHA-256 mismatch");
if (manifest.schemaVersion !== 18 || manifest.chainId !== CHAIN_ID || manifest.contractReleaseSha !== CONTRACT_RELEASE_SHA || manifest.applicationReleaseSha !== APPLICATION_RELEASE_SHA) {
  throw new Error("Schema-18 Mainnet resume manifest identity mismatch");
}
if (manifest.operationalToolingSha !== toolingSha && !localRehearsal) throw new Error("resume manifest is not bound to this tooling SHA");
if (
  manifest.authorizationEligible !== true ||
  manifest.authorization?.additionalBridgeAuthorized !== false ||
  manifest.authorization?.bootstrapFinalizationAuthorized !== false ||
  manifest.authorization?.unanimousRecoveryAuthorized !== false ||
  manifest.authorization?.canaryTransactionsAuthorized !== false ||
  manifest.authorization?.publicActivationAuthorized !== false ||
  manifest.authorization?.applicationWritesAuthorized !== false
) {
  throw new Error("Gate 2 manifest scope or pre-authorization state is invalid");
}
const sourcePostgradStateRaw = await readFile(path.resolve(manifest.sourcePostgrad?.statePath ?? ""), "utf8");
const sourcePostgradJournalRaw = await readFile(path.resolve(manifest.sourcePostgrad?.journalPath ?? ""), "utf8");
const sourcePostgradSumsRaw = await readFile(path.resolve(manifest.sourcePostgrad?.sumsPath ?? ""), "utf8");
const sourcePostgradSummaryRaw = await readFile(path.resolve(manifest.sourcePostgrad?.finalSummaryPath ?? ""), "utf8");
if (
  sha256(sourcePostgradStateRaw) !== manifest.sourcePostgrad?.stateSha256 ||
  sha256(sourcePostgradJournalRaw) !== manifest.sourcePostgrad?.journalSha256 ||
  sha256(sourcePostgradSumsRaw) !== manifest.sourcePostgrad?.sumsSha256 ||
  sha256(sourcePostgradSummaryRaw) !== manifest.sourcePostgrad?.finalSummarySha256
) {
  throw new Error("consumed post-unwind evidence hash mismatch");
}
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
  sourcePostgradIntents.length !== sourcePostgradReceipts.length
) {
  throw new Error("consumed post-unwind lifecycle evidence is incomplete");
}
for (const receipt of sourcePostgradReceipts) {
  if (
    receipt.status !== "success" ||
    sourceKeys.has(receipt.idempotencyKey) ||
    sourceHashes.has(receipt.transactionHash)
  ) {
    throw new Error("consumed post-unwind journal is failed, duplicated, or ambiguous");
  }
  sourceKeys.add(receipt.idempotencyKey);
  sourceHashes.add(receipt.transactionHash);
}
if (sourcePostgradReceipts.length !== manifest.sourcePostgrad.receiptCount) {
  throw new Error("consumed post-unwind receipt count changed");
}
if (!localRehearsal && !readOnly.has(stage)) {
  const authorizationPath = path.resolve(required("ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_AUTHORIZATION_RECEIPT"));
  const authorizationRaw = await readFile(authorizationPath, "utf8");
  const authorization = JSON.parse(authorizationRaw);
  if (
    process.env.ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_AUTHORIZED !== manifestSha ||
    process.env.ROBYN_SCHEMA18_MAINNET_FINAL_SETTLEMENT_AUTHORIZATION_RECEIPT_SHA256 !== sha256(authorizationRaw) ||
    authorization.schemaVersion !== 18 ||
    authorization.gate !== "schema18-gate2-final-settlement-recovery" ||
    authorization.authorized !== true ||
    authorization.manifestSha256 !== manifestSha ||
    authorization.scope !== "final-settlement-reactivation-through-final-guardian-shutdown" ||
    authorization.additionalBridgeAuthorized !== false ||
    authorization.publicActivationAuthorized !== false ||
    authorization.applicationWritesAuthorized !== false
  ) {
    throw new Error("exact Gate 2 manifest lacks a matching protected authorization receipt");
  }
}
const chain = {
  id: CHAIN_ID,
  name: "Robinhood Chain Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
};
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
let gateway;
const assertGateway = async () => {
  if (
    (await client.getChainId()) !== CHAIN_ID ||
    (await client.request({ method: "eth_syncing", params: [] })) !== false
  ) {
    throw new Error("Schema-18 lifecycle RPC is wrong-chain or syncing");
  }
  gateway = localRehearsal
    ? (await client.request({ method: "anvil_nodeInfo", params: [] }),
      {
        status: "ok",
        activeProvider: "primary",
        providerSelection: "operator",
        fallbackTrafficAuthorized: false,
      })
    : await fetch(new URL("/health", rpc)).then(async (response) => {
        if (!response.ok) throw new Error(`gateway health ${response.status}`);
        return response.json();
      });
  if (
    gateway.status !== "ok" ||
    gateway.activeProvider !== "primary" ||
    gateway.providerSelection !== "operator" ||
    gateway.fallbackTrafficAuthorized !== false
  ) {
    throw new Error("Schema-18 gateway is not healthy LAN-only with probe-only fallback");
  }
};

let account;
let wallet;
if (!readOnly.has(stage) && !localRehearsal) {
  const keystore = path.resolve(required("ROBYN_MAINNET_KEYSTORE"));
  const password = (await readFile(path.resolve(required("ROBYN_MAINNET_PASSWORD_FILE")), "utf8")).trimEnd();
  const cast = path.join(process.env.HOME ?? "/home/hendo420", ".foundry", "bin", "cast");
  const decrypted = command(cast, ["wallet", "decrypt-keystore", path.basename(keystore), "--keystore-dir", path.dirname(keystore)], { env: { ...process.env, CAST_UNSAFE_PASSWORD: password } });
  account = privateKeyToAccount(parseCastDecryptedPrivateKey(decrypted));
  if (account.address.toLowerCase() !== manifest.deployer.toLowerCase()) throw new Error("Mainnet keystore does not match deployer");
  wallet = createWalletClient({ account, chain, transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
} else if (!readOnly.has(stage)) {
  account = { address: getAddress(manifest.deployer), type: "json-rpc" };
  wallet = createWalletClient({ account, chain, transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
}

await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const journalPath = path.join(evidenceRoot, "transactions.jsonl");
const statePath = path.join(evidenceRoot, "state.json");
const loadJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
};
const state = await loadJson(statePath, {
  schemaVersion: 18,
  releaseSha,
  deploymentSha: manifest.contractReleaseSha,
  toolingSha,
  manifestSha256: sha256(manifestRaw),
  completedStages: ["claims", "unwind"],
  createdAt: new Date().toISOString(),
  token: getAddress(manifest.canary.token),
  vault: getAddress(manifest.canary.vault),
  market: getAddress(manifest.canary.market),
  adapter: getAddress(manifest.canary.adapter),
  locker: getAddress(manifest.canary.locker),
  lockedPrincipal: String(manifest.canary.lockedPrincipal),
  canaryTargetWei: String(manifest.canary.targetGraduationNativeWei),
  canaryPrincipalWei: String(manifest.canary.actualGraduationNativeWei),
  roundTripRecoveredWei: String(manifest.canary.roundTripRecoveredWei),
  unwindRecoveredWei: String(manifest.canary.unwindRecoveredWei),
  recoveredWei: String(manifest.canary.recoveredWei),
  recoveryBps: String(manifest.canary.recoveryBps),
  graduatedAt: String(manifest.canary.graduatedAt),
  sourcePostgradStateSha256: manifest.sourcePostgrad.stateSha256,
  sourcePostgradJournalSha256: manifest.sourcePostgrad.journalSha256,
});
if (
  state.releaseSha !== releaseSha ||
  state.deploymentSha !== manifest.contractReleaseSha ||
  state.toolingSha !== toolingSha ||
  state.manifestSha256 !== sha256(manifestRaw)
) {
  throw new Error("lifecycle state belongs to another release or manifest");
}
const saveState = async () => {
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${json({ ...state, updatedAt: new Date().toISOString() })}\n`, {
    mode: 0o600,
  });
  await rename(temporary, statePath);
};
const trackBalance = async (before, after) => {
  const priorMinimum = state.minimumBalanceWei === undefined ? before : BigInt(state.minimumBalanceWei);
  Object.assign(state, {
    initialBalanceWei: state.initialBalanceWei ?? before.toString(),
    minimumBalanceWei: (after < priorMinimum ? after : priorMinimum).toString(),
    latestBalanceWei: after.toString(),
  });
  await saveState();
};
const journal = async () => {
  try {
    const raw = (await readFile(journalPath, "utf8")).trim();
    return raw ? raw.split("\n").map(JSON.parse) : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
};
const append = async (record) => {
  const handle = await open(journalPath, "a", 0o600);
  try {
    await handle.write(`${JSON.stringify(record)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
};
const receiptDigest = (receipt) =>
  sha256(
    json({
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
    }),
  );
const missing = (error) => /not found|could not be found/i.test(String(error?.shortMessage ?? error?.message ?? error));

const submit = async ({ phase, label, to, data, value = 0n }) => {
  const key = `schema18-${localRehearsal ? "mainnet-final-settlement-fork" : "mainnet"}:${phase}:${label}`;
  const records = await journal();
  const classified = classifyCanaryJournal(records, key);
  if (classified.receipt) {
    const receipt = await client.getTransactionReceipt({ hash: classified.receipt.transactionHash });
    if (receipt.status !== "success" || receiptDigest(receipt) !== classified.receipt.receiptDigest) {
      throw new Error(`${key} confirmed receipt changed`);
    }
    return receipt;
  }
  if (classified.activeIntent) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: classified.activeIntent.transactionHash });
      if (receipt.status !== "success") throw new Error(`${key} reverted`);
      const balanceAfter = await client.getBalance({ address: account.address });
      await append({
        type: "receipt",
        recordedAt: new Date().toISOString(),
        logicalKey: key,
        idempotencyKey: classified.activeIntent.idempotencyKey,
        phase,
        label,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
        balanceBeforeWei: classified.activeIntent.balanceBeforeWei,
        balanceAfterWei: balanceAfter.toString(),
        receiptDigest: receiptDigest(receipt),
      });
      await trackBalance(BigInt(classified.activeIntent.balanceBeforeWei ?? balanceAfter), balanceAfter);
      return receipt;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    throw new Error(`${key} has an unresolved signed intent; automatic replay is prohibited`);
  }
  const [latest, pending, fees] = await Promise.all([
    client.getTransactionCount({ address: account.address, blockTag: "latest" }),
    client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    client.estimateFeesPerGas(),
  ]);
  if (latest !== pending) throw new Error(`${key} has a pending nonce`);
  const baseMaxFee = localRehearsal
    ? BigInt(manifest.gas?.rehearsalBaseMaxFeePerGasWei ?? 0)
    : (fees.maxFeePerGas ?? fees.gasPrice);
  if (baseMaxFee === 0n) throw new Error(`${key} lacks a valid fee sample`);
  const maxFeePerGas = (baseMaxFee * 12_500n + 9_999n) / 10_000n;
  const maxPriorityFeePerGas =
    localRehearsal
      ? 0n
      : (fees.maxPriorityFeePerGas ?? 0n) <= maxFeePerGas
        ? (fees.maxPriorityFeePerGas ?? 0n)
        : maxFeePerGas;
  const estimate = await client.estimateGas({ account: account.address, to, data, value });
  const gas = estimate * 2n;
  const phaseCeiling = BigInt(manifest.gas?.phaseCeilings?.[phase] ?? 0);
  if (phaseCeiling === 0n || gas > phaseCeiling) throw new Error(`${key} exceeds sealed phase gas ceiling`);
  const feeCeiling = BigInt(manifest.gas?.maxFeePerGasWei ?? 0);
  if (feeCeiling === 0n || maxFeePerGas > feeCeiling) throw new Error(`${key} exceeds sealed fee ceiling`);
  const balance = await client.getBalance({ address: account.address });
  if (balance < value + gas * maxFeePerGas + L1_FEE_RESERVE + RESERVE) {
    throw new Error(`${key} would breach the fixed Mainnet reserve`);
  }
  const request = {
    account,
    chain,
    to,
    data,
    value,
    nonce: latest,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    type: "eip1559",
  };
  const idempotencyKey = keccak256(stringToHex(key));
  if (localRehearsal) {
    await append({
      type: "intent",
      recordedAt: new Date().toISOString(),
      logicalKey: key,
      idempotencyKey,
      phase,
      label,
      chainId: CHAIN_ID,
      nonce: String(latest),
      to,
      valueWei: value.toString(),
      calldataHash: keccak256(data),
      gasEstimate: estimate.toString(),
      gasLimit: gas.toString(),
      maxFeePerGasWei: maxFeePerGas.toString(),
      maxPriorityFeePerGasWei: maxPriorityFeePerGas.toString(),
      balanceBeforeWei: balance.toString(),
      localForkUnsigned: true,
    });
    const transactionHash = await wallet.sendTransaction(request);
    const receipt = await client.waitForTransactionReceipt({
      hash: transactionHash,
      timeout: 180_000,
    });
    if (receipt.status !== "success") throw new Error(`${key} reverted`);
    const balanceAfter = await client.getBalance({ address: account.address });
    await append({
      type: "receipt",
      recordedAt: new Date().toISOString(),
      logicalKey: key,
      idempotencyKey,
      phase,
      label,
      transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      balanceBeforeWei: balance.toString(),
      balanceAfterWei: balanceAfter.toString(),
      receiptDigest: receiptDigest(receipt),
    });
    await trackBalance(balance, balanceAfter);
    return receipt;
  }
  const serialized = await wallet.signTransaction(request);
  const transactionHash = keccak256(serialized);
  await append({
    type: "intent",
    recordedAt: new Date().toISOString(),
    logicalKey: key,
    idempotencyKey,
    phase,
    label,
    chainId: CHAIN_ID,
    nonce: String(latest),
    to,
    valueWei: value.toString(),
    calldataHash: keccak256(data),
    gasEstimate: estimate.toString(),
    gasLimit: gas.toString(),
    maxFeePerGasWei: maxFeePerGas.toString(),
    maxPriorityFeePerGasWei: maxPriorityFeePerGas.toString(),
    balanceBeforeWei: balance.toString(),
    transactionHash,
  });
  let published;
  try {
    published = await client.sendRawTransaction({ serializedTransaction: serialized });
  } catch (error) {
    const [afterLatest, afterPending] = await Promise.all([
      client.getTransactionCount({ address: account.address, blockTag: "latest" }),
      client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    ]);
    if (afterLatest !== latest || afterPending !== latest) {
      throw new Error(`${key} submission is ambiguous; manual reconciliation required`);
    }
    await append({
      type: "submission-rejected",
      recordedAt: new Date().toISOString(),
      logicalKey: key,
      idempotencyKey,
      phase,
      label,
      nonce: String(latest),
      transactionHash,
      error: String(error?.shortMessage ?? error?.message ?? error).slice(0, 500),
    });
    throw new Error(`${key} was rejected before admission`);
  }
  if (published !== transactionHash) throw new Error(`${key} returned a different transaction hash`);
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${key} reverted`);
  const balanceAfter = await client.getBalance({ address: account.address });
  await append({
    type: "receipt",
    recordedAt: new Date().toISOString(),
    logicalKey: key,
    idempotencyKey,
    phase,
    label,
    transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    status: receipt.status,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    balanceBeforeWei: balance.toString(),
    balanceAfterWei: balanceAfter.toString(),
    receiptDigest: receiptDigest(receipt),
  });
  await trackBalance(balance, balanceAfter);
  return receipt;
};

const artifact = async (name, source = `${name}.sol`) =>
  JSON.parse(await readFile(path.join(repoRoot, "packages/contracts/out", source, `${name}.json`), "utf8"));
const built = {
  timelock: await artifact("RobynBootstrapTimelock", "RobynBootstrapTimelock.sol"),
  governor: await artifact("RobynGovernorV2", "RobynGovernorV2.sol"),
  dao: await artifact("RobynDaoTokenV3", "RobynDaoTokenV3.sol"),
  assetRouter: await artifact("RobynV4AssetRouter"),
  feeRouter: await artifact("RobynNativeProtocolFeeRouterV4"),
  coordinator: await artifact("RobynV4LaunchCoordinatorV6"),
  launchFactory: await artifact("RobynNativeLaunchFactoryV4"),
  marketFactory: await artifact("RobynV4MarketFactory"),
  hook: await artifact("RobynV4FeeAndPhaseHook"),
  adapter: await artifact("RobynV4GraduationAdapter"),
};
const checksum = (address) => getAddress(address.toLowerCase());
const contracts = {
  safe: checksum(manifest.guardianSafe),
  timelock: checksum(manifest.contracts.timelock),
  governor: checksum(manifest.contracts.governor),
  daoToken: checksum(manifest.contracts.daoToken),
  assetRouter: checksum(manifest.contracts.assetRouter),
  feeRouter: checksum(manifest.contracts.protocolFeeRouter),
  coordinator: checksum(manifest.contracts.atomicLaunchCoordinator),
  launchFactory: checksum(manifest.contracts.launchFactory),
  marketFactory: checksum(manifest.contracts.marketFactory),
  oracleHook: checksum(manifest.contracts.oracleHook),
};
const external = {
  weth: checksum(manifest.contracts.wrappedNative),
  quoter: checksum(manifest.contracts.quoter),
  universalRouter: checksum(manifest.contracts.universalRouter),
  permit2: checksum(manifest.contracts.permit2),
  positionManager: checksum(manifest.contracts.positionManager),
};
const assertRuntimeIdentities = async () => {
  for (const identity of manifest.runtimeIdentities ?? []) {
    const code = await client.getCode({ address: checksum(identity.address) });
    if (!code || code === "0x" || keccak256(code).toLowerCase() !== identity.runtimeCodeHash.toLowerCase()) {
      throw new Error(`${identity.name} runtime identity changed`);
    }
  }
};
const read = (address, abi, functionName, args = []) =>
  client.readContract({ address, abi, functionName, args });
const write = (phase, label, address, abi, functionName, args = [], value = 0n) =>
  submit({ phase, label, to: address, data: encodeFunctionData({ abi, functionName, args }), value });
const latestTime = async () => (await client.getBlock({ blockTag: "latest" })).timestamp;
const deadline = async () => (await latestTime()) + 120n;
const oracleReadiness = async () => {
  const token = checksum(manifest.canary.token);
  const poolId = await read(
    checksum(manifest.canary.adapter),
    built.adapter.abi,
    "poolId",
  );
  const now = await latestTime();
  const observationIndex = await read(
    contracts.oracleHook,
    built.hook.abi,
    "observationIndex",
    [poolId],
  );
  const latest = await read(
    contracts.oracleHook,
    built.hook.abi,
    "observation",
    [poolId, observationIndex],
  );
  const twapWindow = BigInt(await read(contracts.oracleHook, built.hook.abi, "TWAP_WINDOW"));
  const maxAge = BigInt(await read(contracts.oracleHook, built.hook.abi, "MAX_OBSERVATION_AGE"));
  const maximumDeviation = BigInt(
    await read(contracts.oracleHook, built.hook.abi, "MAX_SPOT_TWAP_TICK_DEVIATION"),
  );
  let meanTick;
  let oldestAge;
  try {
    [meanTick, oldestAge] = await read(contracts.oracleHook, built.hook.abi, "consult", [
      poolId,
      Number(twapWindow),
    ]);
  } catch (error) {
    return {
      ready: false,
      reason: "insufficient-history",
      chainTime: now,
      latestObservationTimestamp: latest.timestamp,
      latestObservationAge: now - BigInt(latest.timestamp),
      error: String(error?.shortMessage ?? error?.message ?? error).slice(0, 300),
    };
  }
  const stateView = await read(
    contracts.assetRouter,
    built.assetRouter.abi,
    "stateView",
  );
  const stateViewAbi = parseAbi([
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  ]);
  const slot0 = await read(stateView, stateViewAbi, "getSlot0", [poolId]);
  const spotTick = BigInt(slot0[1]);
  const mean = BigInt(meanTick);
  const deviation = spotTick >= mean ? spotTick - mean : mean - spotTick;
  const latestAge = now - BigInt(latest.timestamp);
  const refreshReadyAt = state.refreshStartedAt
    ? BigInt(state.refreshStartedAt) + twapWindow
    : null;
  const pendingTokenFees = await read(
    contracts.oracleHook,
    built.hook.abi,
    "pendingTokenFees",
    [token],
  );
  let quotedNative = 0n;
  let quoteError = null;
  if (pendingTokenFees > 0n) {
    try {
      [quotedNative] = await read(
        contracts.assetRouter,
        built.assetRouter.abi,
        "quoteAssetToNative",
        [token, pendingTokenFees],
      );
    } catch (error) {
      quoteError = String(error?.shortMessage ?? error?.message ?? error).slice(0, 300);
    }
  }
  const balance = await client.getBalance({ address: checksum(manifest.deployer) });
  const ready =
    state.completedStages.includes("refresh-start") &&
    refreshReadyAt !== null &&
    now >= refreshReadyAt &&
    latestAge <= maxAge &&
    deviation <= maximumDeviation &&
    pendingTokenFees > 0n &&
    quotedNative > 0n &&
    balance > RESERVE + BigInt(manifest.funding?.remainingGasAllowanceWei ?? 0);
  return {
    ready,
    reason: ready
      ? "ready"
      : latestAge > maxAge
        ? "stale-observation"
        : deviation > maximumDeviation
          ? "spot-twap-deviation"
          : refreshReadyAt === null || now < refreshReadyAt
            ? "twap-window-incomplete"
            : quoteError
              ? "quote-unavailable"
              : pendingTokenFees === 0n || quotedNative === 0n
                ? "no-convertible-fees"
                : "reserve-margin",
    chainTime: now,
    refreshReadyAt,
    latestObservationTimestamp: latest.timestamp,
    latestObservationAge: latestAge,
    oldestAge,
    spotTick,
    meanTick,
    deviation,
    maximumDeviation,
    pendingTokenFees,
    quotedNative,
    quoteError,
    balanceWei: balance,
  };
};
const mark = async (name, extra = {}) => {
  if (!state.completedStages.includes(name)) state.completedStages.push(name);
  Object.assign(state, extra);
  await saveState();
};
const recoveryBatch = () => ({
  targets: manifest.recovery.reactivation.targets.map(checksum),
  values: manifest.recovery.reactivation.valuesWei.map(BigInt),
  payloads: manifest.recovery.reactivation.payloads,
  descriptionHash: manifest.recovery.reactivation.descriptionHash,
});
const assertRecoveryPlan = async () => {
  const batch = recoveryBatch();
  if (
    batch.targets.length === 0 ||
    batch.targets.length !== batch.values.length ||
    batch.targets.length !== batch.payloads.length
  ) {
    throw new Error("sealed recovery batch is malformed");
  }
  const [onchainPlanHash, derivedPlanHash] = await Promise.all([
    read(contracts.timelock, built.timelock.abi, "bootstrapPlanHash", [0]),
    read(contracts.timelock, built.timelock.abi, "hashBootstrapStep", [
      0,
      batch.targets,
      batch.values,
      batch.payloads,
    ]),
  ]);
  const expected = manifest.recovery.sourceBootstrapStepOnePlanHash;
  if (
    !expected ||
    onchainPlanHash.toLowerCase() !== expected.toLowerCase() ||
    derivedPlanHash.toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error("sealed recovery batch differs from qualified bootstrap step one");
  }
};
const incidentSnapshot = async () => {
  const token = checksum(manifest.canary.token);
  const market = checksum(manifest.canary.market);
  const marketAbi = (await artifact("RobynV4BondingCurveMarket")).abi;
  const vault = getAddress(
    await read(contracts.launchFactory, built.launchFactory.abi, "vaultByToken", [token]),
  );
  return {
    token,
    vault,
    market,
    graduated: await read(market, marketAbi, "graduated"),
    nativeRaisedWei: (await read(market, marketAbi, "nativeRaised")).toString(),
    graduationThresholdWei: (
      await read(market, marketAbi, "graduationThresholdNative")
    ).toString(),
    projectTokenBalance: (await read(token, built.dao.abi, "balanceOf", [manifest.deployer])).toString(),
  };
};
const assertGraduatedCanary = async ({ checkProjectBalance = true } = {}) => {
  const observed = await incidentSnapshot();
  if (
    observed.token.toLowerCase() !== manifest.canary.token.toLowerCase() ||
    observed.vault.toLowerCase() !== manifest.canary.vault.toLowerCase() ||
    observed.market.toLowerCase() !== manifest.canary.market.toLowerCase() ||
    !observed.graduated ||
    observed.nativeRaisedWei !== String(manifest.canary.nativeRaisedWei) ||
    observed.graduationThresholdWei !== String(manifest.canary.graduationThresholdWei) ||
    (checkProjectBalance &&
      observed.projectTokenBalance !== String(manifest.canary.projectTokenBalance))
  ) {
    throw new Error("graduated Canary state changed from the sealed manifest");
  }
  const marketAbi = (await artifact("RobynV4BondingCurveMarket")).abi;
  const adapterAbi = (await artifact("RobynV4GraduationAdapter")).abi;
  const lockerAbi = (await artifact("RobynV4FeePositionLocker")).abi;
  const adapter = getAddress(await read(observed.market, marketAbi, "graduationAdapter"));
  const locker = getAddress(await read(adapter, adapterAbi, "locker"));
  const [lockedPrincipal, profile] = await Promise.all([
    read(locker, lockerAbi, "principalLiquidity"),
    read(contracts.marketFactory, built.marketFactory.abi, "graduationProfileByToken", [
      observed.token,
    ]),
  ]);
  if (
    adapter.toLowerCase() !== manifest.canary.adapter.toLowerCase() ||
    locker.toLowerCase() !== manifest.canary.locker.toLowerCase() ||
    lockedPrincipal !== BigInt(manifest.canary.lockedPrincipal) ||
    profile.version !== BigInt(manifest.canary.profileVersion) ||
    profile.targetGraduationNative !== BigInt(manifest.canary.targetGraduationNativeWei) ||
    profile.maximumCurvePurchase !== BigInt(manifest.canary.maximumCurvePurchaseWei)
  ) {
    throw new Error("graduated Canary profile or locked principal changed");
  }
};
const unanimousSalt = ({ nonce, targets, values, payloads, descriptionHash }) =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "address[]" },
        { type: "uint256[]" },
        { type: "bytes[]" },
        { type: "bytes32" },
      ],
      [
        "ROBYN_SCHEMA17_UNANIMOUS_OPERATION",
        BigInt(CHAIN_ID),
        contracts.governor,
        nonce,
        checksum(manifest.deployer),
        targets,
        values,
        payloads,
        descriptionHash,
      ],
    ),
  );
const routesEnabled = async () => {
  for (const route of manifest.routes) {
    const configured = await read(
      contracts.assetRouter,
      built.assetRouter.abi,
      "executionRoute",
      [checksum(route.asset)],
    );
    if (!configured.enabled) return false;
  }
  return true;
};
const routesDisabled = async () => {
  for (const route of manifest.routes) {
    const configured = await read(
      contracts.assetRouter,
      built.assetRouter.abi,
      "executionRoute",
      [checksum(route.asset)],
    );
    if (configured.enabled) return false;
  }
  return true;
};
const paused = async () =>
  Number(await read(contracts.coordinator, built.coordinator.abi, "launchMode")) === 0 &&
  (await read(contracts.assetRouter, built.assetRouter.abi, "conversionsPaused")) &&
  (await read(contracts.feeRouter, built.feeRouter.abi, "paused"));
const safeAbi = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)",
]);
const safeSignature = () => concatHex([pad(account.address, { size: 32 }), zeroHash, "0x01"]);
const safeExec = (label, target, data) =>
  write("shutdown", label, contracts.safe, safeAbi, "execTransaction", [
    target,
    0n,
    data,
    0,
    0n,
    0n,
    0n,
    zeroAddress,
    zeroAddress,
    safeSignature(),
  ]);
const shutdown = async () => {
  const reason = keccak256(
    stringToHex(
      localRehearsal
        ? "SCHEMA18_MAINNET_FORK_CANARY_COMPLETE"
        : "SCHEMA18_MAINNET_RECOVERY_COMPLETE",
    ),
  );
  await safeExec(
    "guardian-pause-launches",
    contracts.coordinator,
    encodeFunctionData({ abi: built.coordinator.abi, functionName: "pauseLaunches" }),
  );
  await safeExec(
    "guardian-pause-asset-conversions",
    contracts.assetRouter,
    encodeFunctionData({ abi: built.assetRouter.abi, functionName: "pauseConversions" }),
  );
  await safeExec(
    "guardian-pause-fee-conversions",
    contracts.feeRouter,
    encodeFunctionData({ abi: built.feeRouter.abi, functionName: "setPaused", args: [true] }),
  );
  for (const route of manifest.routes) {
    await safeExec(
      `guardian-disable-${route.symbol}`,
      contracts.assetRouter,
      encodeFunctionData({
        abi: built.assetRouter.abi,
        functionName: "disableRoute",
        args: [getAddress(route.asset), reason],
      }),
    );
  }
  if (!(await paused())) throw new Error("guardian shutdown did not restore Paused state");
  await mark("shutdown", {
    shutdownAt: new Date().toISOString(),
    shutdownRequired: false,
  });
};

const run = async () => {
  await assertGateway();
  await assertRuntimeIdentities();
  await assertRecoveryPlan();
  if (state.failedRun && !readOnly.has(stage) && stage !== "shutdown") {
    if (state.shutdownRequired) await shutdown();
    const invalidated = new Error(
      "lifecycle is invalidated after a prior failure; use a new manifest and evidence identity",
    );
    invalidated.canaryRunInvalidated = true;
    throw invalidated;
  }
  const currentRecords = await journal();
  const recoveryActivityStarted = currentRecords.some(
    (record) => ["oracle-refresh", "final-settlement"].includes(record.phase),
  );
  await assertGraduatedCanary({ checkProjectBalance: !recoveryActivityStarted });
  if (readOnly.has(stage)) {
    const now = await latestTime();
    const readiness = {
      chainTime: now.toString(),
      reactivationReadyAt: state.recoveryReadyAt ?? null,
      reactivationReady:
        Boolean(state.recoveryReadyAt) && now >= BigInt(state.recoveryReadyAt),
      settlementReadyAt: (BigInt(state.graduatedAt) + 301n).toString(),
      settlementReady: now >= BigInt(state.graduatedAt) + 301n,
      claimsReadyAt: state.streamStartedAt
        ? (BigInt(state.streamStartedAt) + 3_600n).toString()
        : null,
      claimsReady:
        Boolean(state.streamStartedAt) && now >= BigInt(state.streamStartedAt) + 3_600n,
    };
    process.stdout.write(
      `${json({
        stage,
        releaseSha,
        deploymentSha: manifest.contractReleaseSha,
        toolingSha,
        manifestSha256: sha256(manifestRaw),
        chainId: await client.getChainId(),
        blockNumber: await client.getBlockNumber(),
        balanceWei: await client.getBalance({ address: manifest.deployer }),
        launchMode: Number(await read(contracts.coordinator, built.coordinator.abi, "launchMode")),
        bootstrapActive: await read(contracts.timelock, built.timelock.abi, "bootstrapActive"),
        bootstrapFinalized: await read(
          contracts.timelock,
          built.timelock.abi,
          "bootstrapFinalized",
        ),
        bootstrapFinalizationReason: await read(
          contracts.timelock,
          built.timelock.abi,
          "bootstrapFinalizationReason",
        ),
        unanimousNonce: (
          await read(contracts.governor, built.governor.abi, "unanimousNonce")
        ).toString(),
        nextBootstrapStep: Number(
          await read(contracts.timelock, built.timelock.abi, "nextBootstrapStep"),
        ),
        gateway: {
          status: gateway.status,
          activeProvider: gateway.activeProvider,
          fallbackTrafficAuthorized: gateway.fallbackTrafficAuthorized,
        },
        canary: await incidentSnapshot(),
        readiness,
        oracle: await oracleReadiness(),
        state,
      })}\n`,
    );
    return;
  }
  if (state.completedStages.includes(stage)) {
    process.stdout.write(`${json({ stage, status: "already-completed" })}\n`);
    return;
  }
  if (stage === "schedule-reactivation") {
    if (!(await paused()) || !(await routesDisabled())) {
      throw new Error("reactivation scheduling requires fully Paused state with disabled routes");
    }
    if (
      (await client.getBalance({ address: manifest.deployer })) <
      BigInt(manifest.funding?.requiredBalanceWei ?? 0)
    ) {
      throw new Error("reactivation funding no longer satisfies the sealed reserve gate");
    }
    if (!(await read(contracts.timelock, built.timelock.abi, "bootstrapFinalized"))) {
      throw new Error("resume requires irreversibly finalized bootstrap");
    }
    const batch = recoveryBatch();
    const nonce = BigInt(
      await read(contracts.governor, built.governor.abi, "unanimousNonce"),
    );
    if (nonce !== BigInt(manifest.recovery.expectedUnanimousNonce)) {
      throw new Error("unanimous nonce changed from the sealed recovery manifest");
    }
    const salt = unanimousSalt({ nonce, ...batch });
    const operationId = await read(
      contracts.timelock,
      built.timelock.abi,
      "hashOperationBatch",
      [batch.targets, batch.values, batch.payloads, zeroHash, salt],
    );
    if (await read(contracts.timelock, built.timelock.abi, "isOperation", [operationId])) {
      throw new Error("sealed unanimous recovery operation already exists");
    }
    await write(
      "recovery",
      stage,
      contracts.governor,
      built.governor.abi,
      "scheduleUnanimous",
      [batch.targets, batch.values, batch.payloads, batch.descriptionHash],
    );
    const owner = await read(
      contracts.governor,
      built.governor.abi,
      "unanimousOperationOwner",
      [operationId],
    );
    if (owner.toLowerCase() !== manifest.deployer.toLowerCase()) {
      throw new Error("Governor did not bind the recovery operation to the unanimous owner");
    }
    const delay = BigInt(
      await read(contracts.timelock, built.timelock.abi, "getMinDelay"),
    );
    await mark(stage, {
      recoveryNonce: nonce.toString(),
      recoverySalt: salt,
      recoveryOperationId: operationId,
      recoveryReadyAt: ((await latestTime()) + delay).toString(),
    });
    return;
  }
  if (stage === "execute-reactivation") {
    if (!state.completedStages.includes("schedule-reactivation")) {
      throw new Error("reactivation execution requires a scheduled unanimous operation");
    }
    const now = await latestTime();
    if (now < BigInt(state.recoveryReadyAt)) {
      process.stdout.write(
        json({
          stage,
          status: "not-ready",
          chainTime: now,
          readyAt: state.recoveryReadyAt,
          remainingSeconds: BigInt(state.recoveryReadyAt) - now,
        }) + "\n",
      );
      return;
    }
    if (
      !(await read(
        contracts.timelock,
        built.timelock.abi,
        "isOperationReady",
        [state.recoveryOperationId],
      ))
    ) {
      throw new Error("sealed unanimous recovery operation is not ready");
    }
    const batch = recoveryBatch();
    await write(
      "recovery",
      stage,
      contracts.timelock,
      built.timelock.abi,
      "executeBatch",
      [batch.targets, batch.values, batch.payloads, zeroHash, state.recoverySalt],
    );
    if (
      Number(await read(contracts.coordinator, built.coordinator.abi, "launchMode")) !== 1 ||
      (await read(contracts.assetRouter, built.assetRouter.abi, "conversionsPaused")) ||
      (await read(contracts.feeRouter, built.feeRouter.abi, "paused")) ||
      !(await routesEnabled())
    ) {
      throw new Error("unanimous recovery did not restore the exact Canary state");
    }
    await mark(stage, { reactivatedAt: (await latestTime()).toString() });
    return;
  }
  if (!state.completedStages.includes("execute-reactivation")) {
    throw new Error(`${stage} requires executed unanimous reactivation`);
  }

  const erc20 = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
  ]);
  if (stage === "shutdown") {
    await shutdown();
    return;
  }
  if (!state.token) throw new Error(`${stage} requires a completed canary launch`);
  const token = getAddress(state.token);
  const vault = getAddress(state.vault);
  const market = getAddress(state.market);
  const locker = getAddress(state.locker);
  const marketAbi = (await artifact("RobynV4BondingCurveMarket")).abi;
  const lockerAbi = (await artifact("RobynV4FeePositionLocker")).abi;
  const vaultAbi = (await artifact("RobynNativeBasketVaultV2")).abi;
  const tokenAbi = (await artifact("RobynLaunchToken")).abi;
  const adapterAbi = (await artifact("RobynV4GraduationAdapter")).abi;
  const boundedRouteInput = async (asset, amount, direction) => {
    const route = await read(contracts.assetRouter, built.assetRouter.abi, "executionRoute", [
      asset,
    ]);
    const cap =
      direction === "native-to-asset" ? route.maximumNativeInput : route.maximumAssetInput;
    if (cap === 0n) throw new Error(`${direction} route has a zero input cap`);
    return amount > cap ? cap : amount;
  };
  const settleFees = async (phase) => {
    const native = await read(contracts.oracleHook, built.hook.abi, "pendingNativeFees", [token]);
    if (native > 0n) {
      await write(phase, `${phase}-hook-native`, contracts.oracleHook, built.hook.abi, "settleNativeFees", [
        token,
        native,
      ]);
    }
    const tokenFees = await read(contracts.oracleHook, built.hook.abi, "pendingTokenFees", [token]);
    if (tokenFees > 0n) {
      const amount = await boundedRouteInput(token, tokenFees, "asset-to-native");
      const quote = await read(contracts.assetRouter, built.assetRouter.abi, "quoteAssetToNative", [
        token,
        amount,
      ]);
      await write(phase, `${phase}-hook-token`, contracts.oracleHook, built.hook.abi, "convertTokenFees", [
        token,
        amount,
        (quote[0] * 99n) / 100n,
        await deadline(),
      ]);
    }
    await write(phase, `${phase}-collect-locker`, locker, lockerAbi, "collectFees", [0n, 0n]);
    const lockerNative = await read(locker, lockerAbi, "pendingCollectedNativeFees");
    if (lockerNative > 0n) {
      await write(phase, `${phase}-locker-native`, locker, lockerAbi, "routeCollectedNative", [lockerNative]);
    }
    const lockerToken = await read(locker, lockerAbi, "pendingCollectedTokenFees");
    if (lockerToken > 0n) {
      const amount = await boundedRouteInput(token, lockerToken, "asset-to-native");
      const quote = await read(contracts.assetRouter, built.assetRouter.abi, "quoteAssetToNative", [
        token,
        amount,
      ]);
      await write(phase, `${phase}-locker-token`, locker, lockerAbi, "convertCollectedToken", [
        amount,
        (quote[0] * 99n) / 100n,
        await deadline(),
      ]);
    }
    const launchAccount = await read(contracts.feeRouter, built.feeRouter.abi, "launchAccount", [token]);
    if (launchAccount.pendingBasketNative > 0n) {
      await write(phase, `${phase}-basket`, contracts.feeRouter, built.feeRouter.abi, "settleBasketFees", [
        token,
        launchAccount.pendingBasketNative,
      ]);
    }
    const dao = await read(contracts.feeRouter, built.feeRouter.abi, "totalDaoNativeLiability");
    if (dao > 0n) {
      await write(phase, `${phase}-dao`, contracts.feeRouter, built.feeRouter.abi, "settleDaoFees", [dao]);
    }
    const treasury = await read(
      contracts.feeRouter,
      built.feeRouter.abi,
      "totalTreasuryNativeLiability",
    );
    if (treasury > 0n) {
      await write(phase, `${phase}-treasury`, contracts.feeRouter, built.feeRouter.abi, "settleTreasuryFees", [
        treasury,
      ]);
    }
    const leg = await read(vault, vaultAbi, "leg", [0n]);
    if (leg.pendingNative > 0n) {
      const amount = await boundedRouteInput(external.weth, leg.pendingNative, "native-to-asset");
      const quote = await read(contracts.assetRouter, built.assetRouter.abi, "quoteNativeToAsset", [
        external.weth,
        amount,
      ]);
      await write(phase, `${phase}-weth-leg`, vault, vaultAbi, "convertLeg", [
        0n,
        amount,
        (quote[0] * 99n) / 100n,
        await deadline(),
      ]);
    }
  };

  if (stage === "refresh-start") {
    if ((await read(token, tokenAbi, "balanceOf", [account.address])) !== 0n) {
      throw new Error("oracle refresh requires zero project launch-token balance");
    }
    const input = BigInt(manifest.constraints.oracleRefreshNativeInputWei);
    if (input <= 0n) throw new Error("oracle refresh input must be positive");
    const poolKey = await read(state.adapter, adapterAbi, "poolKey");
    const quoterAbi = parseAbi([
      "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
    ]);
    const quote = await read(external.quoter, quoterAbi, "quoteExactInputSingle", [
      { poolKey, zeroForOne: true, exactAmount: input, hookData: "0x" },
    ]);
    if (quote[0] === 0n) throw new Error("oracle refresh buy quote is zero");
    const swap = encodeUniversalV4SingleSwap({
      poolKey,
      zeroForOne: true,
      amount: input,
      limit: (quote[0] * 99n) / 100n,
      refundRecipient: account.address,
    });
    const universalAbi = parseAbi([
      "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
    ]);
    const before = await read(token, tokenAbi, "balanceOf", [account.address]);
    await write(
      "oracle-refresh",
      "oracle-refresh-buy",
      external.universalRouter,
      universalAbi,
      "execute",
      [swap.commands, swap.inputs, await deadline()],
      input,
    );
    const received = (await read(token, tokenAbi, "balanceOf", [account.address])) - before;
    if (received === 0n || received < (quote[0] * 99n) / 100n) {
      throw new Error("oracle refresh buy received an unsafe amount");
    }
    await mark(stage, {
      refreshStartedAt: (await latestTime()).toString(),
      refreshNativeInputWei: input.toString(),
      refreshTokenAmountWei: received.toString(),
    });
    return;
  }
  if (stage === "refresh-finish") {
    if (!state.completedStages.includes("refresh-start")) {
      throw new Error("oracle refresh finish requires a completed refresh buy");
    }
    const readiness = await oracleReadiness();
    if (!readiness.ready) {
      process.stdout.write(`${json({ stage, status: "not-ready", oracle: readiness })}\n`);
      return;
    }
    const amount = BigInt(state.refreshTokenAmountWei);
    if ((await read(token, tokenAbi, "balanceOf", [account.address])) !== amount) {
      throw new Error("oracle refresh token balance changed before the bounded sale");
    }
    const poolKey = await read(state.adapter, adapterAbi, "poolKey");
    const quoterAbi = parseAbi([
      "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
    ]);
    const quote = await read(external.quoter, quoterAbi, "quoteExactInputSingle", [
      { poolKey, zeroForOne: false, exactAmount: amount, hookData: "0x" },
    ]);
    if (quote[0] === 0n) throw new Error("oracle refresh sale quote is zero");
    const permit2Abi = parseAbi([
      "function approve(address token,address spender,uint160 amount,uint48 expiration)",
      "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
    ]);
    await write("oracle-refresh", "oracle-refresh-token-approve", token, tokenAbi, "approve", [
      external.permit2,
      amount,
    ]);
    await write(
      "oracle-refresh",
      "oracle-refresh-router-approve",
      external.permit2,
      permit2Abi,
      "approve",
      [token, external.universalRouter, amount, (await latestTime()) + 300n],
    );
    const swap = encodeUniversalV4SingleSwap({
      poolKey,
      zeroForOne: false,
      amount,
      limit: (quote[0] * 99n) / 100n,
      refundRecipient: account.address,
    });
    const universalAbi = parseAbi([
      "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
    ]);
    await write(
      "oracle-refresh",
      "oracle-refresh-sell",
      external.universalRouter,
      universalAbi,
      "execute",
      [swap.commands, swap.inputs, await deadline()],
    );
    await write(
      "oracle-refresh",
      "oracle-refresh-router-clear",
      external.permit2,
      permit2Abi,
      "approve",
      [token, external.universalRouter, 0n, 0n],
    );
    await write("oracle-refresh", "oracle-refresh-token-clear", token, tokenAbi, "approve", [
      external.permit2,
      0n,
    ]);
    const permit2Allowance = await read(external.permit2, permit2Abi, "allowance", [
      account.address,
      token,
      external.universalRouter,
    ]);
    if (
      (await read(token, tokenAbi, "balanceOf", [account.address])) !== 0n ||
      (await read(token, tokenAbi, "allowance", [account.address, external.permit2])) !== 0n ||
      BigInt(permit2Allowance[0]) !== 0n
    ) {
      throw new Error("oracle refresh round trip left tokens or allowances");
    }
    await mark(stage, { refreshFinishedAt: (await latestTime()).toString() });
    return;
  }

  if (stage === "post-settle") {
    if (!state.completedStages.includes("refresh-finish")) {
      throw new Error("post-settle requires the bounded oracle refresh round trip");
    }
    const readiness = await oracleReadiness();
    if (!readiness.ready) {
      process.stdout.write(`${json({ stage, status: "not-ready", oracle: readiness })}\n`);
      return;
    }
    await settleFees("final-settlement");
    if ((await read(token, tokenAbi, "balanceOf", [account.address])) !== 0n) {
      throw new Error("final settlement changed the project launch-token balance");
    }
    await mark("post-settle");
    return;
  }
  if (stage === "reconcile") {
    if (
      !state.completedStages.includes("post-settle") ||
      !state.completedStages.includes("shutdown")
    ) {
      throw new Error("reconciliation requires final settlement and guardian shutdown");
    }
    if (!(await paused())) throw new Error("reconciliation requires Paused state");
    if ((await read(token, tokenAbi, "balanceOf", [account.address])) !== 0n) {
      throw new Error("reconciliation found a project launch-token balance");
    }
    const positionAbi = parseAbi(["function getPositionLiquidity(uint256 tokenId) view returns (uint128)"]);
    const tokenId = await read(locker, lockerAbi, "positionTokenId");
    const locked = await read(external.positionManager, positionAbi, "getPositionLiquidity", [tokenId]);
    if (locked !== BigInt(state.lockedPrincipal)) throw new Error("locked principal changed");
    if (
      (await read(token, tokenAbi, "totalSupply")) !== 1_000_000_000n * 10n ** 18n ||
      (await read(contracts.daoToken, built.dao.abi, "totalSupply")) !== 1_000_000_000n * 10n ** 18n
    ) {
      throw new Error("fixed supply changed");
    }
    if (
      (await read(token, tokenAbi, "allowance", [account.address, market])) !== 0n ||
      (await read(token, tokenAbi, "allowance", [account.address, external.permit2])) !== 0n ||
      (await read(token, tokenAbi, "allowance", [account.address, contracts.assetRouter])) !== 0n
    ) {
      throw new Error("canary left a residual allowance");
    }
    const liabilities = await read(contracts.feeRouter, built.feeRouter.abi, "totalNativeLiabilities");
    if (liabilities !== (await client.getBalance({ address: contracts.feeRouter }))) {
      throw new Error("fee router is not exactly solvent");
    }
    const launchAccount = await read(contracts.feeRouter, built.feeRouter.abi, "launchAccount", [token]);
    if (
      (await read(contracts.feeRouter, built.feeRouter.abi, "totalBasketNative")) +
        launchAccount.cumulativeCreatorNative +
        (await read(contracts.feeRouter, built.feeRouter.abi, "totalDaoNativeRewards")) +
        (await read(contracts.feeRouter, built.feeRouter.abi, "totalTreasuryNative")) !==
      launchAccount.cumulativeNativeFees
    ) {
      throw new Error("50/25/20/5 conservation failed");
    }
    const assertRewardAccounting = (label, accounting, eligibleSupply) => {
      const [
        deposited,
        vested,
        unvested,
        claimed,
        queued,
        carry,
        available,
        outstanding,
        ,
        deficit,
      ] = accounting.map(BigInt);
      if (deposited !== vested + unvested + queued) {
        throw new Error(`${label} deposited reward conservation failed`);
      }
      if (outstanding !== deposited - claimed || available < outstanding || deficit !== 0n) {
        throw new Error(`${label} reward backing failed`);
      }
      if (eligibleSupply > 0n && carry >= eligibleSupply) {
        throw new Error(`${label} rounding carry is not bounded`);
      }
    };
    const daoAccounting = await read(
      contracts.daoToken,
      built.dao.abi,
      "rewardAccountingState",
    );
    const daoEligibleSupply = await read(
      contracts.daoToken,
      built.dao.abi,
      "eligibleRewardSupply",
    );
    assertRewardAccounting("DAO", daoAccounting, daoEligibleSupply);
    const holderRemainderBound = await read(token, tokenAbi, "totalSupply");
    const rewardAssetCount = Number(await read(token, tokenAbi, "rewardAssetCount"));
    for (let index = 0; index < rewardAssetCount; index += 1) {
      const accounting = await read(token, tokenAbi, "rewardAccountingState", [BigInt(index)]);
      assertRewardAccounting(`holder asset ${index}`, accounting, holderRemainderBound);
    }
    const creator = await read(
      contracts.feeRouter,
      built.feeRouter.abi,
      "creatorRewardStream",
      [token, checksum(manifest.deployer)],
    );
    if (
      BigInt(creator.assigned) !== BigInt(creator.vested) + BigInt(creator.unvested) ||
      BigInt(creator.vested) !== BigInt(creator.claimed) + BigInt(creator.claimable)
    ) {
      throw new Error("creator reward conservation failed");
    }
    const canaryProfile = await read(
      contracts.marketFactory,
      built.marketFactory.abi,
      "graduationProfileByToken",
      [token],
    );
    if (canaryProfile.targetGraduationNative !== BigInt(state.canaryTargetWei)) {
      throw new Error("canary profile snapshot changed");
    }
    await mark("reconcile", {
      reconciledAt: new Date().toISOString(),
      finalBalanceWei: (await client.getBalance({ address: account.address })).toString(),
    });
    return;
  }
};

try {
  await run();
} catch (error) {
  await writeFile(
    path.join(evidenceRoot, `failure-${new Date().toISOString().replace(/[:.]/g, "")}.json`),
    `${json({ stage, failedAt: new Date().toISOString(), error: error.stack ?? error.message })}\n`,
    { mode: 0o600 },
  ).catch(() => {});
  if (!readOnly.has(stage) && stage !== "shutdown" && !error.canaryRunInvalidated) {
    Object.assign(state, {
      failedRun: true,
      shutdownRequired: true,
      failedStage: stage,
      failedAt: new Date().toISOString(),
      failure: String(error?.message ?? error).slice(0, 500),
    });
    await saveState().catch(() => {});
    try {
      if (!(await paused())) await shutdown();
    } catch (shutdownError) {
      await append({
        type: "shutdown-failed",
        recordedAt: new Date().toISOString(),
        stage,
        error: String(shutdownError?.stack ?? shutdownError).slice(0, 2_000),
      }).catch(() => {});
    }
  }
  throw error;
}
