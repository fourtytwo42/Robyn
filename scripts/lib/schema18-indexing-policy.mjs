import { createHash } from "node:crypto";
import { getAddress, parseAbiItem, toEventSelector } from "viem";

const ROOT_ROLES = [
  "assetRouter",
  "atomicLaunchCoordinator",
  "daoToken",
  "factory",
  "governor",
  "launchDeployer",
  "launchFactory",
  "lockerDeployer",
  "marketDeployer",
  "marketFactory",
  "nativeFeeConverter",
  "oracleHook",
  "protocolFeeRouter",
  "timelock",
  "vaultDeployer",
  "adapterDeployer",
];

const EXTERNAL_ROLES = [
  "baseAsset",
  "wrappedNative",
  "rewardAssets",
  "poolManager",
  "positionManager",
  "quoter",
  "universalRouter",
  "permit2",
  "stateView",
];

const launchEvent = parseAbiItem(
  "event AtomicV4LaunchCreated(uint256 indexed launchId,address indexed creator,address indexed token,(address vault,address market,address adapter,address poolManager,bytes32 poolId,address positionManager,address hook,address locker,uint24 poolFeePips,int24 tickSpacing,bytes32 configurationHash,bytes32 launchSaltHash,bytes32 metadataUriHash,(uint64 version,uint256 targetGraduationNative,uint256 actualGraduationNative,uint256 maximumCurvePurchase,uint256 initialVirtualNativeReserve,uint256 terminalNativePerTokenX18,uint160 terminalSqrtPriceX96) graduationProfile,bytes32 graduationProfileHash) receipt)",
);
const poolEvents = [
  parseAbiItem(
    "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
  ),
  parseAbiItem(
    "event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)",
  ),
  parseAbiItem(
    "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
  ),
  parseAbiItem(
    "event Donate(bytes32 indexed id,address indexed sender,uint256 amount0,uint256 amount1)",
  ),
];

function normalizedUnique(values) {
  return [...new Set(values.map((value) => value.toLowerCase()))].sort();
}

function policyPayload(policy) {
  return JSON.stringify({
    version: policy.version,
    protocolRoots: normalizedUnique(policy.protocolRoots),
    launchCoordinator: policy.launchCoordinator.toLowerCase(),
    launchEventTopics: normalizedUnique(policy.launchEventTopics),
    poolManager: policy.poolManager.toLowerCase(),
    poolEventTopics: normalizedUnique(policy.poolEventTopics),
    addressBatchSize: policy.addressBatchSize,
    poolIdBatchSize: policy.poolIdBatchSize,
  });
}

export function schema18IndexingPolicyHash(policy) {
  return createHash("sha256").update(policyPayload(policy)).digest("hex");
}

export function buildSchema18IndexingPolicy(manifest) {
  if (manifest.schemaVersion !== 18) {
    throw new Error("Schema-18 manifest required for scoped indexing policy");
  }
  const contracts = manifest.contracts ?? {};
  const launchCoordinator = getAddress(contracts.atomicLaunchCoordinator);
  const poolManager = getAddress(contracts.poolManager);
  const externalAddresses = new Set(
    EXTERNAL_ROLES.flatMap((role) => {
      const value = contracts[role];
      return (Array.isArray(value) ? value : [value])
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.toLowerCase());
    }),
  );
  const protocolRoots = normalizedUnique(
    ROOT_ROLES.map((role) => contracts[role])
      .filter(
        (value) =>
          typeof value === "string" &&
          value.toLowerCase() !== "0x0000000000000000000000000000000000000000",
      )
      .map((value) => getAddress(value)),
  ).map((value) => getAddress(value));
  if (protocolRoots.length < 10) {
    throw new Error("Schema-18 scoped indexing roots are incomplete");
  }
  for (const root of protocolRoots) {
    if (externalAddresses.has(root.toLowerCase())) {
      throw new Error(`External dependency entered protocol roots: ${root}`);
    }
  }
  const policy = {
    version: 1,
    protocolRoots,
    launchCoordinator,
    launchEventTopics: [toEventSelector(launchEvent)],
    poolManager,
    poolEventTopics: poolEvents.map((event) => toEventSelector(event)),
    addressBatchSize: 128,
    poolIdBatchSize: 64,
  };
  return {
    ...policy,
    policyHash: schema18IndexingPolicyHash(policy),
  };
}

export const schema18IndexingPolicyRoles = {
  protocolRoots: [...ROOT_ROLES],
  excludedExternalSources: [...EXTERNAL_ROLES],
};
