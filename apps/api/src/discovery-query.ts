export type DiscoveryQuery = {
  limit?: string;
  before?: string;
  q?: string;
  asset?: string;
  basketSize?: string;
};

export type ParsedDiscoveryQuery = {
  limit: number;
  before: string | null;
  query: string | null;
  asset: string | null;
  basketSize: number | null;
  invalidCursor: boolean;
  invalidCanonicalAddress: boolean;
};

export function parseDiscoveryQuery(
  input: DiscoveryQuery,
): ParsedDiscoveryQuery {
  const parsedLimit = Number(input.limit ?? "20");
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100)
    : 20;
  const beforeValue = input.before;
  const invalidCursor =
    beforeValue !== undefined &&
    (!/^[0-9]{1,19}$/.test(beforeValue) ||
      BigInt(beforeValue) > 9_223_372_036_854_775_807n);
  const before = invalidCursor ? null : (beforeValue ?? null);
  const query = input.q?.trim().toLowerCase().slice(0, 80) || null;
  const invalidCanonicalAddress = Boolean(
    query?.startsWith("0x") && !/^0x[0-9a-f]{40}$/.test(query),
  );
  const asset = /^0x[0-9a-fA-F]{40}$/.test(input.asset ?? "")
    ? (input.asset as string).toLowerCase()
    : null;
  const requestedSize = Number(input.basketSize);
  const basketSize = [1, 2, 3].includes(requestedSize) ? requestedSize : null;
  return {
    limit,
    before,
    query,
    asset,
    basketSize,
    invalidCursor,
    invalidCanonicalAddress,
  };
}
