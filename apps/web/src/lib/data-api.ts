export type LaunchRecord = {
  launch_id: string;
  token: string;
  vault: string;
  market: string;
  creator: string;
  name: string;
  symbol: string;
  assets: string[];
  weights_bps: number[];
  created_block: string;
  updated_block: string;
  formula_version: string;
  campaign_id: string | null;
  campaign_release_sha: string | null;
  automated_test_launch: boolean;
  pool_id?: string | null;
  kingOfForest?: {
    awarded: boolean;
    isCurrent: boolean;
    awardedAt: string | null;
    awardedBlock: string | null;
    qualifyingTransactionHash: string | null;
    qualifyingLogIndex: number | null;
    progressBps: number;
    uniqueTraders: number;
    progressBpsAtAward: number | null;
    uniqueTradersAtAward: number | null;
    marketPhaseAtAward: "bonding" | "graduated" | null;
    policyVersion: string | null;
  };
  metadata?: {
    token: string;
    media_id: string;
    media_status: "active" | "quarantined";
    display_name: string | null;
    bio: string | null;
    website: string | null;
    x_url: string | null;
    telegram_url: string | null;
    discord_url: string | null;
    avatar_media_id: string | null;
    project_website: string | null;
    project_x_url: string | null;
    metadata_cid: string | null;
    metadata_uri: string | null;
    verification_status: "robyn-sanitized" | "external" | "legacy";
    canonical_png_cid: string | null;
    optimized_webp_cid: string | null;
  } | null;
  metrics?: {
    marketCapBase: string;
    priceChangeBps: number;
    priceChangeSource: "indexed" | "demo";
    change1hBps: number | null;
    change6hBps: number | null;
    change24hBps: number | null;
    change7dBps: number | null;
    liquidityBase: string;
    totalVolumeBase: string;
    volume1hBase: string;
    volume6hBase: string;
    volume24hBase: string;
    volume7dBase: string;
    buyVolume24hBase: string;
    sellVolume24hBase: string;
    tradeCount1h: number;
    tradeCount6h: number;
    tradeCount24h: number;
    tradeCount7d: number;
    uniqueTraders1h: number;
    uniqueTraders6h: number;
    uniqueTraders24h: number;
    uniqueTraders7d: number;
    uniqueTraderCount: number;
    holderCount: number;
    tradeCount: number;
    baseSymbol: string;
    marketPhase: "legacy_fixed" | "bonding" | "graduated";
    graduationProgressBps: number;
    graduationThresholdBase: string;
    baseRaised: string;
    remainingCurveTokens: string;
    graduatedPool: string | null;
    liquidityVenue: "uniswap-v4" | "uniswap-v3" | "devnet-locked-pool" | null;
    poolManager?: string | null;
    poolId?: string | null;
    hook?: string | null;
    positionLocker: string | null;
    positionTokenId: string | null;
    poolFeePips: number | null;
  } | null;
};

export type LaunchList = {
  data: LaunchRecord[];
  nextCursor: string | null;
  asOfBlock: string | null;
  indexedAt: string | null;
  queryStatus?: "ok" | "invalid_address";
};

export type LaunchDetail = {
  data: LaunchRecord;
  asOfBlock: string | null;
  indexedAt: string | null;
};
export type KingOfForestResponse = {
  policy: {
    version: string;
    activationBlock: number;
    progressThresholdBps: number;
    minimumUniqueTraders: number;
  } | null;
  current: LaunchRecord | null;
  history: LaunchRecord[];
  asOfBlock: string | null;
  indexedAt: string | null;
};

export type ActivityRecord = {
  block_number: string;
  transaction_hash: string;
  log_index: number;
  address: string;
  topics: string[];
  data: string;
};

export type LaunchActivity = {
  data: ActivityRecord[];
  asOfBlock: string | null;
  indexedAt: string | null;
};

export type LaunchAnalytics = {
  data: {
    formula: string;
    marketType: string;
    marketPhase: "legacy_fixed" | "bonding" | "graduated";
    graduationProgressBps: number;
    graduationThresholdBase: string;
    baseRaised: string;
    remainingCurveTokens: string;
    graduatedPool: string | null;
    liquidityVenue: "uniswap-v4" | "uniswap-v3" | "devnet-locked-pool" | null;
    poolManager?: string | null;
    poolId?: string | null;
    hook?: string | null;
    positionLocker: string | null;
    positionTokenId: string | null;
    poolFeePips: number | null;
    baseSymbol: string;
    feeBps: number;
    protocolFeeBps: number;
    lpFeeBps: number;
    priceBasePerToken: string;
    priceChangeBps: number;
    change1hBps: number | null;
    change6hBps: number | null;
    change24hBps: number | null;
    change7dBps: number | null;
    marketCapBase: string;
    liquidityBase: string;
    totalVolumeBase: string;
    volume1hBase: string;
    volume6hBase: string;
    volume24hBase: string;
    volume7dBase: string;
    buyVolume24hBase: string;
    sellVolume24hBase: string;
    tradeCount1h: number;
    tradeCount6h: number;
    tradeCount24h: number;
    tradeCount7d: number;
    uniqueTraders1h: number;
    uniqueTraders6h: number;
    uniqueTraders24h: number;
    uniqueTraders7d: number;
    buyVolumeBase: string;
    sellVolumeBase: string;
    totalFeesBase: string;
    tradeCount: number;
    uniqueTraderCount: number;
    holderCount: number;
    totalSupply: string;
    circulatingSupply: string;
    tokenReserve: string;
    baseReserve: string;
    graduationBlock: string | null;
    graduationTimestamp: string | null;
    topHolders: Array<{
      address: string;
      balance: string;
      shareBps: string;
      label: string;
    }>;
    recentTrades: Array<{
      side: "buy" | "sell";
      trader: string;
      baseAmount: string;
      tokenAmount: string;
      feeAmount: string;
      blockNumber: string;
      timestamp: string | null;
      transactionHash: string;
    }>;
    chart: Array<{
      blockNumber: string;
      timestamp: string | null;
      price: string;
      cumulativeVolume: string;
      eventType: "launch" | "trade" | "graduation";
      side: "buy" | "sell" | null;
      baseAmount: string;
      transactionHash: string | null;
      logIndex: number;
    }>;
  };
  asOfBlock: string | null;
  indexedAt: string | null;
};

function apiUrl(path: string) {
  const base = process.env.DATA_API_URL ?? "http://127.0.0.1:3100";
  return new URL(path, base);
}

async function getJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Data API returned " + response.status);
  return (await response.json()) as T;
}

export async function getLaunches(
  filters: {
    q?: string;
    asset?: string;
    basketSize?: string;
    sort?: string;
    window?: string;
    phase?: string;
  } = {},
): Promise<LaunchList> {
  const url = apiUrl("/launches");
  url.searchParams.set("limit", "100");
  if (filters.q) url.searchParams.set("q", filters.q);
  if (filters.asset) url.searchParams.set("asset", filters.asset);
  if (filters.basketSize)
    url.searchParams.set("basketSize", filters.basketSize);
  if (filters.sort) url.searchParams.set("sort", filters.sort);
  if (filters.window) url.searchParams.set("window", filters.window);
  if (filters.phase) url.searchParams.set("phase", filters.phase);
  return getJson<LaunchList>(url);
}

export function getLaunch(token: string): Promise<LaunchDetail> {
  return getJson<LaunchDetail>(
    apiUrl("/launches/" + encodeURIComponent(token)),
  );
}

export function getLaunchActivity(token: string): Promise<LaunchActivity> {
  return getJson<LaunchActivity>(
    apiUrl("/launches/" + encodeURIComponent(token) + "/activity?limit=50"),
  );
}

export function getLaunchAnalytics(token: string): Promise<LaunchAnalytics> {
  return getJson<LaunchAnalytics>(
    apiUrl("/launches/" + encodeURIComponent(token) + "/analytics"),
  );
}

export function getKingOfForest(): Promise<KingOfForestResponse> {
  return getJson<KingOfForestResponse>(apiUrl("/king-of-forest"));
}
