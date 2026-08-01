import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  zeroAddress,
} from "viem";
import { validateSchema18GovernanceManifest } from "./schema18-governance.mjs";

const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function bootstrapOwner() view returns (address)",
  "function bootstrapController() view returns (address)",
]);
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function bootstrapToken() view returns (address)",
  "function bootstrapOwner() view returns (address)",
  "function guardian() view returns (address)",
  "function bootstrapActive() view returns (bool)",
  "function bootstrapFinalized() view returns (bool)",
  "function nextBootstrapStep() view returns (uint8)",
  "function bootstrapPlanHash(uint8) view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function CANCELLER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
]);
const governorAbi = parseAbi([
  "function token() view returns (address)",
  "function timelock() view returns (address)",
  "function votingDelay() view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "function proposalThreshold() view returns (uint256)",
  "function quorumNumerator() view returns (uint256)",
]);
const coordinatorAbi = parseAbi(["function launchMode() view returns (uint8)"]);
const routerAbi = parseAbi([
  "function conversionsPaused() view returns (bool)",
  "function executionRouteStatus(address) view returns (uint8 kind,uint128 minimumLiquidity,uint128 maximumNativeInput,bytes32 poolId,bool configured,bool enabled,bool ready,bytes32 disabledReason)",
]);
const feeRouterAbi = parseAbi([
  "function paused() view returns (bool)",
  "function totalNativeLiabilities() view returns (uint256)",
  "function unattributedNative() view returns (uint256)",
]);
const launchFactoryAbi = parseAbi([
  "function launchCount() view returns (uint256)",
]);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function validateSchema18DeploymentManifest(manifest) {
  validateSchema18GovernanceManifest(manifest, { requireUnauthorized: false });
  assert(
    manifest.schemaVersion === 18,
    "Schema-18 deployment manifest required",
  );
  assert([46630, 4663].includes(manifest.chainId), "wrong Schema-18 chain");
  for (const key of [
    "daoToken",
    "timelock",
    "governor",
    "assetRouter",
    "protocolFeeRouter",
    "factory",
    "atomicLaunchCoordinator",
  ]) {
    assert(
      isAddress(manifest.contracts?.[key]),
      `missing Schema-18 contract ${key}`,
    );
    assert(
      isHex(manifest.runtimeCodeHashes?.[key], { strict: true }) &&
        manifest.runtimeCodeHashes[key].length === 66,
      `missing Schema-18 runtime hash ${key}`,
    );
  }
  assert(
    Array.isArray(manifest.routes) && manifest.routes.length >= 1,
    "Schema-18 route inventory is required",
  );
  assert(
    manifest.initialState?.launchMode === "Paused",
    "Schema-18 must deploy Paused",
  );
  assert(
    manifest.initialState?.assetConversionsPaused === true,
    "asset conversions must deploy Paused",
  );
  assert(
    manifest.initialState?.feeConversionsPaused === true,
    "fee conversions must deploy Paused",
  );
  assert(
    manifest.initialState?.applicationWritesEnabled === false,
    "application writes must be disabled",
  );
  return manifest;
}

export async function verifySchema18Deployment({ manifest, rpcUrl }) {
  validateSchema18DeploymentManifest(manifest);
  assert(
    /^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpcUrl),
    "Schema-18 verifier requires the protected loopback gateway",
  );
  const client = createPublicClient({
    transport: http(rpcUrl, { retryCount: 0, timeout: 20_000 }),
  });
  assert(
    (await client.getChainId()) === manifest.chainId,
    "Schema-18 RPC chain mismatch",
  );
  for (const [key, expectedHash] of Object.entries(
    manifest.runtimeCodeHashes,
  )) {
    const address = manifest.contracts[key];
    if (!isAddress(address)) continue;
    const code = await client.getCode({ address: getAddress(address) });
    assert(code && code !== "0x", `missing runtime code for ${key}`);
    assert(
      keccak256(code) === expectedHash.toLowerCase(),
      `runtime hash mismatch for ${key}`,
    );
  }
  const token = getAddress(manifest.contracts.daoToken);
  const timelock = getAddress(manifest.contracts.timelock);
  const governor = getAddress(manifest.contracts.governor);
  const deployer = getAddress(manifest.deployer);
  const guardian = getAddress(manifest.guardianSafe);
  const [
    totalSupply,
    deployerBalance,
    tokenOwner,
    tokenController,
    delay,
    controllerToken,
    controllerOwner,
    controllerGuardian,
    bootstrapActive,
    bootstrapFinalized,
    nextStep,
    firstPlan,
    secondPlan,
    governorToken,
    governorTimelock,
    votingDelay,
    votingPeriod,
    proposalThreshold,
    quorumNumerator,
  ] = await Promise.all([
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "totalSupply",
    }),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [deployer],
    }),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "bootstrapOwner",
    }),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "bootstrapController",
    }),
    client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "getMinDelay",
    }),
    client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "bootstrapToken",
    }),
    client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "bootstrapOwner",
    }),
    client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "guardian",
    }),
    client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "bootstrapActive",
    }),
    client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "bootstrapFinalized",
    }),
    client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "nextBootstrapStep",
    }),
    client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "bootstrapPlanHash",
      args: [0],
    }),
    client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "bootstrapPlanHash",
      args: [1],
    }),
    client.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "token",
    }),
    client.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "timelock",
    }),
    client.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "votingDelay",
    }),
    client.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "votingPeriod",
    }),
    client.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "proposalThreshold",
    }),
    client.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "quorumNumerator",
    }),
  ]);
  assert(
    totalSupply.toString() === manifest.governance.fixedDaoSupplyWei,
    "RDAO fixed supply mismatch",
  );
  assert(deployerBalance === totalSupply, "deployer does not hold all RDAO");
  assert(getAddress(tokenOwner) === deployer, "RDAO bootstrap owner mismatch");
  assert(
    getAddress(tokenController) === timelock,
    "RDAO bootstrap controller mismatch",
  );
  assert(delay === 3_600n, "Timelock is not one hour");
  assert(getAddress(controllerToken) === token, "Timelock RDAO mismatch");
  assert(getAddress(controllerOwner) === deployer, "Timelock owner mismatch");
  assert(
    getAddress(controllerGuardian) === guardian,
    "Timelock guardian mismatch",
  );
  assert(
    bootstrapActive && !bootstrapFinalized && Number(nextStep) === 0,
    "bootstrap is not fresh and active",
  );
  assert(
    firstPlan === manifest.governance.bootstrapPlanHashes[0],
    "bootstrap step one hash mismatch",
  );
  assert(
    secondPlan === manifest.governance.bootstrapPlanHashes[1],
    "bootstrap step two hash mismatch",
  );
  assert(
    getAddress(governorToken) === token &&
      getAddress(governorTimelock) === timelock,
    "Governor wiring mismatch",
  );
  assert(
    votingDelay === 3_600n && votingPeriod === 14_400n,
    "Governor hour-scale clocks mismatch",
  );
  assert(
    proposalThreshold === 10_000_000n * 10n ** 18n && quorumNumerator === 10n,
    "Governor threshold or quorum mismatch",
  );

  const [
    launchMode,
    assetPaused,
    feePaused,
    liabilities,
    unattributed,
    launchCount,
  ] = await Promise.all([
    client.readContract({
      address: getAddress(manifest.contracts.atomicLaunchCoordinator),
      abi: coordinatorAbi,
      functionName: "launchMode",
    }),
    client.readContract({
      address: getAddress(manifest.contracts.assetRouter),
      abi: routerAbi,
      functionName: "conversionsPaused",
    }),
    client.readContract({
      address: getAddress(manifest.contracts.protocolFeeRouter),
      abi: feeRouterAbi,
      functionName: "paused",
    }),
    client.readContract({
      address: getAddress(manifest.contracts.protocolFeeRouter),
      abi: feeRouterAbi,
      functionName: "totalNativeLiabilities",
    }),
    client.readContract({
      address: getAddress(manifest.contracts.protocolFeeRouter),
      abi: feeRouterAbi,
      functionName: "unattributedNative",
    }),
    client.readContract({
      address: getAddress(manifest.contracts.factory),
      abi: launchFactoryAbi,
      functionName: "launchCount",
    }),
  ]);
  assert(Number(launchMode) === 0, "launch mode is not Paused");
  assert(assetPaused && feePaused, "conversion systems are not Paused");
  assert(
    liabilities === 0n && unattributed === 0n && launchCount === 0n,
    "Schema-18 zero state mismatch",
  );
  for (const route of manifest.routes) {
    const status = await client.readContract({
      address: getAddress(manifest.contracts.assetRouter),
      abi: routerAbi,
      functionName: "executionRouteStatus",
      args: [getAddress(route.asset)],
    });
    assert(
      status[5] === false && status[6] === false,
      `${route.symbol} route is unexpectedly enabled or ready`,
    );
  }
  const roles = Object.fromEntries(
    await Promise.all(
      [
        "PROPOSER_ROLE",
        "CANCELLER_ROLE",
        "EXECUTOR_ROLE",
        "DEFAULT_ADMIN_ROLE",
      ].map(async (name) => [
        name,
        await client.readContract({
          address: timelock,
          abi: timelockAbi,
          functionName: name,
        }),
      ]),
    ),
  );
  assert(
    await client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "hasRole",
      args: [roles.PROPOSER_ROLE, governor],
    }),
    "Governor lacks proposer role",
  );
  assert(
    await client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "hasRole",
      args: [roles.CANCELLER_ROLE, guardian],
    }),
    "Safe lacks canceller role",
  );
  assert(
    await client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "hasRole",
      args: [roles.EXECUTOR_ROLE, zeroAddress],
    }),
    "execution is not open",
  );
  assert(
    !(await client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "hasRole",
      args: [roles.DEFAULT_ADMIN_ROLE, deployer],
    })),
    "deployer retained Timelock administration",
  );
  return {
    chainId: manifest.chainId,
    deploymentBlock: manifest.deploymentBlock,
    contractsVerified: Object.keys(manifest.runtimeCodeHashes).length,
    routesDisabled: manifest.routes.length,
    passed: true,
  };
}
