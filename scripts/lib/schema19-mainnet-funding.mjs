const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const integer = (value, label) => {
  try { return BigInt(value); } catch { throw new Error(`${label} is not an integer`); }
};

export const SCHEMA19_MAINNET_RESERVE_WEI = 20_000_000_000_000_000n;
export const SCHEMA19_MAINNET_L1_DATA_FEE_RESERVE_WEI = 25_000_000_000_000n;

const validateReceipts = (receipts, expectedCount, label) => {
  assert(Array.isArray(receipts) && receipts.length === expectedCount, `${label} receipt count mismatch`);
  const hashes = new Set();
  let gasUsed = 0n;
  for (const receipt of receipts) {
    const status = receipt.status;
    assert(status === "0x1" || status === "success", `${label} contains a failed receipt`);
    const hash = receipt.transactionHash?.toLowerCase();
    assert(/^0x[0-9a-f]{64}$/.test(hash ?? "") && !hashes.has(hash), `${label} receipt hash invalid or reused`);
    hashes.add(hash);
    const gas = integer(receipt.gasUsed, `${label} gasUsed`);
    assert(gas > 0n, `${label} gasUsed missing`);
    gasUsed += gas;
  }
  return { count: receipts.length, gasUsed };
};

export function calculateSchema19MainnetFunding({
  deploymentLedger,
  retirementLedger,
  lifecycleJournal,
  balanceWei,
  baseFeeWei,
  gasPriceWei,
  priorityFeeWei,
}) {
  const deployment = validateReceipts(deploymentLedger?.receipts, 36, "Schema-19 deployment");
  const retirement = validateReceipts(retirementLedger?.receipts, 9, "Schema-18 retirement");
  const emergencyReceipts = lifecycleJournal.filter(
    (entry) => entry.type === "receipt" && entry.phase === "shutdown",
  );
  assert(emergencyReceipts.length > 0, "Schema-19 emergency shutdown receipts missing");
  const emergency = validateReceipts(emergencyReceipts, emergencyReceipts.length, "Schema-19 emergency shutdown");
  const balance = integer(balanceWei, "balanceWei");
  const baseFee = integer(baseFeeWei, "baseFeeWei");
  const gasPrice = integer(gasPriceWei, "gasPriceWei");
  const priority = integer(priorityFeeWei, "priorityFeeWei");
  const envelope = gasPrice > 2n * baseFee + priority ? gasPrice : 2n * baseFee + priority;
  const pinnedMaxFeePerGas = (envelope * 125n + 99n) / 100n;
  const transactionCount = deployment.count + retirement.count + emergency.count;
  const gasUnits = deployment.gasUsed + retirement.gasUsed + emergency.gasUsed;
  const rawBudget = gasUnits * pinnedMaxFeePerGas +
    BigInt(transactionCount) * SCHEMA19_MAINNET_L1_DATA_FEE_RESERVE_WEI;
  const transactionBudgetWithHeadroom = (rawBudget * 150n + 99n) / 100n;
  const requiredBalance = SCHEMA19_MAINNET_RESERVE_WEI + transactionBudgetWithHeadroom;
  return {
    deploymentTransactionCount: deployment.count,
    deploymentGasUsed: deployment.gasUsed,
    retirementTransactionCount: retirement.count,
    retirementGasUsed: retirement.gasUsed,
    emergencyTransactionCount: emergency.count,
    emergencyGasUsed: emergency.gasUsed,
    totalTransactionCount: transactionCount,
    totalGasUnits: gasUnits,
    pinnedMaxFeePerGas,
    l1DataFeeReservePerTransaction: SCHEMA19_MAINNET_L1_DATA_FEE_RESERVE_WEI,
    transactionBudgetWithHeadroom,
    reserveWei: SCHEMA19_MAINNET_RESERVE_WEI,
    requiredBalance,
    availableBalance: balance,
    margin: balance - requiredBalance,
    bridgeShortfall: balance >= requiredBalance ? 0n : requiredBalance - balance,
    passed: balance >= requiredBalance,
  };
}
