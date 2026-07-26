export type DiscoveryQuery = {
  limit?: string;
  before?: string;
  cursor?: string;
  q?: string;
  asset?: string;
  basketSize?: string;
  creator?: string;
  sort?: string;
  window?: string;
  phase?: string;
};

export type DiscoverySort =
  | "new"
  | "trending"
  | "near_graduation"
  | "graduated"
  | "volume"
  | "market_cap";
export type DiscoveryWindow = "1h" | "6h" | "24h" | "7d" | "all";
export type DiscoveryPhase = "all" | "bonding" | "graduated";

export type ParsedDiscoveryQuery = {
  limit: number;
  before: string | null;
  query: string | null;
  asset: string | null;
  basketSize: number | null;
  creator: string | null;
  invalidCreator: boolean;
  invalidCursor: boolean;
  cursor: DiscoveryCursor | null;
  invalidCanonicalAddress: boolean;
  sort: DiscoverySort;
  window: DiscoveryWindow;
  phase: DiscoveryPhase;
};

export type DiscoveryCursor = {
  version: 1;
  launchId: string;
  sort: DiscoverySort;
  window: DiscoveryWindow;
  phase: DiscoveryPhase;
};

export function encodeDiscoveryCursor(
  cursor: Omit<DiscoveryCursor, "version">,
) {
  return Buffer.from(
    JSON.stringify({ version: 1, ...cursor }),
    "utf8",
  ).toString("base64url");
}

export function decodeDiscoveryCursor(value: string | undefined) {
  if (!value || value.length > 512) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<DiscoveryCursor>;
    const validSort: DiscoverySort[] = [
      "new",
      "trending",
      "near_graduation",
      "graduated",
      "volume",
      "market_cap",
    ];
    const validWindow: DiscoveryWindow[] = ["1h", "6h", "24h", "7d", "all"];
    const validPhase: DiscoveryPhase[] = ["all", "bonding", "graduated"];
    if (
      decoded.version !== 1 ||
      !/^[0-9]{1,19}$/.test(decoded.launchId ?? "") ||
      BigInt(decoded.launchId ?? "0") > 9_223_372_036_854_775_807n ||
      !validSort.includes(decoded.sort as DiscoverySort) ||
      !validWindow.includes(decoded.window as DiscoveryWindow) ||
      !validPhase.includes(decoded.phase as DiscoveryPhase)
    )
      return null;
    return decoded as DiscoveryCursor;
  } catch {
    return null;
  }
}

export function parseDiscoveryQuery(
  input: DiscoveryQuery,
): ParsedDiscoveryQuery {
  const parsedLimit = Number(input.limit ?? "20");
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100)
    : 20;
  const beforeValue = input.before;
  const opaqueCursor = decodeDiscoveryCursor(input.cursor);
  const invalidBefore =
    beforeValue !== undefined &&
    (!/^[0-9]{1,19}$/.test(beforeValue) ||
      BigInt(beforeValue) > 9_223_372_036_854_775_807n);
  const before = invalidBefore ? null : (beforeValue ?? null);
  const query = input.q?.trim().toLowerCase().slice(0, 80) || null;
  const invalidCanonicalAddress = Boolean(
    query?.startsWith("0x") && !/^0x[0-9a-f]{40}$/.test(query),
  );
  const asset = /^0x[0-9a-fA-F]{40}$/.test(input.asset ?? "")
    ? (input.asset as string).toLowerCase()
    : null;
  const requestedSize = Number(input.basketSize);
  const basketSize = [1, 2, 3].includes(requestedSize) ? requestedSize : null;
  const creatorInput = input.creator?.trim() ?? "";
  const invalidCreator =
    creatorInput !== "" && !/^0x[0-9a-fA-F]{40}$/.test(creatorInput);
  const creator =
    invalidCreator || creatorInput === "" ? null : creatorInput.toLowerCase();
  const sortValues: DiscoverySort[] = [
    "new",
    "trending",
    "near_graduation",
    "graduated",
    "volume",
    "market_cap",
  ];
  const windowValues: DiscoveryWindow[] = ["1h", "6h", "24h", "7d", "all"];
  const phaseValues: DiscoveryPhase[] = ["all", "bonding", "graduated"];
  const sort = sortValues.includes(input.sort as DiscoverySort)
    ? (input.sort as DiscoverySort)
    : "new";
  const window = windowValues.includes(input.window as DiscoveryWindow)
    ? (input.window as DiscoveryWindow)
    : "all";
  const phase = phaseValues.includes(input.phase as DiscoveryPhase)
    ? (input.phase as DiscoveryPhase)
    : "all";
  const cursorMatches =
    opaqueCursor === null ||
    (opaqueCursor.sort === sort &&
      opaqueCursor.window === window &&
      opaqueCursor.phase === phase);
  const invalidCursor =
    invalidBefore || Boolean(input.cursor && !opaqueCursor) || !cursorMatches;
  return {
    limit,
    before,
    query,
    asset,
    basketSize,
    creator,
    invalidCreator,
    invalidCursor,
    cursor: invalidCursor ? null : opaqueCursor,
    invalidCanonicalAddress,
    sort,
    window,
    phase,
  };
}
