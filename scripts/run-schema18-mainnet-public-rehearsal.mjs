#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

const PUBLIC_APPLICATION_SHA = "5ea50ed836d81416a7a6a32c8078a864fca28d0b";
const INDEXING_POLICY_HASH =
  "5e92d61940f39b05f7b61273b0a2d190d77cf204369a224822b098a4f5ca01e1";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const sourcePath = path.resolve(required("ROBYN_SCHEMA18_GATE1_LIFECYCLE_MANIFEST"));
const gate1Path = path.resolve(required("ROBYN_SCHEMA18_GATE1_AUTHORIZED_MANIFEST"));
const gate2Root = path.resolve(required("ROBYN_SCHEMA18_GATE2_RECOVERY_EVIDENCE"));
const output = path.resolve(required("ROBYN_SCHEMA18_MAINNET_PUBLIC_REHEARSAL"));
const gateway = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const anvilRpc = "http://127.0.0.1:28620";
const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sourceRaw = await readFile(sourcePath, "utf8");
const source = JSON.parse(sourceRaw);
const gate1Raw = await readFile(gate1Path, "utf8");
const gate1 = JSON.parse(gate1Raw);
const gate2StateRaw = await readFile(path.join(gate2Root, "state.json"), "utf8");
const gate2State = JSON.parse(gate2StateRaw);
const gate2JournalRaw = await readFile(path.join(gate2Root, "transactions.jsonl"), "utf8");
if (
  source.schemaVersion !== 18 ||
  source.chainId !== 4663 ||
  gate1.contractReleaseSha !== source.releaseSha ||
  gate2State.releaseSha !== source.releaseSha
) {
  throw new Error("Schema-18 Gate 1 or Gate 2 evidence mismatch");
}
for (const stage of [
  "claims",
  "unwind",
  "schedule-reactivation",
  "execute-reactivation",
  "refresh-start",
  "refresh-finish",
  "post-settle",
  "shutdown",
  "reconcile",
]) {
  if (!gate2State.completedStages?.includes(stage)) throw new Error(`Gate 2 missing ${stage}`);
}
if (gate2State.failedRun || BigInt(gate2State.recoveryBps) < 7500n || !gate2State.token) {
  throw new Error("post-graduation Gate 2 did not finish cleanly");
}
const gate2Records = gate2JournalRaw.trim().split("\n").map(JSON.parse);
const gate2Intents = gate2Records.filter((record) => record.type === "intent");
const gate2Receipts = gate2Records.filter((record) => record.type === "receipt");
const gate2Keys = new Set();
const gate2Hashes = new Set();
if (gate2Intents.length === 0 || gate2Receipts.length !== gate2Intents.length) {
  throw new Error("Gate-2 journal is incomplete");
}
for (const receipt of gate2Receipts) {
  const hash = receipt.transactionHash?.toLowerCase();
  if (receipt.status !== "success" || !hash || gate2Keys.has(receipt.idempotencyKey) || gate2Hashes.has(hash)) {
    throw new Error("Gate-2 receipt failure, duplicate key, or reused hash");
  }
  gate2Keys.add(receipt.idempotencyKey);
  gate2Hashes.add(hash);
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

const routerArtifact = JSON.parse(
  await readFile(
    path.join(repoRoot, "packages/contracts/out/RobynV4AssetRouter.sol/RobynV4AssetRouter.json"),
    "utf8",
  ),
);
const marketArtifact = JSON.parse(
  await readFile(
    path.join(repoRoot, "packages/contracts/out/RobynV4MarketFactory.sol/RobynV4MarketFactory.json"),
    "utf8",
  ),
);
const resumeCalls = source.bootstrap.steps[0].calls.filter((call) =>
  ["resume-asset-conversions", "resume-fee-conversions"].includes(call.label),
);
const stepTwo = source.bootstrap.steps[1];
if (resumeCalls.length !== 2 || stepTwo.calls.length === 0) {
  throw new Error("qualified Public call plan is incomplete");
}
const calls = [...resumeCalls, ...stepTwo.calls];
const batch = {
  calls,
  targets: calls.map((call) => getAddress(call.target)),
  valuesWei: calls.map((call) => String(call.valueWei)),
  payloads: calls.map((call) => call.data),
  descriptionHash: keccak256(stringToHex("SCHEMA18_GATE3_PUBLIC_ACTIVATION")),
};
const batchHash = keccak256(
  encodeAbiParameters(
    [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
    [batch.targets, batch.valuesWei.map(BigInt), batch.payloads, batch.descriptionHash],
  ),
);
const expectedRoutes = [];
for (const call of stepTwo.calls.filter((item) => item.label.includes("public-cap"))) {
  const decoded = decodeFunctionData({ abi: routerArtifact.abi, data: call.data });
  const symbol = call.label.replace("install-", "").replace("-public-cap", "");
  if (decoded.functionName === "configureRoute") {
    const [asset, route] = decoded.args;
    expectedRoutes.push({
      symbol,
      asset: getAddress(asset),
      kind: "v4",
      fee: route.fee,
      tickSpacing: route.tickSpacing,
      hooks: getAddress(route.hooks),
      minimumLiquidity: route.minimumLiquidity.toString(),
      maximumNativeInput: route.maximumNativeInput.toString(),
      referenceTick: route.referenceTick,
      maximumReferenceTickDeviation: route.maximumReferenceTickDeviation,
      enforceReferencePrice: route.enforceReferencePrice,
      verificationClass: route.verificationClass,
      enabled: route.enabled,
    });
  } else if (decoded.functionName === "configureWrappedNativeRoute") {
    expectedRoutes.push({
      symbol,
      asset: getAddress(source.contracts.wrappedNative),
      kind: "wrapped-native",
      maximumNativeInput: decoded.args[0].toString(),
      enabled: decoded.args[1],
    });
  } else {
    throw new Error(`unexpected Public route function ${decoded.functionName}`);
  }
}
if (expectedRoutes.length !== 6 || expectedRoutes.some((route) => !route.enabled)) {
  throw new Error("Public route plan is incomplete");
}
const governorAbi = parseAbi(["function unanimousNonce() view returns (uint256)"]);
const expectedUnanimousNonce = await live.readContract({
  address: getAddress(source.contracts.governor),
  abi: governorAbi,
  functionName: "unanimousNonce",
});
const canaryProfile = await live.readContract({
  address: getAddress(source.contracts.marketFactory),
  abi: marketArtifact.abi,
  functionName: "graduationProfileByToken",
  args: [getAddress(gate2State.token)],
});
const currentProfile = await live.readContract({
  address: getAddress(source.contracts.marketFactory),
  abi: marketArtifact.abi,
  functionName: "currentGraduationProfile",
});
const manifest = {
  schemaVersion: 18,
  chainId: 4663,
  authorizationEligible: true,
  contractReleaseSha: source.releaseSha,
  applicationReleaseSha: PUBLIC_APPLICATION_SHA,
  operationalToolingSha: toolingSha,
  deployer: source.deployer,
  guardianSafe: source.guardianSafe,
  contracts: {
    ...source.contracts,
    factory: source.contracts.launchFactory,
  },
  routes: source.routes,
  runtimeIdentities,
  canary: {
    launchToken: getAddress(gate2State.token),
    profileVersion: canaryProfile.version.toString(),
    targetGraduationNativeWei: canaryProfile.targetGraduationNative.toString(),
    maximumCurvePurchaseWei: canaryProfile.maximumCurvePurchase.toString(),
    recoveryBps: gate2State.recoveryBps,
  },
  publicActivation: {
    expectedUnanimousNonce: expectedUnanimousNonce.toString(),
    batch,
    batchHash,
    profile: {
      version: (currentProfile.version + 1n).toString(),
      targetGraduationNativeWei: "6000000000000000000",
      maximumCurvePurchaseWei: "500000000000000000",
    },
    routes: expectedRoutes,
  },
  application: {
    releaseSha: PUBLIC_APPLICATION_SHA,
    indexingPolicyHash: INDEXING_POLICY_HASH,
    scopedIndexerAcceptancePassed: true,
    applicationWritesEnabled: false,
    financialSubmissionProcessesStarted: false,
    alchemyApplicationTrafficConfigured: false,
    pm2TopologySha256:
      "cfccbd20897b53acac16e9f9dd17efe7798f5ac2f489713048e16f84b86919d1",
    nginxConfigSha256:
      "8e436366086b723696a3cbad1e1912578d5b0e4d811fc91a556432399fd25cbdd",
    keeperStarted: false,
    publicIngressInitiallyEnabled: false,
    databaseIdentity: {
      name: "robyn_mainnet",
      schemaVersion: 18,
      deploymentBlock: "25321851",
    },
  },
  indexingPolicy: {
    policyHash: INDEXING_POLICY_HASH,
  },
  gas: {
    phaseCeilings: { public: "30000000", shutdown: "30000000" },
    maxFeePerGasWei: "1000000000000",
  },
  authorization: {
    additionalBridgeAuthorized: false,
    publicActivationAuthorized: false,
    applicationWritesAuthorized: false,
  },
};
const manifestPath = path.join(output, "rehearsal-input-manifest.json");
const manifestRaw = `${json(manifest)}\n`;
await writeFile(manifestPath, manifestRaw, { mode: 0o600 });
const env = {
  ...process.env,
  ROBYN_SCHEMA18_MAINNET_PUBLIC_LOCAL_REHEARSAL: "true",
  ROBYN_SCHEMA18_MAINNET_PUBLIC_MANIFEST: manifestPath,
  ROBYN_SCHEMA18_MAINNET_PUBLIC_MANIFEST_SHA256: sha256(manifestRaw),
  ROBYN_SCHEMA18_MAINNET_PUBLIC_EVIDENCE: output,
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
    "28620",
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
  execFileSync(process.execPath, [path.join(repoRoot, "scripts/run-schema18-mainnet-public-live.mjs"), stage], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  await wait();
  await rpc("anvil_setBalance", [source.deployer, "0xde0b6b3a7640000"]);
  await rpc("anvil_impersonateAccount", [source.deployer]);
  run("verify");
  run("schedule-public");
  await rpc("evm_increaseTime", [3601]);
  await rpc("evm_mine");
  run("execute-public");
  run("verify-public");
  run("shutdown");
  const statePath = path.join(output, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.forkBlock = forkBlock.toString();
  await writeFile(statePath, `${json(state)}\n`, { mode: 0o600 });
  const journal = await readFile(path.join(output, "transactions.jsonl"), "utf8");
  const receipts = journal.trim().split("\n").map(JSON.parse).filter((record) => record.type === "receipt");
  const report = {
    schemaVersion: 18,
    status: "passed",
    executionMode: "local-fork-broadcast",
    forkBlock: forkBlock.toString(),
    contractReleaseSha: source.releaseSha,
    applicationReleaseSha: PUBLIC_APPLICATION_SHA,
    receiptCount: receipts.length,
    completedStages: state.completedStages,
    mainnetTransactionsBroadcast: 0,
  };
  const reportRaw = `${json(report)}\n`;
  await writeFile(path.join(output, "rehearsal-report.json"), reportRaw, { mode: 0o600 });
  const sums = [
    ["rehearsal-input-manifest.json", sha256(manifestRaw)],
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
