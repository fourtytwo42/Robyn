const BPS = 10_000n;

export const REQUIRED_MAINNET_GAS_PHASES = Object.freeze([
  "deployment",
  "bindings",
  "canary-activation",
  "canary-launch",
  "bonding-graduation",
  "post-graduation-trades",
  "fee-settlement",
  "reward-claims",
  "profile-governance",
  "canary-unwind",
  "post-unwind-settlement",
]);

function asNonNegativeBigInt(value, name) {
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new TypeError(`${name} must be an integer`);
  }
  if (parsed < 0n) throw new RangeError(`${name} must be non-negative`);
  return parsed;
}

function multiplyBpsCeil(value, multiplierBps) {
  return (value * multiplierBps + BPS - 1n) / BPS;
}

export function summarizeMainnetGasEvidence(evidence) {
  if (Number(evidence?.chainId) !== 4663) {
    throw new Error("gas evidence must be for Robinhood Mainnet chain 4663");
  }
  if (
    evidence?.executionMode !== "local-fork-broadcast" ||
    !/^[1-9][0-9]*$/.test(String(evidence?.forkBlock ?? "")) ||
    !/^[0-9a-f]{40}$/i.test(String(evidence?.releaseSha ?? "")) ||
    !/^0x[0-9a-f]{64}$/i.test(String(evidence?.productionConfigHash ?? ""))
  ) {
    throw new Error(
      "gas evidence is not an exact pinned-release fork rehearsal",
    );
  }
  if (
    !Array.isArray(evidence?.transactions) ||
    evidence.transactions.length === 0
  ) {
    throw new Error("gas evidence must contain real fork transaction receipts");
  }
  const identities = new Set();
  const phases = new Set();
  let deploymentGas = 0n;
  let canaryGas = 0n;
  for (const [index, transaction] of evidence.transactions.entries()) {
    const id = String(transaction.idempotencyKey ?? "");
    if (!id || identities.has(id)) {
      throw new Error(
        `duplicate or missing idempotency key at transaction ${index}`,
      );
    }
    identities.add(id);
    if (transaction.receiptStatus !== "success") {
      throw new Error(`transaction ${id} did not succeed`);
    }
    if (
      !/^0x[0-9a-f]{64}$/i.test(String(transaction.transactionHash ?? "")) ||
      !/^[1-9][0-9]*$/.test(String(transaction.blockNumber ?? ""))
    ) {
      throw new Error(`transaction ${id} is missing a fork receipt identity`);
    }
    const phase = String(transaction.phase ?? "");
    phases.add(phase);
    const gasUsed = asNonNegativeBigInt(transaction.gasUsed, `${id}.gasUsed`);
    if (gasUsed === 0n) throw new Error(`transaction ${id} has zero gas`);
    if (transaction.category === "deployment") deploymentGas += gasUsed;
    else if (transaction.category === "canary") canaryGas += gasUsed;
    else throw new Error(`transaction ${id} has an invalid category`);
  }
  const missingPhases = REQUIRED_MAINNET_GAS_PHASES.filter(
    (phase) => !phases.has(phase),
  );
  if (missingPhases.length > 0) {
    throw new Error(
      `gas evidence is missing phases: ${missingPhases.join(", ")}`,
    );
  }
  if (deploymentGas === 0n || canaryGas === 0n) {
    throw new Error("deployment and canary gas must both be measured");
  }
  return {
    transactionCount: evidence.transactions.length,
    deploymentGas,
    canaryGas,
    totalGas: deploymentGas + canaryGas,
  };
}

export function calculateMainnetFundingGate({
  approvedCeilingWei,
  currentL1BalanceWei,
  currentL2BalanceWei = 0n,
  bridgeGasEstimate,
  bridgeMaxFeePerGasWei,
  l2GasPriceWei,
  gasEvidence,
  l1EmergencyReserveWei = 10_000_000_000_000_000n,
  l2OperationalReserveWei = 20_000_000_000_000_000n,
  canaryPrincipalWei = 10_000_000_000_000_000n,
  l2HeadroomBps = 15_000n,
  bridgeHeadroomBps = 20_000n,
}) {
  const ceiling = asNonNegativeBigInt(approvedCeilingWei, "approvedCeilingWei");
  const l1Balance = asNonNegativeBigInt(
    currentL1BalanceWei,
    "currentL1BalanceWei",
  );
  const l2Balance = asNonNegativeBigInt(
    currentL2BalanceWei,
    "currentL2BalanceWei",
  );
  const bridgeGas = asNonNegativeBigInt(bridgeGasEstimate, "bridgeGasEstimate");
  const bridgeFee = asNonNegativeBigInt(
    bridgeMaxFeePerGasWei,
    "bridgeMaxFeePerGasWei",
  );
  const l2GasPrice = asNonNegativeBigInt(l2GasPriceWei, "l2GasPriceWei");
  const l1Reserve = asNonNegativeBigInt(
    l1EmergencyReserveWei,
    "l1EmergencyReserveWei",
  );
  const l2Reserve = asNonNegativeBigInt(
    l2OperationalReserveWei,
    "l2OperationalReserveWei",
  );
  const canaryPrincipal = asNonNegativeBigInt(
    canaryPrincipalWei,
    "canaryPrincipalWei",
  );
  const l2Headroom = asNonNegativeBigInt(l2HeadroomBps, "l2HeadroomBps");
  const bridgeHeadroom = asNonNegativeBigInt(
    bridgeHeadroomBps,
    "bridgeHeadroomBps",
  );
  if (l2Headroom < BPS || bridgeHeadroom < BPS) {
    throw new RangeError("funding headroom cannot be below 100 percent");
  }
  if (l1Balance > ceiling) {
    throw new Error("current L1 balance exceeds the approved funding ceiling");
  }
  const gas = summarizeMainnetGasEvidence(gasEvidence);
  const deploymentCostWei = multiplyBpsCeil(
    gas.deploymentGas * l2GasPrice,
    l2Headroom,
  );
  const canaryCostWei = multiplyBpsCeil(gas.canaryGas * l2GasPrice, l2Headroom);
  const bridgeCostWei = multiplyBpsCeil(bridgeGas * bridgeFee, bridgeHeadroom);
  const l2RequiredBeforeExistingBalance =
    l2Reserve + canaryPrincipal + deploymentCostWei + canaryCostWei;
  const bridgeAmountWei =
    l2RequiredBeforeExistingBalance > l2Balance
      ? l2RequiredBeforeExistingBalance - l2Balance
      : 0n;
  const totalRequiredL1Wei = l1Reserve + bridgeCostWei + bridgeAmountWei;
  const projectedL1RemainingWei =
    l1Balance >= bridgeCostWei + bridgeAmountWei
      ? l1Balance - bridgeCostWei - bridgeAmountWei
      : 0n;
  const passed =
    l1Balance <= ceiling &&
    l1Balance >= totalRequiredL1Wei &&
    projectedL1RemainingWei >= l1Reserve;
  return {
    passed,
    approvedCeilingWei: ceiling,
    currentL1BalanceWei: l1Balance,
    currentL2BalanceWei: l2Balance,
    bridgeGasEstimate: bridgeGas,
    bridgeMaxFeePerGasWei: bridgeFee,
    bridgeCostWei,
    deploymentGas: gas.deploymentGas,
    canaryGas: gas.canaryGas,
    totalMeasuredL2Gas: gas.totalGas,
    deploymentCostWei,
    canaryCostWei,
    l1EmergencyReserveWei: l1Reserve,
    l2OperationalReserveWei: l2Reserve,
    canaryPrincipalWei: canaryPrincipal,
    l2RequiredBeforeExistingBalance,
    bridgeAmountWei,
    totalRequiredL1Wei,
    projectedL1RemainingWei,
    shortfallWei: passed
      ? 0n
      : totalRequiredL1Wei > l1Balance
        ? totalRequiredL1Wei - l1Balance
        : 0n,
    transactionCount: gas.transactionCount,
  };
}

export function jsonMainnetFundingGate(result) {
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [
      key,
      typeof value === "bigint" ? value.toString() : value,
    ]),
  );
}
