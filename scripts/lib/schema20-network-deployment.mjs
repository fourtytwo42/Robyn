import { readFileSync } from "node:fs";
import path from "node:path";
import {
  concatHex,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  isAddress,
  keccak256,
  numberToHex,
  parseEther,
} from "viem";
import { buildSchema19RouteConfiguration } from "./schema19-deployment.mjs";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const ARTIFACTS = Object.freeze({
  assetRouter: "RobynV4AssetRouter",
  launchDeployer: "RobynNativeLaunchDeployerV4",
  vaultDeployer: "RobynNativeVaultDeployerV4",
  launchFactory: "RobynNativeLaunchFactoryV4",
  feeRouter: "RobynNativeProtocolFeeRouterV5",
  staking: "RobynRdaoStaking",
  rdaoLiquidityLocker: "RobynRdaoV4LiquidityLocker",
  rdaoSale: "RobynRdaoBondingSale",
  maintenanceCoordinator: "RobynMaintenanceCoordinator",
  claimsRouter: "RobynClaimsRouter",
  tradeRouter: "RobynTradeRouter",
  oracleHook: "RobynV4FeeAndPhaseHook",
  adapterDeployer: "RobynV4AdapterDeployer",
  lockerDeployer: "RobynV4LockerDeployer",
  marketDeployer: "RobynV4MarketDeployer",
  tokenSink: "RobynTokenSink",
  marketFactory: "RobynV4MarketFactory",
  coordinator: "RobynV4LaunchCoordinatorV7",
});

const artifact = (root, name) =>
  JSON.parse(
    readFileSync(path.join(root, `${name}.sol`, `${name}.json`), "utf8"),
  );

export function validateSchema20NetworkInput(input) {
  assert(input?.schemaVersion === 20, "Schema-20 input required");
  assert([46630, 4663].includes(input.chainId), "unsupported Schema-20 chain");
  for (const field of ["contractReleaseSha", "toolingSha"]) {
    assert(
      /^[0-9a-f]{40}$/.test(input[field] ?? ""),
      `full lowercase ${field} required`,
    );
  }
  for (const field of [
    "deployer",
    "guardianSafe",
    "daoToken",
    "timelock",
    "governor",
  ]) {
    assert(isAddress(input[field]), `invalid ${field}`);
  }
  for (const field of [
    "create2Deployer",
    "poolManager",
    "positionManager",
    "quoter",
    "stateView",
    "permit2",
    "universalRouter",
    "wrappedNative",
  ]) {
    assert(isAddress(input.external?.[field]), `missing external ${field}`);
  }
  assert(
    Number.isSafeInteger(input.startingNonce) && input.startingNonce >= 0,
    "invalid starting nonce",
  );
  assert(
    /^0x[0-9a-fA-F]{64}$/.test(input.hookDomain ?? ""),
    "hook domain required",
  );
  const expected =
    input.chainId === 4663
      ? {
          rewardDuration: 3_600,
          failureObservationSpacing: 86_400,
          fallbackDelay: 259_200,
          targetGraduationNative: "6000000000000000000",
          maximumCurvePurchase: "500000000000000000",
          stakingWarmup: 86_400,
          stakingRewardDuration: 3_600,
          zeroSupplyRewardDuration: 604_800,
        }
      : {
          rewardDuration: 600,
          failureObservationSpacing: 60,
          fallbackDelay: 180,
          targetGraduationNative: "10000000000000000",
          maximumCurvePurchase: "1000000000000000",
          stakingWarmup: 600,
          stakingRewardDuration: 600,
          zeroSupplyRewardDuration: 3_600,
        };
  for (const [key, value] of Object.entries(expected)) {
    assert(
      String(input.settings?.[key]) === String(value),
      `${key} does not match chain profile`,
    );
  }
  assert(
    Number(input.settings?.maintenanceTaskGas) === 2_000_000,
    "maintenance task gas mismatch",
  );
  assert(
    Number(input.settings?.maintenanceCallGas) === 2_050_000,
    "maintenance call gas mismatch",
  );
  assert(
    String(input.sale?.saleInventory) === parseEther("150000000").toString(),
    "sale inventory mismatch",
  );
  assert(
    String(input.sale?.liquidityInventory) ===
      parseEther("50000000").toString(),
    "liquidity inventory mismatch",
  );
  assert(
    String(input.sale?.retainedStake) === parseEther("800000000").toString(),
    "retained stake mismatch",
  );
  assert(
    String(input.sale?.virtualTokenReserve) ===
      parseEther("600000000").toString(),
    "virtual token reserve mismatch",
  );
  for (const field of [
    "virtualNativeReserve",
    "curvePrincipalTarget",
    "deployerPayout",
    "liquidityNative",
  ]) {
    assert(BigInt(input.sale?.[field] ?? 0) > 0n, `invalid sale ${field}`);
  }
  assert(
    BigInt(input.sale.curvePrincipalTarget) ===
      BigInt(input.sale.deployerPayout) +
        BigInt(input.sale.liquidityNative) +
        BigInt(input.sale.dustWei ?? 0),
    "sale principal conservation mismatch",
  );
  assert(
    BigInt(input.sale.virtualNativeReserve) ===
      BigInt(input.sale.curvePrincipalTarget) * 3n,
    "virtual native reserve must be three times curve principal",
  );
  for (const field of ["maximumWethResidual", "maximumRdaoResidual"]) {
    const value = BigInt(input.sale?.[field] ?? 0);
    assert(value > 0n && value <= 1_000_000_000n, `invalid bounded ${field}`);
  }
  assert(
    Array.isArray(input.routes) && input.routes.length >= 6,
    "six qualified routes required",
  );
  return input;
}

export function buildSchema20NetworkPlan(input, artifactRoot) {
  validateSchema20NetworkInput(input);
  const root = path.resolve(artifactRoot);
  const artifacts = Object.fromEntries(
    Object.entries(ARTIFACTS).map(([role, name]) => [
      role,
      artifact(root, name),
    ]),
  );
  const deployer = getAddress(input.deployer);
  const guardian = getAddress(input.guardianSafe);
  const governance = getAddress(input.timelock);
  const rdao = getAddress(input.daoToken);
  const external = Object.fromEntries(
    Object.entries(input.external).map(([key, value]) => [
      key,
      getAddress(value),
    ]),
  );
  const transactions = [];
  const contracts = {};
  const nextNonce = () => input.startingNonce + transactions.length;
  const addDeploy = (role, args) => {
    const nonce = nextNonce();
    const address = getContractAddress({
      from: deployer,
      nonce: BigInt(nonce),
    });
    contracts[role] = address;
    transactions.push({
      label: `deploy-${role}`,
      nonce,
      to: null,
      value: "0",
      data: encodeDeployData({
        abi: artifacts[role].abi,
        bytecode: artifacts[role].bytecode.object,
        args,
      }),
      expectedContractAddress: address,
    });
    return address;
  };
  const addCall = (label, to, abi, functionName, args = [], value = 0n) => {
    transactions.push({
      label,
      nonce: nextNonce(),
      to: getAddress(to),
      value: value.toString(),
      data: encodeFunctionData({ abi, functionName, args }),
      expectedContractAddress: null,
    });
  };

  const assetRouter = addDeploy("assetRouter", [
    external.poolManager,
    external.quoter,
    external.stateView,
    governance,
    guardian,
    external.wrappedNative,
  ]);
  const launchDeployer = addDeploy("launchDeployer", [
    BigInt(input.settings.rewardDuration),
  ]);
  const vaultDeployer = addDeploy("vaultDeployer", []);
  const launchFactory = addDeploy("launchFactory", [
    assetRouter,
    launchDeployer,
    vaultDeployer,
    1n,
    72n * 60n * 60n,
  ]);
  const feeRouter = addDeploy("feeRouter", [
    rdao,
    assetRouter,
    governance,
    guardian,
    BigInt(input.settings.rewardDuration),
  ]);
  const staking = addDeploy("staking", [
    rdao,
    external.wrappedNative,
    governance,
    guardian,
    BigInt(input.settings.stakingWarmup),
    BigInt(input.settings.stakingRewardDuration),
    BigInt(input.settings.zeroSupplyRewardDuration),
  ]);
  const rdaoLiquidityLocker = addDeploy("rdaoLiquidityLocker", [
    external.poolManager,
    rdao,
    external.wrappedNative,
    staking,
    BigInt(input.sale.maximumWethResidual),
    BigInt(input.sale.maximumRdaoResidual),
  ]);
  const rdaoSale = addDeploy("rdaoSale", [
    rdao,
    staking,
    rdaoLiquidityLocker,
    {
      deployerPayoutRecipient: deployer,
      governance,
      guardian,
      saleInventory: BigInt(input.sale.saleInventory),
      liquidityInventory: BigInt(input.sale.liquidityInventory),
      virtualTokenReserve: BigInt(input.sale.virtualTokenReserve),
      virtualNativeReserve: BigInt(input.sale.virtualNativeReserve),
      curvePrincipalTarget: BigInt(input.sale.curvePrincipalTarget),
      deployerPayout: BigInt(input.sale.deployerPayout),
      liquidityNative: BigInt(input.sale.liquidityNative),
      maintenanceGasLimit: BigInt(input.settings.maintenanceTaskGas),
    },
  ]);
  addCall(
    "bind-rdao-sale-locker",
    rdaoLiquidityLocker,
    artifacts.rdaoLiquidityLocker.abi,
    "bindSale",
    [rdaoSale],
  );
  const maintenanceCoordinator = addDeploy("maintenanceCoordinator", [
    feeRouter,
    assetRouter,
    BigInt(input.settings.maintenanceTaskGas),
  ]);
  const claimsRouter = addDeploy("claimsRouter", [
    maintenanceCoordinator,
    BigInt(input.settings.maintenanceCallGas),
  ]);
  const tradeRouter = addDeploy("tradeRouter", []);
  addCall(
    "bind-maintenance",
    feeRouter,
    artifacts.feeRouter.abi,
    "bindMaintenanceCoordinator",
    [maintenanceCoordinator],
  );
  for (const [label, source] of [
    ["fee-router", feeRouter],
    ["sale", rdaoSale],
    ["liquidity-locker", rdaoLiquidityLocker],
  ]) {
    addCall(
      `allow-${label}-rewards`,
      staking,
      artifacts.staking.abi,
      "configureRewardSource",
      [source, true],
    );
  }
  addCall(
    "seal-staking-reward-sources",
    staking,
    artifacts.staking.abi,
    "sealRewardSources",
  );
  addCall(
    "bind-dao-staking-receiver",
    feeRouter,
    artifacts.feeRouter.abi,
    "bindDaoRewardReceiver",
    [staking],
  );

  const hookInitCode = encodeDeployData({
    abi: artifacts.oracleHook.abi,
    bytecode: artifacts.oracleHook.bytecode.object,
    args: [
      external.poolManager,
      feeRouter,
      deployer,
      external.positionManager,
      input.hookDomain,
    ],
  });
  const hookInitCodeHash = keccak256(hookInitCode);
  const requiredFlags = BigInt(input.hookFlags ?? "0x18e4") & 0x3fffn;
  let hookSalt;
  let oracleHook;
  for (let candidate = 0; candidate < 160_444; candidate += 1) {
    const salt = numberToHex(candidate, { size: 32 });
    const address = getCreate2Address({
      from: external.create2Deployer,
      salt,
      bytecodeHash: hookInitCodeHash,
    });
    if ((BigInt(address) & 0x3fffn) === requiredFlags) {
      hookSalt = salt;
      oracleHook = address;
      break;
    }
  }
  assert(hookSalt && oracleHook, "unable to mine Schema-20 hook address");
  contracts.oracleHook = oracleHook;
  transactions.push({
    label: "deploy-oracle-hook-create2",
    nonce: nextNonce(),
    to: external.create2Deployer,
    value: "0",
    data: concatHex([hookSalt, hookInitCode]),
    expectedContractAddress: oracleHook,
  });

  const adapterDeployer = addDeploy("adapterDeployer", []);
  const lockerDeployer = addDeploy("lockerDeployer", []);
  const marketDeployer = addDeploy("marketDeployer", []);
  const tokenSink = addDeploy("tokenSink", []);
  const marketFactory = addDeploy("marketFactory", [
    {
      launchFactory,
      feeRouter,
      assetRouter,
      oracleHook,
      poolManager: external.poolManager,
      positionManager: external.positionManager,
      permit2: external.permit2,
      stateView: external.stateView,
      adapterDeployer,
      lockerDeployer,
      marketDeployer,
      tokenSink,
    },
    {
      curveTokenAllocation: parseEther("800000000"),
      graduationTokenAllocation: parseEther("200000000"),
      initialVirtualTokenReserve: 1_066_666_666_666_666_666_666_666_666n,
      initialVirtualNativeReserve: 1n,
      graduationThresholdNative:
        BigInt(input.settings.targetGraduationNative) + 1n,
      curveFeeBps: 100,
      maximumCurvePurchase: BigInt(input.settings.maximumCurvePurchase),
    },
    9_900,
    BigInt(
      input.settings.maximumGraduatedPurchase ??
        input.settings.maximumCurvePurchase,
    ),
    1_000_000_000n,
    BigInt(input.settings.minimumTradeNative ?? "1000000000000"),
  ]);
  const coordinator = addDeploy("coordinator", [
    launchFactory,
    marketFactory,
    feeRouter,
    tradeRouter,
    governance,
    guardian,
  ]);
  addCall(
    "configure-fallback-policy",
    launchFactory,
    artifacts.launchFactory.abi,
    "configureFallbackPolicy",
    [
      BigInt(input.settings.failureObservationSpacing),
      BigInt(input.settings.fallbackDelay),
    ],
  );
  const routes = buildSchema19RouteConfiguration(
    input.routes,
    external.wrappedNative,
  );
  input.routes.forEach((route, index) => {
    transactions.push({
      label: `configure-route-${route.symbol}`,
      nonce: nextNonce(),
      to: assetRouter,
      value: "0",
      data: routes.configurationCalldata[index],
      expectedContractAddress: null,
    });
  });
  for (const [label, address, abi, target, functionName] of [
    [
      "launch-deployer",
      launchDeployer,
      artifacts.launchDeployer.abi,
      launchFactory,
      "bindController",
    ],
    [
      "vault-deployer",
      vaultDeployer,
      artifacts.vaultDeployer.abi,
      launchFactory,
      "bindController",
    ],
    [
      "adapter-deployer",
      adapterDeployer,
      artifacts.adapterDeployer.abi,
      marketFactory,
      "bindController",
    ],
    [
      "locker-deployer",
      lockerDeployer,
      artifacts.lockerDeployer.abi,
      marketFactory,
      "bindController",
    ],
    [
      "market-deployer",
      marketDeployer,
      artifacts.marketDeployer.abi,
      marketFactory,
      "bindController",
    ],
    [
      "hook-registrar",
      oracleHook,
      artifacts.oracleHook.abi,
      marketFactory,
      "bindRegistrar",
    ],
    [
      "asset-registrar",
      assetRouter,
      artifacts.assetRouter.abi,
      marketFactory,
      "bindLaunchRegistrar",
    ],
    [
      "launch-coordinator",
      launchFactory,
      artifacts.launchFactory.abi,
      coordinator,
      "bindCoordinator",
    ],
    [
      "market-coordinator",
      marketFactory,
      artifacts.marketFactory.abi,
      coordinator,
      "bindCoordinator",
    ],
    [
      "fee-coordinator",
      feeRouter,
      artifacts.feeRouter.abi,
      coordinator,
      "bindCoordinator",
    ],
  ]) {
    addCall(`bind-${label}`, address, abi, functionName, [target]);
  }
  const erc20Abi = [
    {
      type: "function",
      name: "approve",
      stateMutability: "nonpayable",
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bool" }],
    },
  ];
  addCall("approve-rdao-sale-allocation", rdao, erc20Abi, "approve", [
    rdaoSale,
    parseEther("200000000"),
  ]);
  addCall(
    "fund-rdao-sale-allocation",
    rdaoSale,
    artifacts.rdaoSale.abi,
    "fundAllocation",
  );
  addCall("approve-retained-rdao-stake", rdao, erc20Abi, "approve", [
    staking,
    parseEther("800000000"),
  ]);
  addCall("stake-retained-rdao", staking, artifacts.staking.abi, "stake", [
    parseEther("800000000"),
    deployer,
  ]);

  assert(
    transactions.every((tx, index) => tx.nonce === input.startingNonce + index),
    "non-contiguous plan nonce",
  );
  return {
    contracts,
    transactions,
    endingNonceExclusive: input.startingNonce + transactions.length,
    hook: {
      address: oracleHook,
      salt: hookSalt,
      initCodeHash: hookInitCodeHash,
    },
    routes: {
      symbols: input.routes.map((route) => route.symbol),
      assets: routes.assets,
    },
  };
}
