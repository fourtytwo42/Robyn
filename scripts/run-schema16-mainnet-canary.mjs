#!/usr/bin/env node
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  maxUint160,
  maxUint256,
  pad,
  parseAbi,
  stringToHex,
  toHex,
  zeroAddress,
  zeroHash,
} from "viem";
import { validateMainnetReceiptLedger } from "./lib/mainnet-receipt-ledger.mjs";
import { poolIdForRoute } from "./lib/mainnet-rehearsal.mjs";
import { encodeUniversalV4SingleSwap } from "./lib/v4-universal-router.mjs";

const RELEASE_SHA = "a8d54bb125d091be0cea010262a68a2baaceda30";
const CHAIN_ID = 4663;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateRoot = path.resolve(
  process.env.ROBYN_SCHEMA16_RELEASE_WORKTREE ?? "/home/hendo420/Robyn-mainnet-a8d54bb",
);
const governancePath = path.resolve(
  process.env.ROBYN_MAINNET_GOVERNANCE_REPORT ??
    "/home/hendo420/robyn-evidence/schema16-mainnet-go/governance/a8d54bb-final/bootstrap-governance.json",
);
const deploymentManifestPath = path.resolve(
  process.env.ROBYN_MAINNET_DEPLOYMENT_MANIFEST ??
    "/home/hendo420/robyn-evidence/schema16-mainnet-go/manifest/a8d54bb1-f80a187-rpc-policy/schema16-mainnet-deployment-manifest.json",
);
const outputRoot = path.resolve(
  process.env.ROBYN_MAINNET_BROADCAST_EVIDENCE ??
    `/home/hendo420/robyn-evidence/schema16-mainnet-go/fork/${RELEASE_SHA.slice(0, 8)}-broadcast-${new Date().toISOString().replace(/[-:.]/g, "")}`,
);
const upstreamRpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const anvilPort = Number(process.env.ROBYN_MAINNET_ANVIL_PORT ?? "28547");
const localRpc = `http://127.0.0.1:${anvilPort}`;
const foundryBin = path.join(process.env.HOME ?? "/home/hendo420", ".foundry", "bin");
const commandEnv = { ...process.env, PATH: `${foundryBin}:${process.env.PATH}` };
const chain = {
  id: CHAIN_ID,
  name: "Robinhood Mainnet fork rehearsal",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [localRpc] } },
};
const json = (value) =>
  JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
const command = (name, args, options = {}) =>
  execFileSync(name, args, {
    cwd: options.cwd ?? repoRoot,
    env: commandEnv,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
const git = (root, ...args) => command("git", ["-C", root, ...args]);
const requiredFile = async (file) => {
  await access(file);
  return file;
};
const configPath = path.join(repoRoot, "config/protocol/robinhood-mainnet-rehearsal.json");
const configRaw = await readFile(configPath, "utf8");
const config = JSON.parse(configRaw);
const supportPath = path.join(repoRoot, config.supportPolicy);
const supportRaw = await readFile(supportPath, "utf8");
const support = JSON.parse(supportRaw);
const governanceRaw = await readFile(await requiredFile(governancePath), "utf8");
const governance = JSON.parse(governanceRaw);
const deploymentManifest = JSON.parse(
  await readFile(await requiredFile(deploymentManifestPath), "utf8"),
);

if (git(candidateRoot, "rev-parse", "HEAD") !== RELEASE_SHA) {
  throw new Error("frozen release worktree is not the validated a8d54bb candidate");
}
if (git(candidateRoot, "status", "--porcelain") !== "") {
  throw new Error("frozen release worktree is dirty");
}
if (config.schemaVersion !== 16 || config.chainId !== CHAIN_ID) {
  throw new Error("Mainnet rehearsal configuration is not Schema-16 chain 4663");
}
if (
  governance.releaseSha !== RELEASE_SHA ||
  governance.governanceMode !== "sole-owner-bootstrap" ||
  governance.threshold !== 1 ||
  governance.owners?.length !== 1 ||
  governance.owners[0]?.toLowerCase() !== governance.deployer?.toLowerCase()
) {
  throw new Error("protected sole-owner bootstrap evidence does not match the frozen release");
}
if (
  deploymentManifest.releaseSha !== RELEASE_SHA ||
  deploymentManifest.chainId !== CHAIN_ID ||
  deploymentManifest.canaryAuthorized !== false ||
  deploymentManifest.publicActivationAuthorized !== false
) {
  throw new Error("sealed Paused deployment manifest identity mismatch");
}
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(upstreamRpc)) {
  throw new Error("fork upstream must be the protected loopback Mainnet gateway");
}
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
await writeFile(
  path.join(outputRoot, "run-metadata.json"),
  `${json({
    schemaVersion: 16,
    releaseSha: RELEASE_SHA,
    startedAt: new Date().toISOString(),
    upstream: "protected-loopback-mainnet-gateway",
    broadcastScope: "isolated-anvil-only",
    mainnetBroadcastAuthorized: false,
  })}\n`,
  { mode: 0o600, flag: "wx" },
);

const upstream = createPublicClient({ transport: http(upstreamRpc, { timeout: 20_000 }) });
if ((await upstream.getChainId()) !== CHAIN_ID) throw new Error("upstream gateway is not chain 4663");
const upstreamHead = await upstream.getBlockNumber();
const forkBlock = upstreamHead > 3n ? upstreamHead - 3n : upstreamHead;

command("forge", ["build", "--root", "packages/contracts"], { cwd: candidateRoot });
try {
  const occupied = createPublicClient({ transport: http(localRpc, { timeout: 500, retryCount: 0 }) });
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
    "--silent",
  ],
  { env: commandEnv, stdio: ["ignore", "pipe", "pipe"] },
);
anvil.stdout.pipe(anvilLog);
anvil.stderr.pipe(anvilLog);
let anvilStopped = false;
const stopAnvil = async () => {
  if (anvilStopped) return;
  anvilStopped = true;
  anvil.kill("SIGTERM");
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3_000);
    anvil.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!exited) {
    try {
      process.kill(anvil.pid, "SIGKILL");
    } catch {}
  }
  anvilLog.end();
};
process.once("SIGINT", () => void stopAnvil().finally(() => process.exit(130)));
process.once("SIGTERM", () => void stopAnvil().finally(() => process.exit(143)));

const publicClient = createPublicClient({ chain, transport: http(localRpc) });
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    if ((await publicClient.getChainId()) === CHAIN_ID) break;
  } catch {
    if (attempt === 99) throw new Error("Anvil did not become ready");
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const deployer = getAddress(governance.deployer);
await publicClient.request({ method: "anvil_impersonateAccount", params: [deployer] });
await publicClient.request({
  method: "anvil_setBalance",
  params: [deployer, toHex(100n * 10n ** 18n)],
});
const wallet = createWalletClient({ account: deployer, chain, transport: http(localRpc) });
const intentsPath = path.join(outputRoot, "transaction-intents.jsonl");
const receiptsPath = path.join(outputRoot, "transaction-receipts.jsonl");
const transactions = [];
let sequence = 0;

const receiptRecord = async ({ phase, category, label, hash, expectedEffect }) => {
  const [receipt, tx] = await Promise.all([
    publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }),
    publicClient.getTransaction({ hash }),
  ]);
  const key = `schema16:${phase}:${String(++sequence).padStart(3, "0")}:${label}`;
  const normalizedReceipt = {
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    status: receipt.status,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    contractAddress: receipt.contractAddress,
    logCount: receipt.logs.length,
  };
  const record = {
    idempotencyKey: key,
    phase,
    category,
    label,
    expectedEffect,
    transactionHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    receiptStatus: receipt.status,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    valueWei: tx.value.toString(),
    nonce: tx.nonce.toString(),
    calldataHash: keccak256(tx.input),
    normalizedReceipt,
  };
  await appendFile(receiptsPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  transactions.push(record);
  if (receipt.status !== "success") throw new Error(`${key} reverted`);
  return { receipt, tx, record };
};

const send = async ({ phase, category, label, to, data, value = 0n, expectedEffect }) => {
  const nonce = await publicClient.getTransactionCount({ address: deployer, blockTag: "pending" });
  const intent = {
    recordedAt: new Date().toISOString(),
    phase,
    category,
    label,
    nonce: nonce.toString(),
    to: to ?? null,
    valueWei: value.toString(),
    calldataHash: keccak256(data),
    expectedEffect,
  };
  await appendFile(intentsPath, `${JSON.stringify(intent)}\n`, { mode: 0o600 });
  const hash = await wallet.sendTransaction({
    account: deployer,
    to,
    data,
    value,
    gas: 30_000_000n,
  });
  return receiptRecord({ phase, category, label, hash, expectedEffect });
};

const artifact = async (name, source = `${name}.sol`) => {
  const file = path.join(candidateRoot, "packages/contracts/out", source, `${name}.json`);
  return JSON.parse(await readFile(file, "utf8"));
};
const deploy = async (name, args, label = name, source = `${name}.sol`) => {
  const built = await artifact(name, source);
  const data = encodeDeployData({ abi: built.abi, bytecode: built.bytecode.object, args });
  const result = await send({
    phase: "deployment",
    category: "deployment",
    label: `deploy-${label}`,
    data,
    expectedEffect: `Deploy ${label} from the frozen Schema-16 artifact`,
  });
  if (!result.receipt.contractAddress) throw new Error(`${label} deployment has no address`);
  return { address: getAddress(result.receipt.contractAddress), abi: built.abi, artifact: built };
};
const write = async (phase, label, target, abi, functionName, args = [], value = 0n) =>
  send({
    phase,
    category: ["deployment", "bindings"].includes(phase) ? "deployment" : "canary",
    label,
    to: target,
    data: encodeFunctionData({ abi, functionName, args }),
    value,
    expectedEffect: `${functionName} on ${label}`,
  });
const read = (address, abi, functionName, args = []) =>
  publicClient.readContract({ address, abi, functionName, args });
const deadline = async (seconds = 600n) =>
  (await publicClient.getBlock({ blockTag: "latest" })).timestamp + seconds;
const advance = async (seconds) => {
  await publicClient.request({ method: "evm_increaseTime", params: [toHex(BigInt(seconds))] });
  await publicClient.request({ method: "evm_mine", params: [] });
};
const codeHash = async (address) => {
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") throw new Error(`missing runtime code at ${address}`);
  return keccak256(code);
};

try {
  const contracts = Object.fromEntries(
    Object.entries(deploymentManifest.predictedContracts).map(([name, address]) => [name, getAddress(address)]),
  );
  const external = Object.fromEntries(
    Object.entries(config.venue).map(([name, entry]) => [name, getAddress(entry.address)]),
  );
  for (const [name, entry] of Object.entries(config.venue)) {
    const observed = await codeHash(getAddress(entry.address));
    if (observed !== entry.runtimeCodeHash.toLowerCase()) {
      throw new Error(`${name} runtime hash changed at fork block ${forkBlock}`);
    }
  }

  const loadContract = async (name, address, source = `${name}.sol`) => ({
    address: getAddress(address),
    abi: (await artifact(name, source)).abi,
  });
  let timelock;
  let dao;
  let governor;
  let assetRouter;
  let launchDeployer;
  let vaultDeployer;
  let launchFactory;
  let feeRouter;
  let tokenSink;
  let hook;
  let adapterDeployer;
  let lockerDeployer;
  let marketDeployer;
  let marketFactory;
  let coordinator;
  const safeAbi = parseAbi([
    "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)",
    "function getOwners() view returns (address[])",
    "function getThreshold() view returns (uint256)",
  ]);
  const safeSignature = concatHex([pad(deployer, { size: 32 }), zeroHash, "0x01"]);
  const expectedRuntime = new Map(
    deploymentManifest.runtimeIdentities.map((identity) => [identity.name, identity]),
  );
  for (const [name, address] of Object.entries(contracts)) {
    const expected = expectedRuntime.get(name)?.runtimeCodeHash?.toLowerCase();
    if (!expected || (await codeHash(address)).toLowerCase() !== expected) {
      throw new Error(`${name} runtime differs from the sealed Paused deployment`);
    }
  }

  if (process.env.ROBYN_CANARY_REDEPLOY_STACK === "true") {

  const safeSetupAbi = parseAbi([
    "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  ]);
  const safeFactoryAbi = parseAbi([
    "function createChainSpecificProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)",
  ]);
  const initializer = encodeFunctionData({
    abi: safeSetupAbi,
    functionName: "setup",
    args: [[deployer], 1n, zeroAddress, "0x", getAddress(governance.safeContracts.fallbackHandler.address), zeroAddress, 0n, zeroAddress],
  });
  if (keccak256(initializer) !== governance.initializerHash.toLowerCase()) {
    throw new Error("Safe initializer differs from the protected governance proof");
  }
  await write(
    "deployment",
    "canonical-safe-proxy",
    getAddress(governance.safeContracts.proxyFactory.address),
    safeFactoryAbi,
    "createChainSpecificProxyWithNonce",
    [getAddress(governance.safeContracts.singleton.address), initializer, BigInt(governance.saltNonce)],
  );
  contracts.safe = getAddress(governance.predictedSafe);
  if ((await publicClient.getCode({ address: contracts.safe })) === "0x") {
    throw new Error("canonical Safe was not created at its predicted address");
  }

  timelock = await deploy(
    "TimelockController",
    [172_800n, [], [], deployer],
    "timelock",
    "TimelockController.sol",
  );
  contracts.timelock = timelock.address;
  dao = await deploy(
    "RobynDaoToken",
    [[deployer], [1_000_000_000n * 10n ** 18n], 3_600n],
    "rdao",
    "RobynDaoToken.sol",
  );
  contracts.daoToken = dao.address;
  governor = await deploy("RobynGovernor", [dao.address, timelock.address]);
  contracts.governor = governor.address;
  assetRouter = await deploy("RobynV4AssetRouter", [
    external.poolManager,
    external.quoter,
    external.stateView,
    timelock.address,
    contracts.safe,
    external.weth,
  ]);
  contracts.assetRouter = assetRouter.address;
  launchDeployer = await deploy("RobynNativeLaunchDeployerV4", [3_600n]);
  vaultDeployer = await deploy("RobynNativeVaultDeployerV4", []);
  contracts.launchDeployer = launchDeployer.address;
  contracts.vaultDeployer = vaultDeployer.address;
  launchFactory = await deploy("RobynNativeLaunchFactoryV4", [
    assetRouter.address,
    launchDeployer.address,
    vaultDeployer.address,
    1n,
    86_400n,
  ]);
  contracts.launchFactory = launchFactory.address;
  feeRouter = await deploy("RobynNativeProtocolFeeRouterV4", [
    dao.address,
    assetRouter.address,
    timelock.address,
    contracts.safe,
    3_600n,
  ]);
  contracts.feeRouter = feeRouter.address;
  tokenSink = await deploy("RobynTokenSink", []);
  contracts.tokenSink = tokenSink.address;

  const hookArtifact = await artifact("RobynV4FeeAndPhaseHook");
  const hookDomain = keccak256(stringToHex(`sherwood-schema16-mainnet:${RELEASE_SHA}`));
  const hookInitCode = encodeDeployData({
    abi: hookArtifact.abi,
    bytecode: hookArtifact.bytecode.object,
    args: [external.poolManager, feeRouter.address, deployer, external.positionManager, hookDomain],
  });
  const create2Deployer = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
  const mined = JSON.parse(
    command("node", [path.join(repoRoot, "scripts/mine-v4-hook-salt.mjs"), create2Deployer, hookInitCode]),
  );
  const hookAddress = getAddress(mined.address);
  await send({
    phase: "deployment",
    category: "deployment",
    label: "deploy-v4-hook-create2",
    to: create2Deployer,
    data: concatHex([mined.salt, hookInitCode]),
    expectedEffect: "Deploy the Schema-16 v4 hook at the permission-bit-compatible address",
  });
  contracts.oracleHook = hookAddress;
  hook = { address: hookAddress, abi: hookArtifact.abi };
  adapterDeployer = await deploy("RobynV4AdapterDeployer", []);
  lockerDeployer = await deploy("RobynV4LockerDeployer", []);
  marketDeployer = await deploy("RobynV4MarketDeployer", []);
  contracts.adapterDeployer = adapterDeployer.address;
  contracts.lockerDeployer = lockerDeployer.address;
  contracts.marketDeployer = marketDeployer.address;
  marketFactory = await deploy("RobynV4MarketFactory", [
    {
      launchFactory: launchFactory.address,
      feeRouter: feeRouter.address,
      assetRouter: assetRouter.address,
      oracleHook: hookAddress,
      poolManager: external.poolManager,
      positionManager: external.positionManager,
      permit2: external.permit2,
      stateView: external.stateView,
      adapterDeployer: adapterDeployer.address,
      lockerDeployer: lockerDeployer.address,
      marketDeployer: marketDeployer.address,
      tokenSink: tokenSink.address,
    },
    {
      curveTokenAllocation: 800_000_000n * 10n ** 18n,
      graduationTokenAllocation: 200_000_000n * 10n ** 18n,
      initialVirtualTokenReserve: 1_066_666_666_666_666_666_666_666_666n,
      initialVirtualNativeReserve: 2n * 10n ** 18n,
      graduationThresholdNative: 10n ** 16n,
      maximumCurvePurchase: 10n ** 15n,
      curveFeeBps: 100,
    },
    9_900,
    500_000_000_000_000n,
    1_000_000_000n,
    1_000_000_000_000n,
  ]);
  contracts.marketFactory = marketFactory.address;
  coordinator = await deploy("RobynV4LaunchCoordinatorV6", [
    launchFactory.address,
    marketFactory.address,
    feeRouter.address,
    timelock.address,
    contracts.safe,
  ]);
  contracts.coordinator = coordinator.address;

  const bindingWrites = [
    [launchDeployer, "bindController", [launchFactory.address], "launch-deployer-bind"],
    [vaultDeployer, "bindController", [launchFactory.address], "vault-deployer-bind"],
    [adapterDeployer, "bindController", [marketFactory.address], "adapter-deployer-bind"],
    [lockerDeployer, "bindController", [marketFactory.address], "locker-deployer-bind"],
    [marketDeployer, "bindController", [marketFactory.address], "market-deployer-bind"],
    [hook, "bindRegistrar", [marketFactory.address], "hook-registrar-bind"],
    [assetRouter, "bindLaunchRegistrar", [marketFactory.address], "asset-router-registrar-bind"],
    [launchFactory, "bindCoordinator", [coordinator.address], "launch-factory-coordinator-bind"],
    [marketFactory, "bindCoordinator", [coordinator.address], "market-factory-coordinator-bind"],
    [feeRouter, "bindCoordinator", [coordinator.address], "fee-router-coordinator-bind"],
  ];
  for (const [target, functionName, args, label] of bindingWrites) {
    await write("bindings", label, target.address, target.abi, functionName, args);
  }
  const exclusions = [
    timelock.address,
    feeRouter.address,
    governor.address,
    coordinator.address,
    marketFactory.address,
    launchFactory.address,
    launchDeployer.address,
    vaultDeployer.address,
    assetRouter.address,
    hookAddress,
    adapterDeployer.address,
    lockerDeployer.address,
    marketDeployer.address,
    tokenSink.address,
  ];
  await write("bindings", "dao-exclusions", dao.address, dao.abi, "sealRewardExclusions", [exclusions]);
  await write("bindings", "dao-reward-depositor", dao.address, dao.abi, "bindRewardDepositor", [feeRouter.address]);
  await write("bindings", "dao-delegation", dao.address, dao.abi, "delegate", [deployer]);
  const proposerRole = await read(timelock.address, timelock.abi, "PROPOSER_ROLE");
  const cancellerRole = await read(timelock.address, timelock.abi, "CANCELLER_ROLE");
  const executorRole = await read(timelock.address, timelock.abi, "EXECUTOR_ROLE");
  const adminRole = await read(timelock.address, timelock.abi, "DEFAULT_ADMIN_ROLE");
  await write("bindings", "timelock-governor-proposer", timelock.address, timelock.abi, "grantRole", [proposerRole, governor.address]);
  await write("bindings", "timelock-safe-canceller", timelock.address, timelock.abi, "grantRole", [cancellerRole, contracts.safe]);
  await write("bindings", "timelock-open-executor", timelock.address, timelock.abi, "grantRole", [executorRole, zeroAddress]);
  await write("bindings", "timelock-renounce-deployer-admin", timelock.address, timelock.abi, "renounceRole", [adminRole, deployer]);

  } else {
    timelock = await loadContract("TimelockController", contracts.timelock, "TimelockController.sol");
    dao = await loadContract("RobynDaoToken", contracts.daoToken);
    governor = await loadContract("RobynGovernor", contracts.governor);
    assetRouter = await loadContract("RobynV4AssetRouter", contracts.assetRouter);
    launchDeployer = await loadContract("RobynNativeLaunchDeployerV4", contracts.launchDeployer);
    vaultDeployer = await loadContract("RobynNativeVaultDeployerV4", contracts.vaultDeployer);
    launchFactory = await loadContract("RobynNativeLaunchFactoryV4", contracts.launchFactory);
    feeRouter = await loadContract("RobynNativeProtocolFeeRouterV4", contracts.feeRouter);
    tokenSink = await loadContract("RobynTokenSink", contracts.tokenSink);
    hook = await loadContract("RobynV4FeeAndPhaseHook", contracts.oracleHook);
    adapterDeployer = await loadContract("RobynV4AdapterDeployer", contracts.adapterDeployer);
    lockerDeployer = await loadContract("RobynV4LockerDeployer", contracts.lockerDeployer);
    marketDeployer = await loadContract("RobynV4MarketDeployer", contracts.marketDeployer);
    marketFactory = await loadContract("RobynV4MarketFactory", contracts.marketFactory);
    coordinator = await loadContract("RobynV4LaunchCoordinatorV6", contracts.coordinator);

    const owners = await read(contracts.safe, safeAbi, "getOwners");
    if (owners.length !== 1 || owners[0].toLowerCase() !== deployer.toLowerCase() || (await read(contracts.safe, safeAbi, "getThreshold")) !== 1n) {
      throw new Error("live Safe identity differs from the sealed Paused state");
    }
    if (Number(await read(coordinator.address, coordinator.abi, "launchMode")) !== 0) throw new Error("live coordinator is not Paused");
    if (!(await read(assetRouter.address, assetRouter.abi, "conversionsPaused")) || !(await read(feeRouter.address, feeRouter.abi, "paused"))) {
      throw new Error("live conversion systems are not Paused");
    }
    if ((await read(launchFactory.address, launchFactory.abi, "launchCount")) !== 0n) throw new Error("live deployment already contains a launch");
  }

  const safeExec = async (target, data, label, phase = "bindings") =>
    write(phase, label, contracts.safe, safeAbi, "execTransaction", [
      target,
      0n,
      data,
      0,
      0n,
      0n,
      0n,
      zeroAddress,
      zeroAddress,
      safeSignature,
    ]);
  await advance(2);

  const govern = async ({ phase, description, calls }) => {
    const targets = calls.map((call) => call.target);
    const values = calls.map(() => 0n);
    const calldatas = calls.map((call) => call.data);
    const descriptionHash = keccak256(stringToHex(description));
    const proposalId = await read(governor.address, governor.abi, "hashProposal", [
      targets,
      values,
      calldatas,
      descriptionHash,
    ]);
    await write(phase, `${phase}-propose`, governor.address, governor.abi, "propose", [targets, values, calldatas, description]);
    await advance(Number(await read(governor.address, governor.abi, "votingDelay")) + 1);
    await write(phase, `${phase}-vote`, governor.address, governor.abi, "castVoteWithReason", [proposalId, 1, "Schema-16 local-fork broadcast rehearsal"]);
    await advance(Number(await read(governor.address, governor.abi, "votingPeriod")) + 1);
    await write(phase, `${phase}-queue`, governor.address, governor.abi, "queue", [targets, values, calldatas, descriptionHash]);
    await advance(Number(await read(timelock.address, timelock.abi, "getMinDelay")) + 1);
    await write(phase, `${phase}-execute`, governor.address, governor.abi, "execute", [targets, values, calldatas, descriptionHash]);
    const state = Number(await read(governor.address, governor.abi, "state", [proposalId]));
    if (state !== 7) throw new Error(`${phase} proposal did not execute`);
  };

  const stateViewAbi = parseAbi([
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
    "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  ]);
  const activationCalls = [
    {
      target: assetRouter.address,
      data: encodeFunctionData({ abi: assetRouter.abi, functionName: "resumeConversions" }),
    },
    {
      target: feeRouter.address,
      data: encodeFunctionData({ abi: feeRouter.abi, functionName: "setPaused", args: [false] }),
    },
  ];
  const requiredAssets = support.candidates.filter((asset) => asset.required && asset.symbol !== "WETH");
  const routeResults = [];
  for (const asset of requiredAssets) {
    const poolId = poolIdForRoute(asset.address, config.route);
    const [slot0, liquidity] = await Promise.all([
      read(external.stateView, stateViewAbi, "getSlot0", [poolId]),
      read(external.stateView, stateViewAbi, "getLiquidity", [poolId]),
    ]);
    if (slot0[0] === 0n || liquidity === 0n) throw new Error(`${asset.symbol} route has no real liquidity`);
    const route = {
      fee: 10_000,
      tickSpacing: 200,
      hooks: zeroAddress,
      minimumLiquidity: 1n,
      maximumNativeInput: BigInt(asset.maximumNativeInputWei),
      referenceTick: slot0[1],
      maximumReferenceTickDeviation: 198,
      enforceReferencePrice: true,
      verificationClass: keccak256(stringToHex("ROBINHOOD_MAINNET_STOCK_TOKEN")),
      enabled: true,
    };
    activationCalls.push({
      target: assetRouter.address,
      data: encodeFunctionData({ abi: assetRouter.abi, functionName: "configureRoute", args: [getAddress(asset.address), route] }),
    });
    routeResults.push({ symbol: asset.symbol, address: getAddress(asset.address), poolId, liquidity: liquidity.toString(), referenceTick: Number(slot0[1]) });
  }
  activationCalls.push({
    target: assetRouter.address,
    data: encodeFunctionData({ abi: assetRouter.abi, functionName: "configureWrappedNativeRoute", args: [500_000_000_000_000_000n, true] }),
  });
  activationCalls.push({
    target: coordinator.address,
    data: encodeFunctionData({ abi: coordinator.abi, functionName: "setCanaryMode", args: [deployer] }),
  });
  await govern({ phase: "canary-activation", description: "Activate bounded Schema-16 Mainnet canary routes", calls: activationCalls });

  for (const route of routeResults) {
    const input = 1_000_000_000_000n;
    const quote = await read(assetRouter.address, assetRouter.abi, "quoteNativeToAsset", [route.address, input]);
    const before = await read(route.address, parseAbi(["function balanceOf(address) view returns (uint256)"]), "balanceOf", [deployer]);
    await write("post-graduation-trades", `route-${route.symbol}-buy`, assetRouter.address, assetRouter.abi, "swapExactNativeForAsset", [route.address, (quote[0] * 99n) / 100n, deployer, await deadline()], input);
    const after = await read(route.address, parseAbi(["function balanceOf(address) view returns (uint256)"]), "balanceOf", [deployer]);
    const received = after - before;
    const sell = received / 2n;
    const erc20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
    await write("post-graduation-trades", `route-${route.symbol}-approve`, route.address, erc20, "approve", [assetRouter.address, sell]);
    const reverse = await read(assetRouter.address, assetRouter.abi, "quoteAssetToNative", [route.address, sell]);
    await write("post-graduation-trades", `route-${route.symbol}-sell`, assetRouter.address, assetRouter.abi, "swapExactAssetForNative", [route.address, sell, (reverse[0] * 99n) / 100n, deployer, await deadline()]);
    route.executedBothDirections = true;
  }
  await write("post-graduation-trades", "route-WETH-wrap", assetRouter.address, assetRouter.abi, "swapExactNativeForAsset", [external.weth, 1_000_000_000_000n, deployer, await deadline()], 1_000_000_000_000n);
  const wethAbi = parseAbi(["function approve(address,uint256) returns (bool)"]);
  await write("post-graduation-trades", "route-WETH-approve", external.weth, wethAbi, "approve", [assetRouter.address, 1_000_000_000_000n]);
  await write("post-graduation-trades", "route-WETH-unwrap", assetRouter.address, assetRouter.abi, "swapExactAssetForNative", [external.weth, 1_000_000_000_000n, 1_000_000_000_000n, deployer, await deadline()]);
  routeResults.push({ symbol: "WETH", address: external.weth, executedBothDirections: true });

  const profileVersion = await read(marketFactory.address, marketFactory.abi, "graduationProfileVersion");
  const request = {
    name: "Sherwood Mainnet Canary",
    symbol: "SMC",
    assets: [external.weth],
    weights: [10_000],
    metadataUri: "ipfs://bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q",
    userSalt: keccak256(stringToHex(`schema16-mainnet-canary:${forkBlock}:${RELEASE_SHA}`)),
    expectedGraduationProfileVersion: profileVersion,
  };
  const predicted = await read(coordinator.address, coordinator.abi, "predictLaunchAddresses", [deployer, request]);
  const launch = await write("canary-launch", "create-canary-launch", coordinator.address, coordinator.abi, "createLaunch", [request], 1_000_000_000_000_000n);
  const tokenAddress = getAddress(predicted[0]);
  const vaultAddress = getAddress(predicted[1]);
  const token = { address: tokenAddress, ...(await artifact("RobynLaunchToken")) };
  const vault = { address: vaultAddress, ...(await artifact("RobynNativeBasketVaultV2")) };
  const marketAddress = getAddress(await read(marketFactory.address, marketFactory.abi, "marketByToken", [tokenAddress]));
  const marketArtifact = await artifact("RobynV4BondingCurveMarket");
  const market = { address: marketAddress, abi: marketArtifact.abi };
  let buyCount = 0;
  while (!(await read(market.address, market.abi, "graduated"))) {
    if (++buyCount > 20) throw new Error("canary failed to graduate within bounded purchases");
    await write("bonding-graduation", `canary-bonding-buy-${buyCount}`, market.address, market.abi, "buy", [1n], 1_000_000_000_000_000n);
  }
  const adapterAddress = getAddress(await read(market.address, market.abi, "graduationAdapter"));
  const adapterArtifact = await artifact("RobynV4GraduationAdapter");
  const adapter = { address: adapterAddress, abi: adapterArtifact.abi };
  const lockerAddress = getAddress(await read(adapter.address, adapter.abi, "locker"));
  const lockerArtifact = await artifact("RobynV4FeePositionLocker");
  const locker = { address: lockerAddress, abi: lockerArtifact.abi };
  const lockedPrincipal = await read(locker.address, locker.abi, "principalLiquidity");

  await write("post-graduation-trades", "sherwood-routed-buy", market.address, market.abi, "buy", [1n], 1_000_000_000_000n);
  const tokenBalanceAbi = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function claimAll() returns (uint256)",
  ]);
  let tokenBalance = await read(tokenAddress, tokenBalanceAbi, "balanceOf", [deployer]);
  const roundTripAmount = tokenBalance / 50n;
  await write("post-graduation-trades", "sherwood-sell-approve", tokenAddress, tokenBalanceAbi, "approve", [market.address, roundTripAmount]);
  const roundTripQuote = await read(market.address, market.abi, "quoteSell", [roundTripAmount]);
  const beforeRoundTrip = await publicClient.getBalance({ address: deployer });
  const roundTripReceipt = await write("post-graduation-trades", "sherwood-routed-sell", market.address, market.abi, "sell", [roundTripAmount, (roundTripQuote[1] * 99n) / 100n]);
  const afterRoundTrip = await publicClient.getBalance({ address: deployer });
  const roundTripRecovered = afterRoundTrip - beforeRoundTrip + roundTripReceipt.receipt.gasUsed * roundTripReceipt.receipt.effectiveGasPrice;
  await write("post-graduation-trades", "creator-split-lock", feeRouter.address, feeRouter.abi, "setCreatorFeeSplit", [tokenAddress, [deployer], [10_000], true]);

  const poolKey = await read(adapter.address, adapter.abi, "poolKey");
  const quoterAbi = parseAbi([
    "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  ]);
  const directInput = 100_000_000_000n;
  const directQuote = await read(external.quoter, quoterAbi, "quoteExactInputSingle", [{ poolKey, zeroForOne: true, exactAmount: directInput, hookData: "0x" }]);
  const directBuy = encodeUniversalV4SingleSwap({ poolKey, zeroForOne: true, amount: directInput, limit: (directQuote[0] * 99n) / 100n, refundRecipient: deployer });
  const universalAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
  const directBefore = await read(tokenAddress, tokenBalanceAbi, "balanceOf", [deployer]);
  await write("post-graduation-trades", "universal-router-direct-buy", external.universalRouter, universalAbi, "execute", [directBuy.commands, directBuy.inputs, await deadline()], directInput);
  const directAfter = await read(tokenAddress, tokenBalanceAbi, "balanceOf", [deployer]);
  const directTokens = directAfter - directBefore;
  await write("post-graduation-trades", "universal-token-permit2-approve", tokenAddress, tokenBalanceAbi, "approve", [external.permit2, maxUint256]);
  const permit2Abi = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]);
  await write("post-graduation-trades", "universal-permit2-router-approve", external.permit2, permit2Abi, "approve", [tokenAddress, external.universalRouter, maxUint160, await deadline(86_400n)]);
  const directSellQuote = await read(external.quoter, quoterAbi, "quoteExactInputSingle", [{ poolKey, zeroForOne: false, exactAmount: directTokens, hookData: "0x" }]);
  const directSell = encodeUniversalV4SingleSwap({ poolKey, zeroForOne: false, amount: directTokens, limit: (directSellQuote[0] * 99n) / 100n, refundRecipient: deployer });
  await write("post-graduation-trades", "universal-router-direct-sell", external.universalRouter, universalAbi, "execute", [directSell.commands, directSell.inputs, await deadline()]);

  const pendingNative = await read(hook.address, hook.abi, "pendingNativeFees", [tokenAddress]);
  if (pendingNative > 0n) await write("fee-settlement", "settle-hook-native", hook.address, hook.abi, "settleNativeFees", [tokenAddress, pendingNative]);
  await advance(301);
  await write("fee-settlement", "create-convertible-token-fees", market.address, market.abi, "buy", [1n], 1_000_000_000_000n);
  const pendingToken = await read(hook.address, hook.abi, "pendingTokenFees", [tokenAddress]);
  if (pendingToken > 0n) {
    const tokenFeeQuote = await read(assetRouter.address, assetRouter.abi, "quoteAssetToNative", [tokenAddress, pendingToken]);
    await write("fee-settlement", "convert-hook-token-fees", hook.address, hook.abi, "convertTokenFees", [tokenAddress, pendingToken, (tokenFeeQuote[0] * 99n) / 100n, await deadline()]);
  }
  await write("fee-settlement", "collect-locked-position-fees", locker.address, locker.abi, "collectFees", [0n, 0n]);
  const pendingCollectedNative = await read(locker.address, locker.abi, "pendingCollectedNativeFees");
  if (pendingCollectedNative > 0n) await write("fee-settlement", "route-locked-native-fees", locker.address, locker.abi, "routeCollectedNative", [pendingCollectedNative]);
  const pendingCollectedToken = await read(locker.address, locker.abi, "pendingCollectedTokenFees");
  if (pendingCollectedToken > 0n) {
    const lockedQuote = await read(assetRouter.address, assetRouter.abi, "quoteAssetToNative", [tokenAddress, pendingCollectedToken]);
    await write("fee-settlement", "convert-locked-token-fees", locker.address, locker.abi, "convertCollectedToken", [pendingCollectedToken, (lockedQuote[0] * 99n) / 100n, await deadline()]);
  }
  let account = await read(feeRouter.address, feeRouter.abi, "launchAccount", [tokenAddress]);
  if (account.pendingBasketNative > 0n) await write("fee-settlement", "settle-basket-fees", feeRouter.address, feeRouter.abi, "settleBasketFees", [tokenAddress, account.pendingBasketNative]);
  const daoLiability = await read(feeRouter.address, feeRouter.abi, "totalDaoNativeLiability");
  if (daoLiability > 0n) await write("fee-settlement", "settle-dao-fees", feeRouter.address, feeRouter.abi, "settleDaoFees", [daoLiability]);
  const treasuryLiability = await read(feeRouter.address, feeRouter.abi, "totalTreasuryNativeLiability");
  if (treasuryLiability > 0n) await write("fee-settlement", "settle-treasury-fees", feeRouter.address, feeRouter.abi, "settleTreasuryFees", [treasuryLiability]);
  const leg = await read(vault.address, vault.abi, "leg", [0n]);
  if (leg.pendingNative > 0n) {
    const basketQuote = await read(assetRouter.address, assetRouter.abi, "quoteNativeToAsset", [external.weth, leg.pendingNative]);
    await write("fee-settlement", "convert-weth-basket-leg", vault.address, vault.abi, "convertLeg", [0n, leg.pendingNative, (basketQuote[0] * 99n) / 100n, await deadline()]);
  }

  await advance(3_601);
  await write("reward-claims", "claim-holder-rewards", tokenAddress, tokenBalanceAbi, "claimAll");
  await write("reward-claims", "claim-creator-rewards", feeRouter.address, feeRouter.abi, "claimCreatorFees", [tokenAddress]);
  await write("reward-claims", "claim-dao-rewards", dao.address, dao.abi, "claimRewards");

  const canaryProfile = await read(marketFactory.address, marketFactory.abi, "graduationProfileByToken", [tokenAddress]);
  const currentVersion = await read(marketFactory.address, marketFactory.abi, "graduationProfileVersion");
  if (currentVersion !== 1n || canaryProfile.targetGraduationNative !== 10n ** 16n) {
    throw new Error("canary profile changed before the separate production-profile gate");
  }

  tokenBalance = await read(tokenAddress, tokenBalanceAbi, "balanceOf", [deployer]);
  const unwindQuote = await read(market.address, market.abi, "quoteSell", [tokenBalance]);
  await write("canary-unwind", "canary-unwind-approve", tokenAddress, tokenBalanceAbi, "approve", [market.address, tokenBalance]);
  const beforeUnwind = await publicClient.getBalance({ address: deployer });
  const unwindReceipt = await write("canary-unwind", "canary-unwind-sale", market.address, market.abi, "sell", [tokenBalance, (unwindQuote[1] * 99n) / 100n]);
  const afterUnwind = await publicClient.getBalance({ address: deployer });
  const unwindRecovered = afterUnwind - beforeUnwind + unwindReceipt.receipt.gasUsed * unwindReceipt.receipt.effectiveGasPrice;
  const totalRecovered = roundTripRecovered + unwindRecovered;
  const bondingSpend = 10_101_010_101_010_102n;
  const recoveryBps = (totalRecovered * 10_000n) / bondingSpend;
  if (recoveryBps < 7_500n || recoveryBps >= 10_000n) throw new Error(`canary recovery is ${recoveryBps} bps`);
  if ((await read(tokenAddress, tokenBalanceAbi, "allowance", [deployer, market.address])) !== 0n) throw new Error("canary unwind left a market allowance");

  await advance(301);
  const finalNative = await read(hook.address, hook.abi, "pendingNativeFees", [tokenAddress]);
  if (finalNative > 0n) await write("post-unwind-settlement", "settle-post-unwind-hook-fees", hook.address, hook.abi, "settleNativeFees", [tokenAddress, finalNative]);
  await write("post-unwind-settlement", "collect-post-unwind-locker-fees", locker.address, locker.abi, "collectFees", [0n, 0n]);
  const finalLockerNative = await read(locker.address, locker.abi, "pendingCollectedNativeFees");
  if (finalLockerNative > 0n) await write("post-unwind-settlement", "route-post-unwind-native", locker.address, locker.abi, "routeCollectedNative", [finalLockerNative]);
  const finalLockerToken = await read(locker.address, locker.abi, "pendingCollectedTokenFees");
  if (finalLockerToken > 0n) {
    const quote = await read(assetRouter.address, assetRouter.abi, "quoteAssetToNative", [tokenAddress, finalLockerToken]);
    await write("post-unwind-settlement", "convert-post-unwind-token", locker.address, locker.abi, "convertCollectedToken", [finalLockerToken, (quote[0] * 99n) / 100n, await deadline()]);
  }
  account = await read(feeRouter.address, feeRouter.abi, "launchAccount", [tokenAddress]);
  if (account.pendingBasketNative > 0n) await write("post-unwind-settlement", "settle-post-unwind-basket", feeRouter.address, feeRouter.abi, "settleBasketFees", [tokenAddress, account.pendingBasketNative]);
  const finalDao = await read(feeRouter.address, feeRouter.abi, "totalDaoNativeLiability");
  if (finalDao > 0n) await write("post-unwind-settlement", "settle-post-unwind-dao", feeRouter.address, feeRouter.abi, "settleDaoFees", [finalDao]);
  const finalTreasury = await read(feeRouter.address, feeRouter.abi, "totalTreasuryNativeLiability");
  if (finalTreasury > 0n) await write("post-unwind-settlement", "settle-post-unwind-treasury", feeRouter.address, feeRouter.abi, "settleTreasuryFees", [finalTreasury]);
  const shutdownReason = keccak256(stringToHex("SCHEMA16_CANARY_COMPLETE"));
  await safeExec(coordinator.address, encodeFunctionData({ abi: coordinator.abi, functionName: "pauseLaunches" }), "guardian-pause-launches", "post-unwind-settlement");
  await safeExec(assetRouter.address, encodeFunctionData({ abi: assetRouter.abi, functionName: "pauseConversions" }), "guardian-pause-asset-conversions", "post-unwind-settlement");
  await safeExec(feeRouter.address, encodeFunctionData({ abi: feeRouter.abi, functionName: "setPaused", args: [true] }), "guardian-pause-fee-conversions", "post-unwind-settlement");
  for (const route of [...routeResults.map((item) => item.address), external.weth]) {
    await safeExec(assetRouter.address, encodeFunctionData({ abi: assetRouter.abi, functionName: "disableRoute", args: [route, shutdownReason] }), `guardian-disable-route-${route}`, "post-unwind-settlement");
  }
  if (Number(await read(coordinator.address, coordinator.abi, "launchMode")) !== 0) throw new Error("guardian shutdown did not pause launches");
  if (!(await read(assetRouter.address, assetRouter.abi, "conversionsPaused")) || !(await read(feeRouter.address, feeRouter.abi, "paused"))) throw new Error("guardian shutdown did not pause conversions");

  const positionManagerAbi = parseAbi(["function getPositionLiquidity(uint256 tokenId) view returns (uint128)"]);
  const tokenId = await read(locker.address, locker.abi, "positionTokenId");
  const finalLocked = await read(external.positionManager, positionManagerAbi, "getPositionLiquidity", [tokenId]);
  if (finalLocked !== lockedPrincipal) throw new Error("locked principal changed");
  if ((await read(tokenAddress, tokenBalanceAbi, "totalSupply")) !== 1_000_000_000n * 10n ** 18n) throw new Error("launch supply drifted");
  if ((await read(dao.address, dao.abi, "totalSupply")) !== 1_000_000_000n * 10n ** 18n) throw new Error("RDAO supply drifted");
  const liabilities = await read(feeRouter.address, feeRouter.abi, "totalNativeLiabilities");
  const routerBalance = await publicClient.getBalance({ address: feeRouter.address });
  if (liabilities !== routerBalance) throw new Error("fee router is not exactly solvent");
  account = await read(feeRouter.address, feeRouter.abi, "launchAccount", [tokenAddress]);
  if (
    (await read(feeRouter.address, feeRouter.abi, "totalBasketNative")) +
      account.cumulativeCreatorNative +
      (await read(feeRouter.address, feeRouter.abi, "totalDaoNativeRewards")) +
      (await read(feeRouter.address, feeRouter.abi, "totalTreasuryNative")) !==
    account.cumulativeNativeFees
  ) throw new Error("50/25/20/5 fee conservation failed");
  if (Number(await read(coordinator.address, coordinator.abi, "launchMode")) !== 0) throw new Error("coordinator did not return to Paused");

  const runtimeIdentities = [];
  for (const [name, address] of Object.entries({ ...external, ...contracts })) {
    runtimeIdentities.push({ name, address, runtimeCodeHash: await codeHash(address) });
  }
  const productionConfigHash = keccak256(
    stringToHex(
      JSON.stringify({
        config: JSON.parse(configRaw),
        support: JSON.parse(supportRaw),
        governance: {
          governanceMode: governance.governanceMode,
          deployer,
          owners: governance.owners,
          threshold: governance.threshold,
          predictedSafe: governance.predictedSafe,
          signerSetHash: governance.signerSetHash,
          allocations: governance.allocations,
        },
      }),
    ),
  );
  const ledger = {
    schemaVersion: 16,
    generatedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    executionMode: "local-fork-broadcast",
    forkBlock: forkBlock.toString(),
    releaseSha: RELEASE_SHA,
    productionConfigHash,
    deploymentManifestHash: governance.deploymentManifestHash,
    runtimeIdentities,
    transactions,
    mainnetBroadcastAuthorized: false,
  };
  const validation = validateMainnetReceiptLedger(ledger, {
    releaseSha: RELEASE_SHA,
    productionConfigHash,
    requiredPhases: [
      "canary-activation",
      "canary-launch",
      "bonding-graduation",
      "post-graduation-trades",
      "fee-settlement",
      "reward-claims",
      "canary-unwind",
      "post-unwind-settlement",
    ],
  });
  const gasEvidencePath = path.join(outputRoot, "gas-evidence.json");
  await writeFile(gasEvidencePath, `${json(ledger)}\n`, { mode: 0o600, flag: "wx" });
  const capital = {
    schemaVersion: 16,
    forkBlock: forkBlock.toString(),
    bondingSpendWei: bondingSpend.toString(),
    roundTripRecoveredWei: roundTripRecovered.toString(),
    unwindRecoveredWei: unwindRecovered.toString(),
    totalRecoveredWei: totalRecovered.toString(),
    recoveryBps: recoveryBps.toString(),
    lockedPrincipal: lockedPrincipal.toString(),
    lockedPrincipalAfter: finalLocked.toString(),
    passed: recoveryBps >= 7_500n && finalLocked === lockedPrincipal,
  };
  await writeFile(path.join(outputRoot, "capital-ledger.json"), `${json(capital)}\n`, { mode: 0o600, flag: "wx" });
  const deployment = {
    schemaVersion: 16,
    chainId: CHAIN_ID,
    forkBlock: forkBlock.toString(),
    releaseSha: RELEASE_SHA,
    productionConfigHash,
    contracts,
    routes: routeResults,
    canary: { token: tokenAddress, vault: vaultAddress, market: marketAddress, adapter: adapterAddress, locker: lockerAddress },
    validation,
    mainnetBroadcastAuthorized: false,
  };
  await writeFile(path.join(outputRoot, "local-deployment.json"), `${json(deployment)}\n`, { mode: 0o600, flag: "wx" });
  const canaryPlan = {
    schemaVersion: 16,
    releaseSha: RELEASE_SHA,
    forkBlock: forkBlock.toString(),
    sourceDeploymentManifest: deploymentManifestPath,
    activation: {
      description: "Activate Schema-16 Mainnet canary routes and launch mode",
      targets: activationCalls.map((call) => call.target),
      values: activationCalls.map(() => "0"),
      calldatas: activationCalls.map((call) => call.data),
    },
    routeInputs: {
      stockRoundTripInputWei: "1000000000000",
      wethRoundTripInputWei: "1000000000000",
      minimumOutputBps: 9900,
      deadlineSeconds: 120,
    },
    launch: {
      profileVersion: "1",
      targetGraduationNativeWei: "10000000000000000",
      maximumCurvePurchaseWei: "1000000000000000",
      bondingSpendWei: bondingSpend.toString(),
    },
    unwind: {
      minimumOutputBps: 9900,
      deadlineSeconds: 120,
      minimumRecoveryBps: 7500,
      rehearsedRecoveryBps: recoveryBps.toString(),
    },
    shutdown: {
      reasonHash: shutdownReason,
      guardian: contracts.safe,
      routes: [...routeResults.map((item) => item.address), external.weth],
      actions: [
        "pauseLaunches",
        "pauseAssetConversions",
        "pauseFeeConversions",
        "disableEveryCanaryRoute",
      ],
    },
    publicApplicationWritesEnabled: false,
  };
  await writeFile(path.join(outputRoot, "canary-plan.json"), `${json(canaryPlan)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(path.join(outputRoot, "summary.json"), `${json({ passed: true, outputRoot, gasEvidencePath, forkBlock: forkBlock.toString(), transactionCount: transactions.length, recoveryBps: recoveryBps.toString(), mainnetBroadcastAuthorized: false })}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${json({ passed: true, outputRoot, gasEvidencePath, forkBlock, transactionCount: transactions.length, recoveryBps })}\n`);
} catch (error) {
  await writeFile(path.join(outputRoot, "failure.json"), `${json({ passed: false, failedAt: new Date().toISOString(), error: error.stack ?? error.message, transactionCount: transactions.length, mainnetBroadcastAuthorized: false })}\n`, { mode: 0o600 }).catch(() => {});
  throw error;
} finally {
  await stopAnvil();
  await rm(path.join(outputRoot, "anvil.pid"), { force: true });
}
