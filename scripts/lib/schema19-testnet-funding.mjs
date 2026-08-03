const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const SCHEMA19_TESTNET_RESERVE_WEI = 1_500_000_000_000_000n;
export const SCHEMA19_TESTNET_L1_DATA_FEE_RESERVE_WEI = 25_000_000_000_000n;
export const SCHEMA19_TESTNET_PRINCIPAL_WEI = 10_000_000_000_000_000n;
export const SCHEMA19_TESTNET_ROUTE_WORKING_CAPITAL_WEI = 6_000_000_000_000n;

export const SCHEMA19_TESTNET_LIFECYCLE_SCHEDULE = Object.freeze([
  { phase: "route-round-trips", count: 12, gasCeiling: 1_500_000n },
  { phase: "launch", count: 1, gasCeiling: 6_000_000n },
  { phase: "bonding", count: 12, gasCeiling: 1_500_000n },
  { phase: "graduation", count: 1, gasCeiling: 8_000_000n },
  { phase: "post-graduation-trading", count: 4, gasCeiling: 2_000_000n },
  { phase: "maintenance-and-settlement", count: 12, gasCeiling: 2_000_000n },
  {
    phase: "failed-leg-and-manual-processing",
    count: 4,
    gasCeiling: 2_000_000n,
  },
  { phase: "claims", count: 4, gasCeiling: 1_700_000n },
  { phase: "reconciliation-controls", count: 2, gasCeiling: 1_000_000n },
]);

const asBigInt = (value, label) => {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${label} is not an integer`);
  }
};

export function validateSchema19ForgeLedger(ledger, prepared) {
  assert(
    prepared?.schemaVersion === 19 && prepared.chainId === 46630,
    "accelerated Schema-19 Testnet manifest required",
  );
  const transactions = ledger?.transactions;
  const receipts = ledger?.receipts;
  assert(
    Array.isArray(transactions) && Array.isArray(receipts),
    "Forge transaction and receipt arrays required",
  );
  const expectedCount =
    Number(prepared.deployment.fullEndingNonceExclusive) -
    Number(prepared.deployment.startingNonce);
  assert(expectedCount > 0, "full deployment nonce range required");
  assert(
    transactions.length === expectedCount,
    "deployment transaction count mismatch",
  );
  assert(
    receipts.length === expectedCount,
    "deployment receipt count mismatch",
  );
  const receiptByHash = new Map();
  let deploymentGasUsed = 0n;
  for (const receipt of receipts) {
    assert(receipt.status === "0x1", "failed deployment receipt");
    assert(
      /^0x[0-9a-fA-F]{64}$/.test(receipt.transactionHash ?? ""),
      "invalid deployment receipt hash",
    );
    assert(
      !receiptByHash.has(receipt.transactionHash.toLowerCase()),
      "reused deployment receipt hash",
    );
    const gasUsed = asBigInt(receipt.gasUsed, "receipt gasUsed");
    const effectiveGasPrice = asBigInt(
      receipt.effectiveGasPrice,
      "receipt effectiveGasPrice",
    );
    assert(
      gasUsed > 0n && effectiveGasPrice > 0n,
      "incomplete deployment gas fields",
    );
    receiptByHash.set(receipt.transactionHash.toLowerCase(), receipt);
    deploymentGasUsed += gasUsed;
  }
  const nonces = [];
  for (const entry of transactions) {
    const hash = entry.hash?.toLowerCase();
    assert(
      hash && receiptByHash.has(hash),
      "deployment transaction receipt missing",
    );
    nonces.push(
      Number(asBigInt(entry.transaction?.nonce, "transaction nonce")),
    );
  }
  nonces.sort((left, right) => left - right);
  for (let index = 0; index < nonces.length; index += 1) {
    assert(
      nonces[index] === Number(prepared.deployment.startingNonce) + index,
      "deployment nonce range is not contiguous",
    );
  }
  return { transactionCount: transactions.length, deploymentGasUsed };
}

export function calculateSchema19TestnetFunding({
  ledger,
  prepared,
  balanceWei,
  baseFeeWei,
  gasPriceWei,
  priorityFeeWei,
}) {
  const validated = validateSchema19ForgeLedger(ledger, prepared);
  const balance = asBigInt(balanceWei, "balanceWei");
  const baseFee = asBigInt(baseFeeWei, "baseFeeWei");
  const gasPrice = asBigInt(gasPriceWei, "gasPriceWei");
  const priority = asBigInt(priorityFeeWei, "priorityFeeWei");
  const doubledBaseEnvelope = 2n * baseFee + priority;
  const observedEnvelope =
    gasPrice > doubledBaseEnvelope ? gasPrice : doubledBaseEnvelope;
  const pinnedMaxFeePerGas = (observedEnvelope * 125n + 99n) / 100n;
  const lifecycleGasUnits = SCHEMA19_TESTNET_LIFECYCLE_SCHEDULE.reduce(
    (total, item) => total + BigInt(item.count) * item.gasCeiling,
    0n,
  );
  const lifecycleTransactionCount = SCHEMA19_TESTNET_LIFECYCLE_SCHEDULE.reduce(
    (total, item) => total + item.count,
    0,
  );
  const allGasUnits = validated.deploymentGasUsed + lifecycleGasUnits;
  const allTransactionCount =
    validated.transactionCount + lifecycleTransactionCount;
  const rawTransactionBudget =
    allGasUnits * pinnedMaxFeePerGas +
    BigInt(allTransactionCount) * SCHEMA19_TESTNET_L1_DATA_FEE_RESERVE_WEI;
  const transactionBudgetWithCampaignHeadroom =
    (rawTransactionBudget * 125n + 99n) / 100n;
  const requiredBalance =
    SCHEMA19_TESTNET_RESERVE_WEI +
    SCHEMA19_TESTNET_PRINCIPAL_WEI +
    SCHEMA19_TESTNET_ROUTE_WORKING_CAPITAL_WEI +
    transactionBudgetWithCampaignHeadroom;
  return {
    deploymentTransactionCount: validated.transactionCount,
    deploymentGasUsed: validated.deploymentGasUsed,
    lifecycleTransactionCount,
    lifecycleGasUnits,
    pinnedMaxFeePerGas,
    l1DataFeeReservePerTransaction: SCHEMA19_TESTNET_L1_DATA_FEE_RESERVE_WEI,
    transactionBudgetWithCampaignHeadroom,
    reserveWei: SCHEMA19_TESTNET_RESERVE_WEI,
    principalWei: SCHEMA19_TESTNET_PRINCIPAL_WEI,
    routeWorkingCapitalWei: SCHEMA19_TESTNET_ROUTE_WORKING_CAPITAL_WEI,
    requiredBalance,
    availableBalance: balance,
    margin: balance - requiredBalance,
    passed: balance >= requiredBalance,
  };
}
