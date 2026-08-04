#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  http,
  keccak256,
  numberToHex,
  parseEther,
  sliceHex,
  stringToHex,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const argv = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const rpcUrl = option("rpc-url");
const sourceRpcUrl = option("source-rpc-url", "http://127.0.0.1:8545");
const output = resolve(option("output"));
if (rpcUrl !== "http://127.0.0.1:28549" || !output) {
  throw new Error("Schema-20 marketing deployment is restricted to isolated Anvil 28549");
}

const chain = {
  id: 31337,
  name: "Sherwood Schema-20 marketing Devnet",
  nativeCurrency: { name: "Dev Ether", symbol: "DEV", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const owner = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const guardian = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const treasury = owner.address;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const sourceClient = createPublicClient({ transport: http(sourceRpcUrl) });
const wallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== 31337) throw new Error("wrong target chain");

const artifact = (path) => JSON.parse(readFileSync(path, "utf8"));
const artifactRoot = process.env.ROBYN_CONTRACT_ARTIFACT_ROOT ?? "packages/contracts/out";
const contractArtifact = (name) =>
  artifact(`${artifactRoot}/${name}.sol/${name}.json`);
const pinnedArtifact = (path) => artifact(path);
const poolManagerArtifact = pinnedArtifact(
  "node_modules/@uniswap/v4-periphery/foundry-out/PoolManager.sol/PoolManager.default.json",
);
const positionManagerArtifact = pinnedArtifact(
  "node_modules/@uniswap/v4-periphery/foundry-out/PositionManager.sol/PositionManager.json",
);
const stateViewArtifact = pinnedArtifact(
  "node_modules/@uniswap/v4-periphery/foundry-out/StateView.sol/StateView.json",
);
const quoterArtifact = pinnedArtifact(
  "node_modules/@uniswap/v4-periphery/foundry-out/V4Quoter.sol/V4Quoter.json",
);
const liquidityFixtureArtifact = pinnedArtifact(
  "node_modules/@uniswap/v4-periphery/foundry-out/PoolModifyLiquidityTest.sol/PoolModifyLiquidityTest.default.json",
);
const wethArtifact = contractArtifact("DevnetWrappedNative");
const mockAssetArtifact = contractArtifact("DevnetMockERC20");
const assetRouterArtifact = contractArtifact("RobynV4AssetRouter");
const launchDeployerArtifact = contractArtifact("RobynNativeLaunchDeployerV4");
const vaultDeployerArtifact = contractArtifact("RobynNativeVaultDeployerV4");
const launchFactoryArtifact = contractArtifact("RobynNativeLaunchFactoryV4");
const feeRouterArtifact = contractArtifact("RobynNativeProtocolFeeRouterV5");
const rdaoArtifact = contractArtifact("RobynDaoTokenV3");
const timelockArtifact = contractArtifact("RobynBootstrapTimelock");
const governorArtifact = contractArtifact("RobynGovernorV2");
const stakingArtifact = contractArtifact("RobynRdaoStaking");
const rdaoLockerArtifact = contractArtifact("RobynRdaoV4LiquidityLocker");
const saleArtifact = contractArtifact("RobynRdaoBondingSale");
const maintenanceArtifact = contractArtifact("RobynMaintenanceCoordinator");
const claimsArtifact = contractArtifact("RobynClaimsRouter");
const tradesArtifact = contractArtifact("RobynTradeRouter");
const hookArtifact = contractArtifact("RobynV4FeeAndPhaseHook");
const adapterDeployerArtifact = contractArtifact("RobynV4AdapterDeployer");
const lockerDeployerArtifact = contractArtifact("RobynV4LockerDeployer");
const marketDeployerArtifact = contractArtifact("RobynV4MarketDeployer");
const tokenSinkArtifact = contractArtifact("RobynTokenSink");
const marketFactoryArtifact = contractArtifact("RobynV4MarketFactory");
const coordinatorArtifact = contractArtifact("RobynV4LaunchCoordinatorV7");

const transactions = [];
const record = async (label, receipt) => {
  if (receipt.status !== "success") throw new Error(`${label} failed`);
  const transaction = await publicClient.getTransaction({ hash: receipt.transactionHash });
  transactions.push({
    label,
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    nonce: transaction.nonce,
    to: transaction.to,
    value: transaction.value.toString(),
    calldataHash: keccak256(transaction.input),
    status: receipt.status,
  });
};
const deploy = async (label, contract, args = []) => {
  const hash = await wallet.deployContract({
    abi: contract.abi,
    bytecode: contract.bytecode.object,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  await record(label, receipt);
  if (!receipt.contractAddress) throw new Error(`${label} missing address`);
  return getAddress(receipt.contractAddress);
};
const send = async (label, address, abi, functionName, args = [], value = 0n) => {
  const data = encodeFunctionData({ abi, functionName, args });
  await publicClient.call({ account: owner.address, to: address, data, value });
  const hash = await wallet.sendTransaction({ to: address, data, value });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  await record(label, receipt);
  return receipt;
};
const runtimeHash = async (address) => {
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") throw new Error(`missing runtime at ${address}`);
  return keccak256(code);
};

const singletonFactory = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
const singletonRuntime = await sourceClient.getCode({ address: singletonFactory });
if (!singletonRuntime || singletonRuntime === "0x") {
  throw new Error("source Devnet is missing the reviewed CREATE2 deployer runtime");
}
await publicClient.request({
  method: "anvil_setCode",
  params: [singletonFactory, singletonRuntime],
});
const permit2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
const permit2Runtime = readFileSync(
  "packages/contracts/test/fixtures/permit2-runtime.hex",
  "utf8",
).trim();
await publicClient.request({ method: "anvil_setCode", params: [permit2, permit2Runtime] });

const poolManager = await deploy("deploy-pool-manager", poolManagerArtifact, [owner.address]);
const positionManager = await deploy("deploy-position-manager", positionManagerArtifact, [
  poolManager,
  permit2,
  300_000n,
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000002",
]);
const stateView = await deploy("deploy-state-view", stateViewArtifact, [poolManager]);
const quoter = await deploy("deploy-quoter", quoterArtifact, [poolManager]);
const wrappedNative = await deploy("deploy-devnet-weth", wethArtifact);

const fixedSupply = parseEther("1000000000");
const rdao = await deploy("deploy-rdao", rdaoArtifact, [
  [owner.address],
  [fixedSupply],
  3_600n,
  owner.address,
]);
const bootstrapDomain = keccak256(stringToHex("SCHEMA20_MARKETING_DEVNET"));
const plans = [
  keccak256(stringToHex("SCHEMA20_MARKETING_UNUSED_BOOTSTRAP_ONE")),
  keccak256(stringToHex("SCHEMA20_MARKETING_UNUSED_BOOTSTRAP_TWO")),
];
const timelock = await deploy("deploy-timelock", timelockArtifact, [
  rdao,
  owner.address,
  guardian.address,
  bootstrapDomain,
  plans,
]);
await send("bind-rdao-bootstrap-controller", rdao, rdaoArtifact.abi, "bindBootstrapController", [
  timelock,
]);
const governor = await deploy("deploy-governor", governorArtifact, [rdao, timelock]);
const assetRouter = await deploy("deploy-asset-router", assetRouterArtifact, [
  poolManager,
  quoter,
  stateView,
  timelock,
  guardian.address,
  wrappedNative,
]);

const q96 = 1n << 96n;
function sqrtRatioAtTick(tick) {
  let absTick = BigInt(tick < 0 ? -tick : tick);
  let ratio = (absTick & 1n) !== 0n
    ? 0xfffcb933bd6fad37aa2d162d1a594001n
    : 0x100000000000000000000000000000000n;
  const factors = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ];
  for (const [bit, factor] of factors) {
    if ((absTick & bit) !== 0n) ratio = (ratio * factor) >> 128n;
  }
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}
const ceilDiv = (numerator, denominator) =>
  numerator / denominator + (numerator % denominator === 0n ? 0n : 1n);
const liquidity = parseEther("10");
const upperSqrt = sqrtRatioAtTick(600);
const intermediate = ceilDiv((liquidity << 96n) * (upperSqrt - q96), upperSqrt);
const nativeLiquidityAmount = ceilDiv(intermediate, q96);
const liquidityFixture = await deploy(
  "deploy-liquidity-fixture",
  liquidityFixtureArtifact,
  [poolManager],
);

const assetSpecs = [
  { symbol: "mNVDA", name: "Devnet NVIDIA", category: "stock", weightBps: 4_000 },
  { symbol: "mSPY", name: "Devnet S&P 500", category: "etf", weightBps: 4_000 },
  { symbol: "mETH", name: "Devnet Ether", category: "crypto", weightBps: 2_000 },
];
const rewardAssets = [];
for (const spec of assetSpecs) {
  const address = await deploy(`deploy-${spec.symbol}`, mockAssetArtifact, [
    spec.name,
    spec.symbol,
    owner.address,
    parseEther("10000"),
  ]);
  await send(`mint-${spec.symbol}-liquidity`, address, mockAssetArtifact.abi, "mint", [
    owner.address,
    parseEther("1000000"),
  ]);
  const poolKey = {
    currency0: zeroAddress,
    currency1: address,
    fee: 3_000,
    tickSpacing: 60,
    hooks: zeroAddress,
  };
  await send(`initialize-${spec.symbol}-pool`, poolManager, poolManagerArtifact.abi, "initialize", [
    poolKey,
    q96,
  ]);
  await send(`approve-${spec.symbol}-liquidity`, address, mockAssetArtifact.abi, "approve", [
    liquidityFixture,
    (1n << 256n) - 1n,
  ]);
  await send(
    `seed-${spec.symbol}-liquidity`,
    liquidityFixture,
    liquidityFixtureArtifact.abi,
    "modifyLiquidity",
    [
      poolKey,
      { tickLower: -600, tickUpper: 600, liquidityDelta: liquidity, salt: numberToHex(0, { size: 32 }) },
      "0x",
    ],
    nativeLiquidityAmount,
  );
  const verificationClass = keccak256(stringToHex(`SCHEMA20_DEVNET_${spec.symbol}`));
  await send(`configure-${spec.symbol}-route`, assetRouter, assetRouterArtifact.abi, "configureRoute", [
    address,
    {
      fee: 3_000,
      tickSpacing: 60,
      hooks: zeroAddress,
      minimumLiquidity: 1n,
      maximumNativeInput: parseEther("0.25"),
      referenceTick: 0,
      maximumReferenceTickDeviation: 198,
      enforceReferencePrice: true,
      verificationClass,
      enabled: true,
    },
  ]);
  rewardAssets.push({ ...spec, address, verificationClass });
}

const launchDeployer = await deploy("deploy-launch-deployer", launchDeployerArtifact, [3_600n]);
const vaultDeployer = await deploy("deploy-vault-deployer", vaultDeployerArtifact);
const launchFactory = await deploy("deploy-launch-factory", launchFactoryArtifact, [
  assetRouter,
  launchDeployer,
  vaultDeployer,
  1n,
  72n * 60n * 60n,
]);
const feeRouter = await deploy("deploy-fee-router", feeRouterArtifact, [
  rdao,
  assetRouter,
  timelock,
  guardian.address,
  3_600n,
]);
const staking = await deploy("deploy-rdao-staking", stakingArtifact, [
  rdao,
  wrappedNative,
  timelock,
  guardian.address,
  86_400n,
  3_600n,
  604_800n,
]);
const rdaoLiquidityLocker = await deploy("deploy-rdao-liquidity-locker", rdaoLockerArtifact, [
  poolManager,
  rdao,
  wrappedNative,
  staking,
  10_000n,
  100n,
]);
const rdaoSale = await deploy("deploy-rdao-sale", saleArtifact, [
  rdao,
  staking,
  rdaoLiquidityLocker,
  {
    deployerPayoutRecipient: owner.address,
    governance: timelock,
    guardian: guardian.address,
    saleInventory: parseEther("150000000"),
    liquidityInventory: parseEther("50000000"),
    virtualTokenReserve: parseEther("600000000"),
    virtualNativeReserve: 996_953_752_423_151_481_585n,
    curvePrincipalTarget: 332_317_917_474_383_827_195n,
    deployerPayout: 184_621_065_263_546_570_663n,
    liquidityNative: 147_696_852_210_837_256_531n,
    maintenanceGasLimit: 2_000_000n,
  },
]);
await send("bind-rdao-sale-locker", rdaoLiquidityLocker, rdaoLockerArtifact.abi, "bindSale", [
  rdaoSale,
]);
const maintenanceCoordinator = await deploy("deploy-maintenance", maintenanceArtifact, [
  feeRouter,
  assetRouter,
  2_000_000n,
]);
const claimsRouter = await deploy("deploy-claims-router", claimsArtifact, [
  maintenanceCoordinator,
  2_050_000n,
]);
const tradeRouter = await deploy("deploy-trade-router", tradesArtifact);
await send("bind-maintenance", feeRouter, feeRouterArtifact.abi, "bindMaintenanceCoordinator", [
  maintenanceCoordinator,
]);
for (const [label, address] of [
  ["fee-router", feeRouter],
  ["sale", rdaoSale],
  ["liquidity-locker", rdaoLiquidityLocker],
]) {
  await send(`allow-${label}-rewards`, staking, stakingArtifact.abi, "configureRewardSource", [
    address,
    true,
  ]);
}
await send("seal-staking-reward-sources", staking, stakingArtifact.abi, "sealRewardSources");
await send("bind-dao-staking-receiver", feeRouter, feeRouterArtifact.abi, "bindDaoRewardReceiver", [
  staking,
]);

const hookDomain = keccak256(stringToHex("SCHEMA20_MARKETING_DEVNET_HOOK"));
const hookInitCode = encodeDeployData({
  abi: hookArtifact.abi,
  bytecode: hookArtifact.bytecode.object,
  args: [poolManager, feeRouter, owner.address, positionManager, hookDomain],
});
const hookInitCodeHash = keccak256(hookInitCode);
const requiredFlags = 0x18e4n;
let hookSalt;
let oracleHook;
for (let candidate = 0; candidate < 160_444; candidate += 1) {
  const salt = numberToHex(candidate, { size: 32 });
  const address = getCreate2Address({ from: singletonFactory, salt, bytecodeHash: hookInitCodeHash });
  if ((BigInt(address) & 0x3fffn) === requiredFlags) {
    hookSalt = salt;
    oracleHook = address;
    break;
  }
}
if (!hookSalt || !oracleHook) throw new Error("unable to mine Schema-20 hook address");
const hookHash = await wallet.sendTransaction({
  to: singletonFactory,
  data: concatHex([hookSalt, hookInitCode]),
});
const hookReceipt = await publicClient.waitForTransactionReceipt({ hash: hookHash });
await record("deploy-oracle-hook-create2", hookReceipt);
if ((await publicClient.getCode({ address: oracleHook })) === "0x") {
  throw new Error("oracle hook deployment produced no code");
}

const adapterDeployer = await deploy("deploy-adapter-deployer", adapterDeployerArtifact);
const lockerDeployer = await deploy("deploy-locker-deployer", lockerDeployerArtifact);
const marketDeployer = await deploy("deploy-market-deployer", marketDeployerArtifact);
const tokenSink = await deploy("deploy-token-sink", tokenSinkArtifact);
const marketFactory = await deploy("deploy-market-factory", marketFactoryArtifact, [
  {
    launchFactory,
    feeRouter,
    assetRouter,
    oracleHook,
    poolManager,
    positionManager,
    permit2,
    stateView,
    adapterDeployer,
    lockerDeployer,
    marketDeployer,
    tokenSink,
  },
  {
    curveTokenAllocation: parseEther("800000000"),
    graduationTokenAllocation: parseEther("200000000"),
    initialVirtualTokenReserve: 1_066_666_666_666_666_666_666_666_666n,
    initialVirtualNativeReserve: parseEther("0.5"),
    graduationThresholdNative: parseEther("1.5") + 1n,
    curveFeeBps: 100,
    maximumCurvePurchase: parseEther("0.5"),
  },
  9_900,
  parseEther("0.25"),
  1_000_000_000n,
  parseEther("0.000001"),
]);
const coordinator = await deploy("deploy-launch-coordinator", coordinatorArtifact, [
  launchFactory,
  marketFactory,
  feeRouter,
  tradeRouter,
  timelock,
  guardian.address,
]);

for (const [label, address, abi, target, functionName] of [
  ["launch-deployer", launchDeployer, launchDeployerArtifact.abi, launchFactory, "bindController"],
  ["vault-deployer", vaultDeployer, vaultDeployerArtifact.abi, launchFactory, "bindController"],
  ["adapter-deployer", adapterDeployer, adapterDeployerArtifact.abi, marketFactory, "bindController"],
  ["locker-deployer", lockerDeployer, lockerDeployerArtifact.abi, marketFactory, "bindController"],
  ["market-deployer", marketDeployer, marketDeployerArtifact.abi, marketFactory, "bindController"],
  ["hook-registrar", oracleHook, hookArtifact.abi, marketFactory, "bindRegistrar"],
  ["asset-registrar", assetRouter, assetRouterArtifact.abi, marketFactory, "bindLaunchRegistrar"],
  ["launch-coordinator", launchFactory, launchFactoryArtifact.abi, coordinator, "bindCoordinator"],
  ["market-coordinator", marketFactory, marketFactoryArtifact.abi, coordinator, "bindCoordinator"],
  ["fee-coordinator", feeRouter, feeRouterArtifact.abi, coordinator, "bindCoordinator"],
]) {
  await send(`bind-${label}`, address, abi, functionName, [target]);
}

const proposerRole = await publicClient.readContract({
  address: timelock,
  abi: timelockArtifact.abi,
  functionName: "PROPOSER_ROLE",
});
const cancellerRole = await publicClient.readContract({
  address: timelock,
  abi: timelockArtifact.abi,
  functionName: "CANCELLER_ROLE",
});
const executorRole = await publicClient.readContract({
  address: timelock,
  abi: timelockArtifact.abi,
  functionName: "EXECUTOR_ROLE",
});
await send("grant-governor-proposer", timelock, timelockArtifact.abi, "grantRole", [
  proposerRole,
  governor,
]);
await send("grant-guardian-canceller", timelock, timelockArtifact.abi, "grantRole", [
  cancellerRole,
  guardian.address,
]);
await send("grant-open-executor", timelock, timelockArtifact.abi, "grantRole", [
  executorRole,
  zeroAddress,
]);

const saleAllocation = parseEther("200000000");
await send("approve-rdao-sale-allocation", rdao, rdaoArtifact.abi, "approve", [
  rdaoSale,
  saleAllocation,
]);
await send("fund-rdao-sale-allocation", rdaoSale, saleArtifact.abi, "fundAllocation");
const retained = parseEther("800000000");
await send("approve-retained-rdao-stake", rdao, rdaoArtifact.abi, "approve", [staking, retained]);
await send("stake-retained-rdao", staking, stakingArtifact.abi, "stake", [
  retained,
  owner.address,
]);
await publicClient.request({ method: "evm_increaseTime", params: [86_401] });
await publicClient.request({ method: "evm_mine", params: [] });
await send("activate-retained-rdao", staking, stakingArtifact.abi, "activateFor", [owner.address]);

const addresses = {
  wrappedNative,
  rewardAssets: rewardAssets.map((asset) => asset.address),
  factory: launchFactory,
  launchDeployer,
  vaultDeployer,
  marketFactory,
  atomicLaunchCoordinator: coordinator,
  daoToken: rdao,
  governor,
  timelock,
  guardian: guardian.address,
  protocolFeeRouter: feeRouter,
  assetRouter,
  oracleHook,
  poolManager,
  positionManager,
  quoter,
  permit2,
  stateView,
  adapterDeployer,
  lockerDeployer,
  marketDeployer,
  tokenSink,
  maintenanceCoordinator,
  claimsRouter,
  tradeRouter,
  rdaoSale,
  rdaoStaking: staking,
  rdaoLiquidityLocker,
};
const protocolRootRoles = [
  "factory",
  "launchDeployer",
  "vaultDeployer",
  "marketFactory",
  "atomicLaunchCoordinator",
  "daoToken",
  "governor",
  "timelock",
  "protocolFeeRouter",
  "assetRouter",
  "oracleHook",
  "adapterDeployer",
  "lockerDeployer",
  "marketDeployer",
  "tokenSink",
  "maintenanceCoordinator",
  "claimsRouter",
  "tradeRouter",
  "rdaoSale",
  "rdaoStaking",
  "rdaoLiquidityLocker",
];
const protocolRoots = [...new Set(protocolRootRoles.map((role) => addresses[role].toLowerCase()))].sort();
const launchEventTopics = [
  "0xd74962c237728681433889a5419834cff77965f55668fb014ee28925e2cef5f1",
];
const poolEventTopics = [
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
  "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec",
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
  "0x29ef05caaff9404b7cb6d1c0e9bbae9eaa7ab2541feba1a9c4248594c08156cb",
].sort();
const policyPayload = {
  version: 1,
  protocolRoots,
  launchCoordinator: coordinator.toLowerCase(),
  launchEventTopics: [...launchEventTopics].sort(),
  poolManager: poolManager.toLowerCase(),
  poolEventTopics,
  addressBatchSize: 64,
  poolIdBatchSize: 32,
};
const policyHash = createHash("sha256")
  .update(JSON.stringify(policyPayload))
  .digest("hex");
const deploymentBlock = Number(transactions[0].blockNumber);
const runtimeRoles = [
  "wrappedNative", "factory", "launchDeployer", "vaultDeployer", "marketFactory",
  "atomicLaunchCoordinator", "daoToken", "governor", "timelock", "protocolFeeRouter",
  "assetRouter", "oracleHook", "poolManager", "positionManager", "quoter", "permit2",
  "stateView", "adapterDeployer", "lockerDeployer", "marketDeployer", "tokenSink",
  "maintenanceCoordinator", "claimsRouter", "tradeRouter", "rdaoSale", "rdaoStaking",
  "rdaoLiquidityLocker",
];
const runtimeCodeHashes = Object.fromEntries(
  await Promise.all(runtimeRoles.map(async (role) => [role, await runtimeHash(addresses[role])])),
);
const manifest = {
  schemaVersion: 20,
  environment: "robyn-devnet",
  chainId: 31337,
  deploymentBlock,
  gitCommit: option("git-commit", "PENDING_MARKETING_SHA"),
  deployer: owner.address,
  contracts: addresses,
  runtimeCodeHashes,
  indexingPolicy: { ...policyPayload, policyHash },
  assetCatalog: {
    version: 1,
    assets: rewardAssets.map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      category: asset.category,
      address: asset.address,
      chainId: 31337,
      decimals: 18,
      verification: "schema20-devnet-fixture",
      mockOnly: true,
      disclosure: "Deterministic Schema-20 Devnet fixture. No real-world value or redemption rights.",
      referencePriceUsd: null,
      route: { kind: "uniswap-v4", ready: true },
    })),
  },
  dao: {
    tokenName: "Robyn DAO",
    tokenSymbol: "RDAO",
    fixedSupply: fixedSupply.toString(),
    feePolicy: { basketBps: 5_000, creatorBps: 2_500, daoRewardsBps: 2_000, treasuryBps: 500 },
    governance: {
      votingDelaySeconds: 86_400,
      votingPeriodSeconds: 14_400,
      timelockSeconds: 3_600,
      quorumBps: 1_000,
      proposalThresholdBps: 100,
    },
  },
  rdao: {
    allocation: {
      retained: retained.toString(),
      sale: parseEther("150000000").toString(),
      liquidity: parseEther("50000000").toString(),
    },
    pricing: {
      ethUsdFixture: "1624.95",
      ownerTargetUsd: "300000",
      liquidityTargetUsd: "240000",
    },
    staking: {
      warmupSeconds: 86_400,
      rewardDurationSeconds: 3_600,
      zeroSupplyDurationSeconds: 604_800,
    },
  },
  market: {
    type: "uniswap-v4-schema20-user-maintained",
    feeBps: 100,
    curveTokenAllocation: parseEther("800000000").toString(),
    graduationTokenAllocation: parseEther("200000000").toString(),
    initialVirtualTokenReserve: "1066666666666666666666666666",
    initialVirtualNativeReserve: parseEther("0.5").toString(),
    graduationThresholdNative: (parseEther("1.5") + 1n).toString(),
    maximumCurvePurchase: parseEther("0.5").toString(),
  },
  deploymentTransactions: transactions,
  devnetOnly: true,
};
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
chmodSync(output, 0o600);
process.stdout.write(`${JSON.stringify({ output, transactions: transactions.length, policyHash })}\n`);
