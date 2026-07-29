export const REQUIRED_WALLET_COUNT = 100;
export const REQUIRED_LAUNCH_COUNT = 8;
export const REQUIRED_GRADUATED_COUNT = 3;
export const REQUIRED_SUCCESSFUL_WRITES = 1_500;
export const PRICED_TRANSACTION_COUNT = 2_625;
export const PLANNED_SWEEP_GAS_UNITS_PER_ACTOR = 1_600_000n;
export const REQUIRED_RESERVE_WEI = 1_500_000_000_000_000n;
export const REQUIRED_DISK_HEADROOM_BYTES = 5n * 1024n * 1024n * 1024n;
export const REQUIRED_HEADROOM_BPS = 2_500n;
export const KEEPER_MINIMUM_OPERATOR_BALANCE_WEI = 250_000_000_000_000n;
export const KEEPER_MINIMUM_CAMPAIGN_TARGET_WEI = 1_000_000_000_000_000n;
export const KEEPER_PRICED_TRANSACTION_COUNT = 900;
export const KEEPER_AVERAGE_GAS_PER_TRANSACTION = 150_000n;
export const KEEPER_AVERAGE_CALLDATA_BYTES = 256n;
export const V4_FEE_COLLECTION_MINIMUMS = [0n, 0n];
export const V4_ORACLE_WINDOW_MATURITY_SECONDS = 301;
export const MAXIMUM_GRADUATION_TOPUP_WEI = 100_000_000_000_000n;

export function graduationActorIndex(launchIndex) {
  if (
    !Number.isInteger(launchIndex) ||
    launchIndex < 0 ||
    launchIndex >= REQUIRED_GRADUATED_COUNT
  ) {
    throw new Error(
      "Graduated launch index is outside the fixed campaign plan",
    );
  }
  return 96 + launchIndex;
}
export function graduationTopupValueWei({
  thresholdWei,
  raisedWei,
  feeBps,
  maximumCurvePurchaseWei,
}) {
  const threshold = BigInt(thresholdWei);
  const raised = BigInt(raisedWei);
  const fee = BigInt(feeBps);
  const maximumPurchase = BigInt(maximumCurvePurchaseWei);
  if (
    threshold <= 0n ||
    raised < 0n ||
    fee < 0n ||
    fee >= 10_000n ||
    maximumPurchase <= 0n
  ) {
    throw new Error("Graduation top-up inputs are invalid");
  }
  if (raised >= threshold) return 0n;
  const requiredNetWei = threshold - raised;
  const grossWei =
    (requiredNetWei * 10_000n + (10_000n - fee) - 1n) / (10_000n - fee);
  if (grossWei > maximumPurchase || grossWei > MAXIMUM_GRADUATION_TOPUP_WEI) {
    throw new Error("Graduation top-up exceeds the fixed campaign bound");
  }
  return grossWei;
}

export function basketConversionActorIndex(launchIndex, legIndex) {
  if (
    !Number.isInteger(launchIndex) ||
    launchIndex < 0 ||
    launchIndex >= REQUIRED_LAUNCH_COUNT ||
    !Number.isInteger(legIndex) ||
    legIndex < 0 ||
    legIndex >= 3
  ) {
    throw new Error("Basket conversion is outside the fixed campaign plan");
  }
  return 96 + ((launchIndex * 3 + legIndex) % REQUIRED_GRADUATED_COUNT);
}

export function assertSecurityRemediationManifest(manifest) {
  if (manifest?.schemaVersion !== 12 || manifest?.chainId !== 46630) {
    throw new Error(
      "Campaign requires a schema-12 security-remediated chain-46630 manifest",
    );
  }
  if (
    manifest.governanceProfile !== "robinhood-testnet-short-assurance" ||
    manifest.dao?.governance?.votingDelaySeconds !== 600 ||
    manifest.dao?.governance?.votingPeriodSeconds !== 1800 ||
    manifest.dao?.governance?.timelockSeconds !== 600
  ) {
    throw new Error(
      "Campaign requires the reviewed shortened testnet governance profile",
    );
  }
  if (
    !Array.isArray(manifest.assetRoutes) ||
    manifest.assetRoutes.length !== 11
  ) {
    throw new Error(
      "Campaign requires exactly 11 individually qualified basket routes",
    );
  }
  const requiredContracts = [
    "atomicLaunchCoordinator",
    "launchFactory",
    "marketFactory",
    "protocolFeeRouter",
    "oracleHook",
    "assetRouter",
    "quoter",
    "universalRouter",
    "permit2",
    "daoToken",
    "governor",
    "timelock",
    "guardian",
  ];
  for (const key of requiredContracts) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(manifest.contracts?.[key] ?? "")) {
      throw new Error(`Campaign manifest is missing ${key}`);
    }
  }
  return manifest;
}

export function launchBasketPlan(manifest) {
  assertSecurityRemediationManifest(manifest);
  const addresses = manifest.assetRoutes.map((route) => route.address);
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== 11) {
    throw new Error("Campaign route catalog contains duplicate addresses");
  }
  const routeKinds = manifest.assetRoutes.map(
    (route) => route.routeKind ?? "canonical-v4-single-hop",
  );
  if (
    routeKinds.filter((kind) => kind === "canonical-v4-single-hop").length !==
      4 ||
    routeKinds.filter((kind) => kind === "wrapped-native").length !== 1 ||
    routeKinds.filter((kind) => kind === "pinned-adapter").length !== 6
  ) {
    throw new Error(
      "Campaign requires four v4, one WETH, and six pinned-adapter routes",
    );
  }
  // Eight three-leg launches still exercise 24 conversions, but schema-12 has
  // eleven individually qualified assets. Cycle deterministically after every
  // asset has appeared once so every route class is covered without inventing
  // extra assets.
  const orderedRoutes = Array.from(
    { length: REQUIRED_LAUNCH_COUNT * 3 },
    (_, index) => manifest.assetRoutes[index % manifest.assetRoutes.length],
  );
  return Array.from({ length: REQUIRED_LAUNCH_COUNT }, (_, index) => ({
    index,
    name: `Sherwood Automated Test ${index + 1}`,
    symbol: `SAT${index + 1}`,
    assets: orderedRoutes
      .slice(index * 3, index * 3 + 3)
      .map((route) => route.address),
    weights: [3334, 3333, 3333],
    shouldGraduate: index < REQUIRED_GRADUATED_COUNT,
  }));
}

export function minimumActionInventory() {
  return {
    launches: 8,
    buys: 900,
    tokenTransfers: 200,
    approvals: 150,
    sells: 150,
    externalLiquidity: 6,
    universalRouterSwaps: 4,
    hookSettlements: 6,
    basketConversions: 24,
    holderClaims: 20,
    creatorClaims: 8,
    rdaoTransfers: 10,
    delegations: 10,
    governanceMinimum: 20,
  };
}

export function minimumActionCount() {
  return Object.values(minimumActionInventory()).reduce(
    (total, count) => total + count,
    0,
  );
}

export function plannedTransactionValueWei() {
  let value = 0n;
  for (let index = 0; index < 900; index += 1) {
    value += plannedBuyValueWei(index);
  }
  value += 3n * MAXIMUM_GRADUATION_TOPUP_WEI;
  value += 3n * 250_000_000_000n;
  value += 2n * 20_000_000_000n;
  value += 100_000_000_000n + 250_000_000_000_000n;
  value += 10n * 200_000_000_000n;
  return value;
}

export function plannedWalletValueWei(actorIndex) {
  if (
    !Number.isInteger(actorIndex) ||
    actorIndex < 0 ||
    actorIndex >= REQUIRED_WALLET_COUNT
  ) {
    throw new Error("Actor index is outside the fixed campaign plan");
  }
  let value = 0n;
  for (let index = actorIndex; index < 900; index += REQUIRED_WALLET_COUNT) {
    value += plannedBuyValueWei(index);
  }
  if (actorIndex >= 96 && actorIndex <= 98) {
    value += MAXIMUM_GRADUATION_TOPUP_WEI;
  }
  if (actorIndex >= 90 && actorIndex <= 92) value += 250_000_000_000n;
  if (actorIndex === 96 || actorIndex === 97) value += 20_000_000_000n;
  if (actorIndex === 99) {
    value += 100_000_000_000n + 250_000_000_000_000n;
  }
  if (actorIndex < 10) value += 200_000_000_000n;
  return value;
}

export function plannedBuyValueWei(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 900) {
    throw new Error("Buy index is outside the fixed campaign plan");
  }
  const launchIndex = index % REQUIRED_LAUNCH_COUNT;
  if (launchIndex >= REQUIRED_GRADUATED_COUNT) {
    return BigInt(launchIndex - 2) * 400_000_000_000n;
  }
  return index === 896 + launchIndex
    ? 250_000_000_000_000n
    : 11_000_000_000_000n;
}

export function weightedWalletFunding(campaignBudgetWei, topups) {
  if (
    campaignBudgetWei <= 0n ||
    !Array.isArray(topups) ||
    topups.length === 0
  ) {
    throw new Error("Wallet funding budgets must be positive");
  }
  const seen = new Set();
  const byIndex = new Map();
  let topupTotalWei = 0n;
  for (const topup of topups) {
    if (
      !Number.isInteger(topup.index) ||
      topup.index < 0 ||
      topup.index >= REQUIRED_WALLET_COUNT ||
      topup.amountWei <= 0n ||
      seen.has(topup.index)
    ) {
      throw new Error("Wallet funding top-ups are invalid or duplicated");
    }
    seen.add(topup.index);
    byIndex.set(topup.index, topup.amountWei);
    topupTotalWei += topup.amountWei;
  }
  if (topupTotalWei >= campaignBudgetWei) {
    throw new Error("Weighted top-ups consume the complete campaign budget");
  }
  const sharedBudget = campaignBudgetWei - topupTotalWei;
  const basePerWalletWei =
    (sharedBudget + BigInt(REQUIRED_WALLET_COUNT) - 1n) /
    BigInt(REQUIRED_WALLET_COUNT);
  return {
    basePerWalletWei,
    topups,
    topupTotalWei,
    walletBudgetsWei: Array.from(
      { length: REQUIRED_WALLET_COUNT },
      (_, index) => basePerWalletWei + (byIndex.get(index) ?? 0n),
    ),
    allocatedWei:
      basePerWalletWei * BigInt(REQUIRED_WALLET_COUNT) + topupTotalWei,
  };
}

export function applyHeadroom(value, headroomBps = REQUIRED_HEADROOM_BPS) {
  if (value < 0n || headroomBps < REQUIRED_HEADROOM_BPS) {
    throw new Error("Cost headroom must be at least 25%");
  }
  return value + (value * headroomBps + 9_999n) / 10_000n;
}

export function transactionGasLimit(estimatedGasUnits) {
  if (estimatedGasUnits < 0n) {
    throw new Error("Estimated transaction gas cannot be negative");
  }
  return estimatedGasUnits * 2n;
}

export function nativeSweepReserveWei(gasPriceWei, estimatedGasUnits) {
  if (gasPriceWei < 0n || estimatedGasUnits < 0n) {
    throw new Error("Sweep fee inputs cannot be negative");
  }
  return transactionGasLimit(estimatedGasUnits) * gasPriceWei;
}

export function projectKeeperFunding({
  gasPriceWei,
  l1BaseFeeWei,
  currentBalanceWei,
}) {
  for (const value of [gasPriceWei, l1BaseFeeWei, currentBalanceWei]) {
    if (value < 0n) throw new Error("Keeper funding inputs cannot be negative");
  }
  const count = BigInt(KEEPER_PRICED_TRANSACTION_COUNT);
  const executionWei = count * KEEPER_AVERAGE_GAS_PER_TRANSACTION * gasPriceWei;
  const l1DataWei = count * KEEPER_AVERAGE_CALLDATA_BYTES * 16n * l1BaseFeeWei;
  const workloadWithHeadroomWei = applyHeadroom(executionWei + l1DataWei);
  const safetyBufferWei = 2n * KEEPER_MINIMUM_OPERATOR_BALANCE_WEI;
  const calculatedTargetWei = safetyBufferWei + workloadWithHeadroomWei;
  const targetBalanceWei =
    calculatedTargetWei > KEEPER_MINIMUM_CAMPAIGN_TARGET_WEI
      ? calculatedTargetWei
      : KEEPER_MINIMUM_CAMPAIGN_TARGET_WEI;
  return {
    pricedTransactions: KEEPER_PRICED_TRANSACTION_COUNT,
    averageGasPerTransaction: KEEPER_AVERAGE_GAS_PER_TRANSACTION,
    averageCalldataBytes: KEEPER_AVERAGE_CALLDATA_BYTES,
    executionWei,
    l1DataWei,
    workloadWithHeadroomWei,
    safetyBufferWei,
    minimumTargetWei: KEEPER_MINIMUM_CAMPAIGN_TARGET_WEI,
    targetBalanceWei,
    currentBalanceWei,
    deficitWei:
      currentBalanceWei < targetBalanceWei
        ? targetBalanceWei - currentBalanceWei
        : 0n,
  };
}

export function projectCampaignCost({
  gasPriceWei,
  l1BaseFeeWei,
  averageGasPerWrite,
  averageCalldataBytes,
  successfulWrites = REQUIRED_SUCCESSFUL_WRITES,
  transactionValueWei,
}) {
  for (const value of [
    gasPriceWei,
    l1BaseFeeWei,
    averageGasPerWrite,
    averageCalldataBytes,
    transactionValueWei,
  ]) {
    if (value < 0n) throw new Error("Campaign cost inputs cannot be negative");
  }
  const count = BigInt(successfulWrites);
  const execution = count * averageGasPerWrite * gasPriceWei;
  const l1Data = count * averageCalldataBytes * 16n * l1BaseFeeWei;
  const base = execution + l1Data + transactionValueWei;
  return {
    executionWei: execution,
    l1DataWei: l1Data,
    transactionValueWei,
    baseWei: base,
    withHeadroomWei: applyHeadroom(base),
    reserveWei: REQUIRED_RESERVE_WEI,
    totalRequiredWei: applyHeadroom(base) + REQUIRED_RESERVE_WEI,
  };
}
