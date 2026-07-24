export const REQUIRED_WALLET_COUNT = 100;
export const REQUIRED_LAUNCH_COUNT = 8;
export const REQUIRED_GRADUATED_COUNT = 3;
export const REQUIRED_SUCCESSFUL_WRITES = 1_500;
export const REQUIRED_RESERVE_WEI = 1_500_000_000_000_000n;
export const REQUIRED_HEADROOM_BPS = 2_500n;

export function assertSchema8Manifest(manifest) {
  if (manifest?.schemaVersion !== 8 || manifest?.chainId !== 46630) {
    throw new Error("Campaign requires a schema-v8 chain-46630 manifest");
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
  assertSchema8Manifest(manifest);
  const addresses = manifest.assetRoutes.map((route) => route.address);
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== 24) {
    throw new Error("Campaign route catalog contains duplicate addresses");
  }
  return Array.from({ length: REQUIRED_LAUNCH_COUNT }, (_, index) => ({
    index,
    name: `Sherwood Automated Test ${index + 1}`,
    symbol: `SAT${index + 1}`,
    assets: addresses.slice(index * 3, index * 3 + 3),
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
    const launchIndex = index % REQUIRED_LAUNCH_COUNT;
    value +=
      launchIndex < REQUIRED_GRADUATED_COUNT
        ? 13_000_000_000_000n
        : BigInt(launchIndex - 2) * 400_000_000_000n;
  }
  value += 3n * 250_000_000_000n;
  value += 10n * 200_000_000_000n;
  return value;
}

export function applyHeadroom(value, headroomBps = REQUIRED_HEADROOM_BPS) {
  if (value < 0n || headroomBps < REQUIRED_HEADROOM_BPS) {
    throw new Error("Cost headroom must be at least 25%");
  }
  return value + (value * headroomBps + 9_999n) / 10_000n;
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
