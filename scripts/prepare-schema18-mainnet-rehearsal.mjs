#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";
import { poolIdForRoute } from "./lib/mainnet-rehearsal.mjs";

export const SCHEMA18_CONTRACT_SHA =
  "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
export const SCHEMA18_APPLICATION_SHA =
  "8327b250122cd9050a7da6a44e12859e3cf521aa";
export const EXISTING_SAFE = getAddress(
  "0xE6CD65E3039fCbb7fD8fb992E5388247d9627549",
);
const CHAIN_ID = 4663;
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const outputRoot = path.resolve(required("ROBYN_SCHEMA18_MAINNET_PREPARE_OUTPUT"));
const rpcUrl =
  process.env.ROBYN_SCHEMA18_MAINNET_RPC_URL ?? "http://127.0.0.1:28548";
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpcUrl)) {
  throw new Error("Schema-18 Mainnet preparation requires a loopback RPC");
}
const deployer = getAddress(required("ROBYN_MAINNET_DEPLOYER_ADDRESS"));
const config = JSON.parse(
  await readFile(
    path.join(repoRoot, "config/protocol/robinhood-mainnet-rehearsal.json"),
    "utf8",
  ),
);
const schema = JSON.parse(
  await readFile(
    path.join(repoRoot, "config/protocol/robinhood-mainnet-schema18.json"),
    "utf8",
  ),
);
const support = JSON.parse(
  await readFile(
    path.join(
      repoRoot,
      "config/protocol/robinhood-mainnet-support-policy.json",
    ),
    "utf8",
  ),
);
if (
  config.chainId !== CHAIN_ID ||
  schema.schemaVersion !== 18 ||
  schema.chainId !== CHAIN_ID ||
  support.schemaVersion !== 16 ||
  support.chainId !== CHAIN_ID
) {
  throw new Error("Schema-18 Mainnet configuration or external route catalog identity mismatch");
}
if (!schema.reuseExistingSafe) throw new Error("existing Safe reuse is required");

const client = createPublicClient({
  transport: http(rpcUrl, { timeout: 60_000, retryCount: 0 }),
});
if (
  (await client.getChainId()) !== CHAIN_ID ||
  (await client.request({ method: "eth_syncing", params: [] })) !== false
) {
  throw new Error("Schema-18 Mainnet source is wrong-chain or syncing");
}
const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getModulesPaginated(address start,uint256 pageSize) view returns (address[] array,address next)",
]);
const [owners, threshold, modules] = await Promise.all([
  client.readContract({ address: EXISTING_SAFE, abi: safeAbi, functionName: "getOwners" }),
  client.readContract({ address: EXISTING_SAFE, abi: safeAbi, functionName: "getThreshold" }),
  client.readContract({
    address: EXISTING_SAFE,
    abi: safeAbi,
    functionName: "getModulesPaginated",
    args: ["0x0000000000000000000000000000000000000001", 10n],
  }),
]);
if (
  owners.length !== 1 ||
  getAddress(owners[0]) !== deployer ||
  threshold !== 1n ||
  modules[0].length !== 0
) {
  throw new Error("existing Safe is not the verified deployer-owned 1-of-1 Safe");
}

const runtimeIdentities = [];
const verifyCode = async (name, address, expectedHash) => {
  const checksum = getAddress(address);
  const code = await client.getCode({ address: checksum });
  if (!code || code === "0x") throw new Error(`${name} runtime is missing`);
  const observed = keccak256(code).toLowerCase();
  if (expectedHash && observed !== expectedHash.toLowerCase()) {
    throw new Error(`${name} runtime hash changed`);
  }
  runtimeIdentities.push({ name, address: checksum, runtimeCodeHash: observed });
  return checksum;
};
for (const [name, entry] of Object.entries(config.venue)) {
  await verifyCode(name, entry.address, entry.runtimeCodeHash);
}
for (const [name, entry] of Object.entries(config.safe)) {
  if (entry?.address) await verifyCode(`safe-${name}`, entry.address, entry.runtimeCodeHash);
}
await verifyCode("existing-safe", EXISTING_SAFE);

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
const stateView = getAddress(config.venue.stateView.address);
const requiredStocks = support.candidates.filter(
  (candidate) => candidate.required && candidate.symbol !== "WETH",
);
if (requiredStocks.length !== 5) throw new Error("five required stock routes expected");
const routes = [];
for (const asset of requiredStocks) {
  await verifyCode(`asset-${asset.symbol}`, asset.address);
  const poolId = poolIdForRoute(asset.address, config.route);
  const [slot0, liquidity] = await Promise.all([
    client.readContract({ address: stateView, abi: stateViewAbi, functionName: "getSlot0", args: [poolId] }),
    client.readContract({ address: stateView, abi: stateViewAbi, functionName: "getLiquidity", args: [poolId] }),
  ]);
  if (slot0[0] === 0n || liquidity === 0n) {
    throw new Error(`${asset.symbol} has no executable v4 liquidity`);
  }
  const canaryCap = BigInt(asset.maximumNativeInputWei);
  const route = (maximumNativeInput) => ({
    fee: config.route.fee,
    tickSpacing: config.route.tickSpacing,
    hooks: getAddress(config.route.hooks),
    minimumLiquidity: liquidity.toString(),
    maximumNativeInput: maximumNativeInput.toString(),
    referenceTick: Number(slot0[1]),
    maximumReferenceTickDeviation: config.route.maximumReferenceTickDeviation,
    enforceReferencePrice: true,
    verificationClass: keccak256(stringToHex("ROBINHOOD_MAINNET_STOCK_TOKEN")),
    enabled: true,
  });
  routes.push({
    symbol: asset.symbol,
    asset: getAddress(asset.address),
    poolId,
    liquidity: liquidity.toString(),
    canary: route(canaryCap),
    public: route(canaryCap / 10n),
  });
}

const nonce = await client.getTransactionCount({ address: deployer, blockTag: "latest" });
const input = {
  schemaVersion: 18,
  chainId: CHAIN_ID,
  releaseSha: SCHEMA18_CONTRACT_SHA,
  deployer,
  guardianSafe: EXISTING_SAFE,
  startingNonce: nonce,
  autoMineHook: true,
  hookArtifact:
    "packages/contracts/out/RobynV4FeeAndPhaseHook.sol/RobynV4FeeAndPhaseHook.json",
  hookFlags: "0x18e4",
  hookDomain: keccak256(stringToHex(`sherwood-schema18-mainnet:${SCHEMA18_CONTRACT_SHA}`)),
  bootstrapDomain: keccak256(
    stringToHex(`sherwood-schema18-bootstrap:${SCHEMA18_CONTRACT_SHA}`),
  ),
  external: {
    create2Deployer: getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C"),
    poolManager: getAddress(config.venue.poolManager.address),
    positionManager: getAddress(config.venue.positionManager.address),
    quoter: getAddress(config.venue.quoter.address),
    stateView,
    permit2: getAddress(config.venue.permit2.address),
    wrappedNative: getAddress(config.venue.weth.address),
  },
  routes,
  wrappedNativeCanaryCapWei: support.candidates.find((item) => item.symbol === "WETH").maximumNativeInputWei,
  wrappedNativePublicCapWei: (
    BigInt(support.candidates.find((item) => item.symbol === "WETH").maximumNativeInputWei) / 10n
  ).toString(),
};
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const inputPath = path.join(outputRoot, "deployment-input.json");
const preparedPath = path.join(outputRoot, "deployment-prepared.json");
await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});
execFileSync(
  process.execPath,
  [path.join(repoRoot, "scripts/prepare-schema18-deployment.mjs"), inputPath, preparedPath],
  { cwd: repoRoot, stdio: "inherit", env: process.env },
);
const prepared = JSON.parse(await readFile(preparedPath, "utf8"));
const lifecycle = {
  schemaVersion: 18,
  environment: "robinhood-mainnet-local-fork",
  chainId: CHAIN_ID,
  releaseSha: SCHEMA18_CONTRACT_SHA,
  applicationReleaseSha: SCHEMA18_APPLICATION_SHA,
  deployer,
  guardianSafe: EXISTING_SAFE,
  contracts: {
    ...prepared.deployment.contracts,
    protocolFeeRouter: prepared.deployment.contracts.feeRouter,
    atomicLaunchCoordinator: prepared.deployment.contracts.coordinator,
    wrappedNative: input.external.wrappedNative,
    quoter: input.external.quoter,
    universalRouter: getAddress(config.venue.universalRouter.address),
    permit2: input.external.permit2,
    positionManager: input.external.positionManager,
  },
  governance: prepared.governance.governance,
  bootstrap: {
    domain: prepared.governance.bootstrap.domain,
    steps: prepared.governance.bootstrap.steps.map((step) => ({
      ...step,
      valuesWei: step.valuesWei,
    })),
  },
  routes: routes.map(({ symbol, asset, poolId, liquidity }) => ({
    symbol,
    asset,
    poolId,
    liquidity,
  })).concat([{ symbol: "WETH", asset: input.external.wrappedNative }]),
  routeSnapshots: routes,
  runtimeIdentities,
  initialState: schema.initialState,
  authorization: {
    mainnetTransactionsAuthorized: false,
    bootstrapExecutionAuthorized: false,
    publicActivationAuthorized: false,
  },
};
const lifecyclePath = path.join(outputRoot, "lifecycle-manifest.json");
const lifecycleRaw = `${JSON.stringify(lifecycle, null, 2)}\n`;
await writeFile(lifecyclePath, lifecycleRaw, { mode: 0o600, flag: "wx" });
const report = {
  schemaVersion: 18,
  chainId: CHAIN_ID,
  releaseSha: SCHEMA18_CONTRACT_SHA,
  applicationReleaseSha: SCHEMA18_APPLICATION_SHA,
  deployer,
  existingSafe: EXISTING_SAFE,
  startingNonce: nonce,
  routeCount: routes.length + 1,
  runtimeIdentities,
  deploymentInput: inputPath,
  deploymentPrepared: preparedPath,
  lifecycleManifest: lifecyclePath,
  lifecycleManifestSha256: createHash("sha256").update(lifecycleRaw).digest("hex"),
  mainnetBroadcastAuthorized: false,
};
await writeFile(
  path.join(outputRoot, "preparation-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o600, flag: "wx" },
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
