export const TOKEN_MARKET_PAGE_SIZE = 10;

export function pageWindow<T>(
  values: readonly T[],
  requestedPage: number,
  pageSize = TOKEN_MARKET_PAGE_SIZE,
) {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(values.length / safePageSize));
  const page = Math.min(
    totalPages,
    Math.max(1, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 1)),
  );
  const startIndex = (page - 1) * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, values.length);

  return {
    items: values.slice(startIndex, endIndex),
    page,
    totalPages,
    startIndex,
    endIndex,
  };
}
