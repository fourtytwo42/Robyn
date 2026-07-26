export type KingOfForestPolicy = {
  version: string;
  activationBlock: number;
  progressThresholdBps: number;
  minimumUniqueTraders: number;
};

export type KingQualification = {
  blockNumber: bigint;
  progressBps: number;
  uniqueTraders: number;
  alreadyAwarded: boolean;
  hasQualifyingTrade: boolean;
};

export function validateKingOfForestPolicy(policy: KingOfForestPolicy) {
  if (!policy.version.trim())
    throw new Error("King policy version is required");
  if (
    !Number.isSafeInteger(policy.activationBlock) ||
    policy.activationBlock < 0
  )
    throw new Error("King policy activation block is invalid");
  if (
    !Number.isInteger(policy.progressThresholdBps) ||
    policy.progressThresholdBps < 1 ||
    policy.progressThresholdBps > 10_000
  )
    throw new Error("King policy progress threshold is invalid");
  if (
    !Number.isInteger(policy.minimumUniqueTraders) ||
    policy.minimumUniqueTraders < 1
  )
    throw new Error("King policy trader threshold is invalid");
  return policy;
}

export function qualifiesForKingOfForest(
  policy: KingOfForestPolicy,
  state: KingQualification,
) {
  return (
    !state.alreadyAwarded &&
    state.hasQualifyingTrade &&
    state.blockNumber >= BigInt(policy.activationBlock) &&
    state.progressBps >= policy.progressThresholdBps &&
    state.uniqueTraders >= policy.minimumUniqueTraders
  );
}

export function shouldCountKingTrader(
  trader: string,
  systemAccounts: ReadonlySet<string>,
) {
  const normalized = trader.toLowerCase();
  return (
    /^0x[0-9a-f]{40}$/.test(normalized) &&
    normalized !== "0x0000000000000000000000000000000000000000" &&
    !systemAccounts.has(normalized)
  );
}

export type KingAwardOrder = {
  awardedBlock: bigint;
  transactionIndex: number;
  logIndex: number;
  token: string;
};

export function compareKingAwardNewestFirst(
  left: KingAwardOrder,
  right: KingAwardOrder,
) {
  if (left.awardedBlock !== right.awardedBlock)
    return left.awardedBlock > right.awardedBlock ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex)
    return right.transactionIndex - left.transactionIndex;
  if (left.logIndex !== right.logIndex) return right.logIndex - left.logIndex;
  return right.token.toLowerCase().localeCompare(left.token.toLowerCase());
}
