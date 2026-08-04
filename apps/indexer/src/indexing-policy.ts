import { createHash } from "node:crypto";
import type { Address, Hex } from "viem";

const zeroAddress = "0x0000000000000000000000000000000000000000";
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const topicPattern = /^0x[0-9a-fA-F]{64}$/;
const requiredLaunchEventTopics = [
  "0xd74962c237728681433889a5419834cff77965f55668fb014ee28925e2cef5f1",
];
const requiredPoolEventTopics = [
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
  "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec",
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
  "0x29ef05caaff9404b7cb6d1c0e9bbae9eaa7ab2541feba1a9c4248594c08156cb",
];

export type IndexingPolicy = {
  version: 1;
  protocolRoots: Address[];
  launchCoordinator: Address;
  launchEventTopics: Hex[];
  poolManager: Address;
  poolEventTopics: Hex[];
  addressBatchSize: number;
  poolIdBatchSize: number;
  policyHash: string;
};

export type IndexingPolicyManifest = {
  schemaVersion?: number;
  contracts: Record<string, Address | Address[] | undefined>;
  indexingPolicy?: IndexingPolicy;
};

const externalContractRoles = [
  "baseAsset",
  "wrappedNative",
  "rewardAssets",
  "poolManager",
  "positionManager",
  "quoter",
  "universalRouter",
  "permit2",
  "stateView",
] as const;

function normalizedUnique(values: string[]) {
  return [...new Set(values.map((value) => value.toLowerCase()))].sort();
}

function assertAddress(value: string, label: string) {
  if (!addressPattern.test(value) || value.toLowerCase() === zeroAddress) {
    throw new Error(`${label} must be a nonzero address`);
  }
}

function assertTopic(value: string, label: string) {
  if (!topicPattern.test(value)) {
    throw new Error(`${label} must be a bytes32 topic`);
  }
}

function hashPayload(policy: Omit<IndexingPolicy, "policyHash">) {
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

export function indexingPolicyHash(policy: Omit<IndexingPolicy, "policyHash">) {
  return createHash("sha256").update(hashPayload(policy)).digest("hex");
}

export function chunkValues<T>(values: T[], size: number) {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Indexing batch size must be a positive integer");
  }
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }
  return chunks;
}

export function uniqueLogs<
  T extends { transactionHash: Hex | null; logIndex: number | null },
>(logs: T[]) {
  return [
    ...new Map(
      logs.map((log) => {
        if (!log.transactionHash || log.logIndex === null) {
          throw new Error("Scoped log is missing its canonical identity");
        }
        return [`${log.transactionHash.toLowerCase()}:${log.logIndex}`, log];
      }),
    ).values(),
  ];
}

export function backfillAllowed(
  start: bigint,
  head: bigint,
  diskUtilizationPercent: number,
  maximumLiveLagBlocks: bigint,
) {
  if (!Number.isFinite(diskUtilizationPercent)) {
    throw new Error("Disk utilization must be finite");
  }
  if (start > head) return true;
  const pendingBlocks = head - start + 1n;
  return diskUtilizationPercent < 85 || pendingBlocks <= maximumLiveLagBlocks;
}

export function validateIndexingPolicy(manifest: IndexingPolicyManifest) {
  if (manifest.schemaVersion !== 19 && manifest.schemaVersion !== 20) {
    throw new Error("Scoped indexer requires a Schema-19 or Schema-20 manifest");
  }
  const policy = manifest.indexingPolicy;
  if (!policy || policy.version !== 1) {
    throw new Error("Schema-19/20 indexing policy version 1 is required");
  }
  if (policy.protocolRoots.length === 0) {
    throw new Error("Indexing policy requires protocol roots");
  }
  for (const [index, address] of policy.protocolRoots.entries()) {
    assertAddress(address, `protocolRoots[${index}]`);
  }
  const normalizedRoots = normalizedUnique(policy.protocolRoots);
  if (normalizedRoots.length !== policy.protocolRoots.length) {
    throw new Error("Indexing policy protocol roots must be unique");
  }
  assertAddress(policy.launchCoordinator, "launchCoordinator");
  assertAddress(policy.poolManager, "poolManager");
  for (const [index, topic] of policy.launchEventTopics.entries()) {
    assertTopic(topic, `launchEventTopics[${index}]`);
  }
  for (const [index, topic] of policy.poolEventTopics.entries()) {
    assertTopic(topic, `poolEventTopics[${index}]`);
  }
  if (
    normalizedUnique(policy.launchEventTopics).join(",") !==
      normalizedUnique(requiredLaunchEventTopics).join(",") ||
    normalizedUnique(policy.poolEventTopics).join(",") !==
      normalizedUnique(requiredPoolEventTopics).join(",")
  ) {
    throw new Error("Schema-19/20 indexing event identity mismatch");
  }
  for (const [label, size] of [
    ["addressBatchSize", policy.addressBatchSize],
    ["poolIdBatchSize", policy.poolIdBatchSize],
  ] as const) {
    if (!Number.isSafeInteger(size) || size <= 0 || size > 256) {
      throw new Error(`${label} must be between 1 and 256`);
    }
  }
  const coordinator = manifest.contracts.atomicLaunchCoordinator;
  if (
    typeof coordinator !== "string" ||
    coordinator.toLowerCase() !== policy.launchCoordinator.toLowerCase()
  ) {
    throw new Error("Indexing policy launch coordinator mismatch");
  }
  const poolManager = manifest.contracts.poolManager;
  if (
    typeof poolManager !== "string" ||
    poolManager.toLowerCase() !== policy.poolManager.toLowerCase()
  ) {
    throw new Error("Indexing policy PoolManager mismatch");
  }
  const externalAddresses = new Set(
    externalContractRoles.flatMap((role) => {
      const value = manifest.contracts[role];
      return (Array.isArray(value) ? value : [value])
        .filter((entry): entry is Address => typeof entry === "string")
        .map((entry) => entry.toLowerCase())
        .filter((entry) => entry !== zeroAddress);
    }),
  );
  for (const root of normalizedRoots) {
    if (externalAddresses.has(root)) {
      throw new Error(`External dependency entered indexing roots: ${root}`);
    }
  }
  if (manifest.schemaVersion === 20) {
    for (const role of ["rdaoSale", "rdaoStaking", "rdaoLiquidityLocker"] as const) {
      const value = manifest.contracts[role];
      if (typeof value !== "string" || !normalizedRoots.includes(value.toLowerCase())) {
        throw new Error(`Schema-20 indexing roots must include ${role}`);
      }
    }
  }
  const expectedHash = indexingPolicyHash({
    version: policy.version,
    protocolRoots: policy.protocolRoots,
    launchCoordinator: policy.launchCoordinator,
    launchEventTopics: policy.launchEventTopics,
    poolManager: policy.poolManager,
    poolEventTopics: policy.poolEventTopics,
    addressBatchSize: policy.addressBatchSize,
    poolIdBatchSize: policy.poolIdBatchSize,
  });
  if (expectedHash !== policy.policyHash.toLowerCase()) {
    throw new Error("Indexing policy hash mismatch");
  }
  return {
    ...policy,
    protocolRoots: normalizedRoots as Address[],
    launchEventTopics: normalizedUnique(policy.launchEventTopics) as Hex[],
    poolEventTopics: normalizedUnique(policy.poolEventTopics) as Hex[],
    policyHash: expectedHash,
  };
}
