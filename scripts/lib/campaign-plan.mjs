export const REQUIRED_WALLET_COUNT = 100;
export const REQUIRED_LAUNCH_COUNT = 8;
export const REQUIRED_GRADUATED_COUNT = 3;
export const REQUIRED_SUCCESSFUL_WRITES = 1_500;
export const PRICED_TRANSACTION_COUNT = 2_625;
export const PLANNED_SWEEP_GAS_UNITS_PER_ACTOR = 1_600_000n;
export const REQUIRED_RESERVE_WEI = 1_500_000_000_000_000n;
export const REQUIRED_DISK_HEADROOM_BYTES = 5n * 1024n * 1024n * 1024n;
export const REQUIRED_HEADROOM_BPS = 2_500n;
export const V4_FEE_COLLECTION_MINIMUMS = [0n, 0n];
export const V4_ORACLE_WINDOW_MATURITY_SECONDS = 301;

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

export function assertSchema9Manifest(manifest) {
  if (manifest?.schemaVersion !== 9 || manifest?.chainId !== 46630) {
    throw new Error("Campaign requires a schema-v9 chain-46630 manifest");
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
    manifest.assetRoutes.length !== 24
  ) {
    throw new Error(
      "Campaign requires exactly 24 verified and ready basket routes",
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
  assertSchema9Manifest(manifest);
  const addresses = manifest.assetRoutes.map((route) => route.address);
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== 24) {
    throw new Error("Campaign route catalog contains duplicate addresses");
  }
  const faucetRoutes = manifest.assetRoutes.filter(
    (route) => route.verification === "robinhood-testnet-faucet-stock",
  );
  const controlledRoutes = manifest.assetRoutes.filter(
    (route) => route.verification !== "robinhood-testnet-faucet-stock",
  );
  if (faucetRoutes.length !== 5 || controlledRoutes.length !== 19) {
    throw new Error(
      "Campaign requires five faucet-stock routes and nineteen controlled routes",
    );
  }
  // Keep the five shallow shared faucet-stock routes in the final two,
  // non-graduated launches. The first six baskets therefore use controlled
  // liquidity, while every route remains covered exactly once.
  const orderedRoutes = [
    ...controlledRoutes.slice(0, 18),
    ...faucetRoutes,
    controlledRoutes[18],
  ];
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

export function nativeSweepReserveWei(gasPriceWei, estimatedGasUnits) {
  if (gasPriceWei < 0n || estimatedGasUnits < 0n) {
    throw new Error("Sweep fee inputs cannot be negative");
  }
  return applyHeadroom(estimatedGasUnits) * gasPriceWei;
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
