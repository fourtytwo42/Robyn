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
  pad,
  parseAbi,
  stringToHex,
  zeroAddress,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseCastDecryptedPrivateKey } from "./lib/campaign-keystore.mjs";
import { classifyCanaryJournal } from "./lib/mainnet-canary-journal.mjs";

const CHAIN_ID = 4663;
const CONTRACT_RELEASE_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const APPLICATION_RELEASE_SHA = "5ea50ed836d81416a7a6a32c8078a864fca28d0b";
const INDEXING_POLICY_HASH =
  "5e92d61940f39b05f7b61273b0a2d190d77cf204369a224822b098a4f5ca01e1";
const PM2_TOPOLOGY_HASH =
  "cfccbd20897b53acac16e9f9dd17efe7798f5ac2f489713048e16f84b86919d1";
const NGINX_CONFIG_HASH =
  "8e436366086b723696a3cbad1e1912578d5b0e4d811fc91a556432399fd25cbdd";
const RESERVE = 20_000_000_000_000_000n;
const L1_FEE_RESERVE = 25_000_000_000_000n;
const localRehearsal = process.env.ROBYN_SCHEMA18_MAINNET_PUBLIC_LOCAL_REHEARSAL === "true";
const schema19ReplacementRetirement =
  process.env.ROBYN_SCHEMA19_REPLACEMENT_RETIREMENT === "true";
const stages = new Set([
  "verify",
  "schedule-public",
  "execute-public",
  "verify-public",
  "shutdown",
  "status",
]);
const stage = process.argv[2];
if (!stages.has(stage)) {
  throw new Error(`usage: ${path.basename(process.argv[1])} ${[...stages].join("|")}`);
}
if (schema19ReplacementRetirement && stage !== "shutdown") {
  throw new Error("Schema-19 replacement retirement authorizes only Schema-18 shutdown");
}
const readOnly = new Set(["verify", "verify-public", "status"]);
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseSha = CONTRACT_RELEASE_SHA;
const manifestPath = path.resolve(required("ROBYN_SCHEMA18_MAINNET_PUBLIC_MANIFEST"));
const expectedManifestSha = required("ROBYN_SCHEMA18_MAINNET_PUBLIC_MANIFEST_SHA256").toLowerCase();
const evidenceRoot = path.resolve(required("ROBYN_SCHEMA18_MAINNET_PUBLIC_EVIDENCE"));
const rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? (localRehearsal ? "http://127.0.0.1:28549" : "http://127.0.0.1:18549");
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpc)) {
  throw new Error("Schema-18 Mainnet Public activation requires a loopback LAN gateway");
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
  throw new Error("Schema-18 Mainnet Public activation requires exact clean pushed tooling");
}

const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);
const manifestSha = sha256(manifestRaw);
if (manifestSha !== expectedManifestSha) throw new Error("sealed Public manifest SHA-256 mismatch");
if (manifest.schemaVersion !== 18 || manifest.chainId !== CHAIN_ID || manifest.contractReleaseSha !== CONTRACT_RELEASE_SHA || manifest.applicationReleaseSha !== APPLICATION_RELEASE_SHA) {
  throw new Error("Schema-18 Mainnet Public activation manifest identity mismatch");
}
if (
  manifest.indexingPolicy?.policyHash !== INDEXING_POLICY_HASH ||
  manifest.application?.indexingPolicyHash !== INDEXING_POLICY_HASH ||
  manifest.application?.scopedIndexerAcceptancePassed !== true ||
  manifest.application?.applicationWritesEnabled !== false ||
  manifest.application?.financialSubmissionProcessesStarted !== false ||
  manifest.application?.alchemyApplicationTrafficConfigured !== false ||
  manifest.application?.pm2TopologySha256 !== PM2_TOPOLOGY_HASH ||
  manifest.application?.nginxConfigSha256 !== NGINX_CONFIG_HASH ||
  manifest.application?.keeperStarted !== false ||
  manifest.application?.publicIngressInitiallyEnabled !== false ||
  manifest.application?.databaseIdentity?.name !== "robyn_mainnet" ||
  manifest.application?.databaseIdentity?.schemaVersion !== 18 ||
  manifest.application?.databaseIdentity?.deploymentBlock !== "25321851" ||
  manifest.contracts?.factory?.toLowerCase() !== manifest.contracts?.launchFactory?.toLowerCase()
) {
  throw new Error("Gate 3 scoped application or indexer identity mismatch");
}
if (manifest.operationalToolingSha !== toolingSha && !localRehearsal && !schema19ReplacementRetirement) throw new Error("Public manifest is not bound to this tooling SHA");
if (
  manifest.authorizationEligible !== true ||
  manifest.authorization?.additionalBridgeAuthorized !== false ||
  manifest.authorization?.publicActivationAuthorized !== false ||
  manifest.authorization?.applicationWritesAuthorized !== false
) {
  throw new Error("Gate 3 manifest scope or pre-authorization state is invalid");
}
if (!localRehearsal && !readOnly.has(stage) && schema19ReplacementRetirement) {
  const replacementPath = path.resolve(required("ROBYN_SCHEMA19_MAINNET_REPLACEMENT_MANIFEST"));
  const replacementRaw = await readFile(replacementPath, "utf8");
  const replacement = JSON.parse(replacementRaw);
  const replacementSha = sha256(replacementRaw);
  const authorizationRaw = await readFile(
    path.resolve(required("ROBYN_SCHEMA19_MAINNET_REPLACEMENT_AUTHORIZATION_RECEIPT")),
    "utf8",
  );
  const authorization = JSON.parse(authorizationRaw);
  if (
    process.env.ROBYN_SCHEMA19_MAINNET_REPLACEMENT_AUTHORIZED !== replacementSha ||
    replacement.schemaVersion !== 19 ||
    replacement.chainId !== 4663 ||
    replacement.gate !== "schema19-mainnet-public-replacement" ||
    replacement.identities?.operationalToolingSha !== toolingSha ||
    replacement.identities?.schema18ManifestSha256 !== manifestSha ||
    replacement.legacySchema18?.disposition !== "owner-accepted-test-canary-archive" ||
    authorization.authorized !== true ||
    authorization.manifestSha256 !== replacementSha ||
    authorization.scope !== "schema19-deployment-schema18-archive-and-application-cutover" ||
    authorization.schema19DeploymentAuthorized !== true ||
    authorization.schema18RetirementAuthorized !== true ||
    authorization.applicationWritesAuthorized !== true ||
    authorization.additionalBridgeAuthorized !== false
  ) {
    throw new Error("exact Schema-19 replacement authorization does not permit Schema-18 retirement");
  }
} else if (!localRehearsal && !readOnly.has(stage)) {
  const authorizationPath = path.resolve(required("ROBYN_SCHEMA18_MAINNET_PUBLIC_AUTHORIZATION_RECEIPT"));
  const authorizationRaw = await readFile(authorizationPath, "utf8");
  const authorization = JSON.parse(authorizationRaw);
  if (
    process.env.ROBYN_SCHEMA18_MAINNET_PUBLIC_AUTHORIZED !== manifestSha ||
    process.env.ROBYN_SCHEMA18_MAINNET_PUBLIC_AUTHORIZATION_RECEIPT_SHA256 !== sha256(authorizationRaw) ||
    authorization.schemaVersion !== 18 ||
    authorization.gate !== "schema18-gate3-public" ||
    authorization.authorized !== true ||
    authorization.manifestSha256 !== manifestSha ||
    authorization.scope !== "unanimous-public-through-application-writes-and-emergency-verification" ||
    authorization.additionalBridgeAuthorized !== false ||
    authorization.publicActivationAuthorized !== true ||
    authorization.applicationWritesAuthorized !== true
  ) {
    throw new Error("exact Gate 3 manifest lacks a matching protected authorization receipt");
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
  completedStages: [],
  createdAt: new Date().toISOString(),
});
if (
  state.releaseSha !== releaseSha ||
  state.deploymentSha !== manifest.contractReleaseSha ||
  state.toolingSha !== toolingSha ||
  state.manifestSha256 !== sha256(manifestRaw)
) {
  throw new Error("Public lifecycle state belongs to another release or manifest");
}
const saveState = async () => {
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${json({ ...state, updatedAt: new Date().toISOString() })}\n`, {
    mode: 0o600,
  });
  await rename(temporary, statePath);
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
  const key = `schema18-${localRehearsal ? "mainnet-public-fork" : "mainnet-public"}:${phase}:${label}`;
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
        receiptDigest: receiptDigest(receipt),
      });
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
    ? 1_000_000n
    : (fees.maxFeePerGas ?? fees.gasPrice);
  const maxFeePerGas = (baseMaxFee * 12_500n + 9_999n) / 10_000n;
  const maxPriorityFeePerGas = localRehearsal
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
      localForkUnsigned: true,
    });
    const transactionHash = await wallet.sendTransaction(request);
    const receipt = await client.waitForTransactionReceipt({
      hash: transactionHash,
      timeout: 180_000,
    });
    if (receipt.status !== "success") throw new Error(`${key} reverted`);
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
      receiptDigest: receiptDigest(receipt),
    });
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
    receiptDigest: receiptDigest(receipt),
  });
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
  marketFactory: await artifact("RobynV4MarketFactory"),
  hook: await artifact("RobynV4FeeAndPhaseHook"),
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
  marketFactory: checksum(manifest.contracts.marketFactory),
  oracleHook: checksum(manifest.contracts.oracleHook),
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
const mark = async (name, extra = {}) => {
  if (!state.completedStages.includes(name)) state.completedStages.push(name);
  Object.assign(state, extra);
  await saveState();
};
const publicBatch = () => ({
  targets: manifest.publicActivation.batch.targets.map(checksum),
  values: manifest.publicActivation.batch.valuesWei.map(BigInt),
  payloads: manifest.publicActivation.batch.payloads,
  descriptionHash: manifest.publicActivation.batch.descriptionHash,
});
const assertPublicPlan = async () => {
  const batch = publicBatch();
  if (batch.targets.length === 0 || batch.targets.length !== batch.values.length || batch.targets.length !== batch.payloads.length) {
    throw new Error("sealed Public batch is malformed");
  }
  const derived = keccak256(encodeAbiParameters(
    [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
    [batch.targets, batch.values, batch.payloads, batch.descriptionHash],
  ));
  if (derived.toLowerCase() !== manifest.publicActivation.batchHash.toLowerCase()) {
    throw new Error("sealed Public batch hash mismatch");
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
        ? "SCHEMA18_MAINNET_PUBLIC_FORK_EMERGENCY"
        : "SCHEMA18_MAINNET_PUBLIC_EMERGENCY",
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
  await assertPublicPlan();

  const bootstrapFinalized = await read(
    contracts.timelock,
    built.timelock.abi,
    "bootstrapFinalized",
  );
  const launchMode = Number(
    await read(contracts.coordinator, built.coordinator.abi, "launchMode"),
  );
  const unanimousNonce = BigInt(
    await read(contracts.governor, built.governor.abi, "unanimousNonce"),
  );

  const verifyCanarySnapshot = async () => {
    const token = checksum(manifest.canary.launchToken);
    const profile = await read(
      contracts.marketFactory,
      built.marketFactory.abi,
      "graduationProfileByToken",
      [token],
    );
    if (
      profile.version !== BigInt(manifest.canary.profileVersion) ||
      profile.targetGraduationNative !== BigInt(manifest.canary.targetGraduationNativeWei) ||
      profile.maximumCurvePurchase !== BigInt(manifest.canary.maximumCurvePurchaseWei)
    ) {
      throw new Error("Canary launch profile snapshot changed");
    }
  };

  const verifyPublicState = async () => {
    if (
      Number(await read(contracts.coordinator, built.coordinator.abi, "launchMode")) !== 2 ||
      (await read(contracts.assetRouter, built.assetRouter.abi, "conversionsPaused")) ||
      (await read(contracts.feeRouter, built.feeRouter.abi, "paused"))
    ) {
      throw new Error("Public mode or conversion state is incorrect");
    }
    const profile = await read(
      contracts.marketFactory,
      built.marketFactory.abi,
      "currentGraduationProfile",
    );
    if (
      profile.version !== BigInt(manifest.publicActivation.profile.version) ||
      profile.targetGraduationNative !== BigInt(manifest.publicActivation.profile.targetGraduationNativeWei) ||
      profile.maximumCurvePurchase !== BigInt(manifest.publicActivation.profile.maximumCurvePurchaseWei)
    ) {
      throw new Error("production graduation profile mismatch");
    }
    for (const expected of manifest.publicActivation.routes) {
      const execution = await read(
        contracts.assetRouter,
        built.assetRouter.abi,
        "executionRoute",
        [checksum(expected.asset)],
      );
      if (
        !execution.enabled ||
        execution.maximumNativeInput !== BigInt(expected.maximumNativeInput)
      ) {
        throw new Error(`${expected.symbol} Public route differs from the sealed state`);
      }
      if (expected.kind === "wrapped-native") {
        if (Number(execution.kind) !== 2) {
          throw new Error(`${expected.symbol} Public route kind differs from the sealed state`);
        }
        continue;
      }
      if (expected.kind !== "v4" || Number(execution.kind) !== 1) {
        throw new Error(`${expected.symbol} Public route kind differs from the sealed state`);
      }
      const configured = await read(
        contracts.assetRouter,
        built.assetRouter.abi,
        "route",
        [checksum(expected.asset)],
      );
      if (
        !configured.enabled ||
        Number(configured.fee) !== Number(expected.fee) ||
        Number(configured.tickSpacing) !== Number(expected.tickSpacing) ||
        checksum(configured.hooks) !== checksum(expected.hooks) ||
        configured.minimumLiquidity !== BigInt(expected.minimumLiquidity) ||
        configured.maximumNativeInput !== BigInt(expected.maximumNativeInput) ||
        Number(configured.referenceTick) !== Number(expected.referenceTick) ||
        Number(configured.maximumReferenceTickDeviation) !==
          Number(expected.maximumReferenceTickDeviation) ||
        configured.enforceReferencePrice !== expected.enforceReferencePrice ||
        configured.verificationClass.toLowerCase() !==
          expected.verificationClass.toLowerCase()
      ) {
        throw new Error(`${expected.symbol} Public v4 route differs from the sealed state`);
      }
    }
    await verifyCanarySnapshot();
  };

  const status = async () => ({
    stage,
    releaseSha,
    toolingSha,
    manifestSha256: manifestSha,
    chainId: await client.getChainId(),
    blockNumber: await client.getBlockNumber(),
    balanceWei: await client.getBalance({ address: checksum(manifest.deployer) }),
    launchMode: Number(
      await read(contracts.coordinator, built.coordinator.abi, "launchMode"),
    ),
    bootstrapFinalized: await read(
      contracts.timelock,
      built.timelock.abi,
      "bootstrapFinalized",
    ),
    unanimousNonce: (
      await read(contracts.governor, built.governor.abi, "unanimousNonce")
    ).toString(),
    gateway: {
      status: gateway.status,
      activeProvider: gateway.activeProvider,
      fallbackTrafficAuthorized: gateway.fallbackTrafficAuthorized,
    },
    state,
  });

  if (stage === "verify" || stage === "status") {
    if (!bootstrapFinalized || launchMode !== 0 || !(await paused())) {
      throw new Error("Public preparation requires reconciled Paused post-Canary state");
    }
    if (unanimousNonce !== BigInt(manifest.publicActivation.expectedUnanimousNonce)) {
      throw new Error("unanimous nonce changed from the sealed Public manifest");
    }
    await verifyCanarySnapshot();
    process.stdout.write(`${json(await status())}\n`);
    return;
  }
  if (stage === "verify-public") {
    await verifyPublicState();
    process.stdout.write(`${json(await status())}\n`);
    return;
  }
  if (state.failedRun && stage !== "shutdown") {
    if (state.shutdownRequired && !(await paused())) await shutdown();
    throw new Error("Public lifecycle invalidated; automatic replay is prohibited");
  }
  if (state.completedStages.includes(stage)) {
    process.stdout.write(`${json({ stage, status: "already-completed" })}\n`);
    return;
  }

  if (stage === "schedule-public") {
    if (!bootstrapFinalized || !(await paused())) {
      throw new Error("Public scheduling requires finalized bootstrap and Paused state");
    }
    if (unanimousNonce !== BigInt(manifest.publicActivation.expectedUnanimousNonce)) {
      throw new Error("unanimous nonce changed from the sealed Public manifest");
    }
    const supply = await read(contracts.daoToken, built.dao.abi, "totalSupply");
    const ownerBalance = await read(
      contracts.daoToken,
      built.dao.abi,
      "balanceOf",
      [checksum(manifest.deployer)],
    );
    const clock = BigInt(await read(contracts.daoToken, built.dao.abi, "clock"));
    const priorVotes = await read(
      contracts.daoToken,
      built.dao.abi,
      "getPastVotes",
      [checksum(manifest.deployer), clock - 1n],
    );
    if (supply === 0n || ownerBalance !== supply || priorVotes !== supply) {
      throw new Error("deployer is not the checkpointed unanimous RDAO owner");
    }
    const batch = publicBatch();
    const salt = unanimousSalt({ nonce: unanimousNonce, ...batch });
    const operationId = await read(
      contracts.timelock,
      built.timelock.abi,
      "hashOperationBatch",
      [batch.targets, batch.values, batch.payloads, zeroHash, salt],
    );
    if (await read(contracts.timelock, built.timelock.abi, "isOperation", [operationId])) {
      throw new Error("sealed Public operation already exists");
    }
    await write(
      "public",
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
      throw new Error("Governor did not bind the Public operation to the unanimous owner");
    }
    const delay = BigInt(
      await read(contracts.timelock, built.timelock.abi, "getMinDelay"),
    );
    await mark(stage, {
      publicNonce: unanimousNonce.toString(),
      publicSalt: salt,
      publicOperationId: operationId,
      publicReadyAt: ((await latestTime()) + delay).toString(),
    });
    return;
  }

  if (stage === "execute-public") {
    if (!state.completedStages.includes("schedule-public")) {
      throw new Error("Public execution requires the sealed scheduled operation");
    }
    if ((await latestTime()) < BigInt(state.publicReadyAt)) {
      throw new Error("one-hour Public Timelock is not complete");
    }
    if (!(await read(
      contracts.timelock,
      built.timelock.abi,
      "isOperationReady",
      [state.publicOperationId],
    ))) {
      throw new Error("sealed Public operation is not ready");
    }
    const batch = publicBatch();
    await write(
      "public",
      stage,
      contracts.timelock,
      built.timelock.abi,
      "executeBatch",
      [batch.targets, batch.values, batch.payloads, zeroHash, state.publicSalt],
    );
    await verifyPublicState();
    await mark(stage, { publicActivatedAt: (await latestTime()).toString() });
    return;
  }
  if (stage === "shutdown") {
    await shutdown();
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
  if (!readOnly.has(stage) && stage !== "shutdown") {
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
