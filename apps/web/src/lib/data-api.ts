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
  } = {},
): Promise<LaunchList> {
  const url = apiUrl("/launches");
  url.searchParams.set("limit", "100");
  if (filters.q) url.searchParams.set("q", filters.q);
  if (filters.asset) url.searchParams.set("asset", filters.asset);
  if (filters.basketSize)
    url.searchParams.set("basketSize", filters.basketSize);
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
